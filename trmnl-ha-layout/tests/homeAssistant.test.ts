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

    const failingFetcher = (async () => new Response('token=secret private details', { status: 503 })) as typeof fetch
    await expect(new HomeAssistantClient('http://ha.local:8123', 'secret', failingFetcher).getStates())
      .rejects.toThrow('Home Assistant request failed: 503')
  })

  it('rejects discovery before fetching when the token is missing', async () => {
    const fetcher = (() => { throw new Error('should not fetch') }) as typeof fetch
    await expect(new HomeAssistantClient('http://ha.local:8123', '', fetcher).getStates())
      .rejects.toThrow('Missing Home Assistant token')
  })
})
