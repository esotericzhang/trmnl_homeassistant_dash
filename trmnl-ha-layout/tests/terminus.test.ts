import { describe, expect, it } from 'vitest'
import { TerminusClient } from '../src/terminus.js'

describe('TerminusClient', () => {
  const png = Buffer.from('png-bytes')

  it('posts BYOS URI screens with JWT login', async () => {
    const calls: Array<{ url: string, init?: RequestInit }> = []
    const fetcher = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      if (String(url).endsWith('/login')) return json({ access_token: 'jwt' })
      return json({ id: 7 })
    }) as typeof fetch

    const result = await new TerminusClient(fetcher).push(png, {
      apiUrl: 'http://terminus.local',
      login: 'user',
      password: 'pass',
      publicBaseUrl: 'http://addon.local',
      mode: 'byos-uri',
      modelId: 'og',
      screenName: 'ha-layout',
      screenLabel: 'Home Assistant',
      playlistId: '12'
    })

    expect(result).toBe('pushed Terminus screen')
    expect(calls[0].url).toBe('http://terminus.local/login')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ login: 'user', password: 'pass' })
    expect(calls[1].url).toBe('http://terminus.local/api/screens')
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe('jwt')
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      screen: {
        model_id: 'og',
        label: 'Home Assistant',
        name: 'ha-layout',
        uri: 'http://addon.local/screen.png',
        preprocessed: true,
        file_name: 'ha-layout.png',
        playlist_id: '12'
      }
    })
  })

  it('refreshes configured tokens before posting', async () => {
    const authorizations: string[] = []
    const fetcher = (async (url: URL | RequestInfo, init?: RequestInit) => {
      authorizations.push(String((init?.headers as Record<string, string>).Authorization))
      if (String(url).endsWith('/api/jwt')) return json({ access_token: 'fresh' })
      return json({ id: 7 })
    }) as typeof fetch

    await new TerminusClient(fetcher).push(png, {
      apiUrl: 'http://terminus.local',
      accessToken: 'old',
      refreshToken: 'refresh',
      publicBaseUrl: 'http://addon.local',
      mode: 'byos-uri'
    })

    expect(authorizations).toEqual(['old', 'fresh'])
  })

  it('posts BYOS base64 screens when selected', async () => {
    let body = ''
    const fetcher = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      body = String(init?.body)
      return json({ id: 7 })
    }) as typeof fetch

    await new TerminusClient(fetcher).push(png, {
      apiUrl: 'http://terminus.local',
      accessToken: 'jwt',
      mode: 'byos-base64',
      screenName: 'base64-screen'
    })

    expect(JSON.parse(body).screen).toMatchObject({
      data: png.toString('base64'),
      preprocessed: true,
      file_name: 'base64-screen.png'
    })
  })

  it('preserves caller-provided Bearer authorization tokens', async () => {
    let authorization = ''
    const fetcher = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      authorization = String((init?.headers as Record<string, string>).Authorization)
      return json({ id: 7 })
    }) as typeof fetch

    await new TerminusClient(fetcher).push(png, {
      apiUrl: 'http://terminus.local',
      accessToken: 'Bearer jwt',
      mode: 'byos-base64',
      screenName: 'base64-screen'
    })

    expect(authorization).toBe('Bearer jwt')
  })

  it('deletes duplicate screens after a 422 and retries once', async () => {
    const calls: string[] = []
    const fetcher = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${String(url)}`)
      if (calls.length === 1) return new Response('duplicate', { status: 422 })
      if (String(url).endsWith('/api/screens')) return json({ data: [{ id: 9, name: 'ha-layout', model_id: '1' }] })
      return json({ ok: true })
    }) as typeof fetch

    await new TerminusClient(fetcher).push(png, {
      apiUrl: 'http://terminus.local',
      accessToken: 'jwt',
      publicBaseUrl: 'http://addon.local',
      mode: 'byos-uri'
    })

    expect(calls).toEqual([
      'POST http://terminus.local/api/screens',
      'GET http://terminus.local/api/screens',
      'DELETE http://terminus.local/api/screens/9',
      'POST http://terminus.local/api/screens'
    ])
  })

  it('posts raw PNG webhooks', async () => {
    let contentType = ''
    let body: BodyInit | null | undefined
    const fetcher = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      contentType = String((init?.headers as Record<string, string>)['Content-Type'])
      body = init?.body
      return json({ ok: true })
    }) as typeof fetch

    await new TerminusClient(fetcher).push(png, {
      mode: 'raw-webhook',
      webhookUrl: 'http://webhook.local/push'
    })

    expect(contentType).toBe('image/png')
    expect(body).toBeInstanceOf(Uint8Array)
  })
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
