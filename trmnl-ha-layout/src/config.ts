import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import type { LayoutConfig, LayoutItem } from './types.js'

const projectDefault = path.resolve(process.cwd(), 'data/default-layout.yaml')
const addonDefault = '/data/layout.yaml'
const DEFAULT_HOME_ASSISTANT_STATES_MAX_BYTES = 16 * 1024 * 1024

export class LayoutValidationError extends Error {}

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
  try {
    if (!config?.frame || !config?.data?.entities || !Array.isArray(config.items)) {
      throw new Error('Layout must include frame, data.entities, and items')
    }
    for (const key of ['width', 'height'] as const) {
      if (!Number.isFinite(config.frame[key]) || config.frame[key] <= 0) {
        throw new Error(`frame.${key} must be a positive number`)
      }
    }
    const itemIds = new Set<string>()
    config.items.forEach(item => {
      if (typeof item.id !== 'string' || !item.id.trim()) throw new Error('item id must be a non-empty string')
      if (itemIds.has(item.id)) throw new Error(`duplicate item id: ${item.id}`)
      itemIds.add(item.id)
      validateItem(item, config.data.entities)
    })
  } catch (error) {
    if (error instanceof LayoutValidationError) throw error
    throw new LayoutValidationError(error instanceof Error ? error.message : String(error))
  }
}

function validateItem(item: LayoutItem, entities: Record<string, string>): void {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (!Number.isFinite(item[key])) throw new Error(`item ${item.id} has invalid ${key}`)
  }
  if (!['text', 'metric', 'forecast', 'line'].includes(item.type)) {
    throw new Error(`item ${item.id} has unsupported type ${item.type}`)
  }
  if ((item.type === 'text' || item.type === 'metric') && (item.width <= 0 || item.height <= 0)) {
    throw new Error(`item ${item.id} width and height must be positive`)
  }
  const candidate = item as LayoutItem & Record<string, unknown>
  if ('valueFormat' in candidate) {
    if (item.type !== 'metric') throw new Error(`item ${item.id} may only use valueFormat when type is metric`)
    if (typeof candidate.valueFormat !== 'string' || !['raw', 'duration-minutes'].includes(candidate.valueFormat)) {
      throw new Error(`item ${item.id} has invalid valueFormat`)
    }
  }
  if ('unitSource' in candidate) {
    if (item.type !== 'metric') throw new Error(`item ${item.id} may only use unitSource when type is metric`)
    if (typeof candidate.unitSource !== 'string' || !candidate.unitSource) throw new Error(`item ${item.id} has invalid unitSource`)
    validateMetricSource(item, entities, 'unitSource', candidate.unitSource)
  }
  if ('explicitUnitOccurrences' in candidate) {
    if (item.type !== 'metric') throw new Error(`item ${item.id} may only use explicitUnitOccurrences when type is metric`)
    if (!Array.isArray(candidate.explicitUnitOccurrences)
      || candidate.explicitUnitOccurrences.some(value => !Number.isInteger(value) || value < 0)
      || new Set(candidate.explicitUnitOccurrences).size !== candidate.explicitUnitOccurrences.length) {
      throw new Error(`item ${item.id} has invalid explicitUnitOccurrences`)
    }
    if (!item.unitSource) throw new Error(`item ${item.id} explicitUnitOccurrences requires unitSource`)
    const placeholders = Array.from(item.value.matchAll(/{{\s*([\w.-]+)(?:\s*\|\s*([\w-]+))?\s*}}/g))
    if (candidate.explicitUnitOccurrences.some(index => placeholders[index]?.[1] !== item.unitSource
      || (placeholders[index]?.[2] && placeholders[index]?.[2] !== 'raw'))) {
      throw new Error(`item ${item.id} explicitUnitOccurrences must reference raw unitSource placeholders`)
    }
  }
  for (const key of ['previewSource', 'previewState', 'previewUnit'] as const) {
    if (!(key in candidate)) continue
    if (item.type !== 'metric') throw new Error(`item ${item.id} may only use ${key} when type is metric`)
    if (typeof candidate[key] !== 'string') throw new Error(`item ${item.id} has invalid ${key}`)
  }
  if (item.type === 'metric' && ('previewState' in candidate || 'previewUnit' in candidate) && !candidate.previewSource) {
    throw new Error(`item ${item.id} preview snapshot requires previewSource`)
  }
  if (item.type === 'metric' && typeof candidate.previewSource === 'string') {
    validateMetricSource(item, entities, 'previewSource', candidate.previewSource)
  }
  if (item.type === 'metric' && typeof candidate.previewSource === 'string' && typeof candidate.unitSource === 'string'
    && candidate.previewSource !== candidate.unitSource) {
    throw new Error(`item ${item.id} previewSource and unitSource must match`)
  }
}

