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

  it('keeps same-ID replacement masks until the saved server preview commits', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false)
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    document.querySelector<HTMLInputElement>('#new-label')!.value = 'Title'
    document.querySelector<HTMLInputElement>('#new-entity')!.value = 'sensor.replacement'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const hasOldTitleMask = () => Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).some(element => element.style.left === '10px' && element.style.top === '10px')
    expect(hasOldTitleMask()).toBe(true)
    expect(document.querySelector('.item[data-id="title"] .item-preview.metric')).not.toBeNull()

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expect(hasOldTitleMask()).toBe(false)
    expect(document.querySelector('.item[data-id="title"] .item-preview.metric')).toBeNull()
  })

  it('keeps same-ID replacement masks when the saved server preview fails', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false)
    const document = dom.window.document
    const priorSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    document.querySelector<HTMLInputElement>('#new-label')!.value = 'Title'
    document.querySelector<HTMLInputElement>('#new-entity')!.value = 'sensor.replacement'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))

    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(priorSrc)
    expect(Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).some(element => element.style.left === '10px' && element.style.top === '10px')).toBe(true)
    expect(document.querySelector('.item[data-id="title"] .item-preview.metric')).not.toBeNull()
  })

  it('clears a saved replacement mask after a later clean preview commits', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true, [], false)
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    document.querySelector<HTMLInputElement>('#new-label')!.value = 'Title'
    document.querySelector<HTMLInputElement>('#new-entity')!.value = 'sensor.replacement'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))

    const hasOldTitleMask = () => Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).some(element => element.style.left === '10px' && element.style.top === '10px')
    expect(hasOldTitleMask()).toBe(true)

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="default"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default'))
    expect(hasOldTitleMask()).toBe(true)

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expect(hasOldTitleMask()).toBe(false)
    expect(document.querySelector('.item[data-id="title"] .item-preview.metric')).toBeNull()
  })

  it('preserves replacement masking across schedule switches', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    document.querySelector<HTMLInputElement>('#new-label')!.value = 'Title'
    document.querySelector<HTMLInputElement>('#new-entity')!.value = 'sensor.manual'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="default"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default'))
    expect(Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).some(element => element.style.left === '10px' && element.style.top === '10px')).toBe(true)
  })

  it('restores each dirty schedule preview when regeneration fails', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true, [
      '<svg xmlns="http://www.w3.org/2000/svg"><text>default draft</text></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><text>second draft</text></svg>',
      new Response('preview unavailable', { status: 503 })
    ])
    const document = dom.window.document
    const title = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    title.value = 'Default draft'
    title.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('default%20draft'))
    const defaultSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    const secondTitle = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    secondTitle.value = 'Second draft'
    secondTitle.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('second%20draft'))

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="default"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default'))
    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(defaultSrc)
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Draft preview failed'))
    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(defaultSrc)
  })

  it('uses a fresh server preview when returning to a clean schedule', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document
    const firstSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="default"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default'))

    const refreshedSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src
    expect(refreshedSrc).toContain('/schedules/default/screen.svg?sample=1&t=')
    expect(refreshedSrc).not.toBe(firstSrc)
  })

  it('commits a clean schedule baseline only after its preview loads', async () => {
    const secondLayout = structuredClone(layout)
    secondLayout.items[0].x = 80
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true, [], true, secondLayout)
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/second/screen.svg'))

    expect(document.querySelectorAll('.item-mask')).toHaveLength(1)
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expect(Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).some(element => element.style.left === '10px')).toBe(false)
  })

  it('retains the prior baseline when a clean preview fails', async () => {
    const secondLayout = structuredClone(layout)
    secondLayout.items[0].x = 80
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true, [], true, secondLayout)
    const document = dom.window.document
    const priorSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/second/screen.svg'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))

    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(priorSrc)
    expect(Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).some(element => element.style.width === '800px' && element.style.height === '480px')).toBe(true)
    expect(document.querySelector('#status')?.textContent).toContain('Preview failed')
  })

  it('masks a prior schedule with identical items but different entities', async () => {
    const secondLayout = structuredClone(layout)
    secondLayout.data.entities.temperature = 'sensor.outdoor_temperature'
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true, [], true, secondLayout)
    const document = dom.window.document
    const priorSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/second/screen.svg'))

    const fullMask = Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).find(element => element.style.left === '0px' && element.style.top === '0px')
    expect(fullMask?.style.width).toBe('800px')
    expect(fullMask?.style.height).toBe('480px')

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))
    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(priorSrc)
    expect(Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).some(element => element.style.width === '800px' && element.style.height === '480px')).toBe(true)
  })

  it('ignores superseded clean preview transitions', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/second/screen.svg'))
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="default"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/default/screen.svg'))
    const requestedSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(requestedSrc)
  })

  it('regenerates the unsaved preview after overlapping deletions', async () => {
    const overlapping = structuredClone(layout)
    overlapping.items[1].x = 20
    overlapping.items[1].y = 20
    const dom = await editorDom(null, undefined, undefined, '', [], overlapping)
    dom.window.document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    await vi.waitFor(() => expect(dom.window.document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('data:image/svg+xml'))
    const previewCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default/preview')
    const body = JSON.parse(String(previewCall?.[1]?.body)) as LayoutConfig
    expect(body.items.find(item => item.id === 'title')).toBeUndefined()
    expect(body.items.find(item => item.id === 'sensor-text')).toBeDefined()
  })

  it('masks content from the displayed draft when its next preview fails', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false, [
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      new Response('preview unavailable', { status: 503 })
    ])
    const document = dom.window.document
    const text = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    text.value = 'Draft title'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('data:image/svg+xml'))

    document.querySelector<HTMLElement>('.item[data-id="sensor-text"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Draft preview failed'))

    expect(Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).some(element => element.style.left === '10px' && element.style.top === '50px')).toBe(true)
  })

  it('keeps masks until a replacement draft image loads', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false, [
      '<svg xmlns="http://www.w3.org/2000/svg"><text>updated</text></svg>'
    ], false)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="sensor-text"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()

    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('updated'))
    const hasDeletedMask = () => Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).some(element => element.style.left === '10px' && element.style.top === '50px')
    expect(hasDeletedMask()).toBe(true)

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expect(hasDeletedMask()).toBe(false)
  })

  it('restores the prior image and masks when a replacement image fails', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false, [
      '<svg xmlns="http://www.w3.org/2000/svg"><text>broken</text></svg>'
    ], false)
    const document = dom.window.document
    const priorSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src
    document.querySelector<HTMLElement>('.item[data-id="sensor-text"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()

    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('broken'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))

    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(priorSrc)
    expect(Array.from(document.querySelectorAll<HTMLElement>('.item-mask')).some(element => element.style.left === '10px' && element.style.top === '50px')).toBe(true)
    expect(document.querySelector('#status')?.textContent).toContain('Draft preview failed')
  })

  it('debounces layout previews and skips schedule metadata changes', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const text = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    for (const value of ['AB', 'ABC', 'ABCD']) {
      text.value = value
      text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    }
    await vi.waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([input]) => new URL(String(input), 'http://editor.local').pathname.endsWith('/preview'))
      expect(calls).toHaveLength(1)
    })

    const name = document.querySelector<HTMLInputElement>('#schedule-name')!
    name.value = 'Renamed'
    name.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 150))
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(([input]) => new URL(String(input), 'http://editor.local').pathname.endsWith('/preview'))
    expect(calls).toHaveLength(1)
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
      previewSource: 'kitchenTemperature',
      previewState: '21.5',
      previewUnit: '°C'
    })
  })

  it('formats metric preview snapshots with the named duration option', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { previewSource: 'temperature', previewState: '125', previewUnit: 'min', valueFormat: 'duration-minutes' })
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
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature | minutes }}', previewSource: 'temperature', previewState: '125', previewUnit: 'min', valueFormat: 'raw' })
    let dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('2h 5m')

    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }}', previewSource: 'temperature', previewState: 'unknown', previewUnit: undefined, valueFormat: 'raw' })
    dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('unknown')
    delete (snapshotLayout.items[2] as { valueFormat?: string }).valueFormat
    dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('—')
  })

  it('keeps a raw value unit when a later placeholder is formatted', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }} at {{ updated | time }}', previewSource: 'temperature', previewState: '21.5', previewUnit: '°C' })
    const dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('21.5 °C at {{ updated | time }}')
  })

  it('matches runtime unit placement for repeated and mixed placeholders', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }} / {{ temperature }}', previewSource: 'temperature', previewState: '125', previewUnit: 'min' })
    let dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('125 min / 125 min')

    Object.assign(snapshotLayout.items[2], { value: '{{ temperature | minutes }} / {{ temperature }}' })
    dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('2h 5m / 125 min')
  })

  it('places a snapshot unit beside its placeholder in decorated templates', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }} indoors', previewSource: 'temperature', previewState: '21.5', previewUnit: '°C' })
    const dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('21.5 °C indoors')
  })

  it('shows omitted legacy formatting as Default', async () => {
    const dom = await editorDom()
    dom.window.document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const format = dom.window.document.querySelector<HTMLSelectElement>('select[name="valueFormat"]')
    expect(format?.value).toBe('')
    expect(format?.selectedOptions[0]?.textContent).toBe('Default')
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
    expect(document.querySelector('.item[data-id="sensor"] .item-preview.metric')).not.toBeNull()
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expect(document.querySelector('.item[data-id="sensor"] .item-preview.metric')).toBeNull()
    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'sensor')).not.toHaveProperty('previewState')
  })

  it('clears a saved preview snapshot when its value template changes', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { previewSource: 'temperature', previewState: '21.5', previewUnit: '°C' })
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
    expect(metric).not.toHaveProperty('previewSource')
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
    document.querySelector<HTMLInputElement>('#new-label')!.value = 'Stale'
    document.querySelector<HTMLInputElement>('#new-entity')!.value = 'sensor.stale'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    const metric = body.config.items.find(item => item.id === 'stale')
    expect(metric).not.toHaveProperty('previewState')
    expect(metric).not.toHaveProperty('previewUnit')
  })

  it('clears only picker-derived inputs when settings are saved', async () => {
    const dom = await editorDom(null, { entities: [{ entityId: 'sensor.stale', friendlyName: 'Stale', domain: 'sensor', state: 'off' }] })
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    document.querySelector<HTMLButtonElement>('[data-add-type="sensor"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.entity-option')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.entity-option')?.click()
    document.querySelector<HTMLInputElement>('#new-label')!.value = 'Manual label'
    document.querySelector<HTMLButtonElement>('#global-settings')?.click()
    await vi.waitFor(() => expect(document.querySelector('#save-settings')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('#save-settings')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#new-entity')?.value).toBe(''))
    expect(document.querySelector<HTMLInputElement>('#new-source')?.value).toBe('')
    expect(document.querySelector<HTMLInputElement>('#new-label')?.value).toBe('Manual label')
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

  it('replaces a stale stored token and removes the bootstrap token from the URL', async () => {
    const dom = await editorDom(null, { entities: [] }, undefined, 'fresh-token', [], layout, false, [], true, layout, 'http://editor.local/editor?token=fresh-token&panel=layout#canvas', 'stale-token')

    expect(dom.window.sessionStorage.getItem('trmnl_settings_token')).toBe('fresh-token')
    expect(dom.window.location.href).toBe('http://editor.local/editor?panel=layout#canvas')
    const schedulesCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules')
    expect(schedulesCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer fresh-token' })
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

async function editorDom(webhookUrl: string | null = null, discovery: unknown = { entities: [] }, discoveryError?: { status: number; message: string }, bootstrapToken = '', discoveryResponses: Array<unknown | Promise<unknown>> = [], initialLayout: LayoutConfig = layout, secondSchedule = false, previewResponses: Array<string | Response> = [], autoLoadDraftImages = true, secondLayout: LayoutConfig = layout, editorUrl = 'http://editor.local/editor', storedToken = ''): Promise<JSDOM> {
  const responses = new Map<string, unknown>([
    ['/api/schedules', { schedules: [{
      id: 'default', name: 'Default', enabled: true, order: 0,
      timing: { kind: 'manual' },
      destination: { deviceId: null, playlistId: null, mode: webhookUrl ? 'raw-webhook' : null, screenId: null, webhookUrl, modelId: null, screenName: null, screenLabel: null },
      status: { lastAttemptAt: null, lastSuccessAt: null, nextRunAt: null, result: null, error: null }
    }, ...(secondSchedule ? [{ id: 'second', name: 'Second', enabled: true, order: 1, timing: { kind: 'manual' }, destination: {}, status: {} }] : [])] }],
    ['/api/schedules/default/config', initialLayout],
    ['/api/schedules/second/config', secondLayout],
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
    if (path.endsWith('/preview')) {
      const previewResponse = previewResponses.shift()
      if (previewResponse instanceof Response) return previewResponse
      if (typeof previewResponse === 'string') return new Response(previewResponse, { status: 200, headers: { 'Content-Type': 'image/svg+xml' } })
      if (secondSchedule) return new Response('preview unavailable', { status: 503 })
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } })
    }
    const body = responses.get(path)
    return new Response(JSON.stringify(body), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetcher)

  const dom = new JSDOM(renderEditorHtml(bootstrapToken), {
    url: editorUrl,
    runScripts: 'dangerously',
    beforeParse(window) {
      if (storedToken) window.sessionStorage.setItem('trmnl_settings_token', storedToken)
      const src = Object.getOwnPropertyDescriptor(window.HTMLImageElement.prototype, 'src')
      if (src?.get && src.set) Object.defineProperty(window.HTMLImageElement.prototype, 'src', {
        configurable: true,
        get: src.get,
        set(value: string) {
          src.set!.call(this, value)
          if (autoLoadDraftImages && value.startsWith('data:image/svg+xml')) queueMicrotask(() => this.dispatchEvent(new window.Event('load')))
        }
      })
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
