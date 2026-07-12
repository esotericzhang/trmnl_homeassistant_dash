import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadLayoutConfig, saveLayoutConfig, validateLayoutConfig } from '../src/config.js'
import type { LayoutItem } from '../src/types.js'

describe('layout config', () => {
  it('loads default layout with positioned items', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    expect(config.frame.width).toBe(800)
    expect(config.frame.height).toBe(480)
    expect(config.data.entities.minutesAsleep).toContain('google_health')
    expect(config.items.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y))).toBe(true)
  })

  it('saves valid layout YAML without losing item fields', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-layout-'))
    const layoutPath = path.join(directory, 'layout.yaml')
    const config = loadLayoutConfig('data/default-layout.yaml')
    const title = config.items.find((item) => item.id === 'title')
    if (!title || title.type !== 'text') throw new Error('title text item missing')
    title.x = 42
    title.text = 'Edited title'

    saveLayoutConfig(config, layoutPath)
    const saved = loadLayoutConfig(layoutPath)
    const savedTitle = saved.items.find((item) => item.id === 'title')

    expect(fs.readFileSync(layoutPath, 'utf8')).toContain('Edited title')
    expect(savedTitle).toMatchObject({ id: 'title', type: 'text', x: 42, text: 'Edited title' })
  })

  it('validates selectors against entities and supported paths', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    config.data.selectors = { minutesAsleep: 'attributes.forecast.0.temperature' }
    expect(() => validateLayoutConfig(config)).not.toThrow()

    config.data.selectors = { missing: 'state' }
    expect(() => validateLayoutConfig(config)).toThrow('must reference an existing entity key')

    config.data.selectors = { constructor: 'state' }
    expect(() => validateLayoutConfig(config)).toThrow('must reference an existing entity key')

    config.data.selectors = { minutesAsleep: 'attributes.forecast[0].temperature' }
    expect(() => validateLayoutConfig(config)).toThrow('unsupported path')

    for (const selector of [
      'attributes.forecast.8.temperature',
      'attributes.forecast.0.details.temperature.value',
      `attributes.${'a'.repeat(65)}`,
      `attributes.${'a'.repeat(246)}`
    ]) {
      config.data.selectors = { minutesAsleep: selector }
      expect(() => validateLayoutConfig(config)).toThrow('unsupported path')
    }

    config.data.selectors = { minutesAsleep: 42 } as unknown as Record<string, string>
    expect(() => validateLayoutConfig(config)).toThrow('must be a string map')
  })

  it('requires non-empty unique item ids', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    config.items[0].id = ''
    expect(() => validateLayoutConfig(config)).toThrow('item id must be a non-empty string')

    config.items[0].id = config.items[1].id
    expect(() => validateLayoutConfig(config)).toThrow(`item id ${config.items[1].id} must be unique`)

    config.items[0].id = 42 as unknown as string
    expect(() => validateLayoutConfig(config)).toThrow('item id must be a non-empty string')
  })

  it('rejects non-object item entries', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    config.items = [null as unknown as LayoutItem]
    expect(() => validateLayoutConfig(config)).toThrow('each item must be an object')
  })

  it('requires text literal flags to be boolean', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const title = config.items.find(item => item.type === 'text')
    if (!title || title.type !== 'text') throw new Error('text item missing')
    title.literal = 'false' as unknown as boolean
    expect(() => validateLayoutConfig(config)).toThrow(`item ${title.id} has invalid literal`)
  })
})
