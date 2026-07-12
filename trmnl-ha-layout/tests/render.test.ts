import { describe, expect, it } from 'vitest'
import { loadLayoutConfig } from '../src/config.js'
import { sampleRenderData } from '../src/homeAssistant.js'
import { renderEditorHtml, renderSvg } from '../src/render.js'
import type { LayoutConfig, RenderData } from '../src/types.js'

describe('renderer', () => {
  it('positions bounded text from the top edge and escapes wrapped lines', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { message: 'sensor.message' } },
      items: [{ id: 'bounded', type: 'text', x: 20, y: 30, width: 70, height: 48, fontSize: 20, text: '{{ message }}' }]
    }
    const data: RenderData = { values: { message: 'A & B' }, states: {} }

    const svg = renderSvg(config, data)

    expect(svg).toContain('<text x="20" y="30"')
    expect(svg).toContain('A &amp; B')
    expect(svg).not.toContain('A &amp;amp; B')
  })

  it('renders an SVG with sleep and forecast content', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const svg = renderSvg(config, sampleRenderData(config))
    expect(svg).toContain('<svg')
    expect(svg).toContain('Sleep + Weather')
    expect(svg).not.toContain('Next 8 Hours')
    expect(svg).toContain('cloudy')
  })

  it('provides forecast sample values for arbitrary selected source keys', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: {
        entities: { firstTemperature: 'sensor.weather_hourly_forecast' },
        selectors: { firstTemperature: 'attributes.forecast.0.temperature' }
      },
      items: [{ id: 'temperature', type: 'text', x: 0, y: 0, width: 100, height: 30, text: '{{ firstTemperature }}' }]
    }

    const data = sampleRenderData(config)

    expect(data.values.firstTemperature).toBe(61)
    expect(data.states.firstTemperature.attributes.forecast).toBeInstanceOf(Array)
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
    expect(svg).toContain('<clipPath id="clip-8-forecast">')
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
    expect(svg).toContain('clip-path="url(#clip-8-forecast)"')
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
    expect(svg).toContain('clip-path="url(#clip-0-forecast-test)"')
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
    expect(svg).toContain('&lt;/text&gt;&lt;scr')
    expect(svg).not.toContain('</text><script>')
  })

  it('wraps and clips text within its exported bounds', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: {} },
      items: [{ id: 'bounded-text', type: 'text', x: 10, y: 20, width: 70, height: 40, fontSize: 16, text: 'First line wraps here\nSecond line' }]
    }
    const svg = renderSvg(config, { values: {}, states: {} })
    expect(svg).toContain('<clipPath id="clip-0-bounded-text"><rect x="10" y="20" width="70" height="40" /></clipPath>')
    expect(svg).toContain('clip-path="url(#clip-0-bounded-text)"')
    expect(svg).toContain('y="20"')
    expect(svg).toContain('y="40"')
    expect(svg).not.toContain('y="60"')
    expect(svg).not.toContain('Second line')
  })

  it('wraps interpolated text before escaping SVG characters', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: {} },
      items: [{ id: 'escaped-wrap', type: 'text', x: 0, y: 0, width: 55, height: 60, fontSize: 16, text: '{{ value }}' }]
    }
    const svg = renderSvg(config, { values: { value: 'A&B' }, states: {} })
    expect(svg).toContain('>A&amp;B</text>')
    expect(svg).not.toContain('&amp</text>')
  })

  it('wraps text without splitting grapheme clusters', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: {} },
      items: [{ id: 'unicode-wrap', type: 'text', x: 0, y: 0, width: 9, height: 80, fontSize: 16, text: '👨‍👩‍👧‍👦éX' }]
    }
    const svg = renderSvg(config, { values: {}, states: {} })
    expect(svg).toContain('>👨‍👩‍👧‍👦</text>')
    expect(svg).toContain('>é</text>')
    expect(svg).not.toContain('�')
  })

  it('uses unique forecast clip paths for IDs with the same sanitized form', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: { weather: 'sensor.weather' } },
      items: [
        { id: 'weather hourly', type: 'forecast', x: 0, y: 0, width: 200, height: 40, source: 'weather' },
        { id: 'weather-hourly', type: 'forecast', x: 0, y: 50, width: 300, height: 60, source: 'weather' }
      ]
    }
    const data: RenderData = { values: {}, states: { weather: { entity_id: 'sensor.weather', state: 'forecast', attributes: { forecast: [] } } } }

    const svg = renderSvg(config, data)

    expect(svg).toContain('id="clip-0-weather-hourly"')
    expect(svg).toContain('id="clip-1-weather-hourly"')
  })

  it('clips metric contents to the card bounds', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: {} },
      items: [{ id: 'small-card', type: 'metric', x: 10, y: 20, width: 80, height: 24, label: 'Label', value: '123', fontSize: 40 }]
    }

    const svg = renderSvg(config, { values: {}, states: {} })
    expect(svg).toContain('<clipPath id="clip-metric-0-small-card"><rect x="0" y="0" width="80" height="24" rx="10" /></clipPath>')
    expect(svg).toContain('<g clip-path="url(#clip-metric-0-small-card)" transform="translate(10,20)">')
  })

  it('uses render-local clip ids for text items with colliding ids', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: {} },
      items: [
        { id: 'same id', type: 'text', x: 0, y: 0, width: 100, height: 30, text: 'First' },
        { id: 'same-id', type: 'text', x: 0, y: 40, width: 100, height: 30, text: 'Second' }
      ]
    }
    const svg = renderSvg(config, { values: {}, states: {} })
    expect(svg).toContain('id="clip-0-same-id"')
    expect(svg).toContain('id="clip-1-same-id"')
  })

  it('uses render-local clip ids for metric items with colliding ids', () => {
    const config: LayoutConfig = {
      frame: { width: 800, height: 480, background: '#fff', foreground: '#111', fontFamily: 'Arial' },
      data: { entities: {} },
      items: [
        { id: 'same id', type: 'metric', x: 0, y: 0, width: 100, height: 40, label: 'First', value: '1' },
        { id: 'same-id', type: 'metric', x: 0, y: 50, width: 100, height: 40, label: 'Second', value: '2' }
      ]
    }
    const svg = renderSvg(config, { values: {}, states: {} })
    expect(svg).toContain('id="clip-metric-0-same-id"')
    expect(svg).toContain('id="clip-metric-1-same-id"')
  })

  it('escapes masked HA token placeholders in editor settings UI', () => {
    const html = renderEditorHtml()
    expect(html).toContain("escapeHtml(settings.haToken || 'set to replace')")
    expect(html).not.toContain("placeholder=\"' + (settings.haToken || 'set to replace')")
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
    expect(html).toContain("config.data.entities[source] = entity")
    expect(html).toContain("value:'{{ ' + source + ' }}'")
    expect(html).toContain("status('Added field. Save to persist it to runtime YAML.')")
  })

  it('includes delete-field handling with confirmation and unused entity cleanup', () => {
    const html = renderEditorHtml()
    expect(html).toContain('id="delete-field"')
    expect(html).toContain("confirm('Delete field \"")
    expect(html).toContain('config.items.splice(index, 1)')
    expect(html).toContain('removeUnusedEntities(referencedSources(item))')
    expect(html).toContain('sourceStillReferenced(source)')
    expect(html).toContain("status('Deleted field. Save to persist it to runtime YAML.')")
  })
})
