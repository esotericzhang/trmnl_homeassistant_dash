import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { renderEditorHtml } from '../src/render.js'
import type { LayoutConfig } from '../src/types.js'

const layout: LayoutConfig = {
  frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
  data: { entities: { temperature: 'sensor.temperature' } },
  items: [
    { id: 'title', type: 'text', x: 10, y: 10, width: 200, height: 30, text: 'A' },
    { id: 'sensor-text', type: 'text', x: 10, y: 50, width: 200, height: 30, text: '{{ temperature }}' },
    { id: 'temperature', type: 'metric', x: 240, y: 10, width: 180, height: 70, label: 'Temperature', value: '{{ temperature }}' }
  ]
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
      expect(document.querySelector<HTMLElement>('.item[data-id="title"] .item-preview')?.textContent).toBe(value)
      expect(document.querySelectorAll('.item-mask')).toHaveLength(1)
    }
  })

  it('moves and resizes saved visible content with pointer interactions', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    let item = document.querySelector<HTMLElement>('.item[data-id="title"]')
    let preview = item?.querySelector<HTMLElement>('.item-preview')
    if (!item || !preview) throw new Error('saved item preview missing')

    dispatchPointer(dom, item, 'pointerdown', 10, 10)
    dispatchPointer(dom, document.querySelector<HTMLElement>('#stage')!, 'pointermove', 35, 45)
    item = document.querySelector<HTMLElement>('.item[data-id="title"]')
    preview = item?.querySelector<HTMLElement>('.item-preview')
    expect(item?.style.left).toBe('35px')
    expect(item?.style.top).toBe('45px')
    expect(preview?.parentElement).toBe(item)
    expect(preview?.style.width).toBe('100%')
    expect(preview?.style.height).toBe('100%')
    const mask = document.querySelector<HTMLElement>('.item-mask')
    expect(mask?.style.left).toBe('10px')
    expect(mask?.style.top).toBe('10px')
    expect(mask?.style.width).toBe('200px')
    expect(mask?.style.height).toBe('30px')

    const handle = item?.querySelector<HTMLElement>('.resize')
    if (!item || !handle) throw new Error('resize handle missing')
    dispatchPointer(dom, handle, 'pointerdown', 35, 45)
    dispatchPointer(dom, document.querySelector<HTMLElement>('#stage')!, 'pointermove', 75, 65)
    item = document.querySelector<HTMLElement>('.item[data-id="title"]')
    preview = item?.querySelector<HTMLElement>('.item-preview')
    expect(item?.style.width).toBe('240px')
    expect(item?.style.height).toBe('50px')
    expect(preview?.parentElement).toBe(item)
    expect(preview?.style.width).toBe('100%')
    expect(preview?.style.height).toBe('100%')
    expect(document.querySelector<HTMLElement>('.item-mask')?.style.width).toBe('200px')
    expect(document.querySelector<HTMLElement>('.item-mask')?.style.height).toBe('30px')
  })

  it('masks persisted canvas content immediately when its field is deleted', async () => {
    const dom = await editorDom()
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()

    expect(document.querySelector('.item[data-id="title"]')).toBeNull()
    const mask = Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).find(element => element.style.left === '10px' && element.style.top === '10px')
    expect(mask?.style.width).toBe('200px')
    expect(mask?.style.height).toBe('30px')
  })

  it('masks old text when a deleted persisted ID is reused before save', async () => {
    const dom = await editorDom()
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    const text = document.querySelector<HTMLInputElement>('#new-text')
    if (!text) throw new Error('new text input missing')
    text.value = 'Title'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()

    expect(document.querySelector('.item[data-id="title"] .item-preview')?.textContent).toBe('Title')
    const mask = Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).find(element => element.style.left === '10px' && element.style.top === '10px')
    expect(mask).toBeDefined()
  })

  it('masks old text when a deleted persisted ID is reused by a manual metric', async () => {
    const dom = await editorDom()
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    const label = document.querySelector<HTMLInputElement>('#new-label')
    const entity = document.querySelector<HTMLInputElement>('#new-entity')
    if (!label || !entity) throw new Error('manual metric inputs missing')
    label.value = 'Title'
    entity.value = 'sensor.manual'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()

    expect(document.querySelector('.item[data-id="title"] .item-preview.metric')?.textContent).toContain('{{ title }}')
    const mask = Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).find(element => element.style.left === '10px' && element.style.top === '10px')
    expect(mask).toBeDefined()
  })

  it('keeps persisted sensor text and metrics in the authoritative server preview', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const sensorText = document.querySelector<HTMLElement>('.item[data-id="sensor-text"]')
    const metric = document.querySelector<HTMLElement>('.item[data-id="temperature"]')

    expect(sensorText).not.toBeNull()
    expect(sensorText?.querySelector('.item-preview')).toBeNull()
    expect(metric).not.toBeNull()
    expect(metric?.querySelector('.item-preview')).toBeNull()
    expect(document.querySelector('.item-preview.metric')).toBeNull()
  })

  it('shows useful client previews for newly added text and sensor fields', async () => {
    const dom = await editorDom()
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    const newText = document.querySelector<HTMLInputElement>('#new-text')
    if (!newText) throw new Error('new text input missing')
    newText.value = 'Draft note'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()
    expect(document.querySelector<HTMLElement>('.item[data-id="draft-note"] .item-preview')?.textContent).toBe('Draft note')

    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    const label = document.querySelector<HTMLInputElement>('#new-label')
    const entity = document.querySelector<HTMLInputElement>('#new-entity')
    if (!label || !entity) throw new Error('new sensor inputs missing')
    label.value = 'Humidity'
    entity.value = 'sensor.humidity'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()
    const preview = document.querySelector<HTMLElement>('.item[data-id="humidity"] .item-preview.metric')
    expect(preview?.textContent).toContain('Humidity')
    expect(preview?.textContent).toContain('{{ humidity }}')
  })

  it('searches discovered entities and selects one without blocking manual IDs', async () => {
    const dom = await editorDom(null, {
      entities: [
        { entityId: 'light.porch', friendlyName: '<img src=x onerror=alert(1)>', domain: 'light', state: 'on' },
        { entityId: 'sensor.kitchen_temperature', friendlyName: 'Kitchen Temperature', domain: 'sensor', state: '21.5', unitOfMeasurement: '°C' }
      ]
    })
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    await vi.waitFor(() => expect(document.querySelectorAll('.entity-option')).toHaveLength(2))

    expect(document.querySelector('.entity-results img')).toBeNull()
    const search = document.querySelector<HTMLInputElement>('#entity-search')
    if (!search) throw new Error('entity search missing')
    search.value = 'kitchen'
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    expect(document.querySelectorAll('.entity-option')).toHaveLength(1)
    expect(document.querySelector('.entity-option')?.textContent).toContain('Kitchen Temperature')
    expect(document.querySelector('.entity-option')?.textContent).toContain('21.5 °C')

    document.querySelector<HTMLButtonElement>('.entity-option')?.click()
    expect(document.querySelector<HTMLInputElement>('#new-entity')?.value).toBe('sensor.kitchen_temperature')
    expect(document.querySelector<HTMLInputElement>('#new-label')?.value).toBe('Kitchen Temperature')
    expect(document.querySelector<HTMLInputElement>('#new-source')?.value).toBe('kitchenTemperature')
  })

  it('persists a discovered state and unit snapshot on the editor canvas', async () => {
    const dom = await editorDom(null, {
      entities: [{ entityId: 'sensor.kitchen_temperature', friendlyName: 'Kitchen Temperature', domain: 'sensor', state: '21.5', unitOfMeasurement: '°C' }]
    })
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.entity-option')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.entity-option')?.click()
    document.querySelector<HTMLButtonElement>('#create-field')?.click()

    let preview = document.querySelector<HTMLElement>('.item[data-id="kitchen-temperature"] .item-preview.metric')
    expect(preview?.textContent).toContain('Kitchen Temperature')
    expect(preview?.textContent).toContain('21.5 °C')
    expect(preview?.textContent).not.toContain('{{ kitchenTemperature }}')

    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))
    preview = document.querySelector<HTMLElement>('.item[data-id="kitchen-temperature"] .item-preview.metric')
    expect(preview?.textContent).toContain('21.5 °C')
    expect(document.querySelectorAll('.item-mask').length).toBeGreaterThan(0)

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'kitchen-temperature')).toMatchObject({
      type: 'metric',
      value: '{{ kitchenTemperature }}',
      previewState: '21.5',
      previewUnit: '°C'
    })
  })

  it('formats metric preview snapshots with the named duration option', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { previewState: '125', previewUnit: 'min', valueFormat: 'duration-minutes' })
    const dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    const document = dom.window.document

    expect(document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('2h 5m')
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const format = document.querySelector<HTMLSelectElement>('select[name="valueFormat"]')
    if (!format) throw new Error('metric value format missing')
    format.value = 'raw'
    format.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    expect(document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('125 min')
  })

  it('honors inline preview filters and explicit raw state strings', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature | minutes }}', previewState: '125', previewUnit: 'min', valueFormat: 'raw' })
    let dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('2h 5m')

    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }}', previewState: 'unknown', previewUnit: undefined, valueFormat: 'raw' })
    dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('unknown')
    delete (snapshotLayout.items[2] as { valueFormat?: string }).valueFormat
    dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('—')
  })

  it('keeps manual sensor fields free of discovery preview snapshots', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    const entity = document.querySelector<HTMLInputElement>('#new-entity')
    if (!entity) throw new Error('new entity input missing')
    entity.value = 'sensor.manual'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()

    expect(document.querySelector('.item[data-id="sensor"] .item-preview.metric')?.textContent).toContain('{{ sensor }}')
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))
    expect(document.querySelector('.item[data-id="sensor"] .item-preview.metric')).toBeNull()
    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'sensor')).not.toHaveProperty('previewState')
  })

  it('clears a saved preview snapshot when its value template changes', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { previewState: '21.5', previewUnit: '°C' })
    const dom = await editorDom(null, undefined, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')
    if (!value) throw new Error('metric value input missing')
    value.value = '{{ humidity }}'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

    expect(document.querySelector('.item[data-id="temperature"] .item-preview.metric')).toBeNull()
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))
    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    const metric = body.config.items.find(item => item.id === 'temperature')
    expect(metric).toMatchObject({ value: '{{ humidity }}' })
    expect(metric).not.toHaveProperty('previewState')
    expect(metric).not.toHaveProperty('previewUnit')
  })

  it('shows discovery failures while preserving manual entity creation', async () => {
    const dom = await editorDom(null, undefined, { status: 401, message: 'Home Assistant rejected the configured credentials (401).' })
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('#entity-picker-message')?.textContent).toContain('enter an entity ID manually'))

    const entity = document.querySelector<HTMLInputElement>('#new-entity')
    if (!entity) throw new Error('manual entity input missing')
    entity.value = 'custom.unlisted_entity'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()
    expect(document.querySelector<HTMLElement>('.item[data-id="sensor"]')).not.toBeNull()
  })

  it('retries failed discovery and caches the successful result', async () => {
    const dom = await editorDom(null, { entities: [{ entityId: 'sensor.retry', domain: 'sensor', state: 'ready' }] }, { status: 502, message: 'Temporary discovery failure.' })
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('#retry-entity-discovery')).not.toBeNull())

    document.querySelector<HTMLButtonElement>('#retry-entity-discovery')?.click()
    await vi.waitFor(() => expect(document.querySelector('.entity-option')?.textContent).toContain('sensor.retry'))
    document.querySelector<HTMLButtonElement>('#cancel-add')?.click()
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/home-assistant/entities')
    expect(calls).toHaveLength(2)
  })

  it('refreshes cached discovery when settings are saved with the picker open', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [
      { entities: [{ entityId: 'sensor.stale', domain: 'sensor', state: 'off' }] },
      { entities: [{ entityId: 'sensor.current', domain: 'sensor', state: 'on' }] }
    ])
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.entity-option')?.textContent).toContain('sensor.stale'))

    document.querySelector<HTMLButtonElement>('#global-settings')?.click()
    await vi.waitFor(() => expect(document.querySelector('#save-settings')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('#save-settings')?.click()
    await vi.waitFor(() => expect(document.querySelector('#global-modal')?.classList.contains('show')).toBe(false))
    await vi.waitFor(() => expect(document.querySelector('.entity-option')?.textContent).toContain('sensor.current'))
    expect(document.querySelector('.entity-option')?.textContent).not.toContain('sensor.stale')
  })

  it('clears a pending entity snapshot when settings are saved', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [
      { entities: [{ entityId: 'sensor.stale', friendlyName: 'Stale', domain: 'sensor', state: 'off' }] },
      { entities: [{ entityId: 'sensor.current', friendlyName: 'Current', domain: 'sensor', state: 'on' }] }
    ])
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.entity-option')?.textContent).toContain('Stale'))
    document.querySelector<HTMLButtonElement>('.entity-option')?.click()

    document.querySelector<HTMLButtonElement>('#global-settings')?.click()
    await vi.waitFor(() => expect(document.querySelector('#save-settings')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('#save-settings')?.click()
    await vi.waitFor(() => expect(document.querySelector('.entity-option')?.textContent).toContain('Current'))
    document.querySelector<HTMLButtonElement>('#create-field')?.click()
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    const metric = body.config.items.find(item => item.id === 'stale')
    expect(metric).not.toHaveProperty('previewState')
    expect(metric).not.toHaveProperty('previewUnit')
  })

  it('restarts in-flight discovery when settings are saved with the picker open', async () => {
    let resolveOldDiscovery: ((value: unknown) => void) | undefined
    const oldDiscovery = new Promise<unknown>(resolve => { resolveOldDiscovery = resolve })
    const dom = await editorDom(null, undefined, undefined, '', [
      oldDiscovery,
      { entities: [{ entityId: 'sensor.current', domain: 'sensor', state: 'on' }] }
    ])
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    await vi.waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/home-assistant/entities')
      expect(calls).toHaveLength(1)
    })

    document.querySelector<HTMLButtonElement>('#global-settings')?.click()
    await vi.waitFor(() => expect(document.querySelector('#save-settings')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('#save-settings')?.click()
    await vi.waitFor(() => expect(document.querySelector('#global-modal')?.classList.contains('show')).toBe(false))

    await vi.waitFor(() => expect(document.querySelector('.entity-option')?.textContent).toContain('sensor.current'))

    resolveOldDiscovery?.({ entities: [{ entityId: 'sensor.stale', domain: 'sensor', state: 'off' }] })
    await vi.waitFor(() => expect(document.querySelector('.entity-option')?.textContent).toContain('sensor.current'))
    expect(document.querySelector('.entity-option')?.textContent).not.toContain('sensor.stale')
  })

  it('uses the editor settings token for entity discovery', async () => {
    const dom = await editorDom(null, { entities: [] }, undefined, 'editor-token')
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()

    await vi.waitFor(() => {
      const discoveryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/home-assistant/entities')
      expect(discoveryCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer editor-token' })
    })
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

async function editorDom(webhookUrl: string | null = null, discovery: unknown = { entities: [] }, discoveryError?: { status: number; message: string }, bootstrapToken = '', discoveryResponses: Array<unknown | Promise<unknown>> = [], initialLayout: LayoutConfig = layout): Promise<JSDOM> {
  const responses = new Map<string, unknown>([
    ['/api/schedules', { schedules: [{
      id: 'default', name: 'Default', enabled: true, order: 0,
      timing: { kind: 'manual' },
      destination: { deviceId: null, playlistId: null, mode: webhookUrl ? 'raw-webhook' : null, screenId: null, webhookUrl, modelId: null, screenName: null, screenLabel: null },
      status: { lastAttemptAt: null, lastSuccessAt: null, nextRunAt: null, result: null, error: null }
    }] }],
    ['/api/schedules/default/config', initialLayout],
    ['/api/settings', { homeAssistantUrl: '', haToken: '', publicBaseUrl: '', refreshIntervalSeconds: 0, device: null, terminus: { apiUrl: '', mode: 'byos-uri' } }],
    ['/api/home-assistant/entities', discovery]
  ])
  let discoveryAttempts = 0
  const fetcher = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const path = new URL(String(input), 'http://editor.local').pathname
    if (path === '/api/home-assistant/entities' && discoveryError && discoveryAttempts++ === 0) {
      return new Response(JSON.stringify({ message: discoveryError.message }), { status: discoveryError.status, headers: { 'Content-Type': 'application/json' } })
    }
    if (path === '/api/home-assistant/entities' && discoveryResponses.length) {
      const body = await discoveryResponses.shift()
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (path === '/api/schedules/default') {
      const body = options?.body ? JSON.parse(String(options.body)) : {}
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const body = responses.get(path)
    return new Response(JSON.stringify(body), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetcher)

  const dom = new JSDOM(renderEditorHtml(bootstrapToken), {
    url: 'http://editor.local/editor',
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.defineProperty(window, 'fetch', { value: fetcher })
      Object.defineProperty(window, 'confirm', { value: () => true })
      Object.defineProperty(window, 'prompt', { value: () => null })
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { value: () => undefined })
      Object.defineProperty(window.HTMLElement.prototype, 'setPointerCapture', { value: () => undefined })
      Object.defineProperty(window, 'requestAnimationFrame', { value: (cb: (frame?: number) => void) => { cb(); return 1 } })
    }
  })

  await vi.waitFor(() => expect(dom.window.document.querySelector('textarea[name="text"]')).not.toBeNull())
  return dom
}

function dispatchPointer(dom: JSDOM, target: HTMLElement, type: string, clientX: number, clientY: number): void {
  const event = new dom.window.MouseEvent(type, { bubbles: true, clientX, clientY })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  target.dispatchEvent(event)
}
