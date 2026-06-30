import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import type { Settings } from '../src/config.js'
import { loadSettings, saveSettings } from '../src/config.js'
import { app } from '../src/server.js'

describe('server routes', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('expected TCP address')
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('redirects root to /editor', async () => {
    const res = await fetch(`${baseUrl}/`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/editor')
  })

  it('serves PNG output and editor UI with visible Connection Settings', async () => {
    const png = await fetch(`${baseUrl}/screen.png?sample=1`)
    expect(png.headers.get('content-type')).toContain('image/png')
    const bytes = new Uint8Array(await png.arrayBuffer())
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

    const editor = await fetch(`${baseUrl}/editor`)
    const editorHtml = await editor.text()
    expect(editorHtml).toContain('TRMNL Layout Editor')
    expect(editorHtml).toContain('id="preview-frame"')
    expect(editorHtml).toContain('src="/screen.svg?sample=1"')
    expect(editorHtml).toContain('id="overlay"')
    expect(editorHtml).toContain('Connection Settings')
    expect(editorHtml).toContain('<details class="settings" open>')
    expect(editorHtml).toContain('Terminus server URL')
    expect(editorHtml).toContain('id="terminus_api_url"')
    expect(editorHtml).toContain('Home Assistant URL')
    expect(editorHtml).toContain('id="home_assistant_url"')
    expect(editorHtml).toContain('Screen metadata (optional)')
    expect(editorHtml).toContain('id="terminus_model_id"')
    expect(editorHtml).toContain('id="terminus_screen_name"')
    expect(editorHtml).toContain('id="terminus_screen_label"')
    expect(editorHtml).toContain('id="terminus_playlist_id"')
    expect(editorHtml).not.toContain('id="terminus_screen_id"')
  })

  it('serves preview refresh with stored bearer token', async () => {
    const preview = await fetch(`${baseUrl}/preview`)
    const previewHtml = await preview.text()
    expect(previewHtml).toContain("sessionStorage.getItem('trmnl_settings_token')")
    expect(previewHtml).toContain("Authorization:'Bearer '+token")
    expect(previewHtml).toContain("fetch('/api/refresh',{method:'POST',headers:authHeaders()})")
  })
})