function validateMetricSource(
  item: Extract<LayoutItem, { type: 'metric' }>,
  entities: Record<string, string>,
  field: 'unitSource' | 'previewSource',
  source: string
): void {
  if (!Object.prototype.hasOwnProperty.call(entities, source)) {
    throw new Error(`item ${item.id} ${field} is not configured in data.entities`)
  }
  const referenced = Array.from(item.value.matchAll(/{{\s*([\w.-]+)(?:\s*\|\s*[\w-]+)?\s*}}/g), match => match[1]).includes(source)
  if (!referenced) throw new Error(`item ${item.id} ${field} is not referenced by value`)
}

export function getRuntimeConfig() {
  const options = getAddonOptions()
  const settings = loadSettingsSafe()
  return {
    port: Number(process.env.PORT ?? 10000),
    homeAssistantUrl: envString('HOME_ASSISTANT_URL') ?? stringOption(options, 'home_assistant_url') ?? settings.homeAssistantUrl ?? 'http://homeassistant:8123',
    accessToken: envString('ACCESS_TOKEN') ?? envString('HA_TOKEN') ?? stringOption(options, 'access_token') ?? settings.haToken ?? '',
    homeAssistantStatesMaxBytes: positiveInteger(
      process.env.HOME_ASSISTANT_STATES_MAX_BYTES ?? numberOption(options, 'home_assistant_states_max_bytes') ?? DEFAULT_HOME_ASSISTANT_STATES_MAX_BYTES,
      'HOME_ASSISTANT_STATES_MAX_BYTES'
    ),
    publicBaseUrl: resolveAddonBaseUrl(options, settings.publicBaseUrl),
    refreshIntervalSeconds: Number(process.env.REFRESH_INTERVAL_SECONDS ?? numberOption(options, 'refresh_interval_seconds') ?? settings.refreshIntervalSeconds ?? 0)
  }
}

export function resolveAddonBaseUrl(options: Record<string, unknown>, settingsValue?: string): string {
  return envString('ADDON_BASE_URL')
    ?? envString('PUBLIC_BASE_URL')
    ?? stringOption(options, 'addon_base_url')
    ?? stringOption(options, 'public_base_url')
    ?? settingsValue
    ?? ''
}

