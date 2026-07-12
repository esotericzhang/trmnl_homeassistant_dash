import { describe, expect, it } from 'vitest'
import { HomeAssistantClient, sampleRenderData, selectStateValue } from '../src/homeAssistant.js'

describe('HomeAssistantClient', () => {
  it('fetches an entity state with bearer auth', async () => {
    let auth = ''
    const fetcher = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>).Authorization)
      return new Response(JSON.stringify({ entity_id: 'sensor.test', state: '42', attributes: {} }), { status: 200 })
    }) as typeof fetch
    const client = new HomeAssistantClient('http://ha.local:8123', 'secret', fetcher)
    const state = await client.getState('sensor.test')
    expect(state.state).toBe('42')
    expect(auth).toBe('Bearer secret')
  })

  it('fetches all entity states for sanitized bridge use', async () => {
    let path = ''
    const fetcher = (async (url: URL | RequestInfo, init?: RequestInit) => {
      path = String(url)
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret')
      return new Response(JSON.stringify([{ entity_id: 'sensor.temp', state: '72', attributes: { friendly_name: 'Temp' } }]), { status: 200 })
    }) as typeof fetch
    const client = new HomeAssistantClient('http://ha.local:8123', 'secret', fetcher)
    const states = await client.getStates()
    expect(path).toBe('http://ha.local:8123/api/states')
    expect(states[0].entity_id).toBe('sensor.temp')
  })

  it('bounds and validates the all-states response', async () => {
    const invalidClient = new HomeAssistantClient('http://ha.local:8123', 'secret', (async () =>
      new Response(JSON.stringify({ entity_id: 'sensor.temp' }), { status: 200 })) as typeof fetch)
    await expect(invalidClient.getStates()).rejects.toThrow('must be an array')

    const malformedClient = new HomeAssistantClient('http://ha.local:8123', 'secret', (async () =>
      new Response(JSON.stringify([{ entity_id: 'sensor.temp', state: 72, attributes: {} }]), { status: 200 })) as typeof fetch)
    await expect(malformedClient.getStates()).rejects.toThrow('invalid entity')

    const oversizedClient = new HomeAssistantClient('http://ha.local:8123', 'secret', (async () =>
      new Response(JSON.stringify(Array.from({ length: 10_001 }, (_, index) => ({ entity_id: `sensor.${index}`, state: '0', attributes: {} }))), { status: 200 })) as typeof fetch)
    await expect(oversizedClient.getStates()).rejects.toThrow('exceeds 10000 entities')
  })

  it('applies a timeout signal to the all-states request', async () => {
    let signal: AbortSignal | null | undefined
    const client = new HomeAssistantClient('http://ha.local:8123', 'secret', (async (_url, init) => {
      signal = init?.signal
      return new Response(JSON.stringify([]), { status: 200 })
    }) as typeof fetch)
    await client.getStates()
    expect(signal).toBeInstanceOf(AbortSignal)
  })

  it('collects a selected attribute path for rendering', async () => {
    const fetcher = (async () => new Response(JSON.stringify({
      entity_id: 'sensor.weather',
      state: 'forecast',
      attributes: { forecast: [{ temperature: 61 }] }
    }), { status: 200 })) as typeof fetch
    const client = new HomeAssistantClient('http://ha.local:8123', 'secret', fetcher)
    const data = await client.collect({
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { temperature: 'sensor.weather' }, selectors: { temperature: 'attributes.forecast.0.temperature' } },
      items: []
    })
    expect(data.values.temperature).toBe(61)
  })

  it('fetches shared entities once before applying per-source selectors', async () => {
    let requests = 0
    const fetcher = (async () => {
      requests++
      return new Response(JSON.stringify({
        entity_id: 'sensor.weather',
        state: 'forecast',
        attributes: { forecast: [{ temperature: 61, condition: 'cloudy' }] }
      }), { status: 200 })
    }) as typeof fetch
    const client = new HomeAssistantClient('http://ha.local:8123', 'secret', fetcher)
    const data = await client.collect({
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: {
        entities: { temperature: 'sensor.weather', condition: 'sensor.weather' },
        selectors: {
          temperature: 'attributes.forecast.0.temperature',
          condition: 'attributes.forecast.0.condition'
        }
      },
      items: []
    })

    expect(requests).toBe(1)
    expect(data.values).toMatchObject({ temperature: 61, condition: 'cloudy' })
  })

  it('uses a representative fallback for arbitrary sample sources', () => {
    const data = sampleRenderData({
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { kitchenTemperature: 'sensor.kitchen_temperature' } },
      items: []
    })

    expect(data.values.kitchenTemperature).toBe('42')
  })

  it('builds forecast sample paths beyond representative fields and rows', () => {
    const data = sampleRenderData({
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: {
        entities: { precipitation: 'sensor.weather', humidity: 'sensor.weather' },
        selectors: {
          precipitation: 'attributes.forecast.0.precipitation_probability',
          humidity: 'attributes.forecast.9.humidity'
        }
      },
      items: []
    })

    expect(data.values.precipitation).toBe('42')
    expect(data.values.humidity).toBe('42')
  })

  it.each(['attributes.constructor', 'attributes.__proto__', 'attributes.toString'])(
    'rejects prototype-sensitive selector %s',
    (path) => {
      expect(selectStateValue({ entity_id: 'sensor.test', state: '42', attributes: {} }, path)).toBeUndefined()
    }
  )

  it('does not traverse inherited selector properties', () => {
    const attributes = Object.create({ temperature: 72 }) as Record<string, unknown>
    expect(selectStateValue({ entity_id: 'sensor.test', state: '42', attributes }, 'attributes.temperature')).toBeUndefined()
  })
})
