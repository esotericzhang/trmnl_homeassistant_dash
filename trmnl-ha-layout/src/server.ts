import express from 'express'
import { timingSafeEqual } from 'crypto'
import {
  getRuntimeConfig,
  loadLayoutConfig,
  loadSettings,
  loadSettingsMasked,
  loadSettingsSafe,
  maskSettings,
  normalizeSettings,
  saveLayoutConfig,
  saveSettings,
  validateSettings
} from './config.js'
import type { Settings } from './config.js'
import { HomeAssistantClient, sampleRenderData } from './homeAssistant.js'
import { renderEditorHtml, renderHtml, renderPng, renderSvg } from './render.js'
import { startScheduler } from './scheduler.js'
import { TerminusClient, terminusOptionsFromEnv } from './terminus.js'

const runtime = getRuntimeConfig()
const app = express()
app.use(express.json({ limit: '2mb' }))

let lastSvg = ''
let lastPng: Buffer | null = null
let lastRefresh: string | null = null
let lastPush = 'not run'

const SETTINGS_TOKEN_ENV = process.env.SETTINGS_TOKEN ?? ''
const ALLOW_NO_AUTH = process.env.ALLOW_NO_AUTH === '1'

function settingsToken(): string | undefined {
  return SETTINGS_TOKEN_ENV || loadSettings().settingsToken
}

function isMutationAuthenticated(req: express.Request): boolean {
  const token = settingsToken()
  if (!token) {
    if (process.env.NODE_ENV === 'test') return true
    if (ALLOW_NO_AUTH) return true
    console.warn('no SETTINGS_TOKEN set; allowing settings mutations in dev mode. Set SETTINGS_TOKEN for production or ALLOW_NO_AUTH=1 to silence.')
    return true
  }
  const header = req.headers.authorization ?? ''
  const expected = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (typeof expected !== 'string' || typeof token !== 'string' || expected.length !== token.length) {
    return false
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token))
}

function requireMutationAuth(req: express.Request, res: express.Response): boolean {
  if (isMutationAuthenticated(req)) return true
  res.status(401).json({ status: 'error', message: 'unauthorized' })
  return false
}

async function currentRuntime() {
  return getRuntimeConfig()
}

async function renderCurrent(useSample = false): Promise<{ layout: ReturnType<typeof loadLayoutConfig>, svg: string, png: Buffer }> {
  const layout = loadLayoutConfig()
  const config = await currentRuntime()
  const data = useSample || !config.accessToken
    ? sampleRenderData(layout)
    : await new HomeAssistantClient(config.homeAssistantUrl, config.accessToken).collect(layout)
  lastSvg = renderSvg(layout, data)
  lastPng = await renderPng(layout, lastSvg)
  lastRefresh = new Date().toISOString()
  return { layout, svg: lastSvg, png: lastPng }
}

async function refreshAndPush(): Promise<string> {
  const rendered = await renderCurrent(false)
  lastPush = await new TerminusClient().push(rendered.png, terminusOptionsFromEnv(), rendered.svg)
  return lastPush
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', lastRefresh, lastPush })
})

app.get('/api/config', (_req, res, next) => {
  try { res.json(loadLayoutConfig()) } catch (error) { next(error) }
})

app.put('/api/config', (req, res, next) => {
  try { res.json(saveLayoutConfig(req.body)) } catch (error) { next(error) }
})

app.post('/api/refresh', async (_req, res, next) => {
  try { res.json({ status: 'ok', result: await refreshAndPush(), refreshedAt: lastRefresh }) } catch (error) { next(error) }
})

app.get('/api/settings', (_req, res, next) => {
  try { res.json(loadSettingsMasked()) } catch (error) { next(error) }
})

app.put('/api/settings', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try {
    const incoming = normalizeSettings(req.body as Partial<Settings>)
    const existing = loadSettings()
    const merged: Settings = {
      ...incoming,
      haToken: incoming.haToken && !incoming.haToken.startsWith('••••') ? incoming.haToken : existing.haToken,
      settingsToken: incoming.settingsToken ?? existing.settingsToken,
      terminus: {
        ...incoming.terminus,
        accessToken: incoming.terminus.accessToken && !incoming.terminus.accessToken.startsWith('••••') ? incoming.terminus.accessToken : existing.terminus.accessToken,
        refreshToken: incoming.terminus.refreshToken && !incoming.terminus.refreshToken.startsWith('••••') ? incoming.terminus.refreshToken : existing.terminus.refreshToken,
        obtainedAt: incoming.terminus.obtainedAt ?? existing.terminus.obtainedAt
      }
    }
    const saved = saveSettings(merged)
    res.json(maskSettings(saved))
  } catch (error) { next(error) }
})

