import { loadSettingsSafe } from './config.js'

export function startScheduler(seconds: number, job: () => Promise<unknown>): NodeJS.Timeout | undefined {
  const initial = resolveInterval(seconds)
  if (!initial) return undefined
  let timer: NodeJS.Timeout
  const scheduleNext = () => {
    const interval = resolveInterval(loadSettingsSafe().refreshIntervalSeconds) ?? initial
    timer = setTimeout(runOnce, interval * 1000)
  }
  const runOnce = () => {
    job().catch((error) => console.error('scheduled refresh failed', error)).finally(() => scheduleNext())
  }
  timer = setTimeout(runOnce, initial * 1000)
  return timer
}

function resolveInterval(seconds: number): number | undefined {
  const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  return value > 0 ? value : undefined
}
