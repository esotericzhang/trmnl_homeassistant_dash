import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import sharp from 'sharp'
import { editorPreviewRenderData } from '../src/homeAssistant.js'
import { renderEditorHtml, renderSvg } from '../src/render.js'
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
      expectCanvasState(document, 'rendering')
    }
  })

  it('moves and resizes saved visible content with pointer interactions', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    let item = document.querySelector<HTMLElement>('.item[data-id="title"]')
    let preview = item?.querySelector<HTMLElement>('.item-preview')
    if (!item) throw new Error('saved item missing')
    expect(preview).toBeNull()

    dispatchPointer(dom, item, 'pointerdown', 10, 10)
    dispatchPointer(dom, document.querySelector<HTMLElement>('#stage')!, 'pointermove', 35, 45)
    item = document.querySelector<HTMLElement>('.item[data-id="title"]')
    preview = item?.querySelector<HTMLElement>('.item-preview')
    expect(item?.style.left).toBe('35px')
    expect(item?.style.top).toBe('45px')
    expect(preview?.parentElement).toBe(item)
    expect(preview?.style.width).toBe('100%')
    expect(preview?.style.height).toBe('100%')
    expectCanvasState(document, 'rendering')

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
    expectCanvasState(document, 'rendering')
  })

  it('coalesces drag overlay rendering without rebuilding inspector or tabs', async () => {
    const frames: FrameRequestCallback[] = []
    const dom = await editorDom()
    Object.defineProperty(dom.window, 'requestAnimationFrame', { value: (callback: FrameRequestCallback) => { frames.push(callback); return frames.length } })
    const document = dom.window.document
    const item = document.querySelector<HTMLElement>('.item[data-id="title"]')!

    dispatchPointer(dom, item, 'pointerdown', 10, 10)
    const currentForm = document.querySelector<HTMLFormElement>('#form')!
    const currentTabs = document.querySelector<HTMLElement>('#schedule-tabs')!
    dispatchPointer(dom, document.querySelector<HTMLElement>('#stage')!, 'pointermove', 20, 25)
    dispatchPointer(dom, document.querySelector<HTMLElement>('#stage')!, 'pointermove', 30, 35)

    expect(frames).toHaveLength(1)
    expect(document.querySelector('#form')).toBe(currentForm)
    expect(document.querySelector('#schedule-tabs')).toBe(currentTabs)
    frames.shift()?.(0)
    expect(document.querySelector<HTMLElement>('.item[data-id="title"]')?.style.left).toBe('30px')
    expect(document.querySelector<HTMLElement>('.item[data-id="title"]')?.style.top).toBe('35px')
    expect(document.querySelector('#form')).toBe(currentForm)
    expect(document.querySelector('#schedule-tabs')).toBe(currentTabs)
  })

  it('hides persisted canvas content immediately when its field is deleted', async () => {
    const dom = await editorDom()
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()

    expect(document.querySelector('.item[data-id="title"]')).toBeNull()
    expectCanvasState(document, 'rendering')
    expect(document.querySelectorAll('.item-mask')).toHaveLength(0)
  })

  it('hides old text when a deleted persisted ID is reused before save', async () => {
    const dom = await editorDom()
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    document.querySelector<HTMLButtonElement>('#add-field')?.click()
    const text = document.querySelector<HTMLInputElement>('#new-text')
    if (!text) throw new Error('new text input missing')
    text.value = 'Title'
    document.querySelector<HTMLButtonElement>('#create-field')?.click()

    expect(document.querySelector('.item[data-id="title"] .item-preview')?.textContent).toBe('Title')
    expectCanvasState(document, 'rendering')
  })

  it('hides old text when a deleted persisted ID is reused by a manual metric', async () => {
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
    expectCanvasState(document, 'rendering')
  })

  it('keeps the canvas hidden until the saved same-ID replacement commits', async () => {
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

    expectCanvasState(document, 'rendering')
    expect(document.querySelector('.item[data-id="title"] .item-preview.metric')).not.toBeNull()

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expectCanvasState(document, 'ready')
    expect(document.querySelector('.item[data-id="title"] .item-preview.metric')).toBeNull()
  })

  it('keeps the canvas hidden when the saved same-ID replacement fails', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false)
    const document = dom.window.document
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
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
    expectCanvasState(document, 'error')
    expect(document.querySelector('.item[data-id="title"] .item-preview.metric')).not.toBeNull()
  })

  it('restores a saved replacement after a later clean preview commits', async () => {
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

    expectCanvasState(document, 'error')

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="default"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default'))
    expectCanvasState(document, 'rendering')

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expectCanvasState(document, 'ready')
    expect(document.querySelector('.item[data-id="title"] .item-preview.metric')).toBeNull()
  })

  it('preserves hidden replacement state across schedule switches', async () => {
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
    expectCanvasState(document, 'rendering')
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

    expectCanvasState(document, 'rendering')
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expectCanvasState(document, 'ready')
  })

  it('retains the prior baseline when a clean preview fails', async () => {
    const secondLayout = structuredClone(layout)
    secondLayout.items[0].x = 80
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true, [], true, secondLayout)
    const document = dom.window.document
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    const priorSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/second/screen.svg'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))

    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(priorSrc)
    expectCanvasState(document, 'error')
    expect(document.querySelector('#status')?.textContent).toContain('Preview failed')
  })

  it('keeps the default bootstrap image hidden when the first ordered schedule preview fails', async () => {
    const secondLayout = structuredClone(layout)
    secondLayout.items[0].x = 80
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true, [], true, secondLayout, 'http://editor.local/editor', '', { defaultOrder: 1, secondOrder: 0 })
    const document = dom.window.document

    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/second/screen.svg'))
    expectCanvasState(document, 'rendering')

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))

    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe('http://editor.local/screen.svg?sample=1')
    expectCanvasState(document, 'error')
    expect(document.querySelector('#status')?.textContent).toContain('Preview failed')
  })

  it('hides a prior schedule with identical items but different entities', async () => {
    const secondLayout = structuredClone(layout)
    secondLayout.data.entities.temperature = 'sensor.outdoor_temperature'
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true, [], true, secondLayout)
    const document = dom.window.document
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    const priorSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/second/screen.svg'))

    expectCanvasState(document, 'rendering')

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))
    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(priorSrc)
    expectCanvasState(document, 'error')
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

  it('ignores a superseded schedule config load', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolveSecond: ((response: Response) => void) | undefined
    const secondResponse = new Promise<Response>(resolve => { resolveSecond = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/second/config') return secondResponse
      return originalImplementation!(input, options)
    })

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/second/config')).toBe(true))
    const secondCall = fetcher.mock.calls.find(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/second/config')
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="default"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default'))

    const staleLayout = structuredClone(layout)
    const staleTitle = staleLayout.items.find(item => item.id === 'title')
    if (staleTitle?.type !== 'text') throw new Error('expected text item')
    staleTitle.text = 'Stale second schedule'
    resolveSecond?.(new Response(JSON.stringify(staleLayout), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(secondCall?.[1]?.signal?.aborted).toBe(true)
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe('A')
  })

  it('rolls back a failed schedule switch so clicking the tab can retry', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let secondConfigAttempts = 0
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/second/config' && secondConfigAttempts++ === 0) {
        return new Response('temporary config failure', { status: 503 })
      }
      return originalImplementation!(input, options)
    })

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    expect(document.querySelector('.schedule-tab[data-id="second"]')?.classList.contains('loading')).toBe(true)
    expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default')
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Schedule load failed'))

    expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default')
    expect(document.querySelector('#schedule-title')?.textContent).toBe('Default')

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    expect(document.querySelector('#schedule-title')?.textContent).toBe('Second')
    expect(document.querySelector('#status')?.textContent).toBe('Loaded "Second".')
    expect(secondConfigAttempts).toBe(2)
  })

  it('restores the committed draft image after rapid switch failure', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true, [], false)
    const document = dom.window.document
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    const committedSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/second/screen.svg'))
    const pendingSecondSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="default"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/default/screen.svg'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))

    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(committedSrc)
    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).not.toBe(pendingSecondSrc)
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

  it('hides sparse overlapping text pixels when draft preview generation fails', async () => {
    const overlapping = structuredClone(layout)
    overlapping.items[1].x = 20
    overlapping.items[1].y = 20
    const dom = await editorDom(null, undefined, undefined, '', [], overlapping, false, [new Response('preview unavailable', { status: 503 })])
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Draft preview failed'))

    expectCanvasState(document, 'error')
    expect(await hiddenCanvasPixel(document, 25, 25, sparseBaselineSvg(overlapping))).not.toEqual([0, 0, 0])
  })

  it('hides overlapping metric pixels when replacement images fail', async () => {
    const overlapping = structuredClone(layout)
    overlapping.items[2].x = 20
    overlapping.items[2].y = 20
    const dom = await editorDom(null, undefined, undefined, '', [], overlapping, false, ['<svg xmlns="http://www.w3.org/2000/svg"><text>broken</text></svg>'], false)
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('broken'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))

    expectCanvasState(document, 'error')
    expect(await hiddenCanvasPixel(document, 25, 25, sparseBaselineSvg(overlapping))).not.toEqual([0, 0, 0])
  })

  it('keeps controls usable while an overlapping sensor canvas is hidden', async () => {
    const overlapping = structuredClone(layout)
    overlapping.items[2].x = 20
    overlapping.items[2].y = 50
    const dom = await editorDom(null, undefined, undefined, '', [], overlapping, false, [new Response('preview unavailable', { status: 503 })])
    const document = dom.window.document

    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Draft preview failed'))

    expectCanvasState(document, 'error')
    expect(document.querySelector('.item[data-id="sensor-text"] .item-preview')).toBeNull()
    expect(document.querySelector('.item[data-id="sensor-text"]')).not.toBeNull()
  })

  it('hides unsupported overlapping item types when preview generation fails', async () => {
    const overlapping = structuredClone(layout)
    overlapping.items.splice(1, 0, { id: 'divider', type: 'line', x: 20, y: 20, width: 200, height: 2 })
    const dom = await editorDom(null, undefined, undefined, '', [], overlapping, false, [new Response('preview unavailable', { status: 503 })])
    const document = dom.window.document

    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Draft preview failed'))

    expectCanvasState(document, 'error')
    expect(document.querySelector('.item[data-id="divider"] .item-preview')).toBeNull()
  })

  it('restores cached ownership when a clean schedule revisit preview fails', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true, [], true)
    const document = dom.window.document

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/second/screen.svg'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    const secondSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="default"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/default/screen.svg'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('/schedules/second/screen.svg'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))

    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(secondSrc)
    expectCanvasState(document, 'ready')
  })

  it('hides content from the displayed draft when its next preview fails', async () => {
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

    expectCanvasState(document, 'error')
  })

  it('keeps the canvas hidden until a replacement draft image loads', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false, [
      '<svg xmlns="http://www.w3.org/2000/svg"><text>updated</text></svg>'
    ], false)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="sensor-text"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()

    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('updated'))
    expectCanvasState(document, 'rendering')

    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expectCanvasState(document, 'ready')
  })

  it('keeps the prior image hidden when a replacement image fails', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false, [
      '<svg xmlns="http://www.w3.org/2000/svg"><text>broken</text></svg>'
    ], false)
    const document = dom.window.document
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    const priorSrc = document.querySelector<HTMLImageElement>('#preview-frame')!.src
    document.querySelector<HTMLElement>('.item[data-id="sensor-text"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()

    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('broken'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('error'))

    expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toBe(priorSrc)
    expectCanvasState(document, 'error')
    expect(document.querySelector('#status')?.textContent).toContain('Draft preview failed')
  })

  it('retries a failed draft preview and restores the canvas atomically', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false, [
      new Response('preview unavailable', { status: 503 }),
      '<svg xmlns="http://www.w3.org/2000/svg"><text>recovered</text></svg>'
    ], false)
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    await vi.waitFor(() => expectCanvasState(document, 'error'))

    const canvasState = document.querySelector<HTMLElement>('#canvas-state')!
    const overlay = document.querySelector<HTMLElement>('#overlay')!
    const retry = document.querySelector<HTMLButtonElement>('#retry-preview')!
    expect(Number(dom.window.getComputedStyle(canvasState).zIndex)).toBeGreaterThan(Number(dom.window.getComputedStyle(overlay).zIndex))
    dispatchPointer(dom, retry, 'pointerdown', 400, 240)
    dispatchPointer(dom, retry, 'pointerup', 400, 240)
    retry.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 400, clientY: 240 }))
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('recovered'))
    expectCanvasState(document, 'rendering')
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expectCanvasState(document, 'ready')
  })

  it('keeps items selectable while a failed preview hides the canvas', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false, [
      new Response('preview unavailable', { status: 503 })
    ])
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Draft preview failed'))

    expectCanvasState(document, 'error')
    const canvasState = document.querySelector<HTMLElement>('#canvas-state')!
    const card = document.querySelector<HTMLElement>('#canvas-state .canvas-state-card')!
    const retry = document.querySelector<HTMLButtonElement>('#retry-preview')!
    expect(dom.window.getComputedStyle(canvasState).pointerEvents).toBe('none')
    expect(dom.window.getComputedStyle(card).pointerEvents).toBe('none')
    expect(dom.window.getComputedStyle(retry).pointerEvents).toBe('auto')

    document.querySelector<HTMLElement>('.item[data-id="sensor-text"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe('{{ temperature }}')
  })

  it('keeps retry reachable when the last item deletion preview fails', async () => {
    const singleItemLayout: LayoutConfig = { ...layout, items: [layout.items[0]] }
    const dom = await editorDom(null, undefined, undefined, '', [], singleItemLayout, false, [
      new Response('preview unavailable', { status: 503 }),
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"></svg>'
    ], false)
    const document = dom.window.document
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    await vi.waitFor(() => expectCanvasState(document, 'error'))

    const stage = document.querySelector<HTMLElement>('#stage')!
    const emptyStage = document.querySelector<HTMLElement>('#empty-stage')!
    const retry = document.querySelector<HTMLButtonElement>('#retry-preview')!
    expect(stage.style.display).toBe('block')
    expect(emptyStage.classList.contains('show')).toBe(false)
    dispatchPointer(dom, retry, 'pointerdown', 400, 240)
    dispatchPointer(dom, retry, 'pointerup', 400, 240)
    retry.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 400, clientY: 240 }))
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('data:image/svg+xml'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))

    expectCanvasState(document, 'ready')
    expect(stage.style.display).toBe('none')
    expect(emptyStage.classList.contains('show')).toBe(true)
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

  it('removes a changed static text DOM preview after the draft image loads', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, false, [], false)
    const document = dom.window.document
    const text = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    text.value = 'Updated title'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

    expect(document.querySelector('.item[data-id="title"] .item-preview')?.textContent).toBe('Updated title')
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('data:image/svg+xml'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))

    expectCanvasState(document, 'ready')
    expect(document.querySelector('.item[data-id="title"] .item-preview')).toBeNull()
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

    const preview = document.querySelector<HTMLElement>('.item[data-id="kitchen-temperature"] .item-preview.metric')
    expect(preview?.textContent).toContain('Kitchen Temperature')
    expect(preview?.textContent).toContain('21.5 °C')
    expect(preview?.textContent).not.toContain('{{ kitchenTemperature }}')

    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'kitchen-temperature')).toMatchObject({
      type: 'metric',
      value: '{{ kitchenTemperature }}',
      unitSource: 'kitchenTemperature',
      previewSource: 'kitchenTemperature',
      previewState: '21.5',
      previewUnit: '°C'
    })
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('data:image/svg+xml'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expect(document.querySelector('.item[data-id="kitchen-temperature"] .item-preview.metric')).toBeNull()
    expect(decodeURIComponent(document.querySelector<HTMLImageElement>('#preview-frame')!.src)).toContain('21.5 °C')
  })

  it('does not mistake short units for letters inside ordinary prose', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }} Current', unitSource: 'temperature', previewSource: 'temperature', previewState: '21.5', previewUnit: 'C' })
    const dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')!
    value.value = '{{ temperature }} Current room'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    const saveCallBefore = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(saveCallBefore))
    const saveCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(call => {
      const [input, options] = call as [string | URL | Request, RequestInit?]
      return new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT'
    })
    const saveCall = saveCalls[saveCalls.length - 1]
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'temperature')).toHaveProperty('unitSource', 'temperature')
  })

  it('removes metric snapshot overlays after the draft SVG commits', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { unitSource: 'temperature', previewSource: 'temperature', previewState: '21.5', previewUnit: '°C' })
    const dom = await editorDom(null, undefined, undefined, '', [], snapshotLayout, false, [], false)
    const document = dom.window.document
    await vi.waitFor(() => expect(document.querySelector<HTMLImageElement>('#preview-frame')?.src).toContain('data:image/svg+xml'))
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    const committedSvg = decodeURIComponent(document.querySelector<HTMLImageElement>('#preview-frame')?.src || '')
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const label = document.querySelector<HTMLTextAreaElement>('textarea[name="label"]')!
    label.value = 'Room temperature'
    label.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

    await vi.waitFor(() => expect(document.querySelector('.item[data-id="temperature"] .item-preview.metric')).not.toBeNull())
    await vi.waitFor(() => expect(decodeURIComponent(document.querySelector<HTMLImageElement>('#preview-frame')?.src || '')).toContain('Room temperature'))
    expect(committedSvg).not.toContain('Room temperature')
    document.querySelector<HTMLImageElement>('#preview-frame')?.dispatchEvent(new dom.window.Event('load'))
    expect(document.querySelector('.item[data-id="temperature"] .item-preview.metric')).toBeNull()
  })

  it('formats metric preview snapshots with the named duration option', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { unitSource: 'temperature', previewSource: 'temperature', previewState: '125', previewUnit: 'min', valueFormat: 'duration-minutes' })
    const dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    showSnapshotFallback(dom)

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
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature | minutes }}', unitSource: 'temperature', previewSource: 'temperature', previewState: '125', previewUnit: 'min', valueFormat: 'raw' })
    let dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    showSnapshotFallback(dom)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('2h 5m')

    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }}', previewSource: 'temperature', previewState: 'unknown', previewUnit: undefined, valueFormat: 'raw' })
    dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    showSnapshotFallback(dom)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('unknown')
    delete (snapshotLayout.items[2] as { valueFormat?: string }).valueFormat
    dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    showSnapshotFallback(dom)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('—')
  })

  it('keeps a raw value unit when a later placeholder is formatted', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }} at {{ updated | time }}', unitSource: 'temperature', previewSource: 'temperature', previewState: '21.5', previewUnit: '°C' })
    const dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    showSnapshotFallback(dom)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('21.5 °C at {{ updated | time }}')
  })

  it('matches runtime unit placement for repeated and mixed placeholders', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }} / {{ temperature }}', unitSource: 'temperature', previewSource: 'temperature', previewState: '125', previewUnit: 'min' })
    let dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    showSnapshotFallback(dom)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('125 min / 125 min')

    Object.assign(snapshotLayout.items[2], { value: '{{ temperature | minutes }} / {{ temperature }}' })
    dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    showSnapshotFallback(dom)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('2h 5m / 125 min')
  })

  it('keeps automatic units for repeated placeholders without explicit units', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }} °C / {{ temperature }}', unitSource: 'temperature', previewSource: 'temperature', previewState: '21.5', previewUnit: '°C' })
    const dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    showSnapshotFallback(dom)
    expect(document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('21.5 °C / 21.5 °C')

    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')!
    value.value = '{{ temperature }} °F / {{ temperature }}'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))
    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'temperature')).toHaveProperty('unitSource', 'temperature')
  })

  it('places a snapshot unit beside its placeholder in decorated templates', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }} indoors', unitSource: 'temperature', previewSource: 'temperature', previewState: '21.5', previewUnit: '°C' })
    const dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    showSnapshotFallback(dom)
    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('21.5 °C indoors')
  })

  it('omits fallback snapshot units without a matching live unit opt-in', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], { value: '{{ temperature }} °C', previewSource: 'temperature', previewState: '21.5', previewUnit: '°C' })
    const dom = await editorDom(null, { entities: [] }, undefined, '', [], snapshotLayout)
    showSnapshotFallback(dom)

    expect(dom.window.document.querySelector('.item[data-id="temperature"] .metric-value')?.textContent).toBe('21.5 °C')
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
    expect(metric).not.toHaveProperty('unitSource')
    expect(metric).not.toHaveProperty('explicitUnitOccurrences')
  })

  it('clears explicit unit metadata when its bound source is removed', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], {
      unitSource: 'temperature',
      explicitUnitOccurrences: [0],
      previewSource: 'temperature',
      previewState: '21.5',
      previewUnit: '°C',
      value: '{{ temperature }} °C'
    })
    const dom = await editorDom(null, undefined, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')!
    value.value = '{{ humidity }}'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    const metric = body.config.items.find(item => item.id === 'temperature')
    expect(metric).not.toHaveProperty('unitSource')
    expect(metric).not.toHaveProperty('explicitUnitOccurrences')
  })

  it('preserves metric bindings while value edits still reference their source', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], {
      unitSource: 'temperature',
      previewSource: 'temperature',
      previewState: '21.5',
      previewUnit: '°C'
    })
    const dom = await editorDom(null, undefined, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')
    if (!value) throw new Error('metric value input missing')
    value.value = '{{ temperature }} indoors'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))
    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'temperature')).toMatchObject({
      value: '{{ temperature }} indoors',
      unitSource: 'temperature',
      previewSource: 'temperature',
      previewState: '21.5',
      previewUnit: '°C'
    })
  })

  it('does not apply a completed save to another active schedule', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolveDefaultSave: ((response: Response) => void) | undefined
    const defaultSave = new Promise<Response>(resolve => { resolveDefaultSave = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/default' && options?.method === 'PUT') return defaultSave
      if (path === '/api/schedules/second' && options?.method === 'PUT') {
        return new Response(String(options.body), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return originalImplementation!(input, options)
    })

    const defaultText = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    defaultText.value = 'Saved default'
    defaultText.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    const secondText = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    secondText.value = 'Saved second'
    secondText.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only "Second"'))

    resolveDefaultSave?.(new Response(JSON.stringify({ schedule: { id: 'default', name: 'Default' }, config: { ...layout, items: [{ ...layout.items[0], text: 'Saved default' }, ...layout.items.slice(1)] } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second')
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe('Saved second')
  })

  it('serializes saves for the same schedule and keeps the latest result', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    const resolvers: Array<(response: Response) => void> = []
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/default' && options?.method === 'PUT') {
        return new Promise<Response>(resolve => resolvers.push(resolve))
      }
      return originalImplementation!(input, options)
    })

    const text = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    text.value = 'First save'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    text.value = 'Second save'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(resolvers).toHaveLength(1))

    const saveCalls = () => fetcher.mock.calls.filter(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    expect(saveCalls()).toHaveLength(1)
    resolvers[0](new Response(String(saveCalls()[0][1]?.body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    expect(saveCalls()).toHaveLength(2)
    resolvers[1](new Response(String(saveCalls()[1][1]?.body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe('Second save')
    expect(document.querySelector<HTMLButtonElement>('#save')?.classList.contains('dirty')).toBe(false)
  })

  it('keeps the last successful save as the reset baseline when a queued save fails', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let saveAttempt = 0
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/default' && options?.method === 'PUT' && ++saveAttempt === 2) {
        return new Response('second save failed', { status: 500 })
      }
      return originalImplementation!(input, options)
    })

    const text = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    text.value = 'Persisted first save'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    text.value = 'Failed second save'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Save failed'))

    document.querySelector<HTMLButtonElement>('#reset')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe('Persisted first save'))
    expect(document.querySelector<HTMLButtonElement>('#save')?.classList.contains('dirty')).toBe(false)
  })

  it('defers reset until an in-flight save establishes the persisted baseline', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolveSave: ((response: Response) => void) | undefined
    const pendingSave = new Promise<Response>(resolve => { resolveSave = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/default' && options?.method === 'PUT') return pendingSave
      return originalImplementation!(input, options)
    })

    const text = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    text.value = 'Saved before reset'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    text.value = 'Unsaved after submit'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#reset')?.click()
    expect(text.value).toBe('Unsaved after submit')

    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')).toBe(true))
    const saveCall = fetcher.mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    resolveSave?.(new Response(String(saveCall?.[1]?.body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe('Saved before reset'))
  })

  it('keeps a newer unsaved draft preview after an earlier save completes', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolveSave: ((response: Response) => void) | undefined
    const pendingSave = new Promise<Response>(resolve => { resolveSave = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/default' && options?.method === 'PUT') return pendingSave
      return originalImplementation!(input, options)
    })

    const text = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    text.value = 'Submitted layout'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    text.value = 'Newer unsaved layout'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')).toBe(true))
    const saveCall = fetcher.mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    resolveSave?.(new Response(String(saveCall?.[1]?.body), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await vi.waitFor(() => expect(decodeURIComponent(document.querySelector<HTMLImageElement>('#preview-frame')?.src || '')).toContain('Newer unsaved layout'))
    expect(decodeURIComponent(document.querySelector<HTMLImageElement>('#preview-frame')?.src || '')).not.toContain('Submitted layout')
    expect(document.querySelector<HTMLButtonElement>('#save')?.classList.contains('dirty')).toBe(true)
  })

  it('serializes quick schedule patches after an in-flight full save', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolveSave: ((response: Response) => void) | undefined
    const pendingSave = new Promise<Response>(resolve => { resolveSave = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/default' && options?.method === 'PUT') return pendingSave
      if (path === '/api/schedules/default' && options?.method === 'PATCH') {
        return new Response(JSON.stringify({ name: 'Quick rename' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return originalImplementation!(input, options)
    })
    vi.spyOn(dom.window, 'prompt').mockReturnValue('Quick rename')

    document.querySelector<HTMLButtonElement>('#save')?.click()
    document.querySelector<HTMLButtonElement>('#schedule-menu')?.click()
    document.querySelector<HTMLButtonElement>('#schedule-popover [data-action="rename"]')?.click()
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')).toBe(true))
    expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PATCH')).toBe(false)

    const saveCall = fetcher.mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    resolveSave?.(new Response(String(saveCall?.[1]?.body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PATCH')).toBe(true))
    expect(document.querySelector<HTMLInputElement>('#schedule-name')?.value).toBe('Quick rename')
  })

  it('preserves unrelated dirty inspector fields across quick patches', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const name = document.querySelector<HTMLInputElement>('#schedule-name')!
    name.value = 'Unsaved inspector name'
    name.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

    document.querySelector<HTMLButtonElement>('#schedule-menu')?.click()
    document.querySelector<HTMLButtonElement>('#schedule-popover [data-action="toggle"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#schedule-enabled')?.checked).toBe(false))

    expect(document.querySelector<HTMLInputElement>('#schedule-name')?.value).toBe('Unsaved inspector name')
    expect(document.querySelector<HTMLButtonElement>('#save')?.classList.contains('dirty')).toBe(true)
  })

  it('keeps an uncached schedule switch non-interactive until load commits', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolveSecond: ((response: Response) => void) | undefined
    const pendingSecond = new Promise<Response>(resolve => { resolveSecond = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      if (new URL(String(input), 'http://editor.local').pathname === '/api/schedules/second/config') return pendingSecond
      return originalImplementation!(input, options)
    })

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/second/config')).toBe(true))
    expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default')
    expect(document.querySelector<HTMLButtonElement>('#save')?.disabled).toBe(true)
    expect(document.querySelector<HTMLFormElement>('#form')?.hidden).toBe(true)
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.disabled).toBe(true)
    expectCanvasState(document, 'rendering')

    const secondLayout = structuredClone(layout)
    const secondTitle = secondLayout.items[0]
    if (secondTitle?.type !== 'text') throw new Error('expected text title')
    secondTitle.text = 'Second loaded'
    resolveSecond?.(new Response(JSON.stringify(secondLayout), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe('Second loaded')
    expect(document.querySelector<HTMLButtonElement>('#save')?.disabled).toBe(false)
  })

  it('restores the prior ready canvas when an uncached schedule load fails', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      if (new URL(String(input), 'http://editor.local').pathname === '/api/schedules/second/config') return new Response('load failed', { status: 500 })
      return originalImplementation!(input, options)
    })

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Schedule load failed'))

    expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default')
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe('A')
    expect(document.querySelector<HTMLButtonElement>('#save')?.disabled).toBe(false)
    expectCanvasState(document, 'ready')
  })

  it.each(['second', 'default'])('aborts a pending switch when deleting %s', async (deletedId) => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolveSecond: ((response: Response) => void) | undefined
    const pendingSecond = new Promise<Response>(resolve => { resolveSecond = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/second/config') return pendingSecond
      if (path === '/api/schedules/' + deletedId && options?.method === 'DELETE') return new Response(null, { status: 204 })
      return originalImplementation!(input, options)
    })

    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('#save')?.disabled).toBe(true))
    document.querySelector<HTMLButtonElement>('#manage-schedules')?.click()
    document.querySelector<HTMLButtonElement>('[data-delete="' + deletedId + '"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab[data-id="' + deletedId + '"]')).toBeNull())
    resolveSecond?.(new Response(JSON.stringify(layout), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const expectedActive = deletedId === 'default' ? 'second' : 'default'
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe(expectedActive))
    expect(document.querySelector<HTMLButtonElement>('#save')?.disabled).toBe(false)
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe('A')
    expectCanvasState(document, deletedId === 'default' ? 'rendering' : 'ready')
  })

  it.each([
    ['create', '#add-schedule', '/api/schedules'],
    ['duplicate', '#schedule-popover [data-action="duplicate"]', '/api/schedules/default/duplicate']
  ])('keeps %s non-interactive until the new schedule load commits', async (_operation, selector, mutationPath) => {
    const dom = await editorDom()
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolveCreated: ((response: Response) => void) | undefined
    const pendingCreated = new Promise<Response>(resolve => { resolveCreated = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === mutationPath && options?.method === 'POST') return new Response(JSON.stringify({ id: 'created', name: 'Created', enabled: false, order: 1, timing: { kind: 'manual' }, destination: {}, status: {} }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      if (path === '/api/schedules/created/config') return pendingCreated
      return originalImplementation!(input, options)
    })
    vi.spyOn(dom.window, 'prompt').mockReturnValue('Created')

    if (selector.includes('schedule-popover')) document.querySelector<HTMLButtonElement>('#schedule-menu')?.click()
    document.querySelector<HTMLButtonElement>(selector)?.click()
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/created/config')).toBe(true))
    expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('default')
    expect(document.querySelector<HTMLButtonElement>('#save')?.disabled).toBe(true)
    expect(document.querySelector<HTMLFormElement>('#form')?.hidden).toBe(true)
    expectCanvasState(document, 'rendering')

    const createdLayout = structuredClone(layout)
    const createdTitle = createdLayout.items[0]
    if (createdTitle?.type !== 'text') throw new Error('expected text title')
    createdTitle.text = 'Created loaded'
    resolveCreated?.(new Response(JSON.stringify(createdLayout), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('created'))
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')?.value).toBe('Created loaded')
    expect(document.querySelector<HTMLButtonElement>('#save')?.disabled).toBe(false)
  })

  it('does not push a different or newly dirty schedule after saving', async () => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolveSave: ((response: Response) => void) | undefined
    const pendingSave = new Promise<Response>(resolve => { resolveSave = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/default' && options?.method === 'PUT') return pendingSave
      return originalImplementation!(input, options)
    })

    const text = document.querySelector<HTMLTextAreaElement>('textarea[name="text"]')!
    text.value = 'Submitted for push'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#push-now')?.click()
    text.value = 'Newer unsaved draft'
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    const saveCall = fetcher.mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    resolveSave?.(new Response(String(saveCall?.[1]?.body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Push canceled'))

    expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname.endsWith('/push') && options?.method === 'POST')).toBe(false)
  })

  it('waits for queued quick patches before pushing', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolvePatch: ((response: Response) => void) | undefined
    const pendingPatch = new Promise<Response>(resolve => { resolvePatch = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/default' && options?.method === 'PATCH') return pendingPatch
      if (path === '/api/schedules/default/push' && options?.method === 'POST') return new Response(JSON.stringify({ status: { result: 'success' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return originalImplementation!(input, options)
    })
    vi.spyOn(dom.window, 'prompt').mockReturnValue('Queued rename')

    document.querySelector<HTMLButtonElement>('#schedule-menu')?.click()
    document.querySelector<HTMLButtonElement>('#schedule-popover [data-action="rename"]')?.click()
    document.querySelector<HTMLButtonElement>('#push-now')?.click()
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PATCH')).toBe(true))
    expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default/push' && options?.method === 'POST')).toBe(false)

    resolvePatch?.(new Response(JSON.stringify({ name: 'Queued rename' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default/push' && options?.method === 'POST')).toBe(true))
  })

  it('waits for queued mutations before duplicating', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolvePatch: ((response: Response) => void) | undefined
    const pendingPatch = new Promise<Response>(resolve => { resolvePatch = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/default' && options?.method === 'PATCH') return pendingPatch
      if (path === '/api/schedules/default/duplicate' && options?.method === 'POST') return new Response(JSON.stringify({ id: 'created', name: 'Created', enabled: false, order: 1, timing: { kind: 'manual' }, destination: {}, status: {} }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      if (path === '/api/schedules/created/config') return new Response(JSON.stringify(layout), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return originalImplementation!(input, options)
    })
    vi.spyOn(dom.window, 'prompt').mockReturnValue('Queued rename')

    document.querySelector<HTMLButtonElement>('#schedule-menu')?.click()
    document.querySelector<HTMLButtonElement>('#schedule-popover [data-action="rename"]')?.click()
    document.querySelector<HTMLButtonElement>('#schedule-menu')?.click()
    document.querySelector<HTMLButtonElement>('#schedule-popover [data-action="duplicate"]')?.click()
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PATCH')).toBe(true))
    expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default/duplicate' && options?.method === 'POST')).toBe(false)

    resolvePatch?.(new Response(JSON.stringify({ name: 'Queued rename' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default/duplicate' && options?.method === 'POST')).toBe(true))
  })

  it('cancels duplication when a queued prerequisite fails', async () => {
    const dom = await editorDom()
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolvePatch: ((response: Response) => void) | undefined
    const pendingPatch = new Promise<Response>(resolve => { resolvePatch = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === '/api/schedules/default' && options?.method === 'PATCH') return pendingPatch
      return originalImplementation!(input, options)
    })
    vi.spyOn(dom.window, 'prompt').mockReturnValue('Failed rename')

    document.querySelector<HTMLButtonElement>('#schedule-menu')?.click()
    document.querySelector<HTMLButtonElement>('#schedule-popover [data-action="rename"]')?.click()
    document.querySelector<HTMLButtonElement>('#schedule-menu')?.click()
    document.querySelector<HTMLButtonElement>('#schedule-popover [data-action="duplicate"]')?.click()
    resolvePatch?.(new Response('rename failed', { status: 500 }))

    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Duplicate canceled'))
    expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default/duplicate' && options?.method === 'POST')).toBe(false)
  })

  it.each([
    ['create', '#add-schedule', '/api/schedules'],
    ['duplicate', '#schedule-popover [data-action="duplicate"]', '/api/schedules/default/duplicate']
  ])('does not activate a late %s response after newer navigation', async (_operation, selector, mutationPath) => {
    const dom = await editorDom(null, undefined, undefined, '', [], layout, true)
    const document = dom.window.document
    const fetcher = globalThis.fetch as ReturnType<typeof vi.fn>
    const originalImplementation = fetcher.getMockImplementation()
    let resolveCreated: ((response: Response) => void) | undefined
    const pendingCreated = new Promise<Response>(resolve => { resolveCreated = resolve })
    fetcher.mockImplementation(async (input: string | URL | Request, options?: RequestInit) => {
      const path = new URL(String(input), 'http://editor.local').pathname
      if (path === mutationPath && options?.method === 'POST') return pendingCreated
      return originalImplementation!(input, options)
    })
    vi.spyOn(dom.window, 'prompt').mockReturnValue('Created')

    if (selector.includes('schedule-popover')) document.querySelector<HTMLButtonElement>('#schedule-menu')?.click()
    document.querySelector<HTMLButtonElement>(selector)?.click()
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([input, options]) => new URL(String(input), 'http://editor.local').pathname === mutationPath && options?.method === 'POST')).toBe(true))
    document.querySelector<HTMLButtonElement>('.schedule-tab[data-id="second"]')?.click()
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second'))
    resolveCreated?.(new Response(JSON.stringify({ id: 'created', name: 'Created', enabled: false, order: 2, timing: { kind: 'manual' }, destination: {}, status: {} }), { status: 201, headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(document.querySelector('.schedule-tab[data-id="created"]')).not.toBeNull())

    expect(document.querySelector('.schedule-tab.active')?.getAttribute('data-id')).toBe('second')
    expect(fetcher.mock.calls.some(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/created/config')).toBe(false)
  })

  it('removes unused entity mappings with hyphenated source keys', async () => {
    const hyphenatedLayout = structuredClone(layout)
    hyphenatedLayout.data = { entities: { ...hyphenatedLayout.data?.entities, 'temperature-2': 'sensor.temperature_2' } }
    const sourceMetric = hyphenatedLayout.items[2]
    if (sourceMetric?.type !== 'metric') throw new Error('expected source metric')
    hyphenatedLayout.items.push({ ...sourceMetric, id: 'temperature-2', value: '{{ temperature-2 }}' })
    const dom = await editorDom(null, undefined, undefined, '', [], hyphenatedLayout)
    const document = dom.window.document

    document.querySelector<HTMLElement>('.item[data-id="temperature-2"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#delete-field')?.click()
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.data?.entities).not.toHaveProperty('temperature-2')
    expect(body.config.data?.entities).toHaveProperty('temperature')
  })

  it('clears live unit insertion when the template includes the explicit unit', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], {
      unitSource: 'temperature',
      previewSource: 'temperature',
      previewState: '21.5',
      previewUnit: '°C'
    })
    const dom = await editorDom(null, undefined, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')!
    value.value = '{{ temperature }} °C'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'temperature')).toMatchObject({ unitSource: 'temperature', explicitUnitOccurrences: [0] })
  })

  it('clears live unit insertion for a different adjacent unit but not prose', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], {
      unitSource: 'temperature',
      previewSource: 'temperature',
      previewState: '21.5',
      previewUnit: '°C'
    })
    const dom = await editorDom(null, undefined, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')!
    value.value = '{{ temperature }} indoors'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    value.value = '{{ temperature }} °F'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'temperature')).toMatchObject({ unitSource: 'temperature', explicitUnitOccurrences: [0] })
  })

  it('clears live unit insertion for uncommon explicit units', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], {
      unitSource: 'temperature',
      previewSource: 'temperature',
      previewState: '21.5',
      previewUnit: '°C'
    })
    const dom = await editorDom(null, undefined, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')!
    value.value = '{{ temperature }} µg/m³'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'temperature')).toMatchObject({ unitSource: 'temperature', explicitUnitOccurrences: [0] })
  })

  it.each(['{{ temperature }} in room', '{{ temperature }} now', '{{ temperature }} low', 'Air {{ temperature }}'])('keeps live units for ambiguous adjacent prose: %s', async (template) => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], {
      unitSource: 'temperature',
      previewSource: 'temperature',
      previewState: '21.5',
      previewUnit: '°C'
    })
    const dom = await editorDom(null, undefined, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')!
    value.value = template
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'temperature')).toHaveProperty('unitSource', 'temperature')
    expect(body.config.items.find(item => item.id === 'temperature')).not.toHaveProperty('explicitUnitOccurrences')
  })

  it('does not mark uppercase prose as an explicit unit', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], {
      unitSource: 'temperature', previewSource: 'temperature', previewState: '21.5', previewUnit: '°C'
    })
    const dom = await editorDom(null, undefined, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')!
    value.value = '{{ temperature }} NOW'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'temperature')).toHaveProperty('unitSource', 'temperature')
    expect(body.config.items.find(item => item.id === 'temperature')).not.toHaveProperty('explicitUnitOccurrences')
  })

  it('recognizes ambiguous inches when they match the discovered unit', async () => {
    const snapshotLayout = structuredClone(layout)
    Object.assign(snapshotLayout.items[2], {
      unitSource: 'temperature',
      previewSource: 'temperature',
      previewState: '12',
      previewUnit: 'in'
    })
    const dom = await editorDom(null, undefined, undefined, '', [], snapshotLayout)
    const document = dom.window.document
    document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
    const value = document.querySelector<HTMLTextAreaElement>('textarea[name="value"]')!
    value.value = '{{ temperature }} in'
    value.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('#save')?.click()
    await vi.waitFor(() => expect(document.querySelector('#status')?.textContent).toContain('Saved only'))

    const saveCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input, options]) => new URL(String(input), 'http://editor.local').pathname === '/api/schedules/default' && options?.method === 'PUT')
    const body = JSON.parse(String(saveCall?.[1]?.body)) as { config: LayoutConfig }
    expect(body.config.items.find(item => item.id === 'temperature')).toMatchObject({ unitSource: 'temperature', explicitUnitOccurrences: [0] })
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
    const oldDiscoveryCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input]) => new URL(String(input), 'http://editor.local').pathname === '/api/home-assistant/entities')

    document.querySelector<HTMLButtonElement>('#global-settings')?.click()
    await vi.waitFor(() => expect(document.querySelector('#save-settings')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('#save-settings')?.click()
    await vi.waitFor(() => expect(document.querySelector('#global-modal')?.classList.contains('show')).toBe(false))

    await vi.waitFor(() => expect(document.querySelector('.entity-option')?.textContent).toContain('sensor.current'))
    expect(oldDiscoveryCall?.[1]?.signal?.aborted).toBe(true)

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

async function editorDom(webhookUrl: string | null = null, discovery: unknown = { entities: [] }, discoveryError?: { status: number; message: string }, bootstrapToken = '', discoveryResponses: Array<unknown | Promise<unknown>> = [], initialLayout: LayoutConfig = layout, secondSchedule = false, previewResponses: Array<string | Response> = [], autoLoadDraftImages = true, secondLayout: LayoutConfig = layout, editorUrl = 'http://editor.local/editor', storedToken = '', scheduleOrder: { defaultOrder?: number; secondOrder?: number } = {}): Promise<JSDOM> {
  const responses = new Map<string, unknown>([
    ['/api/schedules', { defaultScheduleId: 'default', schedules: [{
      id: 'default', name: 'Default', enabled: true, order: scheduleOrder.defaultOrder ?? 0,
      timing: { kind: 'manual' },
      destination: { deviceId: null, playlistId: null, mode: webhookUrl ? 'raw-webhook' : null, screenId: null, webhookUrl, modelId: null, screenName: null, screenLabel: null },
      status: { lastAttemptAt: null, lastSuccessAt: null, nextRunAt: null, result: null, error: null }
    }, ...(secondSchedule ? [{ id: 'second', name: 'Second', enabled: true, order: scheduleOrder.secondOrder ?? 1, timing: { kind: 'manual' }, destination: {}, status: {} }] : [])] }],
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
      const previewLayout = options?.body ? JSON.parse(String(options.body)) as LayoutConfig : initialLayout
      return new Response(renderSvg(previewLayout, editorPreviewRenderData(previewLayout)), { status: 200, headers: { 'Content-Type': 'image/svg+xml' } })
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
      Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: (cb: (frame?: number) => void) => { cb(); return 1 } })
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

function expectCanvasState(document: Document, state: 'ready' | 'rendering' | 'error'): void {
  expect(document.querySelector('#stage')?.classList.contains('canvas-hidden')).toBe(state !== 'ready')
  expect(document.querySelector('#canvas-state')?.classList.contains('show')).toBe(state !== 'ready')
  expect((document.querySelector<HTMLButtonElement>('#retry-preview')?.hidden)).toBe(state !== 'error')
}

function showSnapshotFallback(dom: JSDOM): void {
  const document = dom.window.document
  document.querySelector<HTMLElement>('.item[data-id="temperature"]')?.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }))
  const label = document.querySelector<HTMLTextAreaElement>('textarea[name="label"]')
  if (!label) throw new Error('metric label input missing')
  label.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
}

function sparseBaselineSvg(config: LayoutConfig): string {
  const items = config.items.map(item => item.type === 'line'
    ? `<line x1="${item.x}" y1="${item.y}" x2="${item.x + item.width}" y2="${item.y}" stroke="black"/>`
    : `<text x="${item.x}" y="${item.y + 18}" font-family="Arial" font-size="18">${item.id}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="white"/>${items}</svg>`
}

async function hiddenCanvasPixel(document: Document, x: number, y: number, baseline: string): Promise<number[]> {
  const hidden = document.querySelector('#stage')?.classList.contains('canvas-hidden')
  const svg = hidden ? '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="480"><rect width="800" height="480" fill="#e7eaee"/></svg>' : baseline
  const image = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const offset = (y * image.info.width + x) * 3
  return Array.from(image.data.subarray(offset, offset + 3))
}
