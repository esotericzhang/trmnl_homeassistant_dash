import express from 'express'
import { timingSafeEqual } from 'crypto'
import {
  getRuntimeConfig,
  getAddonOptions,
  loadLayoutConfig,
  loadSettings,
  loadSettingsMasked,
  loadSettingsSafe,
  maskSettings,
  normalizeSettings,
  saveSettings,
  stringOption,
  validateLayoutConfig,
  validateSettings
} from './config.js'
import type { Settings } from './config.js'
import { HomeAssistantClient, sampleRenderData } from './homeAssistant.js'
import { renderEditorHtml, renderHtml, renderPng, renderSvg } from './render.js'
import { createScheduleCoordinator } from './scheduler.js'
import { legacyScheduleTerminusOverrides, TerminusClient, terminusOptionsFromEnv } from './terminus.js'
import type { TerminusPushOptions } from './terminus.js'
import {
  createSchedule,
  deleteSchedule,
  duplicateSchedule,
  emptyScheduleLayout,
  ensureSchedules,
  getSchedule,
  listSchedules,
  loadScheduleLayout,
  loadSchedulesIndex,
  saveScheduleLayout,
  updateSchedule
} from './schedules.js'
import type { Schedule, UpdateScheduleInput } from './schedules.js'

const runtime = getRuntimeConfig()
const app = express()
app.use(express.json({ limit: '2mb' }))
ensureSchedules()

let lastSvg = ''
let lastPng: Buffer | null = null
let lastRefresh: string | null = null
let lastPush = 'not run'
const pushJobs = new Map<string, Promise<string>>()

const SETTINGS_TOKEN_ENV = process.env.SETTINGS_TOKEN ?? ''
const ALLOW_NO_AUTH = process.env.ALLOW_NO_AUTH === '1'

function settingsToken(): string | undefined {
  return SETTINGS_TOKEN_ENV || stringOption(getAddonOptions(), 'settings_token') || loadSettings().settingsToken
}

function isMutationAuthenticated(req: express.Request): boolean {
  const token = settingsToken()
  if (!token) {
    if (process.env.NODE_ENV === 'test') return true
    if (ALLOW_NO_AUTH) return true
    if (process.env.NODE_ENV === 'production') return false
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

function defaultScheduleId(): string {
  return loadSchedulesIndex().defaultScheduleId
}

async function renderSchedule(scheduleId: string, useSample = false, signal?: AbortSignal): Promise<{ layout: ReturnType<typeof loadLayoutConfig>, svg: string, png: Buffer }> {
  const layout = loadScheduleLayout(scheduleId)
  const config = await currentRuntime()
  const data = useSample || !config.accessToken
    ? sampleRenderData(layout)
    : await new HomeAssistantClient(config.homeAssistantUrl, config.accessToken).collect(layout, signal)
  lastSvg = renderSvg(layout, data)
  lastPng = await renderPng(layout, lastSvg)
  lastRefresh = new Date().toISOString()
  return { layout, svg: lastSvg, png: lastPng }
}

function terminusOptionsForSchedule(schedule: Schedule): TerminusPushOptions {
  const global = terminusOptionsFromEnv()
  const legacyOverrides = legacyScheduleTerminusOverrides()
  const destination = schedule.destination
  const legacyDefault = schedule.id === defaultScheduleId()
  return {
    ...global,
    mode: legacyDefault ? legacyOverrides.mode ?? destination.mode ?? global.mode : destination.mode ?? global.mode,
    webhookUrl: legacyDefault ? legacyOverrides.webhookUrl ?? destination.webhookUrl ?? global.webhookUrl : destination.webhookUrl ?? global.webhookUrl,
    modelId: legacyDefault ? legacyOverrides.modelId ?? destination.modelId ?? global.modelId : destination.modelId ?? undefined,
    screenName: legacyDefault ? legacyOverrides.screenName ?? destination.screenName ?? global.screenName : destination.screenName ?? `ha-layout-${schedule.id}`,
    screenLabel: legacyDefault ? legacyOverrides.screenLabel ?? destination.screenLabel ?? global.screenLabel : destination.screenLabel ?? schedule.name,
    playlistId: legacyDefault ? legacyOverrides.playlistId ?? destination.playlistId ?? global.playlistId : destination.playlistId ?? undefined,
    screenId: legacyDefault ? legacyOverrides.screenId ?? destination.deviceId ?? global.screenId : destination.deviceId ?? undefined,
    screenUri: legacyDefault ? '/screen.png' : `/schedules/${encodeURIComponent(schedule.id)}/screen.png`
  }
}

async function refreshAndPushSchedule(scheduleId: string, signal?: AbortSignal): Promise<string> {
  const existing = pushJobs.get(scheduleId)
  if (existing) return existing
  const job = runRefreshAndPushSchedule(scheduleId, signal)
  pushJobs.set(scheduleId, job)
  try { return await job } finally { pushJobs.delete(scheduleId) }
}

async function runRefreshAndPushSchedule(scheduleId: string, signal?: AbortSignal): Promise<string> {
  const schedule = getSchedule(scheduleId)
  const attemptedAt = new Date().toISOString()
  updateSchedule(scheduleId, { status: { lastAttemptAt: attemptedAt, result: null, error: null } })
  try {
    const rendered = await renderSchedule(scheduleId, false, signal)
    const result = await new TerminusClient().push(rendered.png, { ...terminusOptionsForSchedule(schedule), signal }, rendered.svg)
    lastPush = result
    const skipped = result.startsWith('skipped:')
    updateSchedule(scheduleId, { status: skipped
      ? { result, error: result }
      : { lastSuccessAt: new Date().toISOString(), result, error: null }
    })
    return result
  } catch (error) {
    updateSchedule(scheduleId, {
      status: { result: null, error: safeScheduleError(error) }
    })
    throw error
  }
}

function safeScheduleError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/https?:\/\/[^\s)]+/g, '[redacted URL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .slice(0, 500)
}

