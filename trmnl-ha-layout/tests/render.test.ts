import { describe, expect, it } from 'vitest'
import { loadLayoutConfig } from '../src/config.js'
import { sampleRenderData } from '../src/homeAssistant.js'
import { renderSvg } from '../src/render.js'
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
    expect(svg).toContain('<clipPath id="clip-forecast">')
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
    expect(svg).toContain('clip-path="url(#clip-forecast)"')
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
    expect(svg).toContain('clip-path="url(#clip-forecast-test)"')
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
})
