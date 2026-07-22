import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { renderEditorHtml } from '../src/render.js'
import type { LayoutConfig } from '../src/types.js'

const layout: LayoutConfig = {
  frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
  data: { entities: {} },
  items: [{ id: 'title', type: 'text', x: 10, y: 10, width: 200, height: 30, text: 'A' }]
}

describe('editor focus continuity', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('types multiple selected-field characters without replacing or blurring the input', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const input = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')
    if (!input) throw new Error('selected text input missing')
    input.focus()

    const sameNode = input
    for (const value of ['AB', 'ABC', 'ABCD']) {
      input.value = value
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      expect(document.activeElement).toBe(sameNode)
      expect(document.querySelector('textarea[name="text"]')).toBe(sameNode)
      expect(input.value).toBe(value)
    }
  })

  it('keeps schedule-name input focused as the non-replacing comparison path', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const input = document.querySelector<HTMLInputElement>('#schedule-name')
    if (!input) throw new Error('schedule name input missing')
    input.focus()

    for (const value of ['D', 'De', 'Desk']) {
      input.value = value
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      expect(document.activeElement).toBe(input)
      expect(document.querySelector('#schedule-name')).toBe(input)
      expect(input.value).toBe(value)
    }
  })

  it('preserves a masked schedule webhook through unrelated inspector edits', async () => {
    const dom = await editorDom('••••')
    const document = dom.window.document
    const webhook = document.querySelector<HTMLInputElement>('#schedule-webhook')
    const enabled = document.querySelector<HTMLInputElement>('#schedule-enabled')
    if (!webhook || !enabled) throw new Error('schedule controls missing')

    expect(webhook.value).toBe('••••')
    enabled.checked = false
    enabled.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    expect(webhook.value).toBe('••••')
  })
})

async function editorDom(webhookUrl: string | null = null): Promise<JSDOM> {
  const responses = new Map<string, unknown>([
    ['/api/schedules', { schedules: [{
      id: 'default', name: 'Default', enabled: true, order: 0,
      timing: { kind: 'manual' },
      destination: { deviceId: null, playlistId: null, mode: webhookUrl ? 'raw-webhook' : null, screenId: null, webhookUrl, modelId: null, screenName: null, screenLabel: null },
      status: { lastAttemptAt: null, lastSuccessAt: null, nextRunAt: null, result: null, error: null }
    }] }],
    ['/api/schedules/default/config', layout],
    ['/api/settings', { homeAssistantUrl: '', haToken: '', publicBaseUrl: '', refreshIntervalSeconds: 0, device: null, terminus: { apiUrl: '', mode: 'byos-uri' } }]
  ])
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input), 'http://editor.local').pathname
    const body = responses.get(path)
    return new Response(JSON.stringify(body), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetcher)

  const dom = new JSDOM(renderEditorHtml(), {
    url: 'http://editor.local/editor',
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.defineProperty(window, 'fetch', { value: fetcher })
      Object.defineProperty(window, 'confirm', { value: () => true })
      Object.defineProperty(window, 'prompt', { value: () => null })
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { value: () => undefined })
      Object.defineProperty(window, 'requestAnimationFrame', { value: (cb: (frame?: number) => void) => { cb(); return 1 } })
    }
  })

  await vi.waitFor(() => expect(dom.window.document.querySelector('textarea[name="text"]')).not.toBeNull())
  return dom
}
