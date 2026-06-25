import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadLayoutConfig, saveLayoutConfig } from '../src/config.js'

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
})
