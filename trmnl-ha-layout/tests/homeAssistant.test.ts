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
})
