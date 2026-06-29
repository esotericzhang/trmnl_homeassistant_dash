import { loadSettingsSafe } from './config.js'

const POLL_INTERVAL_MS = 60_000

export function startScheduler(seconds: number, job: () => Promise<unknown>): NodeJS.Timeout | undefined {
  const initial = resolveInterval(seconds)
  if (initial) {
    return startTicking(initial, job)
  }
  return startPolling(seconds, job)
}

function startTicking(intervalSeconds: number, job: () => Promise<unknown>): NodeJS.Timeout {
  let timer: NodeJS.Timeout
  const scheduleNext = () => {
    const interval = resolveInterval(loadSettingsSafe().refreshIntervalSeconds) ?? intervalSeconds
    timer = setTimeout(runOnce, interval * 1000)
  }
  const runOnce = () => {
    job().catch((error) => console.error('scheduled refresh failed', error)).finally(() => scheduleNext())
  }
  timer = setTimeout(runOnce, intervalSeconds * 1000)
  return timer
}

function startPolling(initialSeconds: number, job: () => Promise<unknown>): NodeJS.Timeout {
  const timer = setInterval(() => {
    const interval = resolveInterval(loadSettingsSafe().refreshIntervalSeconds)
    if (interval) {
      clearInterval(timer)
      startTicking(interval, job)
    }
  }, POLL_INTERVAL_MS)
  void initialSeconds
  return timer
}

function resolveInterval(seconds: number): number | undefined {
  const value = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  return value > 0 ? value : undefined
}