describe('settings + terminus auth routes', () => {
  let server: Server
  let baseUrl: string
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    saveSettings({
      homeAssistantUrl: '',
      haToken: '',
      publicBaseUrl: '',
      refreshIntervalSeconds: 0,
      device: null,
      terminus: {
        apiUrl: '',
        mode: 'byos-uri',
        accessToken: 'secret-access-1234',
        refreshToken: 'secret-refresh-5678',
        obtainedAt: 1700000000000
      }
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('expected TCP address')
        baseUrl = `http://127.0.0.1:${address.port}`
        resolve()
      })
    })
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('GET /api/settings masks tokens to last-4', async () => {
    const res = await fetch(`${baseUrl}/api/settings`)
    expect(res.ok).toBe(true)
    const settings = (await res.json()) as Settings
    expect(settings.haToken).toBe('')
    expect(settings.terminus.accessToken).toBe('••••1234')
    expect(settings.terminus.refreshToken).toBe('••••5678')
    expect(settings.terminus.login).toBeUndefined()
    expect(settings.terminus.password).toBeUndefined()
  })

  it('PUT /api/settings round-trips and preserves unmasked tokens', async () => {
    const body: Partial<Settings> = {
      homeAssistantUrl: 'http://ha.local:8123',
      haToken: 'new-ha-token',
      publicBaseUrl: 'http://addon.local',
      refreshIntervalSeconds: 300,
      device: null,
      terminus: {
        apiUrl: 'http://terminus.local',
        mode: 'byos-uri',
        modelId: 'og'
      }
    }
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    expect(res.ok).toBe(true)
    const masked = (await res.json()) as Settings
    expect(masked.homeAssistantUrl).toBe('http://ha.local:8123')
    expect(masked.haToken).toBe('••••oken')

    const direct = loadSettings()
    expect(direct.haToken).toBe('new-ha-token')
    expect(direct.terminus.accessToken).toBe('secret-access-1234')
    expect(direct.terminus.modelId).toBe('og')
  })

  it('requires mutation auth for layout config updates', async () => {
    const existing = loadSettings()
    saveSettings({ ...existing, settingsToken: 'guard-token' })

    const unauthorized = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(unauthorized.status).toBe(401)
  })

  it('requires mutation auth for manual refresh pushes', async () => {
    const existing = loadSettings()
    saveSettings({ ...existing, settingsToken: 'guard-token' })

    const unauthorized = await fetch(`${baseUrl}/api/refresh`, { method: 'POST' })
    expect(unauthorized.status).toBe(401)
  })

  it('rejects unauthenticated mutations in production without an explicit no-auth override', async () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const existing = loadSettings()
      saveSettings({ ...existing, settingsToken: undefined })

      const unauthorized = await fetch(`${baseUrl}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      expect(unauthorized.status).toBe(401)
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('keeps existing tokens when masked values submitted', async () => {
    const existing = loadSettings()
    saveSettings({ ...existing, settingsToken: 'secret-settings-9012' })

    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret-settings-9012' },
      body: JSON.stringify({
        homeAssistantUrl: '',
        haToken: '••••12ab',
        settingsToken: '••••9012',
        publicBaseUrl: '',
        refreshIntervalSeconds: 0,
        terminus: {
          apiUrl: '',
          mode: 'byos-uri',
          accessToken: '••••1234',
          refreshToken: '••••5678'
        }
      })
    })
    expect(res.ok).toBe(true)
    const direct = loadSettings()
    expect(direct.haToken).toBe('')
    expect(direct.settingsToken).toBe('secret-settings-9012')
    expect(direct.terminus.accessToken).toBe('secret-access-1234')
    expect(direct.terminus.refreshToken).toBe('secret-refresh-5678')
  })

  it('preserves hidden optional terminus fields when omitted', async () => {
    const existing = loadSettings()
    saveSettings({
      ...existing,
      terminus: {
        ...existing.terminus,
        webhookUrl: 'http://webhook.local/push',
        modelId: 'og',
        screenName: 'stored-screen',
        screenLabel: 'Stored Screen',
        playlistId: 'playlist-1',
        screenId: 'screen-1'
      }
    })

    const res = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        homeAssistantUrl: '',
        publicBaseUrl: '',
        refreshIntervalSeconds: 0,
        terminus: {
          apiUrl: 'http://terminus.local',
          mode: 'byos-uri',
          modelId: ''
        }
      })
    })
    expect(res.ok).toBe(true)
    const direct = loadSettings()
    expect(direct.terminus.webhookUrl).toBe('http://webhook.local/push')
    expect(direct.terminus.modelId).toBe('')
    expect(direct.terminus.screenName).toBe('stored-screen')
    expect(direct.terminus.screenLabel).toBe('Stored Screen')
    expect(direct.terminus.playlistId).toBe('playlist-1')
    expect(direct.terminus.screenId).toBe('screen-1')
  })

  it('POST /api/terminus/login proxies to Terminus and persists tokens', async () => {
    const calls: Array<{ url: string; body?: unknown }> = []
    globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      const urlString = String(url)
      if (urlString.endsWith('/login') && !urlString.includes('127.0.0.1')) {
        calls.push({ url: urlString, body: init?.body ? JSON.parse(String(init.body)) : undefined })
        return new Response(JSON.stringify({ access_token: 'fresh-access', refresh_token: 'fresh-refresh' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      return originalFetch(url, init)
    }) as typeof fetch

    const res = await fetch(`${baseUrl}/api/terminus/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiUrl: 'http://terminus.local', login: 'user@example.com', password: 'p4ss' })
    })
    expect(res.ok).toBe(true)
    const result = await res.json() as { success: boolean; obtained_at: number }
    expect(result.success).toBe(true)
    expect(result.obtained_at).toBeTypeOf('number')

    expect(calls[0].url).toBe('http://terminus.local/login')
    expect(calls[0].body).toEqual({ login: 'user@example.com', password: 'p4ss' })

    const direct = loadSettings()
    expect(direct.terminus.apiUrl).toBe('http://terminus.local')
    expect(direct.terminus.accessToken).toBe('fresh-access')
    expect(direct.terminus.refreshToken).toBe('fresh-refresh')
    expect(direct.terminus.obtainedAt).toBe(result.obtained_at)
    expect(direct.terminus.login).toBeUndefined()
    expect(direct.terminus.password).toBeUndefined()
  })

  it('POST /api/terminus/login rejects missing fields', async () => {
    const res = await fetch(`${baseUrl}/api/terminus/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiUrl: 'http://terminus.local' })
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { success: boolean }
    expect(body.success).toBe(false)
  })

  it('DELETE /api/terminus/tokens clears stored tokens', async () => {
    const res = await fetch(`${baseUrl}/api/terminus/tokens`, { method: 'DELETE' })
    expect(res.ok).toBe(true)
    const direct = loadSettings()
    expect(direct.terminus.accessToken).toBeUndefined()
    expect(direct.terminus.refreshToken).toBeUndefined()
    expect(direct.terminus.obtainedAt).toBeUndefined()
  })
})
