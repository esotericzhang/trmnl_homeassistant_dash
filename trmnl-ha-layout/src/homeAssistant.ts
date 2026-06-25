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

  async collect(config: LayoutConfig): Promise<RenderData> {
    const entries = await Promise.all(
      Object.entries(config.data.entities).map(async ([key, entity]) => [key, await this.getState(entity)] as const)
    )
    const states: HassStateMap = Object.fromEntries(entries)
    const values = Object.fromEntries(entries.map(([key, state]) => [key, state.state]))
    return { values, states }
  }
}

export function sampleRenderData(config: LayoutConfig): RenderData {
  const states: HassStateMap = {}
  for (const [key, entity] of Object.entries(config.data.entities)) {
    states[key] = { entity_id: entity, state: sampleValue(key), attributes: {} }
  }
  states.hourlyForecast.attributes.forecast = [
    { datetime: '2026-06-24T08:00:00-07:00', temperature: 61, condition: 'cloudy' },
    { datetime: '2026-06-24T09:00:00-07:00', temperature: 64, condition: 'partlycloudy' },
    { datetime: '2026-06-24T10:00:00-07:00', temperature: 67, condition: 'sunny' },
    { datetime: '2026-06-24T11:00:00-07:00', temperature: 70, condition: 'sunny' },
    { datetime: '2026-06-24T12:00:00-07:00', temperature: 73, condition: 'sunny' },
    { datetime: '2026-06-24T13:00:00-07:00', temperature: 75, condition: 'sunny' },
    { datetime: '2026-06-24T14:00:00-07:00', temperature: 76, condition: 'partlycloudy' },
    { datetime: '2026-06-24T15:00:00-07:00', temperature: 74, condition: 'cloudy' }
  ]
  return { values: Object.fromEntries(Object.entries(states).map(([key, state]) => [key, state.state])), states }
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