async function refreshAndPush(): Promise<string> {
  return refreshAndPushSchedule(defaultScheduleId())
}

async function renderCurrent(useSample = false): Promise<{ layout: ReturnType<typeof loadLayoutConfig>, svg: string, png: Buffer }> {
  return renderSchedule(defaultScheduleId(), useSample)
}

function scheduleNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Schedule not found:')
}

function handleScheduleError(error: unknown, res: express.Response, next: express.NextFunction): void {
  if (scheduleNotFound(error)) {
    res.status(404).json({ status: 'error', message: (error as Error).message })
    return
  }
  next(error)
}

function scheduleForApi(schedule: Schedule): Schedule {
  return {
    ...schedule,
    destination: {
      ...schedule.destination,
      webhookUrl: schedule.destination.webhookUrl ? '••••' : null
    }
  }
}

app.get('/api/schedules', (_req, res, next) => {
  try { res.json({ defaultScheduleId: defaultScheduleId(), schedules: listSchedules().map(scheduleForApi) }) } catch (error) { next(error) }
})

app.post('/api/schedules', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try {
    const template = loadScheduleLayout(defaultScheduleId())
    const schedule = createSchedule({ name: typeof req.body?.name === 'string' ? req.body.name : 'Untitled schedule' }, emptyScheduleLayout(template))
    res.status(201).json(scheduleForApi(schedule))
  } catch (error) { next(error) }
})

app.get('/api/schedules/:id', (req, res, next) => {
  try { res.json(scheduleForApi(getSchedule(req.params.id))) } catch (error) { handleScheduleError(error, res, next) }
})

app.patch('/api/schedules/:id', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try {
    const changes = { ...(req.body as UpdateScheduleInput) }
    delete changes.status
    const current = getSchedule(req.params.id)
    if (changes.destination?.webhookUrl === '••••') changes.destination.webhookUrl = current.destination.webhookUrl
    res.json(scheduleForApi(updateSchedule(req.params.id, changes)))
  } catch (error) { handleScheduleError(error, res, next) }
})

app.delete('/api/schedules/:id', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try { deleteSchedule(req.params.id); res.status(204).end() } catch (error) { handleScheduleError(error, res, next) }
})

app.post('/api/schedules/:id/duplicate', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try { res.status(201).json(scheduleForApi(duplicateSchedule(req.params.id, typeof req.body?.name === 'string' ? req.body.name : undefined))) } catch (error) { handleScheduleError(error, res, next) }
})

app.get('/api/schedules/:id/config', (req, res, next) => {
  try { res.json(loadScheduleLayout(req.params.id)) } catch (error) { handleScheduleError(error, res, next) }
})

app.put('/api/schedules/:id/config', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try { res.json(saveScheduleLayout(req.params.id, req.body)) } catch (error) { handleScheduleError(error, res, next) }
})

app.put('/api/schedules/:id', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try {
    const changes = { ...(req.body?.schedule as UpdateScheduleInput) }
    delete changes.status
    const current = getSchedule(req.params.id)
    if (changes.destination?.webhookUrl === '••••') changes.destination.webhookUrl = current.destination.webhookUrl
    validateLayoutConfig(req.body?.config)
    const updated = updateSchedule(req.params.id, changes)
    try {
      const layout = saveScheduleLayout(req.params.id, req.body.config)
      res.json({ schedule: scheduleForApi(updated), config: layout })
    } catch (error) {
      updateSchedule(req.params.id, current)
      throw error
    }
  } catch (error) { handleScheduleError(error, res, next) }
})

app.post('/api/schedules/:id/push', async (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try {
    await refreshAndPushSchedule(req.params.id)
    res.json({ status: getSchedule(req.params.id).status })
  } catch (error) { handleScheduleError(error, res, next) }
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', lastRefresh, lastPush })
})

app.get('/api/config', (_req, res, next) => {
  try { res.json(loadScheduleLayout(defaultScheduleId())) } catch (error) { next(error) }
})

app.put('/api/config', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try { res.json(saveScheduleLayout(defaultScheduleId(), req.body)) } catch (error) { next(error) }
})

