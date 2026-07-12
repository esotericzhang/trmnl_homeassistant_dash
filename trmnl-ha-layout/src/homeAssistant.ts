import type { HassState, HassStateMap, LayoutConfig, RenderData } from './types.js'

export class HomeAssistantClient {
  constructor(private baseUrl: string, private token: string, private fetcher: typeof fetch = fetch) {}

  async getState(entityId: string): Promise<HassState> {
    if (!this.token) throw new Error('Missing Home Assistant token')
    const url = new URL(`/api/states/${entityId}`, this.baseUrl)
    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }
    })
    if (!response.ok) throw new Error(`Home Assistant ${entityId} failed: ${response.status}`)
    return response.json() as Promise<HassState>
  }

  async getStates(): Promise<HassState[]> {
    if (!this.token) throw new Error('Missing Home Assistant token')
    const url = new URL('/api/states', this.baseUrl)
    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }
    })
    if (!response.ok) throw new Error(`Home Assistant states failed: ${response.status}`)
    return response.json() as Promise<HassState[]>
  }

  async collect(config: LayoutConfig): Promise<RenderData> {
    const entityStates = new Map(await Promise.all(
      [...new Set(Object.values(config.data.entities))].map(async entity => [entity, await this.getState(entity)] as const)
    ))
    const entries = Object.entries(config.data.entities).map(([key, entity]) => [key, entityStates.get(entity)!] as const)
    const states: HassStateMap = Object.fromEntries(entries)
    const values = Object.fromEntries(entries.map(([key, state]) => [key, selectStateValue(state, config.data.selectors?.[key])]))
    return { values, states }
  }
}

export function sampleRenderData(config: LayoutConfig): RenderData {
  const states: HassStateMap = {}
  for (const [key, entity] of Object.entries(config.data.entities)) {
    states[key] = { entity_id: entity, state: sampleValue(key), attributes: {} }
    const selector = config.data.selectors?.[key]
    if (selector && selector !== 'state') setSampleSelector(states[key], selector, key)
  }
  for (const item of config.items) {
    if (item.type === 'forecast' && states[item.source]) states[item.source].attributes.forecast = sampleForecast()
  }
  return {
    values: Object.fromEntries(Object.entries(states).map(([key, state]) => [key, selectStateValue(state, config.data.selectors?.[key])])),
    states
  }
}

function setSampleSelector(state: HassState, path: string, key: string): void {
  if (path.startsWith('attributes.forecast.')) {
    state.attributes.forecast = sampleForecast()
    return
  }
  const segments = path.split('.').slice(1)
  let current: Record<string, unknown> = state.attributes
  for (const segment of segments.slice(0, -1)) {
    const next: Record<string, unknown> = {}
    current[segment] = next
    current = next
  }
  if (segments.length) current[segments.at(-1)!] = sampleValue(key) === 'unknown' ? 42 : sampleValue(key)
}

function sampleForecast(): Array<Record<string, unknown>> {
  return [
    { datetime: '2026-06-24T08:00:00-07:00', temperature: 61, condition: 'cloudy' },
    { datetime: '2026-06-24T09:00:00-07:00', temperature: 64, condition: 'partlycloudy' },
    { datetime: '2026-06-24T10:00:00-07:00', temperature: 67, condition: 'sunny' },
    { datetime: '2026-06-24T11:00:00-07:00', temperature: 70, condition: 'sunny' },
    { datetime: '2026-06-24T12:00:00-07:00', temperature: 73, condition: 'sunny' },
    { datetime: '2026-06-24T13:00:00-07:00', temperature: 75, condition: 'sunny' },
    { datetime: '2026-06-24T14:00:00-07:00', temperature: 76, condition: 'partlycloudy' },
    { datetime: '2026-06-24T15:00:00-07:00', temperature: 74, condition: 'cloudy' }
  ]
}

export function selectStateValue(state: HassState, path = 'state'): unknown {
  if (path === 'state') return state.state
  const segments = path.split('.')
  let value: unknown = state
  for (const segment of segments) {
    if (!segment || !/^[a-zA-Z0-9_]+$/.test(segment)) return undefined
    if (Array.isArray(value)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= value.length) return undefined
      value = value[index]
    } else if (value && typeof value === 'object') {
      value = (value as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return value
}

function sampleValue(key: string): string {
  const values: Record<string, string> = {
    sleepStart: '2026-06-23T23:14:00-07:00',
    sleepEnd: '2026-06-24T06:42:00-07:00',
    sleepPeriod: '7h 28m',
    minutesAsleep: '417',
    minutesAwake: '31',
    hourlyForecast: 'forecast',
    sunNextRising: '2026-06-24T05:47:00-07:00',
    sunNextSetting: '2026-06-24T20:34:00-07:00'
  }
  return values[key] ?? 'unknown'
}
