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

describe('figma bridge routes', () => {
  let server: Server
  let baseUrl: string
  const originalFetch = globalThis.fetch

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

  beforeEach(() => {
    saveSettings({
      homeAssistantUrl: 'http://ha.local:8123',
      haToken: 'secret-ha-token',
      publicBaseUrl: '',
      refreshIntervalSeconds: 0,
      device: null,
      terminus: { apiUrl: '', mode: 'byos-uri' }
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('GET /api/figma/entities returns sanitized Home Assistant entities', async () => {
    globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      const urlString = String(url)
      if (urlString.startsWith(baseUrl)) return originalFetch(url, init)
      expect(urlString).toBe('http://ha.local:8123/api/states')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret-ha-token')
      return new Response(JSON.stringify([
        {
          entity_id: 'sensor.temperature',
          state: '72.4',
          attributes: {
            friendly_name: 'https://example.test?token=name-secret',
            unit_of_measurement: 'token=unit-secret',
            device_class: 'session=device-secret',
            forecast: [{ temperature: 61, condition: 'cloudy', pin: 1234, access_code: true, url: 'https://example.test?token=secret' }],
            current: 2468,
            native_value: 3579,
            status: false,
            api_key: 'must-not-leak',
            session: 'must-not-leak-either'
          }
        },
        {
          entity_id: 'input_text.access_code',
          state: '1234',
          attributes: { friendly_name: 'Access code', current: 1234, status: '1234' }
        },
        { entity_id: 'sensor.door_pin', state: '7391', attributes: { friendly_name: 'Door PIN', native_value: 7391 } },
        { entity_id: 'sensor.api_credential', state: 'opaque-value', attributes: { device_class: 'temperature', status: 'opaque-value' } }
      ]), { status: 200 })
    }) as typeof fetch

    const res = await fetch(`${baseUrl}/api/figma/entities`)
    expect(res.ok).toBe(true)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const body = await res.json() as { source: string; entities: Array<Record<string, unknown>> }
    expect(body.source).toBe('live')
    expect(body.entities).toEqual([
      {
        entity_id: 'sensor.api_credential',
        name: 'sensor.api_credential',
        state: '—',
        unit: null,
        domain: 'sensor',
        device_class: null,
        values: [{ path: 'state', label: 'State', value: '—' }]
      },
      {
        entity_id: 'sensor.door_pin',
        name: 'sensor.door_pin',
        state: '—',
        unit: null,
        domain: 'sensor',
        device_class: null,
        values: [{ path: 'state', label: 'State', value: '—' }]
      },
      {
        entity_id: 'sensor.temperature',
        name: 'sensor.temperature',
        state: '72.4',
        unit: null,
        domain: 'sensor',
        device_class: null,
        values: [
          { path: 'state', label: 'State', value: '72.4' },
          { path: 'attributes.forecast.0.temperature', label: 'forecast.0.temperature', value: 61 },
          { path: 'attributes.forecast.0.condition', label: 'forecast.0.condition', value: 'cloudy' }
        ]
      }
    ])
    expect(JSON.stringify(body)).not.toContain('secret-ha-token')
    expect(JSON.stringify(body)).not.toContain('must-not-leak')
    expect(JSON.stringify(body)).not.toContain('1234')
    expect(JSON.stringify(body)).not.toContain('2468')
    expect(JSON.stringify(body)).not.toContain('3579')
    expect(JSON.stringify(body)).not.toContain('7391')
    expect(JSON.stringify(body)).not.toContain('opaque-value')
    expect(JSON.stringify(body)).not.toContain('example.test')
    expect(JSON.stringify(body)).not.toContain('unit-secret')
    expect(JSON.stringify(body)).not.toContain('device-secret')
  })

  it('GET /api/figma/entities rejects no-token production access', async () => {
    const originalNodeEnv = process.env.NODE_ENV
    const existing = loadSettings()
    saveSettings({ ...existing, settingsToken: undefined })
    process.env.NODE_ENV = 'production'

    try {
      const res = await fetch(`${baseUrl}/api/figma/entities`)
      expect(res.status).toBe(401)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('GET /api/figma/entities requires auth when settings token is configured', async () => {
    const existing = loadSettings()
    saveSettings({ ...existing, haToken: '', settingsToken: 'guard-token' })

    const unauthorized = await fetch(`${baseUrl}/api/figma/entities`)
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get('access-control-allow-origin')).toBe('*')

    const authorized = await fetch(`${baseUrl}/api/figma/entities`, {
      headers: { Authorization: 'Bearer guard-token' }
    })
    expect(authorized.ok).toBe(true)
    expect(authorized.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('POST /api/figma/preview-layout requires auth when settings token is configured', async () => {
    const existing = loadSettings()
    saveSettings({ ...existing, haToken: '', settingsToken: 'guard-token' })
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 800, height: 480, widgets: [] })
    }

    const unauthorized = await fetch(`${baseUrl}/api/figma/preview-layout`, request)
    expect(unauthorized.status).toBe(401)

    const authorized = await fetch(`${baseUrl}/api/figma/preview-layout`, {
      ...request,
      headers: { ...request.headers, Authorization: 'Bearer guard-token' }
    })
    expect(authorized.ok).toBe(true)
  })

  it('PUT /api/figma/layout maps widgets into the existing layout schema', async () => {
    const res = await fetch(`${baseUrl}/api/figma/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width: 800,
        height: 480,
        widgets: [
          { type: 'text', staticText: 'Kitchen', x: 20, y: 18, width: 220, height: 32, fontSize: 26, align: 'left' },
          { type: 'metric_card', entity: 'sensor.kitchen_temperature', unit: '°F', label: 'Kitchen Temp', x: 24, y: 70, width: 210, height: 92, fontSize: 34 }
        ]
      })
    })
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.frame.width).toBe(800)
    expect(body.data.entities.kitchenTemperature).toBe('sensor.kitchen_temperature')
    expect(body.items[0]).toMatchObject({ type: 'text', text: 'Kitchen', x: 20, y: 18, width: 220, height: 32 })
    expect(body.items[1]).toMatchObject({ type: 'metric', label: 'Kitchen Temp', value: '{{ kitchenTemperature }}°F' })
  })

  it('PUT /api/figma/layout preserves explicitly empty static text', async () => {
    const res = await fetch(`${baseUrl}/api/figma/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 800, height: 480, widgets: [{ type: 'text', staticText: '', x: 20, y: 18, width: 220, height: 32 }] })
    })

    expect(res.ok).toBe(true)
    expect((await res.json()).items[0].text).toBe('')
  })

  it('PUT /api/config returns 400 for invalid client layout data', async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frame: { width: 800, height: 480 }, data: { entities: {}, selectors: { missing: 'state' } }, items: [] })
    })

    expect(res.status).toBe(400)
    expect((await res.json()).message).toContain('must reference an existing entity key')
  })

  it('PUT /api/figma/layout reuses sources for repeated entity bindings', async () => {
    const res = await fetch(`${baseUrl}/api/figma/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width: 800,
        height: 480,
        widgets: [
          { type: 'text', entity: 'sensor.kitchen_temperature', x: 20, y: 20, width: 220, height: 32 },
          { type: 'metric_card', entity: 'sensor.kitchen_temperature', x: 20, y: 70, width: 220, height: 92 }
        ]
      })
    })

    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.data.entities).toEqual({ kitchenTemperature: 'sensor.kitchen_temperature' })
    expect(body.items[0].text).toContain('{{ kitchenTemperature }}')
    expect(body.items[1].value).toBe('{{ kitchenTemperature }}')
  })

  it('PUT /api/figma/layout saves attribute selectors and formatter presets', async () => {
    const res = await fetch(`${baseUrl}/api/figma/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width: 800,
        height: 480,
        widgets: [
          { type: 'metric_card', entity: 'sensor.sleep', label: 'Sleep', valuePath: 'state', format: 'minutes', x: 20, y: 20, width: 220, height: 92 },
          { type: 'metric_card', entity: 'sensor.sleep_with_unit', unit: 'min', label: 'Sleep with unit', valuePath: 'state', format: 'minutes', x: 260, y: 20, width: 220, height: 92 },
          { type: 'text', entity: 'sensor.weather', unit: '°F', label: 'First temp', valuePath: 'attributes.forecast.0.temperature', x: 20, y: 130, width: 220, height: 32 }
        ]
      })
    })

    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.items[0].value).toBe('{{ sleep | minutes }}')
    expect(body.items[1].value).toBe('{{ sleepWithUnit | minutes }}')
    expect(body.items[2].text).toBe('First temp: {{ weather }}')
    expect(body.data.selectors).toEqual({ weather: 'attributes.forecast.0.temperature' })
  })

  it('PUT /api/figma/layout rejects widgets outside the frame', async () => {
    const res = await fetch(`${baseUrl}/api/figma/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 800, height: 480, widgets: [{ type: 'metric_card', entity: 'sensor.bad', x: 790, y: 10, width: 40, height: 40 }] })
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('outside the 800x480 frame')
  })

  it('PUT /api/figma/layout validates normalized geometry', async () => {
    const res = await fetch(`${baseUrl}/api/figma/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 800, height: 480, widgets: [{ type: 'text', staticText: 'Tiny', x: 799.6, y: 10, width: 0.4, height: 20 }] })
    })

    expect(res.status).toBe(400)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('position and size must be positive')
  })

  it.each([
    ['label', { label: { invalid: true } }],
    ['staticText', { staticText: 42 }],
    ['weight object', { weight: { invalid: true } }],
    ['weight injection', { weight: '" onload="alert(1)' }],
    ['weight out of range', { weight: 1001 }],
    ['rounded fontSize', { fontSize: 0.4 }]
  ])('PUT /api/figma/layout rejects invalid %s fields', async (_field, invalid) => {
    const res = await fetch(`${baseUrl}/api/figma/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 800, height: 480, widgets: [{ type: 'text', x: 10, y: 10, width: 100, height: 30, ...invalid }] })
    })

    expect(res.status).toBe(400)
  })

  it.each([
    ['unit length', { unit: 'u'.repeat(65) }],
    ['label length', { label: 'l'.repeat(257) }],
    ['staticText length', { staticText: 't'.repeat(4097) }],
    ['unit control character', { unit: 'degrees\u0000F' }],
    ['label control character', { label: 'Kitchen\u0007' }],
    ['staticText control character', { staticText: 'Line\u000Bbreak' }]
  ])('PUT /api/figma/layout rejects invalid %s', async (_field, invalid) => {
    const res = await fetch(`${baseUrl}/api/figma/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 800, height: 480, widgets: [{ type: 'text', x: 10, y: 10, width: 100, height: 30, ...invalid }] })
    })

    expect(res.status).toBe(400)
  })

  it.each(['.', 'sensor.', '.temperature', 'sensor.bad id', 'sensor.bad/path', 'Sensor.temperature'])(
    'PUT /api/figma/layout rejects malformed entity id %s',
    async (entity) => {
      const res = await fetch(`${baseUrl}/api/figma/layout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width: 800, height: 480, widgets: [{ type: 'text', entity, x: 10, y: 10, width: 100, height: 30 }] })
      })

      expect(res.status).toBe(400)
    }
  )
})
