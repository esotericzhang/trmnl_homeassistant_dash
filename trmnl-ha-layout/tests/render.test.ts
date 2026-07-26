import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { loadLayoutConfig } from '../src/config.js'
import { sampleRenderData } from '../src/homeAssistant.js'
import { renderEditorHtml, renderSvg } from '../src/render.js'
import type { LayoutConfig, RenderData } from '../src/types.js'

describe('renderer', () => {
  it('renders an SVG with sleep and forecast content', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const svg = renderSvg(config, sampleRenderData(config))
    expect(svg).toContain('<svg')
    expect(svg).toContain('Sleep + Weather')
    expect(svg).not.toContain('Next 8 Hours')
    expect(svg).toContain('cloudy')
  })

  it('keeps the default OG forecast within the visible frame', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const forecast = config.items.find((item) => item.id === 'forecast')
    expect(forecast).toBeDefined()
    expect(forecast!.type).toBe('forecast')
    if (forecast!.type !== 'forecast') throw new Error('forecast item must be a forecast')
    expect(forecast!.x).toBeGreaterThanOrEqual(0)
    expect(forecast!.x + forecast!.width).toBeLessThanOrEqual(config.frame.width)
    expect(forecast!.y + forecast!.height).toBeLessThanOrEqual(config.frame.height)
    expect(forecast!.width).toBeGreaterThanOrEqual(config.frame.width * 0.9)
    expect(forecast!.height).toBeGreaterThanOrEqual(config.frame.height * 0.7)
    expect(forecast!.rowHeight! * forecast!.maxItems!).toBeLessThanOrEqual(forecast!.height)
    expect(forecast!.y).toBeGreaterThan(104)
    expect(forecast!.y + forecast!.rowPaddingY!).toBeGreaterThan(104)

    const svg = renderSvg(config, sampleRenderData(config))
    expect(svg).toMatch(/<clipPath id="layout-clip-\d+">/)
    expect(svg).toContain('<rect x="0" y="0" width="744" height="342" />')
    expect(svg).toContain('translate(0,294)')
  })

  it('renders the default OG forecast with large bold rows, safe columns, and dividers', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const forecast = config.items.find((item) => item.id === 'forecast')
    expect(forecast).toBeDefined()
    if (forecast!.type !== 'forecast') throw new Error('forecast item must be a forecast')
    expect(forecast).toMatchObject({
      type: 'forecast',
      y: 122,
      height: 342,
      fontSize: 31,
      weight: 900,
      rowHeight: 42,
      maxItems: 8,
      timeX: 0,
      tempX: 150,
      precipX: 250,
      conditionX: 350,
      conditionFontSize: 30,
      rowDivider: true
    })
    expect(forecast!.tempX! - forecast!.timeX!).toBeGreaterThanOrEqual(145)
    expect(forecast!.precipX! - forecast!.tempX!).toBeGreaterThanOrEqual(90)
    expect(forecast!.conditionX! - forecast!.precipX!).toBeGreaterThanOrEqual(95)

    const svg = renderSvg(config, sampleRenderData(config))
    expect(svg).toContain('font-size="31" font-weight="900"')
    expect(svg).toContain('font-size="30" font-weight="900" fill="#222"')
    expect(svg).toContain('x2="744" y2="41" stroke="#111"')
    expect(svg).toMatch(/clip-path="url\(#layout-clip-\d+\)"/)
  })

  it('clips forecast rows and truncates long conditions inside item bounds', () => {
    const config: LayoutConfig = {
      frame: {
        width: 800,
        height: 480,
        background: '#fff',
        foreground: '#111',
        fontFamily: 'Arial'
      },
      data: { entities: { hourlyForecast: 'sensor.weather_hourly_forecast' } },
      items: [{
        id: 'forecast-test',
        type: 'forecast',
        x: 420,
        y: 136,
        width: 220,
        height: 68,
        fontSize: 16,
        rowHeight: 34,
        maxItems: 8,
        source: 'hourlyForecast'
      }]
    }
    const data: RenderData = {
      values: {},
      states: {
        hourlyForecast: {
          entity_id: 'sensor.weather_hourly_forecast',
          state: 'forecast',
          attributes: {
            forecast: [
              { datetime: '2026-06-24T08:00:00-07:00', temperature: 61, precipitation_probability: 15, condition: 'exceptionally-long-condition-text-that-would-overflow' },
              { datetime: '2026-06-24T09:00:00-07:00', temperature: 64, precipitation_probability: 20, condition: 'partly-cloudy' },
              { datetime: '2026-06-24T10:00:00-07:00', temperature: 67, precipitation_probability: 25, condition: 'sunny' }
            ]
          }
        }
      }
    }
    const svg = renderSvg(config, data)
    expect(svg).toContain('15%')
    expect(svg).toContain('excep…')
    expect(svg).toContain('clip-path="url(#layout-clip-0)"')
    expect(svg).not.toContain('translate(0,68)')
  })

  it('escapes static text item content in SVG output', () => {
    const config: LayoutConfig = {
      frame: {
        width: 800,
        height: 480,
        background: '#fff',
        foreground: '#111',
        fontFamily: 'Arial'
      },
      data: { entities: {} },
      items: [{
        id: 'unsafe-text',
        type: 'text',
        x: 0,
        y: 0,
        width: 200,
        height: 40,
        text: '</text><script>alert(1)</script>{{ value }}'
      }]
    }
    const svg = renderSvg(config, { values: { value: '<ok>' }, states: {} })
    expect(svg).toContain('&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;ok&gt;')
    expect(svg).not.toContain('</text><script>')
  })

  it('uses picker metadata to insert the live runtime unit', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { temperature: 'sensor.temperature' } },
      items: [{
        id: 'temperature', type: 'metric', x: 0, y: 0, width: 180, height: 62,
        label: 'Temperature', value: '{{ temperature }}', previewState: '21.5', previewUnit: '°C'
      }]
    }
    const svg = renderSvg(config, {
      values: { temperature: '99' },
      states: { temperature: { entity_id: 'sensor.temperature', state: '99', attributes: { unit_of_measurement: '°F' } } }
    })

    expect(svg).toContain('>99 °F</text>')
    expect(svg).not.toContain('°C')
    expect(svg).not.toContain('21.5')
  })

  it('preserves legacy literal units without automatic runtime insertion', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { temperature: 'sensor.temperature' } },
      items: [{ id: 'temperature', type: 'metric', x: 0, y: 0, width: 180, height: 62, label: 'Temperature', value: '{{ temperature }} °C' }]
    }
    const svg = renderSvg(config, {
      values: { temperature: '21.5' },
      states: { temperature: { entity_id: 'sensor.temperature', state: '21.5', attributes: { unit_of_measurement: '°F' } } }
    })

    expect(svg).toContain('>21.5 °C</text>')
    expect(svg).not.toContain('°F')
  })

  it('does not append a runtime unit to unavailable fallback values', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { temperature: 'sensor.temperature' } },
      items: [{ id: 'temperature', type: 'metric', x: 0, y: 0, width: 180, height: 62, label: 'Temperature', value: '{{ temperature }}', previewUnit: '°C' }]
    }
    const svg = renderSvg(config, {
      values: { temperature: 'unavailable' },
      states: { temperature: { entity_id: 'sensor.temperature', state: 'unavailable', attributes: { unit_of_measurement: '°F' } } }
    })

    expect(svg).toContain('>—</text>')
    expect(svg).not.toContain('— °F')
  })

  it('tracks live unit changes instead of persisting the picker preview unit', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { temperature: 'sensor.temperature' } },
      items: [{ id: 'temperature', type: 'metric', x: 0, y: 0, width: 180, height: 62, label: 'Temperature', value: '{{ temperature }}', previewUnit: '°C' }]
    }
    const renderWithUnit = (unit: string) => renderSvg(config, {
      values: { temperature: '70' },
      states: { temperature: { entity_id: 'sensor.temperature', state: '70', attributes: { unit_of_measurement: unit } } }
    })

    expect(renderWithUnit('°F')).toContain('>70 °F</text>')
    expect(renderWithUnit('K')).toContain('>70 K</text>')
  })

  it('suppresses discovered units after duration conversion', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { minutes: 'sensor.minutes' } },
      items: [{ id: 'duration', type: 'metric', x: 0, y: 0, width: 180, height: 62, label: 'Duration', value: '{{ minutes }}', valueFormat: 'duration-minutes', previewUnit: 'min' }]
    }

    const svg = renderSvg(config, { values: { minutes: '135' }, states: {} })
    expect(svg).toContain('>2h 15m</text>')
    expect(svg).not.toContain('2h 15m min')
  })

  it('applies named metric duration formatting to runtime values', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { minutes: 'sensor.minutes' } },
      items: [{ id: 'duration', type: 'metric', x: 0, y: 0, width: 180, height: 62, label: 'Duration', value: '{{ minutes }}', valueFormat: 'duration-minutes' }]
    }

    expect(renderSvg(config, { values: { minutes: '125' }, states: {} })).toContain('>2h 5m</text>')
    const metric = config.items[0]
    if (metric.type !== 'metric') throw new Error('expected metric')
    metric.valueFormat = 'raw'
    expect(renderSvg(config, { values: { minutes: '125' }, states: {} })).toContain('>125</text>')
  })

  it('preserves inline filters and explicit raw state strings', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { duration: 'sensor.duration', startedAt: 'sensor.started_at' } },
      items: [{ id: 'mixed', type: 'metric', x: 0, y: 0, width: 180, height: 62, label: 'Mixed', value: '{{ duration }} {{ startedAt | time }}', valueFormat: 'duration-minutes' }]
    }
    const durationSvg = renderSvg(config, { values: { duration: '125', startedAt: '2026-06-24T08:30:00Z' }, states: {} })
    expect(durationSvg).toContain('2h 5m ')
    expect(durationSvg).not.toContain('33774096h')

    const metric = config.items[0]
    if (metric.type !== 'metric') throw new Error('expected metric')
    metric.value = '{{ duration }}'
    metric.valueFormat = 'raw'
    expect(renderSvg(config, { values: { duration: 'unknown' }, states: {} })).toContain('>unknown</text>')
    delete metric.valueFormat
    expect(renderSvg(config, { values: { duration: 'unknown' }, states: {} })).toContain('>—</text>')
  })

  it('keeps the value unit when only a later placeholder is transformed', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { temperature: 'sensor.temperature', updated: 'sensor.updated' } },
      items: [{ id: 'mixed', type: 'metric', x: 0, y: 0, width: 240, height: 62, label: 'Mixed', value: '{{ temperature }} at {{ updated | time }}', previewUnit: '°C' }]
    }
    const svg = renderSvg(config, {
      values: { temperature: '21.5', updated: '2026-06-24T08:30:00Z' },
      states: {
        temperature: { entity_id: 'sensor.temperature', state: '21.5', attributes: { unit_of_measurement: '°C' } },
        updated: { entity_id: 'sensor.updated', state: '2026-06-24T08:30:00Z', attributes: {} }
      }
    })
    expect(svg).toMatch(/>21\.5 °C at [^<]+<\/text>/)
    expect(svg).not.toMatch(/at [^<]+ °C<\/text>/)
  })

  it('places a live unit beside its placeholder in decorated templates', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { temperature: 'sensor.temperature' } },
      items: [{ id: 'decorated', type: 'metric', x: 0, y: 0, width: 240, height: 62, label: 'Temperature', value: '{{ temperature }} indoors', previewUnit: 'stale' }]
    }
    const svg = renderSvg(config, {
      values: { temperature: '21.5' },
      states: { temperature: { entity_id: 'sensor.temperature', state: '21.5', attributes: { unit_of_measurement: '°C' } } }
    })
    expect(svg).toContain('>21.5 °C indoors</text>')
    expect(svg).not.toContain('stale')
  })

  it('clips runtime metric content to the configured item bounds', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { state: 'sensor.state' } },
      items: [{ id: 'narrow', type: 'metric', x: 10, y: 20, width: 40, height: 25, label: 'Long label', value: '{{ state }}' }]
    }
    const svg = renderSvg(config, { values: { state: 'Long runtime value outside bounds' }, states: {} })
    expect(svg).toContain('<clipPath id="layout-clip-0"><rect x="0" y="0" width="40" height="25" /></clipPath>')
    expect(svg).toContain('<g clip-path="url(#layout-clip-0)">')
  })

  it('keeps standard metric value glyphs inside a 62px card', async () => {
    const config: LayoutConfig = {
      frame: { width: 180, height: 80, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: {} },
      items: [{ id: 'standard', type: 'metric', x: 0, y: 0, width: 180, height: 62, label: 'Temperature', value: '{{ state }}', fontSize: 30 }]
    }
    const svg = renderSvg(config, { values: { state: 'gyjpQ' }, states: {} })
    const rendered = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const rowHasDarkText = (y: number) => {
      for (let x = 10; x < 170; x++) {
        const index = (y * rendered.info.width + x) * 3
        if (rendered.data[index] < 80 && rendered.data[index + 1] < 80 && rendered.data[index + 2] < 80) return true
      }
      return false
    }

    expect(svg).toContain('<text x="16" y="30" font-size="30" font-weight="700">gyjpQ</text>')
    expect(rowHasDarkText(60)).toBe(false)
  })

  it('clips runtime text to the configured item bounds', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: {} },
      items: [{ id: 'long-text', type: 'text', x: 10, y: 20, width: 40, height: 25, text: 'Long text outside bounds' }]
    }
    const svg = renderSvg(config, { values: {}, states: {} })

    expect(svg).toContain('<clipPath id="layout-clip-0"><rect x="10" y="20" width="40" height="25" /></clipPath>')
    expect(svg).toContain('clip-path="url(#layout-clip-0)"')
  })

  it('uses collision-free clip IDs for arbitrary cross-type item IDs', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { value: 'sensor.value' } },
      items: [
        { id: 'metric-temperature', type: 'text', x: 0, y: 0, width: 100, height: 30, text: 'Text' },
        { id: 'temperature )', type: 'metric', x: 0, y: 40, width: 100, height: 60, label: 'Metric', value: '{{ value }}' }
      ]
    }
    const svg = renderSvg(config, { values: { value: 'long value' }, states: {} })
    expect(svg).toContain('id="layout-clip-0"')
    expect(svg).toContain('id="layout-clip-1"')
    expect(svg.match(/id="layout-clip-/g)).toHaveLength(2)
    expect(svg).not.toContain('url(#clip-')
  })

  it('escapes masked HA token placeholders in editor settings UI', () => {
    const html = renderEditorHtml()
    expect(html).toContain("escapeHtml(settings.haToken || 'set to replace')")
    expect(html).not.toContain("placeholder=\"' + (settings.haToken || 'set to replace')")
  })

  it('escapes bootstrap tokens for an inline script context', () => {
    const token = '</script><script>globalThis.pwned=true</script>&>\u2028\u2029'
    const html = renderEditorHtml(token)
    expect(html).not.toContain(token)
    expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003e')
    expect(html).toContain('\\u0026\\u003e\\u2028\\u2029')
  })

  it('labels the byos-uri URL as Add-on URL and shows it only for byos-uri mode', () => {
    const html = renderEditorHtml()
    expect(html).toContain('const showAddonUrl = mode === \'byos-uri\';')
    expect(html).toContain('<label>Add-on URL</label>')
    expect(html).toContain('Terminus can use to fetch /screen.png')
    expect(html).not.toContain('<label>Public base URL</label>')
  })

  it('preserves the saved Add-on URL when the field is hidden by another mode', () => {
    const html = renderEditorHtml()
    expect(html).toContain("publicBaseUrl: addonUrlInput ? val('public_base_url') : (existing.publicBaseUrl || '')")
  })

  it('includes an add-field mode that creates text and sensor-backed fields', () => {
    const html = renderEditorHtml()
    expect(html).toContain('id="add-field"')
    expect(html).toContain('id="add-panel" class="add-panel" hidden')
    expect(html).toContain('Static text')
    expect(html).toContain('Sensor value')
    expect(html).toContain('addedIds.add(id)')
    expect(html).toContain('previewFor(item)')
    expect(html).toContain('config.data.entities[source]=entity')
    expect(html).toContain("value:'{{ '+source+' }}'")
    expect(html).toContain("status('Added field. Save to persist it to runtime YAML.')")
  })

  it('defines each core editor function once without layered reassignment', () => {
    const html = renderEditorHtml()
    for (const name of ['api', 'setAddMode', 'selectHomeAssistantEntity', 'renderOverlay', 'loadActiveConfig', 'fieldHtml', 'refreshPreview', 'refreshDraftPreview', 'metricPreviewText']) {
      expect(html.match(new RegExp(`(?:async )?function ${name}\\(`, 'g'))).toHaveLength(1)
      expect(html).not.toMatch(new RegExp(`${name}\\s*=`))
    }
  })

  it('includes delete-field handling with confirmation and unused entity cleanup', () => {
    const html = renderEditorHtml()
    expect(html).toContain('id="delete-field"')
    expect(html).toContain("confirm('Delete field \"")
    expect(html).toContain('config.items.splice(index,1)')
    expect(html).toContain('removeUnusedEntities(referencedSources(item))')
    expect(html).toContain('sourceStillReferenced(source)')
    expect(html).toContain("status('Deleted field. Save to persist it to runtime YAML.')")
  })

  it('includes responsive schedule tabs, a searchable manager, and per-schedule drafts', () => {
    const html = renderEditorHtml()
    expect(html).toContain('id="schedule-tabs"')
    expect(html).toContain('id="add-schedule"')
    expect(html).toContain('id="manage-schedules"')
    expect(html).toContain('id="manager-search"')
    expect(html).toContain('const drafts=new Map()')
    expect(html).toContain('class="dirty-mark"')
    expect(html).toContain('.tab-viewport{min-width:0;overflow-x:auto')
    expect(html).toContain('@media(max-width:820px)')
    expect(html).toContain('.workspace{grid-template-columns:1fr;padding:10px}')
  })

  it('wires schedule CRUD, config, duplicate, and push endpoints', () => {
    const html = renderEditorHtml()
    expect(html).toContain("api('/api/schedules')")
    expect(html).toContain("api('/api/schedules',{method:'POST'")
    expect(html).toContain("+'/duplicate',{method:'POST'}")
    expect(html).toContain("body:JSON.stringify({schedule:scheduleBody,config})")
    expect(html).toContain("+'/push',{method:'POST'}")
    expect(html).toContain("{method:'PATCH'")
    expect(html).toContain("{method:'DELETE'}")
    expect(html).toContain('id="schedule-webhook"')
    expect(html).toContain("previewFrame.src='/schedules/'")
    expect(html).toContain("if(draft()?.dirty&&!await saveActive())return")
    expect(html).toContain('d.loadedSchedule=clone(target)')
  })

  it('includes blank schedules and manual, interval, and daily timing controls', () => {
    const html = renderEditorHtml()
    expect(html).toContain('id="empty-stage" class="empty-stage"')
    expect(html).toContain('Blank schedule')
    expect(html).toContain('<option value="manual">Manual only</option>')
    expect(html).toContain('<option value="interval">Every interval</option>')
    expect(html).toContain('<option value="daily">Daily at a time</option>')
    expect(html).toContain("s.timing.intervalSeconds=amount*")
    expect(html).toContain("s.timing.time=document.getElementById('daily-time').value")
  })

  it('keeps global connection and authentication in a separate modal', () => {
    const html = renderEditorHtml()
    expect(html).toContain('id="global-settings"')
    expect(html).toContain('id="global-modal" class="manager"')
    expect(html).toContain('Global connection and authentication')
    expect(html).toContain('Shared by every schedule.')
    expect(html).toContain("api('/api/settings'")
    expect(html).toContain("api('/api/terminus/login'")
    expect(html).toContain("api('/api/terminus/refresh'")
    expect(html).toContain("api('/api/terminus/tokens'")
  })
})