export function envString(key: string): string | undefined {
  const value = process.env[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
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

function positiveInteger(value: string | number, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

export const TERMINUS_MODES = ['screen-content', 'byos-uri', 'byos-base64', 'raw-webhook'] as const
export type TerminusMode = (typeof TERMINUS_MODES)[number]

export interface Settings {
  homeAssistantUrl: string
  haToken: string
  publicBaseUrl: string
  refreshIntervalSeconds: number
  device: string | null
  terminus: {
    apiUrl: string
    mode: TerminusMode
    login?: string
    password?: string
    accessToken?: string
    refreshToken?: string
    obtainedAt?: number
    webhookUrl?: string
    modelId?: string
    screenName?: string
    screenLabel?: string
    playlistId?: string
    screenId?: string
  }
  settingsToken?: string
}

const defaultSettings: Settings = {
  homeAssistantUrl: '',
  haToken: '',
  publicBaseUrl: '',
  refreshIntervalSeconds: 0,
  device: null,
  terminus: {
    apiUrl: '',
    mode: 'byos-uri'
  }
}

export function resolveSettingsPath(): string {
  if (process.env.LAYOUT_PATH) return path.join(path.dirname(process.env.LAYOUT_PATH), 'settings.json')
  if (fs.existsSync('/data/options.json')) return '/data/settings.json'
  return path.resolve(process.cwd(), 'settings.json')
}

export function loadSettingsSafe(settingsPath = resolveSettingsPath()): Settings {
  if (!fs.existsSync(settingsPath)) {
    saveSettings(defaultSettings, settingsPath)
    return { ...defaultSettings }
  }
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    return normalizeSettings(parsed)
  } catch (error) {
    console.error(`settings.json unreadable (${(error as Error).message}); using defaults`)
    return { ...defaultSettings }
  }
}

export function loadSettings(settingsPath = resolveSettingsPath()): Settings {
  if (!fs.existsSync(settingsPath)) {
    saveSettings(defaultSettings, settingsPath)
    return { ...defaultSettings }
  }
  const raw = fs.readFileSync(settingsPath, 'utf8')
  const parsed = JSON.parse(raw) as Partial<Settings>
  return normalizeSettings(parsed)
}

export function saveSettings(settings: Settings, settingsPath = resolveSettingsPath()): Settings {
  const normalized = normalizeSettings(settings)
  validateSettings(normalized)
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  const temporaryPath = `${settingsPath}.tmp`
  fs.writeFileSync(temporaryPath, JSON.stringify(normalized, null, 2), 'utf8')
  fs.renameSync(temporaryPath, settingsPath)
  return normalized
}

export function loadSettingsMasked(settingsPath = resolveSettingsPath()): Settings {
  const settings = loadSettings(settingsPath)
  return maskSettings(settings)
}

export function normalizeSettings(input: Partial<Settings> | null | undefined): Settings {
  if (!input) return { ...defaultSettings }
  return {
    homeAssistantUrl: typeof input.homeAssistantUrl === 'string' ? input.homeAssistantUrl : '',
    haToken: typeof input.haToken === 'string' ? input.haToken : '',
    publicBaseUrl: typeof input.publicBaseUrl === 'string' ? input.publicBaseUrl : '',
    refreshIntervalSeconds: typeof input.refreshIntervalSeconds === 'number' ? input.refreshIntervalSeconds : 0,
    device: typeof input.device === 'string' ? input.device : null,
    settingsToken: typeof input.settingsToken === 'string' && input.settingsToken.length > 0 ? input.settingsToken : undefined,
    terminus: {
      apiUrl: typeof input.terminus?.apiUrl === 'string' ? input.terminus.apiUrl : '',
      mode: TERMINUS_MODES.includes(input.terminus?.mode as TerminusMode) ? (input.terminus!.mode as TerminusMode) : 'byos-uri',
      login: undefined,
      password: undefined,
      accessToken: typeof input.terminus?.accessToken === 'string' ? input.terminus.accessToken : undefined,
      refreshToken: typeof input.terminus?.refreshToken === 'string' ? input.terminus.refreshToken : undefined,
      obtainedAt: typeof input.terminus?.obtainedAt === 'number' ? input.terminus.obtainedAt : undefined,
      webhookUrl: typeof input.terminus?.webhookUrl === 'string' ? input.terminus.webhookUrl : undefined,
      modelId: typeof input.terminus?.modelId === 'string' ? input.terminus.modelId : undefined,
      screenName: typeof input.terminus?.screenName === 'string' ? input.terminus.screenName : undefined,
      screenLabel: typeof input.terminus?.screenLabel === 'string' ? input.terminus.screenLabel : undefined,
      playlistId: typeof input.terminus?.playlistId === 'string' ? input.terminus.playlistId : undefined,
      screenId: typeof input.terminus?.screenId === 'string' ? input.terminus.screenId : undefined
    }
  }
}

export function validateSettings(settings: Settings): void {
  if (!Number.isFinite(settings.refreshIntervalSeconds) || settings.refreshIntervalSeconds < 0) {
    throw new Error('settings.refreshIntervalSeconds must be a non-negative number')
  }
  if (!TERMINUS_MODES.includes(settings.terminus.mode)) {
    throw new Error(`settings.terminus.mode must be one of ${TERMINUS_MODES.join(', ')}`)
  }
  if (settings.terminus.obtainedAt !== undefined && typeof settings.terminus.obtainedAt !== 'number') {
    throw new Error('settings.terminus.obtainedAt must be a number when present')
  }
}

export function maskSettings(settings: Settings): Settings {
  return {
    ...settings,
    haToken: maskToken(settings.haToken) ?? '',
    settingsToken: maskToken(settings.settingsToken),
    terminus: {
      ...settings.terminus,
      login: undefined,
      password: undefined,
      accessToken: maskToken(settings.terminus.accessToken),
      refreshToken: maskToken(settings.terminus.refreshToken)
    }
  }
}

export function maskToken(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value.length <= 4) return '••••'
  return `••••${value.slice(-4)}`
}