app.post('/api/refresh', async (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try { res.json({ status: 'ok', result: await refreshAndPush(), refreshedAt: lastRefresh }) } catch (error) { next(error) }
})

app.get('/api/settings', (_req, res, next) => {
  try { res.json(loadSettingsMasked()) } catch (error) { next(error) }
})

app.put('/api/settings', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try {
    const body = req.body as Partial<Settings>
    const incoming = normalizeSettings(req.body as Partial<Settings>)
    const existing = loadSettings()
    const merged: Settings = {
      ...incoming,
      haToken: incoming.haToken && !incoming.haToken.startsWith('••••') ? incoming.haToken : existing.haToken,
      settingsToken: incoming.settingsToken && !incoming.settingsToken.startsWith('••••') ? incoming.settingsToken : existing.settingsToken,
      terminus: {
        ...incoming.terminus,
        webhookUrl: body.terminus?.webhookUrl === undefined ? existing.terminus.webhookUrl : incoming.terminus.webhookUrl,
        modelId: body.terminus?.modelId === undefined ? existing.terminus.modelId : incoming.terminus.modelId,
        screenName: body.terminus?.screenName === undefined ? existing.terminus.screenName : incoming.terminus.screenName,
        screenLabel: body.terminus?.screenLabel === undefined ? existing.terminus.screenLabel : incoming.terminus.screenLabel,
        playlistId: body.terminus?.playlistId === undefined ? existing.terminus.playlistId : incoming.terminus.playlistId,
        screenId: body.terminus?.screenId === undefined ? existing.terminus.screenId : incoming.terminus.screenId,
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
    const { svg } = await renderSchedule(defaultScheduleId(), req.query.sample === '1')
    res.type('image/svg+xml').send(svg)
  } catch (error) { next(error) }
})

app.get('/screen.png', async (req, res, next) => {
  try {
    const { png } = await renderSchedule(defaultScheduleId(), req.query.sample === '1')
    res.type('image/png').send(png)
  } catch (error) { next(error) }
})

app.get('/render', async (req, res, next) => {
  try {
    const { layout, svg } = await renderSchedule(defaultScheduleId(), req.query.sample === '1')
    res.type('html').send(renderHtml(layout, svg))
  } catch (error) { next(error) }
})

app.get('/schedules/:id/screen.svg', async (req, res, next) => {
  try { res.type('image/svg+xml').send((await renderSchedule(req.params.id, req.query.sample === '1')).svg) } catch (error) { handleScheduleError(error, res, next) }
})

app.get('/schedules/:id/screen.png', async (req, res, next) => {
  try { res.type('image/png').send((await renderSchedule(req.params.id, req.query.sample === '1')).png) } catch (error) { handleScheduleError(error, res, next) }
})

app.get('/schedules/:id/render', async (req, res, next) => {
  try {
    const { layout, svg } = await renderSchedule(req.params.id, req.query.sample === '1')
    res.type('html').send(renderHtml(layout, svg))
  } catch (error) { handleScheduleError(error, res, next) }
})

app.get('/', (_req, res) => {
  res.redirect(302, '/editor')
})

app.get('/editor', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  res.type('html').send(renderEditorHtml(token))
})

app.get('/preview', (_req, res) => {
  res.type('html').send(`<!doctype html><html><head><title>TRMNL HA Layout</title><style>body{font-family:system-ui;margin:24px} iframe{border:1px solid #333;width:800px;height:480px}.row{display:flex;gap:12px;align-items:center}</style></head><body><h1>TRMNL HA Layout</h1><div class="row"><button id="refresh-push">Refresh and push</button><a href="/screen.png?sample=1">Sample PNG</a><a href="/screen.svg?sample=1">Sample SVG</a><a href="/render?sample=1">Sample HTML</a><a href="/editor">Editor</a></div><p>Live preview uses configured Home Assistant token. Add <code>?sample=1</code> to use sample data.</p><iframe src="/render?sample=1"></iframe><script>function authHeaders(){const token=sessionStorage.getItem('trmnl_settings_token')||'';return token?{Authorization:'Bearer '+token}:{}}document.getElementById('refresh-push').addEventListener('click',()=>fetch('/api/refresh',{method:'POST',headers:authHeaders()}).then(r=>r.json()).then(j=>alert(JSON.stringify(j,null,2))))</script></body></html>`)
})

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  void next
  const message = error instanceof Error ? error.message : String(error)
  res.status(500).json({ status: 'error', message })
})

void loadSettingsSafe
void validateSettings

const coordinator = createScheduleCoordinator({
  loadSchedules: listSchedules,
  execute: (schedule, signal) => refreshAndPushSchedule(schedule.id, signal),
  onStatus: (schedule, status) => { updateSchedule(schedule.id, { status }) }
})

if (process.env.NODE_ENV !== 'test') {
  coordinator.start()
  app.listen(runtime.port, () => console.log(`TRMNL HA Layout listening on ${runtime.port}`))
}

export { app, renderCurrent, renderSchedule, refreshAndPush, refreshAndPushSchedule }
