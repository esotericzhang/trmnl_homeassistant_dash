import express from 'express'
import { timingSafeEqual } from 'crypto'
import {
  getRuntimeConfig,
  getAddonOptions,
  isSafeValuePath,
  LayoutConfigError,
  loadLayoutConfig,
  loadSettings,
  loadSettingsMasked,
  loadSettingsSafe,
  maskSettings,
  normalizeSettings,
  saveLayoutConfig,
  saveSettings,
  stringOption,
  validateSettings
} from './config.js'
import type { Settings } from './config.js'
import { HomeAssistantClient, sampleRenderData } from './homeAssistant.js'
import { renderEditorHtml, renderHtml, renderPng, renderSvg } from './render.js'
import { startScheduler } from './scheduler.js'
import { TerminusClient, terminusOptionsFromEnv } from './terminus.js'
import type { Align, HassState, LayoutConfig, LayoutItem } from './types.js'

const runtime = getRuntimeConfig()
const app = express()
app.use((req, res, next) => {
  if (req.path.startsWith('/api/figma/')) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type')
    if (req.method === 'OPTIONS') {
      res.status(204).send()
      return
    }
  }
  next()
})
app.use(express.json({ limit: '2mb' }))

let lastSvg = ''
let lastPng: Buffer | null = null
let lastRefresh: string | null = null
let lastPush = 'not run'

const SETTINGS_TOKEN_ENV = process.env.SETTINGS_TOKEN ?? ''
const ALLOW_NO_AUTH = process.env.ALLOW_NO_AUTH === '1'
const FIGMA_ENTITY_DOMAINS = new Set(['air_quality', 'binary_sensor', 'climate', 'cover', 'device_tracker', 'fan', 'humidifier', 'light', 'person', 'sensor', 'sun', 'weather'])

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

function requireConfiguredTokenAuth(req: express.Request, res: express.Response): boolean {
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
  if (!requireMutationAuth(req, res)) return
  try { res.json(saveLayoutConfig(req.body)) } catch (error) { next(error) }
})

// Local Figma plugin bridge. The plugin talks only to this dashboard bridge and never receives Home Assistant credentials.
app.get('/api/figma/entities', async (req, res, next) => {
  if (!requireConfiguredTokenAuth(req, res)) return
  try {
    const config = await currentRuntime()
    const layout = loadLayoutConfig()
    const states = config.accessToken
      ? await new HomeAssistantClient(config.homeAssistantUrl, config.accessToken).getStates()
      : Object.values(sampleRenderData(layout).states)
    res.json({
      source: config.accessToken ? 'live' : 'sample',
      entities: states.filter(isSupportedFigmaEntity).map(sanitizeEntity).sort((a, b) => a.entity_id.localeCompare(b.entity_id))
    })
  } catch (error) { next(error) }
})

app.put('/api/figma/layout', (req, res, next) => {
  if (!requireMutationAuth(req, res)) return
  try {
    const existing = loadLayoutConfig()
    const replacement = figmaLayoutToConfig(req.body, existing)
    res.json(saveLayoutConfig(replacement))
  } catch (error) { next(error) }
})

app.post('/api/figma/preview-layout', (req, res, next) => {
  if (!requireConfiguredTokenAuth(req, res)) return
  try {
    const existing = loadLayoutConfig()
    const layout = figmaLayoutToConfig(req.body, existing)
    const data = sampleRenderData(layout)
    const svg = renderSvg(layout, data)
    res.json({ svg, config: layout })
  } catch (error) { next(error) }
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

app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  void next
  const message = error instanceof Error ? error.message : String(error)
  const isClientLayoutError = error instanceof FigmaLayoutError
    || (error instanceof LayoutConfigError && req.method === 'PUT' && req.path === '/api/config')
  const status = isClientLayoutError ? 400 : 500
  res.status(status).json({ status: 'error', message })
})

void loadSettingsSafe
void validateSettings

startScheduler(runtime.refreshIntervalSeconds, refreshAndPush)

if (process.env.NODE_ENV !== 'test') {
  app.listen(runtime.port, () => console.log(`TRMNL HA Layout listening on ${runtime.port}`))
}

export { app, renderCurrent, refreshAndPush }

