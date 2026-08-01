import fs from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import type { Settings } from '../src/config.js'
import { loadSettings, resolveSettingsPath, saveSettings } from '../src/config.js'
import { app, terminusOptionsForSchedule } from '../src/server.js'
import { loadScheduleLayout, loadSchedulesIndex, resolveScheduleLayoutPath, saveScheduleLayout } from '../src/schedules.js'
import type { Schedule } from '../src/schedules.js'

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

  it('resolves schedule screen IDs from either compatibility field', () => {
    const schedule = {
      id: 'compatibility-test',
      name: 'Compatibility test',
      destination: { screenId: 'screen-id', deviceId: 'device-id' }
    } as Schedule

    expect(terminusOptionsForSchedule(schedule).screenId).toBe('screen-id')
    schedule.destination.screenId = null
    expect(terminusOptionsForSchedule(schedule).screenId).toBe('device-id')
  })

  it('serves PNG output and editor UI with global connection settings', async () => {
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
    expect(editorHtml).toContain('id="global-settings"')
    expect(editorHtml).toContain('id="global-modal" class="manager"')
    expect(editorHtml).toContain('Global connection and authentication')
    expect(editorHtml).toContain('Terminus server URL')
    expect(editorHtml).toContain('id="terminus_api_url"')
    expect(editorHtml).toContain('Home Assistant URL')
    expect(editorHtml).toContain('id="home_assistant_url"')
    expect(editorHtml).not.toContain('id="destination-device"')
    expect(editorHtml).not.toContain('id="destination-playlist"')
    expect(editorHtml).not.toContain('Screen / device ID')
    expect(editorHtml).not.toContain('Playlist ID')
    expect(editorHtml).toContain('id="model-id"')
    expect(editorHtml).toContain('id="screen-name"')
    expect(editorHtml).toContain('id="screen-label"')
    expect(editorHtml).not.toContain('id="terminus_screen_id"')
  })

  it('creates and edits independent schedules while legacy routes keep the default layout', async () => {
    const listBefore = await fetch(`${baseUrl}/api/schedules`).then((response) => response.json()) as {
      defaultScheduleId: string
      schedules: Array<{ id: string }>
    }
    expect(listBefore.schedules.some((schedule) => schedule.id === listBefore.defaultScheduleId)).toBe(true)

    const createdResponse = await fetch(`${baseUrl}/api/schedules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Kitchen' })
    })
    expect(createdResponse.status).toBe(201)
    const created = await createdResponse.json() as { id: string; name: string; enabled: boolean }
    expect(created).toMatchObject({ name: 'Kitchen', enabled: false })

    const blank = await fetch(`${baseUrl}/api/schedules/${created.id}/config`).then((response) => response.json()) as { items: unknown[] }
    expect(blank.items).toEqual([])

    const defaultConfig = await fetch(`${baseUrl}/api/config`).then((response) => response.json()) as { items: Array<{ id: string }> }
    expect(defaultConfig.items.length).toBeGreaterThan(0)

    const patched = await fetch(`${baseUrl}/api/schedules/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: true,
        timing: { kind: 'daily', time: '07:15', timezone: 'America/New_York' },
        destination: { deviceId: 'screen-text-id', playlistId: 'playlist-text-id' }
      })
    }).then((response) => response.json()) as { timing: unknown; destination: unknown }
    expect(patched.timing).toEqual({ kind: 'daily', time: '07:15', timezone: 'America/New_York' })
    expect(patched.destination).toMatchObject({ deviceId: 'screen-text-id', playlistId: 'playlist-text-id' })

    const svg = await fetch(`${baseUrl}/schedules/${created.id}/screen.svg?sample=1`)
    expect(svg.headers.get('content-type')).toContain('image/svg+xml')

    const legacySvg = await fetch(`${baseUrl}/screen.svg?sample=1&schedule_id=${created.id}`).then((response) => response.text())
    const defaultSvg = await fetch(`${baseUrl}/screen.svg?sample=1`).then((response) => response.text())
    expect(legacySvg).toBe(defaultSvg)
  })

  it('returns 404 for unknown schedule routes', async () => {
    const response = await fetch(`${baseUrl}/api/schedules/missing/config`)
    expect(response.status).toBe(404)
  })

  it('renders an unsaved schedule preview without persisting it', async () => {
    const list = await fetch(`${baseUrl}/api/schedules`).then((response) => response.json()) as { defaultScheduleId: string }
    const saved = loadScheduleLayout(list.defaultScheduleId)
    const draft = structuredClone(saved)
    draft.items = draft.items.filter(item => item.id !== draft.items[0]?.id)
    const response = await fetch(`${baseUrl}/api/schedules/${list.defaultScheduleId}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft)
    })
    expect(response.headers.get('content-type')).toContain('image/svg+xml')
    expect(loadScheduleLayout(list.defaultScheduleId).items).toHaveLength(saved.items.length)
  })

  it('returns a sanitized client error for invalid draft previews', async () => {
    const list = await fetch(`${baseUrl}/api/schedules`).then((response) => response.json()) as { defaultScheduleId: string }
    const response = await fetch(`${baseUrl}/api/schedules/${list.defaultScheduleId}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frame: { width: -1 } })
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ status: 'error', message: 'Invalid layout preview request.' })

    const missing = await fetch(`${baseUrl}/api/schedules/missing/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(missing.status).toBe(404)
  })

  it('returns a sanitized server error for unexpected draft preview failures', async () => {
    const list = await fetch(`${baseUrl}/api/schedules`).then((response) => response.json()) as { defaultScheduleId: string }
    const saved = loadScheduleLayout(list.defaultScheduleId)
    const send = app.response.send
    const sendSpy = vi.spyOn(app.response, 'send').mockImplementationOnce(function () {
      throw new Error('private renderer failure')
    }).mockImplementation(send)

    try {
      const response = await fetch(`${baseUrl}/api/schedules/${list.defaultScheduleId}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saved)
      })
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ status: 'error', message: 'Unable to render layout preview.' })
    } finally {
      sendSpy.mockRestore()
    }
  })

  it('returns sanitized client errors for invalid persisted layout writes and rolls back combined updates', async () => {
    const list = await fetch(`${baseUrl}/api/schedules`).then((response) => response.json()) as { defaultScheduleId: string }
    const originalSchedule = await fetch(`${baseUrl}/api/schedules/${list.defaultScheduleId}`).then((response) => response.json()) as { name: string }

    for (const path of [`/api/schedules/${list.defaultScheduleId}/config`, '/api/config']) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame: { width: -1 } })
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ status: 'error', message: 'Invalid layout configuration.' })
    }

    const combined = await fetch(`${baseUrl}/api/schedules/${list.defaultScheduleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule: { name: 'Should roll back' }, config: { frame: { width: -1 } } })
    })
    expect(combined.status).toBe(400)
    expect(await combined.json()).toEqual({ status: 'error', message: 'Invalid layout configuration.' })
    const currentSchedule = await fetch(`${baseUrl}/api/schedules/${list.defaultScheduleId}`).then((response) => response.json()) as { name: string }
    expect(currentSchedule.name).toBe(originalSchedule.name)
  })

  it('sanitizes malformed layouts on every public render route', async () => {
    const scheduleId = loadSchedulesIndex().defaultScheduleId
    const layoutPath = resolveScheduleLayoutPath(scheduleId)
    const original = fs.readFileSync(layoutPath, 'utf8')
    fs.writeFileSync(layoutPath, 'items:\n  - previewState: private malformed snapshot\n    value: [', 'utf8')

    try {
      for (const path of [
        '/screen.svg?sample=1', '/screen.png?sample=1', '/render?sample=1',
        `/schedules/${scheduleId}/screen.svg?sample=1`, `/schedules/${scheduleId}/screen.png?sample=1`, `/schedules/${scheduleId}/render?sample=1`
      ]) {
        const response = await fetch(`${baseUrl}${path}`)
        expect(response.status).toBe(500)
        expect(response.headers.get('content-type')).toContain('application/json')
        expect(await response.json()).toEqual({ status: 'error', message: 'Unable to render layout.' })
      }
    } finally {
      fs.writeFileSync(layoutPath, original, 'utf8')
    }

    for (const path of ['/schedules/missing/screen.svg', '/schedules/missing/screen.png', '/schedules/missing/render']) {
      expect((await fetch(`${baseUrl}${path}`)).status).toBe(404)
    }
  })

  it('masks schedule webhook URLs and rejects client-owned status updates', async () => {
    const list = await fetch(`${baseUrl}/api/schedules`).then((response) => response.json()) as { defaultScheduleId: string }
    await fetch(`${baseUrl}/api/schedules/${list.defaultScheduleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination: { webhookUrl: 'https://hooks.example/secret-key' },
        status: { result: 'forged' }
      })
    })

    const visible = await fetch(`${baseUrl}/api/schedules/${list.defaultScheduleId}`).then((response) => response.json()) as {
      destination: { webhookUrl: string }
      status: { result: string | null }
    }
    expect(visible.destination.webhookUrl).toBe('••••')
    expect(visible.status.result).not.toBe('forged')
  })

  it('records skipped pushes without marking them successful', async () => {
    const list = await fetch(`${baseUrl}/api/schedules`).then((response) => response.json()) as { defaultScheduleId: string }
    const response = await fetch(`${baseUrl}/api/schedules/${list.defaultScheduleId}/push`, { method: 'POST' })
    expect(response.ok).toBe(true)
    const body = await response.json() as { status: { result: string; lastSuccessAt: string | null; error: string } }
    expect(body.status.result).toMatch(/^skipped:/)
    expect(body.status.lastSuccessAt).toBeNull()
    expect(body.status.error).toMatch(/^skipped:/)
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

  it('discovers sanitized Home Assistant entities with the configured bearer token', async () => {
    saveSettings({ ...loadSettings(), homeAssistantUrl: 'http://ha.local:8123', haToken: 'ha-secret' })
    let upstreamAuth = ''
    globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url) === 'http://ha.local:8123/api/states') {
        upstreamAuth = String((init?.headers as Record<string, string>).Authorization)
        return new Response(JSON.stringify([
          { entity_id: 'light.porch', state: 'on', attributes: { friendly_name: 'Porch Light', sensitive_blob: 'do-not-return' } },
          { entity_id: 'sensor.kitchen_temperature', state: '21.5', attributes: { friendly_name: 'Kitchen Temperature', unit_of_measurement: '°C', latitude: 12 } },
          { entity_id: 'invalid', state: 'ignored', attributes: {} }
        ]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return originalFetch(url, init)
    }) as typeof fetch

    const res = await fetch(`${baseUrl}/api/home-assistant/entities`)
    expect(res.ok).toBe(true)
    expect(upstreamAuth).toBe('Bearer ha-secret')
    const body = await res.json() as { entities: unknown[] }
    expect(body.entities).toEqual([
      { entityId: 'light.porch', friendlyName: 'Porch Light', domain: 'light', state: 'on' },
      { entityId: 'sensor.kitchen_temperature', friendlyName: 'Kitchen Temperature', domain: 'sensor', state: '21.5', unitOfMeasurement: '°C' }
    ])
    expect(JSON.stringify(body)).not.toContain('ha-secret')
    expect(JSON.stringify(body)).not.toContain('sensitive_blob')
    expect(JSON.stringify(body)).not.toContain('latitude')
  })

  it('returns clear non-secret Home Assistant discovery errors', async () => {
    let res = await fetch(`${baseUrl}/api/home-assistant/entities`)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('credentials are not configured')

    saveSettings({ ...loadSettings(), homeAssistantUrl: 'http://ha.local:8123', haToken: 'ha-secret' })
    globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url) === 'http://ha.local:8123/api/states') {
        return new Response('Bearer ha-secret upstream private body', { status: 401 })
      }
      return originalFetch(url, init)
    }) as typeof fetch
    res = await fetch(`${baseUrl}/api/home-assistant/entities`)
    expect(res.status).toBe(401)
    const text = await res.text()
    expect(text).toContain('rejected the configured credentials (401)')
    expect(text).not.toContain('ha-secret')
    expect(text).not.toContain('upstream private body')
  })

  it('returns safe errors for malformed and timed-out discovery responses', async () => {
    saveSettings({ ...loadSettings(), homeAssistantUrl: 'http://ha.local:8123', haToken: 'ha-secret' })
    globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url) === 'http://ha.local:8123/api/states') return new Response(JSON.stringify({ states: [] }), { status: 200 })
      return originalFetch(url, init)
    }) as typeof fetch
    let res = await fetch(`${baseUrl}/api/home-assistant/entities`)
    expect(res.status).toBe(502)
    expect(await res.text()).toContain('invalid entity response')

    globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url) === 'http://ha.local:8123/api/states') {
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        throw new DOMException('timed out', 'TimeoutError')
      }
      return originalFetch(url, init)
    }) as typeof fetch
    res = await fetch(`${baseUrl}/api/home-assistant/entities`)
    expect(res.status).toBe(504)
    const text = await res.text()
    expect(text).toContain('discovery timed out')
    expect(text).not.toContain('ha-secret')
  })

  it('preserves discovery timeouts raised while streaming the response body', async () => {
    saveSettings({ ...loadSettings(), homeAssistantUrl: 'http://ha.local:8123', haToken: 'ha-secret' })
    globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url) === 'http://ha.local:8123/api/states') {
        expect(init?.signal).toBeInstanceOf(AbortSignal)
        return new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('['))
            controller.error(new DOMException('timed out after headers', 'TimeoutError'))
          }
        }), { status: 200 })
      }
      return originalFetch(url, init)
    }) as typeof fetch

    const response = await fetch(`${baseUrl}/api/home-assistant/entities`)
    expect(response.status).toBe(504)
    const text = await response.text()
    expect(text).toContain('discovery timed out')
    expect(text).not.toContain('ha-secret')
    expect(text).not.toContain('timed out after headers')
  })

  it('returns a sanitized gateway error for oversized discovery responses', async () => {
    saveSettings({ ...loadSettings(), homeAssistantUrl: 'http://ha.local:8123', haToken: 'ha-secret' })
    globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url) === 'http://ha.local:8123/api/states') {
        return new Response('[]', { status: 200, headers: { 'Content-Length': String(16 * 1024 * 1024 + 1) } })
      }
      return originalFetch(url, init)
    }) as typeof fetch

    const response = await fetch(`${baseUrl}/api/home-assistant/entities`)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ status: 'error', message: 'Home Assistant returned an invalid entity response.' })
  })

  it('sanitizes runtime configuration failures during entity discovery', async () => {
    const settingsPath = resolveSettingsPath()
    const original = fs.readFileSync(settingsPath, 'utf8')
    fs.writeFileSync(settingsPath, '{ private malformed settings', 'utf8')
    try {
      const response = await fetch(`${baseUrl}/api/home-assistant/entities`)
      expect(response.status).toBe(502)
      const text = await response.text()
      expect(text).toContain('Could not connect to the configured Home Assistant instance.')
      expect(text).not.toContain('malformed settings')
      expect(text).not.toContain('JSON')
    } finally {
      fs.writeFileSync(settingsPath, original, 'utf8')
    }
  })

  it('requires settings authentication for Home Assistant discovery', async () => {
    saveSettings({ ...loadSettings(), homeAssistantUrl: 'http://ha.local:8123', haToken: 'ha-secret', settingsToken: 'guard-token' })
    const unauthorized = await fetch(`${baseUrl}/api/home-assistant/entities`)
    expect(unauthorized.status).toBe(401)
  })

  it('requires settings authentication for config reads containing preview snapshots', async () => {
    const scheduleId = loadSchedulesIndex().defaultScheduleId
    const original = loadScheduleLayout(scheduleId)
    const snapshot = structuredClone(original)
    snapshot.data.entities.private = 'sensor.private'
    snapshot.items.push({
      id: 'private-preview', type: 'metric', x: 0, y: 0, width: 100, height: 60,
      label: 'Private', value: '{{ private }}', previewSource: 'private', previewState: 'locked', previewUnit: 'secret'
    })
    saveScheduleLayout(scheduleId, snapshot)
    saveSettings({ ...loadSettings(), settingsToken: 'guard-token' })

    try {
      for (const path of [`/api/schedules/${scheduleId}/config`, '/api/config']) {
        const unauthorized = await fetch(`${baseUrl}${path}`)
        expect(unauthorized.status).toBe(401)
        expect(await unauthorized.text()).not.toContain('locked')

        const authorized = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer guard-token' } })
        expect(authorized.ok).toBe(true)
        expect(await authorized.text()).toContain('locked')
      }
    } finally {
      saveScheduleLayout(scheduleId, original)
    }
  })

  it('does not expose malformed protected config content before authentication', async () => {
    const scheduleId = loadSchedulesIndex().defaultScheduleId
    const layoutPath = resolveScheduleLayoutPath(scheduleId)
    const original = fs.readFileSync(layoutPath, 'utf8')
    fs.writeFileSync(layoutPath, 'items:\n  - previewState: private malformed snapshot\n    value: [', 'utf8')
    saveSettings({ ...loadSettings(), settingsToken: 'guard-token' })

    try {
      for (const path of [`/api/schedules/${scheduleId}/config`, '/api/config']) {
        const unauthorized = await fetch(`${baseUrl}${path}`)
        expect(unauthorized.status).toBe(401)
        const text = await unauthorized.text()
        expect(text).not.toContain('private malformed snapshot')
        expect(text).not.toContain('YAML')
      }
    } finally {
      fs.writeFileSync(layoutPath, original, 'utf8')
    }
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