app.post('/api/terminus/login', async (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try {
    const { apiUrl, login, password } = req.body as { apiUrl?: string; login?: string; password?: string }
    if (!apiUrl || !login || !password) {
      res.status(400).json({ success: false, error: 'apiUrl, login, and password are required' })
      return
    }
    const tokens = await new TerminusClient().login(apiUrl, login, password)
    const settings = loadSettings()
    const obtainedAt = Date.now()
    const saved = saveSettings({
      ...settings,
      terminus: {
        ...settings.terminus,
        apiUrl,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? settings.terminus.refreshToken,
        obtainedAt
      }
    })
    void saved
    res.json({ success: true, obtained_at: obtainedAt })
  } catch (error) {
    const message = (error as Error).message
    if (message.includes('login failed')) {
      res.status(401).json({ success: false, error: message })
    } else {
      next(error)
    }
  }
})

app.post('/api/terminus/refresh', async (req, res) => {
  if (!requireMutationAuth(req, res)) return
  try {
    const settings = loadSettings()
    const terminus = settings.terminus
    if (!terminus.apiUrl || !terminus.accessToken || !terminus.refreshToken) {
      res.status(400).json({ success: false, error: 'no stored tokens to refresh' })
      return
    }
    const tokens = await new TerminusClient().refresh({
      apiUrl: terminus.apiUrl,
      accessToken: terminus.accessToken,
      refreshToken: terminus.refreshToken
    })
    const obtainedAt = Date.now()
    const saved = saveSettings({
      ...settings,
      terminus: {
        ...terminus,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? terminus.refreshToken,
        obtainedAt
      }
    })
    void saved
    res.json({ success: true, obtained_at: obtainedAt })
  } catch (error) {
    res.status(401).json({ success: false, error: (error as Error).message })
  }
})

app.delete('/api/terminus/tokens', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try {
    const settings = loadSettings()
    const saved = saveSettings({
      ...settings,
      terminus: {
        ...settings.terminus,
        accessToken: undefined,
        refreshToken: undefined,
        obtainedAt: undefined
      }
    })
    void saved
    res.json({ success: true })
  } catch (error) { next(error) }
})

app.get('/screen.svg', async (req, res, next) => {
  try {
    const { svg } = await renderCurrent(req.query.sample === '1')
    res.type('image/svg+xml').send(svg)
  } catch (error) { next(error) }
})

app.get('/screen.png', async (req, res, next) => {
  try {
    const { png } = await renderCurrent(req.query.sample === '1')
    res.type('image/png').send(png)
  } catch (error) { next(error) }
})

app.get('/render', async (req, res, next) => {
  try {
    const { layout, svg } = await renderCurrent(req.query.sample === '1')
    res.type('html').send(renderHtml(layout, svg))
  } catch (error) { next(error) }
})

app.get('/editor', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  res.type('html').send(renderEditorHtml(token))
})

app.get('/preview', (_req, res) => {
  res.type('html').send(`<!doctype html><html><head><title>TRMNL HA Layout</title><style>body{font-family:system-ui;margin:24px} iframe{border:1px solid #333;width:800px;height:480px}.row{display:flex;gap:12px;align-items:center}</style></head><body><h1>TRMNL HA Layout</h1><div class="row"><button onclick="fetch('/api/refresh',{method:'POST'}).then(r=>r.json()).then(j=>alert(JSON.stringify(j,null,2)))">Refresh and push</button><a href="/screen.png?sample=1">Sample PNG</a><a href="/screen.svg?sample=1">Sample SVG</a><a href="/render?sample=1">Sample HTML</a><a href="/editor">Editor</a></div><p>Live preview uses configured Home Assistant token. Add <code>?sample=1</code> to use sample data.</p><iframe src="/render?sample=1"></iframe></body></html>`)
})

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  void next
  const message = error instanceof Error ? error.message : String(error)
  res.status(500).json({ status: 'error', message })
})

void loadSettingsSafe
void validateSettings

startScheduler(runtime.refreshIntervalSeconds, refreshAndPush)

if (process.env.NODE_ENV !== 'test') {
  app.listen(runtime.port, () => console.log(`TRMNL HA Layout listening on ${runtime.port}`))
}

export { app, renderCurrent, refreshAndPush }