interface FigmaEntity {
  entity_id: string
  name: string
  state: string
  unit: string | null
  domain: string | null
  device_class: string | null
  values: Array<{ path: string; label: string; value: string | number | boolean | null }>
}

interface FigmaWidget {
  type: 'text' | 'metric_card'
  entity?: string
  unit?: string | null
  valuePath?: string
  format?: string
  label?: string
  x: number
  y: number
  width: number
  height: number
  fontSize?: number
  align?: Align
  staticText?: string
  weight?: number | string
}

interface FigmaLayout {
  width: 800
  height: 480
  widgets: FigmaWidget[]
}

class FigmaLayoutError extends Error {}

function isSupportedFigmaEntity(state: HassState): boolean {
  const separator = state.entity_id.indexOf('.')
  return separator > 0 && FIGMA_ENTITY_DOMAINS.has(state.entity_id.slice(0, separator))
}

function sanitizeEntity(state: HassState): FigmaEntity {
  const attributes = state.attributes ?? {}
  const secretLike = isSecretLikeEntity(state)
  const sanitizedState = secretLike ? undefined : sanitizePrimitive(state.state)
  return {
    entity_id: state.entity_id,
    name: secretLike ? state.entity_id : (sanitizedStringAttribute(attributes.friendly_name) ?? state.entity_id),
    state: sanitizedState === undefined ? '—' : String(sanitizedState),
    unit: secretLike ? null : sanitizedStringAttribute(attributes.unit_of_measurement),
    domain: state.entity_id.includes('.') ? state.entity_id.split('.')[0] : null,
    device_class: secretLike ? null : sanitizedStringAttribute(attributes.device_class),
    values: [
      { path: 'state', label: 'State', value: sanitizedState ?? '—' },
      ...(secretLike ? [] : sanitizeAttributeValues(attributes))
    ]
  }
}

function isSecretLikeEntity(state: HassState): boolean {
  const objectId = state.entity_id.split('.').slice(1).join('.')
  const deviceClass = typeof state.attributes?.device_class === 'string' ? state.attributes.device_class : ''
  return /(?:^|_)(?:access|api|auth|bearer|code|cookie|credential|jwt|key|oauth|passcode|password|pat|pin|secret|session|token|webhook)(?:_|$)/i.test(objectId)
    || /^(?:code|key|password|secret|token)$/i.test(deviceClass)
}

function sanitizeAttributeValues(attributes: Record<string, unknown>): FigmaEntity['values'] {
  const values: FigmaEntity['values'] = []
  const visit = (value: unknown, path: string, depth: number): void => {
    if (values.length >= 100 || depth > 4) return
    if (isPrimitive(value)) {
      const sanitized = sanitizePrimitive(value)
      if (sanitized !== undefined) values.push({ path, label: path.replace(/^attributes\./, ''), value: sanitized })
      return
    }
    if (Array.isArray(value)) {
      value.slice(0, 8).forEach((entry, index) => visit(entry, `${path}.${index}`, depth + 1))
      return
    }
    if (value && typeof value === 'object') {
      Object.entries(value as Record<string, unknown>).slice(0, 40).forEach(([key, entry]) => {
        if (!isAllowedAttributeKey(key)) return
        visit(entry, `${path}.${key}`, depth + 1)
      })
    }
  }
  Object.entries(attributes).forEach(([key, value]) => {
    if (!isAllowedAttributeKey(key)) return
    visit(value, `attributes.${key}`, 1)
  })
  return values
}

const ALLOWED_ATTRIBUTE_KEYS = new Set([
  'apparent_temperature', 'battery_level', 'cloud_coverage', 'condition', 'datetime',
  'dew_point', 'distance', 'duration', 'energy', 'forecast', 'frequency', 'humidity', 'mode',
  'ozone', 'percentage', 'power', 'precipitation', 'precipitation_probability', 'pressure',
  'temperature', 'templow', 'uv_index', 'visibility', 'voltage', 'volume',
  'wind_bearing', 'wind_gust_speed', 'wind_speed'
])

function isAllowedAttributeKey(key: string): boolean {
  return ALLOWED_ATTRIBUTE_KEYS.has(key) && !isSecretLikeKey(key)
}

