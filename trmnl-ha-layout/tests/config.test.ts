import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadLayoutConfig, saveLayoutConfig, validateLayoutConfig } from '../src/config.js'
import type { LayoutConfig } from '../src/types.js'

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

  it('accepts string preview snapshots only on metric items', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const metric = config.items.find((item) => item.type === 'metric')
    if (!metric || metric.type !== 'metric') throw new Error('metric item missing')
    metric.previewSource = 'minutesAsleep'
    metric.previewState = '21.5'
    metric.previewUnit = '°C'

    expect(() => validateLayoutConfig(config)).not.toThrow()

    const numericSnapshot = structuredClone(config) as unknown as LayoutConfig
    Object.assign(numericSnapshot.items.find((item) => item.id === metric.id)!, { previewState: 21.5 })
    expect(() => validateLayoutConfig(numericSnapshot)).toThrow('invalid previewState')

    const unboundSnapshot = structuredClone(config) as unknown as LayoutConfig
    delete (unboundSnapshot.items.find((item) => item.id === metric.id) as { previewSource?: string }).previewSource
    expect(() => validateLayoutConfig(unboundSnapshot)).toThrow('preview snapshot requires previewSource')

    const textSnapshot = structuredClone(config) as unknown as LayoutConfig
    const text = textSnapshot.items.find((item) => item.type === 'text')!
    Object.assign(text, { previewUnit: 'private' })
    expect(() => validateLayoutConfig(textSnapshot)).toThrow('may only use previewUnit when type is metric')
  })

  it('rejects unknown metric value formats while preserving layouts without one', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    expect(() => validateLayoutConfig(config)).not.toThrow()
    const metric = config.items.find(item => item.type === 'metric')
    if (!metric || metric.type !== 'metric') throw new Error('expected metric')
    Object.assign(metric, { valueFormat: 'surprising' })
    expect(() => validateLayoutConfig(config)).toThrow('invalid valueFormat')

    for (const valueFormat of [['raw'], 1, null]) {
      Object.assign(metric, { valueFormat })
      expect(() => validateLayoutConfig(config)).toThrow('invalid valueFormat')
    }
  })

  it('rejects value formats on non-metric items', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const text = config.items.find(item => item.type === 'text')!
    Object.assign(text, { valueFormat: 'raw' })
    expect(() => validateLayoutConfig(config)).toThrow('may only use valueFormat when type is metric')
  })

  it('validates runtime unit sources only on metric items', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const metric = config.items.find(item => item.type === 'metric')!
    Object.assign(metric, { unitSource: 'minutesAsleep', value: '{{ minutesAsleep }}' })
    expect(() => validateLayoutConfig(config)).not.toThrow()
    Object.assign(metric, { unitSource: '' })
    expect(() => validateLayoutConfig(config)).toThrow('invalid unitSource')
    const text = config.items.find(item => item.type === 'text')!
    Object.assign(text, { unitSource: 'temperature' })
    expect(() => validateLayoutConfig(config)).toThrow('may only use unitSource when type is metric')
  })

  it('requires runtime unit sources to be configured and referenced by the metric value', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const metric = config.items.find(item => item.type === 'metric')!
    Object.assign(metric, { unitSource: 'missing', value: '{{ missing }}' })
    expect(() => validateLayoutConfig(config)).toThrow('unitSource is not configured in data.entities')

    Object.assign(metric, { unitSource: 'minutesAsleep', value: '{{ minutesAwake }}' })
    expect(() => validateLayoutConfig(config)).toThrow('unitSource is not referenced by value')

    Object.assign(metric, { unitSource: 'minutesAsleep', value: '{{ minutesAsleep | raw }}' })
    expect(() => validateLayoutConfig(config)).not.toThrow()
  })

  it('requires preview sources to be configured and referenced by the metric value', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const metric = config.items.find(item => item.type === 'metric')!
    Object.assign(metric, { previewSource: 'missing', previewState: '21.5', value: '{{ missing }}' })
    expect(() => validateLayoutConfig(config)).toThrow('previewSource is not configured in data.entities')

    Object.assign(metric, { previewSource: 'minutesAsleep', value: '{{ minutesAwake }}' })
    expect(() => validateLayoutConfig(config)).toThrow('previewSource is not referenced by value')

    Object.assign(metric, { previewSource: 'minutesAsleep', value: '{{ minutesAsleep | raw }}' })
    expect(() => validateLayoutConfig(config)).not.toThrow()
  })

  it('requires preview and runtime unit sources to match when both are present', () => {
    const config = loadLayoutConfig('data/default-layout.yaml')
    const metric = config.items.find(item => item.type === 'metric')!
    Object.assign(metric, {
      value: '{{ minutesAsleep }} / {{ minutesAwake }}',
      previewSource: 'minutesAsleep',
      previewState: '125',
      previewUnit: 'min',
      unitSource: 'minutesAwake'
    })
    expect(() => validateLayoutConfig(config)).toThrow('previewSource and unitSource must match')

    delete (metric as { unitSource?: string }).unitSource
    expect(() => validateLayoutConfig(config)).not.toThrow()
    Object.assign(metric, { unitSource: 'minutesAsleep' })
    expect(() => validateLayoutConfig(config)).not.toThrow()
  })
})
