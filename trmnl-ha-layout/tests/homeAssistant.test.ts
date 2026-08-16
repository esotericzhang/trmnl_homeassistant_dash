import { describe, expect, it } from 'vitest'
import { editorPreviewRenderData, HomeAssistantClient } from '../src/homeAssistant.js'
import { renderSvg } from '../src/render.js'
import type { LayoutConfig } from '../src/types.js'

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

  it('fetches all states without exposing upstream error details', async () => {
    const calls: Array<{ url: string; auth: string }> = []
    const fetcher = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), auth: String((init?.headers as Record<string, string>).Authorization) })
      return new Response(JSON.stringify([
        { entity_id: 'sensor.kitchen', state: '21', attributes: { friendly_name: 'Kitchen' } }
      ]), { status: 200 })
    }) as typeof fetch
    const states = await new HomeAssistantClient('http://ha.local:8123', 'secret', fetcher).getStates()

    expect(states).toHaveLength(1)
    expect(calls).toEqual([{ url: 'http://ha.local:8123/api/states', auth: 'Bearer secret' }])

    let cancelled = false
    const failingFetcher = (async () => new Response(new ReadableStream({ cancel: () => { cancelled = true } }), { status: 503 })) as typeof fetch
    await expect(new HomeAssistantClient('http://ha.local:8123', 'secret', failingFetcher).getStates())
      .rejects.toThrow('Home Assistant request failed: 503')
    expect(cancelled).toBe(true)
  })

  it('rejects discovery before fetching when the token is missing', async () => {
    const fetcher = (() => { throw new Error('should not fetch') }) as typeof fetch
    await expect(new HomeAssistantClient('http://ha.local:8123', '', fetcher).getStates())
      .rejects.toThrow('Missing Home Assistant token')
  })

  it('rejects malformed states responses distinctly', async () => {
    const nonArrayFetcher = (async () => new Response(JSON.stringify({ states: [] }), { status: 200 })) as typeof fetch
    await expect(new HomeAssistantClient('http://ha.local:8123', 'secret', nonArrayFetcher).getStates())
      .rejects.toThrow('invalid states response')

    const invalidJsonFetcher = (async () => new Response('{broken', { status: 200 })) as typeof fetch
    await expect(new HomeAssistantClient('http://ha.local:8123', 'secret', invalidJsonFetcher).getStates())
      .rejects.toThrow('invalid states response')
  })

  it('rejects oversized state responses before processing them', async () => {
    let cancelled = false
    const oversizedBody = new ReadableStream({
      cancel() {
        cancelled = true
      }
    })
    const oversizedHeaderFetcher = (async () => new Response(oversizedBody, {
      status: 200,
      headers: { 'Content-Length': String(16 * 1024 * 1024 + 1) }
    })) as typeof fetch
    await expect(new HomeAssistantClient('http://ha.local:8123', 'secret', oversizedHeaderFetcher).getStates())
      .rejects.toThrow('invalid states response')
    expect(cancelled).toBe(true)

  })

  it('accepts more than ten thousand states within the byte limit', async () => {
    const states = Array.from({ length: 10_001 }, (_, index) => ({ entity_id: `sensor.${index}`, state: 'ok', attributes: {} }))
    const fetcher = (async () => new Response(JSON.stringify(states), { status: 200 })) as typeof fetch
    await expect(new HomeAssistantClient('http://ha.local:8123', 'secret', fetcher).getStates()).resolves.toHaveLength(10_001)
  })

  it('accepts attribute-heavy discovery responses within the configured limit', async () => {
    const payload = JSON.stringify([{ entity_id: 'sensor.large', state: 'ok', attributes: { metadata: 'x'.repeat(2 * 1024 * 1024) } }])
    const fetcher = (async () => new Response(payload, { status: 200 })) as typeof fetch

    await expect(new HomeAssistantClient('http://ha.local:8123', 'secret', fetcher).getStates())
      .resolves.toMatchObject([{ entity_id: 'sensor.large', state: 'ok' }])
    await expect(new HomeAssistantClient('http://ha.local:8123', 'secret', fetcher).getStates(undefined, payload.length - 1))
      .rejects.toThrow('invalid states response')
  })

  it('keeps shared-source metric snapshots item-scoped without replacing forecast state', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { shared: 'sensor.shared' } },
      items: [
        { id: 'first', type: 'metric', x: 0, y: 0, width: 180, height: 62, label: 'First', value: '{{ shared }}', unitSource: 'shared', previewSource: 'shared', previewState: '21', previewUnit: '°C' },
        { id: 'second', type: 'metric', x: 200, y: 0, width: 180, height: 62, label: 'Second', value: '{{ shared }}', unitSource: 'shared', previewSource: 'shared', previewState: '45', previewUnit: '%' },
        { id: 'forecast', type: 'forecast', x: 0, y: 80, width: 400, height: 100, source: 'shared' }
      ]
    }
    const data = editorPreviewRenderData(config)
    data.states.shared.attributes.forecast = [{ datetime: '2026-06-24T08:00:00Z', temperature: 61, condition: 'cloudy' }]

    const svg = renderSvg(config, data)

    expect(svg).toContain('21 °C')
    expect(svg).toContain('45 %')
    expect(svg).toContain('cloudy')
  })
})