function isSecretLikeKey(key: string): boolean {
  return /(?:^|_)(?:access|api|auth|code|cookie|credential|key|passcode|password|pin|secret|session|signature|token|webhook)(?:_|$)/i.test(key)
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function sanitizePrimitive(value: unknown): string | number | boolean | null | undefined {
  if (!isPrimitive(value)) return undefined
  if (typeof value !== 'string') return value
  const normalized = value.trim()
  if (normalized.length > 256 || [...normalized].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return undefined
  if (/^(?:https?|wss?):\/\//i.test(normalized)) return undefined
  if (/^(?:bearer\s+|eyJ[a-zA-Z0-9_-]*\.)/i.test(normalized)) return undefined
  if (/^(?:gh[oprsu]_|github_pat_|glpat-|sk-(?:live|test)-|xox[baprs]-|AKIA)[a-zA-Z0-9_-]+$/i.test(normalized)) return undefined
  if (normalized.length >= 24 && !/\s/.test(normalized) && /[a-z]/i.test(normalized) && /\d/.test(normalized)
    && /^[a-zA-Z0-9_+/=-]+$/.test(normalized)) return undefined
  if (/[?&](?:access_token|auth|code|credential|key|password|pin|secret|session|signature|token|webhook)=/i.test(normalized)) return undefined
  if (/^(?:access_token|auth|code|cookie|credential|key|password|pin|secret|session|token|webhook)[:=]/i.test(normalized)) return undefined
  return value
}

function sanitizedStringAttribute(value: unknown): string | null {
  const sanitized = sanitizePrimitive(value)
  return typeof sanitized === 'string' && sanitized.length > 0 ? sanitized : null
}

function figmaLayoutToConfig(body: unknown, existing: LayoutConfig): LayoutConfig {
  const layout = validateFigmaLayout(body)
  const entities: Record<string, string> = {}
  const selectors: Record<string, string> = {}
  const items = layout.widgets.map((widget, index) => widgetToItem(widget, index, entities, selectors))
  return {
    ...existing,
    frame: { ...existing.frame, width: 800, height: 480 },
    data: { ...existing.data, entities, ...(Object.keys(selectors).length ? { selectors } : { selectors: undefined }) },
    items
  }
}

function validateFigmaLayout(body: unknown): FigmaLayout {
  if (!body || typeof body !== 'object') throw new FigmaLayoutError('request body must be a layout object')
  const layout = body as Partial<FigmaLayout>
  if (layout.width !== 800 || layout.height !== 480) throw new FigmaLayoutError('layout width and height must be 800x480')
  if (!Array.isArray(layout.widgets)) throw new FigmaLayoutError('layout.widgets must be an array')
  const widgets = layout.widgets.map(normalizeFigmaWidget)
  return { width: 800, height: 480, widgets }
}

function normalizeFigmaWidget(widget: unknown, index: number): FigmaWidget {
  if (!widget || typeof widget !== 'object') throw new FigmaLayoutError(`widget ${index} must be an object`)
  const item = widget as Partial<FigmaWidget>
  if (item.type !== 'text' && item.type !== 'metric_card') throw new FigmaLayoutError(`widget ${index} has unsupported type`)
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (!Number.isFinite(item[key])) throw new FigmaLayoutError(`widget ${index} has invalid ${key}`)
  }
  const normalized = {
    ...item,
    x: Math.round(item.x!),
    y: Math.round(item.y!),
    width: Math.round(item.width!),
    height: Math.round(item.height!),
    fontSize: item.fontSize === undefined ? undefined : Math.round(item.fontSize)
  } as FigmaWidget
  if (normalized.x < 0 || normalized.y < 0 || normalized.width <= 0 || normalized.height <= 0) {
    throw new FigmaLayoutError(`widget ${index} position and size must be positive`)
  }
  if (normalized.x + normalized.width > 800 || normalized.y + normalized.height > 480) {
    throw new FigmaLayoutError(`widget ${index} is outside the 800x480 frame`)
  }
  if (item.entity !== undefined && (typeof item.entity !== 'string' || !/^[a-z0-9_]+\.[a-z0-9_]+$/.test(item.entity))) {
    throw new FigmaLayoutError(`widget ${index} has malformed entity id`)
  }
  validateOptionalFigmaString(item.unit, 'unit', index, 64, true)
  if (item.valuePath !== undefined && (typeof item.valuePath !== 'string' || !isSafeValuePath(item.valuePath))) {
    throw new FigmaLayoutError(`widget ${index} has invalid valuePath`)
  }
  if (item.format !== undefined && (typeof item.format !== 'string' || !['', 'minutes', 'time', 'date'].includes(item.format))) {
    throw new FigmaLayoutError(`widget ${index} has invalid format`)
  }
  validateOptionalFigmaString(item.label, 'label', index, 256)
  validateOptionalFigmaString(item.staticText, 'staticText', index, 4096)
  if (item.weight !== undefined && !isSupportedFontWeight(item.weight)) {
    throw new FigmaLayoutError(`widget ${index} has invalid weight`)
  }
  if (item.type === 'metric_card' && !item.entity) throw new FigmaLayoutError(`widget ${index} metric_card requires entity`)
  if (normalized.fontSize !== undefined && (!Number.isFinite(normalized.fontSize) || normalized.fontSize < 1 || normalized.fontSize > 480)) {
    throw new FigmaLayoutError(`widget ${index} has invalid fontSize`)
  }
  if (item.align !== undefined && !['left', 'center', 'right'].includes(item.align)) {
    throw new FigmaLayoutError(`widget ${index} has invalid align`)
  }
  return normalized
}

function validateOptionalFigmaString(value: unknown, field: string, index: number, maxLength: number, allowNull = false): void {
  if (value === undefined || (allowNull && value === null)) return
  if (typeof value !== 'string' || value.length > maxLength || [...value].some(character => {
    const code = character.charCodeAt(0)
    return code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
  })) {
    throw new FigmaLayoutError(`widget ${index} has invalid ${field}`)
  }
}

function isSupportedFontWeight(weight: unknown): weight is number | string {
  if (typeof weight === 'number') return Number.isFinite(weight) && weight >= 1 && weight <= 1000
  return typeof weight === 'string' && ['normal', 'bold', 'bolder', 'lighter'].includes(weight)
}

function widgetToItem(widget: FigmaWidget, index: number, entities: Record<string, string>, selectors: Record<string, string>): LayoutItem {
  const selector = widget.valuePath && widget.valuePath !== 'state' ? widget.valuePath : undefined
  const source = widget.entity ? uniqueSourceKey(widget.entity, selector, entities, selectors) : undefined
  if (source && widget.entity) entities[source] = widget.entity
  if (source && selector) selectors[source] = selector
  const placeholder = source ? `{{ ${source}${widget.format ? ` | ${widget.format}` : ''} }}` : ''
  const unit = selector || widget.format ? '' : (widget.unit ?? '')
  const base = {
    id: uniqueItemId(widget.label || widget.entity || widget.staticText || widget.type, index),
    x: widget.x,
    y: widget.y,
    width: widget.width,
    height: widget.height,
    fontSize: widget.fontSize,
    align: widget.align,
    weight: widget.weight
  }
  if (widget.type === 'metric_card') {
    return {
      ...base,
      type: 'metric',
      label: widget.label || widget.entity || 'Metric',
      value: source ? `${placeholder}${unit}` : ''
    }
  }
  return {
    ...base,
    type: 'text',
    text: source ? `${widget.label || widget.entity}: ${placeholder}${unit}` : (widget.staticText ?? widget.label ?? 'Text')
  }
}


function uniqueSourceKey(entityId: string, selector: string | undefined, entities: Record<string, string>, selectors: Record<string, string>): string {
  const existing = Object.entries(entities).find(([key, existingEntityId]) => {
    return existingEntityId === entityId && selectors[key] === selector
  })
  if (existing) return existing[0]
  const base = camelKey(entityId.replace(/^[^.]+\./, '')) || 'entity'
  let key = base
  let index = 2
  while (key in entities) key = `${base}${index++}`
  return key
}

function uniqueItemId(value: string, index: number): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `${slug || 'figma-widget'}-${index + 1}`
}

function camelKey(value: string): string {
  const words = value.split(/[^a-zA-Z0-9]+/).filter(Boolean)
  return words.map((word, index) => {
    const lower = word.charAt(0).toLowerCase() + word.slice(1)
    return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
  }).join('').replace(/^[^a-zA-Z_]+/, '')
}
