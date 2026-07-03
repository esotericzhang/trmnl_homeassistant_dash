import { describe, expect, it } from 'vitest'
import { HomeAssistantClient } from '../src/homeAssistant.js'

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
})
