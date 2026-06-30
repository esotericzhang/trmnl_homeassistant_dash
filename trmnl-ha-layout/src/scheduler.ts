import { loadSettingsSafe } from './config.js'

const POLL_INTERVAL_MS = 60_000

export function startScheduler(seconds: number, job: () => Promise<unknown>): NodeJS.Timeout | undefined {
  const initial = resolveInterval(seconds)
  let timer: NodeJS.Timeout
  const scheduleNext = (delayMs: number) => {
    timer = setTimeout(runOnce, delayMs)
  }
  const runOnce = () => {
    const interval = resolveInterval(loadSettingsSafe().refreshIntervalSeconds)
    if (!interval) {
      scheduleNext(POLL_INTERVAL_MS)
      return
    }
    job()
      .catch((error) => console.error('scheduled refresh failed', error))
      .finally(() => {
        const nextInterval = resolveInterval(loadSettingsSafe().refreshIntervalSeconds)
        scheduleNext(nextInterval ? nextInterval * 1000 : POLL_INTERVAL_MS)
      })
  }
  timer = setTimeout(runOnce, initial ? initial * 1000 : POLL_INTERVAL_MS)
  return timer
}

function resolveInterval(seconds: number): number | undefined {
  const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  return value > 0 ? value : undefined
}
