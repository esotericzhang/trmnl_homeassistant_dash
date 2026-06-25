import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import type { LayoutConfig, LayoutItem } from './types.js'

const projectDefault = path.resolve(process.cwd(), 'data/default-layout.yaml')
const addonDefault = '/data/layout.yaml'

export function resolveLayoutPath(): string {
  if (process.env.LAYOUT_PATH) return process.env.LAYOUT_PATH
  if (fs.existsSync(addonDefault)) return addonDefault
  return projectDefault
}

export function ensureLayoutFile(layoutPath = resolveLayoutPath()): void {
  if (fs.existsSync(layoutPath)) return
  fs.mkdirSync(path.dirname(layoutPath), { recursive: true })
  fs.copyFileSync(projectDefault, layoutPath)
}

export function loadLayoutConfig(layoutPath = resolveLayoutPath()): LayoutConfig {
  ensureLayoutFile(layoutPath)
  const raw = fs.readFileSync(layoutPath, 'utf8')
  const parsed = yaml.load(raw) as LayoutConfig
  validateLayoutConfig(parsed)
  return parsed
}

export function saveLayoutConfig(config: LayoutConfig, layoutPath = resolveLayoutPath()): LayoutConfig {
  validateLayoutConfig(config)
  fs.mkdirSync(path.dirname(layoutPath), { recursive: true })
  const yamlText = yaml.dump(config, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  })
  const temporaryPath = `${layoutPath}.tmp`
  fs.writeFileSync(temporaryPath, yamlText, 'utf8')
  fs.renameSync(temporaryPath, layoutPath)
  return loadLayoutConfig(layoutPath)
}

export function validateLayoutConfig(config: LayoutConfig): void {
  if (!config?.frame || !config?.data?.entities || !Array.isArray(config.items)) {
    throw new Error('Layout must include frame, data.entities, and items')
  }
  for (const key of ['width', 'height'] as const) {
    if (!Number.isFinite(config.frame[key]) || config.frame[key] <= 0) {
      throw new Error(`frame.${key} must be a positive number`)
    }
  }
  config.items.forEach(validateItem)
}

function validateItem(item: LayoutItem): void {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (!Number.isFinite(item[key])) throw new Error(`item ${item.id} has invalid ${key}`)
  }
  if (!['text', 'metric', 'forecast', 'line'].includes(item.type)) {
    throw new Error(`item ${item.id} has unsupported type ${item.type}`)
  }
}

export function getRuntimeConfig() {
  const options = getAddonOptions()
  return {
    port: Number(process.env.PORT ?? 10000),
    homeAssistantUrl: process.env.HOME_ASSISTANT_URL ?? stringOption(options, 'home_assistant_url') ?? 'http://homeassistant:8123',
    accessToken: process.env.ACCESS_TOKEN ?? process.env.HA_TOKEN ?? stringOption(options, 'access_token') ?? '',
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? stringOption(options, 'public_base_url') ?? '',
    refreshIntervalSeconds: Number(process.env.REFRESH_INTERVAL_SECONDS ?? numberOption(options, 'refresh_interval_seconds') ?? 0)
  }
}

export function getAddonOptions(optionsPath = '/data/options.json'): Record<string, unknown> {
  if (!fs.existsSync(optionsPath)) return {}
  return JSON.parse(fs.readFileSync(optionsPath, 'utf8')) as Record<string, unknown>
}

export function stringOption(options: Record<string, unknown>, key: string): string | undefined {
  const value = options[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function numberOption(options: Record<string, unknown>, key: string): number | undefined {
  const value = options[key]
  return typeof value === 'number' ? value : undefined
}
