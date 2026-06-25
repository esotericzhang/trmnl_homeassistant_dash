import express from 'express'
import { getRuntimeConfig, loadLayoutConfig, saveLayoutConfig } from './config.js'
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

async function renderCurrent(useSample = false): Promise<{ layout: ReturnType<typeof loadLayoutConfig>, svg: string, png: Buffer }> {
  const layout = loadLayoutConfig()
  const data = useSample || !runtime.accessToken
    ? sampleRenderData(layout)
    : await new HomeAssistantClient(runtime.homeAssistantUrl, runtime.accessToken).collect(layout)
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

app.get('/editor', (_req, res) => {
  res.type('html').send(renderEditorHtml())
})

app.get('/preview', (_req, res) => {
  res.type('html').send(`<!doctype html><html><head><title>TRMNL HA Layout</title><style>body{font-family:system-ui;margin:24px} iframe{border:1px solid #333;width:800px;height:480px}.row{display:flex;gap:12px;align-items:center}</style></head><body><h1>TRMNL HA Layout</h1><div class="row"><button onclick="fetch('/api/refresh',{method:'POST'}).then(r=>r.json()).then(j=>alert(JSON.stringify(j,null,2)))">Refresh and push</button><a href="/screen.png?sample=1">Sample PNG</a><a href="/screen.svg?sample=1">Sample SVG</a><a href="/render?sample=1">Sample HTML</a><a href="/editor">Editor</a></div><p>Live preview uses configured Home Assistant token. Add <code>?sample=1</code> to use sample data.</p><iframe src="/render?sample=1"></iframe></body></html>`)
})

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  void next
  const message = error instanceof Error ? error.message : String(error)
  res.status(500).json({ status: 'error', message })
})

startScheduler(runtime.refreshIntervalSeconds, refreshAndPush)

if (process.env.NODE_ENV !== 'test') {
  app.listen(runtime.port, () => console.log(`TRMNL HA Layout listening on ${runtime.port}`))
}

export { app, renderCurrent, refreshAndPush }
