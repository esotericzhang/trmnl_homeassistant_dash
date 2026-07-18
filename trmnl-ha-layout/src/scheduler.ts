import { loadSettingsSafe } from './config.js'
import type { Schedule, ScheduleStatus } from './schedules.js'

const POLL_INTERVAL_MS = 60_000
const MAX_COORDINATOR_POLL_MS = 30_000

export type ScheduleStatusUpdate = Partial<ScheduleStatus>

export interface ScheduleCoordinatorOptions {
  loadSchedules: () => Schedule[] | Promise<Schedule[]>
  execute: (schedule: Schedule, signal: AbortSignal) => Promise<unknown>
  onStatus?: (schedule: Schedule, update: ScheduleStatusUpdate) => void | Promise<void>
  now?: () => Date
  pollIntervalMs?: number
  executionTimeoutMs?: number
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

export interface ScheduleCoordinator {
  start(): void
  stop(): void
  poll(): Promise<void>
}

interface ScheduleState {
  signature: string
  nextRunAt: Date | null
}

export function createScheduleCoordinator(options: ScheduleCoordinatorOptions): ScheduleCoordinator {
  const now = options.now ?? (() => new Date())
  const pollIntervalMs = Math.min(MAX_COORDINATOR_POLL_MS, Math.max(1, options.pollIntervalMs ?? MAX_COORDINATOR_POLL_MS))
  const executionTimeoutMs = Math.max(1, options.executionTimeoutMs ?? 60_000)
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  const states = new Map<string, ScheduleState>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let polling = false
  let stopped = true

  const report = async (schedule: Schedule, update: ScheduleStatusUpdate) => {
    try {
      await options.onStatus?.(schedule, update)
    } catch (error) {
      console.error(`schedule status update failed: ${schedule.id}`, error)
    }
  }

  const poll = async () => {
    if (polling) return
    polling = true
    try {
      const schedules = await options.loadSchedules()
      const activeIds = new Set(schedules.map((schedule) => schedule.id))
      for (const id of states.keys()) if (!activeIds.has(id)) states.delete(id)

      for (const schedule of schedules) {
        const latest = (await options.loadSchedules()).find((candidate) => candidate.id === schedule.id)
        if (!latest) {
          states.delete(schedule.id)
          continue
        }
        const signature = scheduleSignature(latest)
        let state = states.get(latest.id)
        if (!state || state.signature !== signature) {
          const persistedNextRun = !state && latest.status.nextRunSignature === signature
            ? parseDate(latest.status.nextRunAt)
            : null
          const calculated = calculateNextRun(latest, now())
          state = { signature, nextRunAt: persistedNextRun ?? calculated.nextRunAt }
          states.set(latest.id, state)
          await report(latest, {
            nextRunAt: state.nextRunAt?.toISOString() ?? null,
            nextRunSignature: state.nextRunAt ? signature : null,
            ...(calculated.error ? { error: calculated.error } : {})
          })
        }

        const currentTime = now()
        if (!state.nextRunAt || state.nextRunAt.getTime() > currentTime.getTime()) continue

        const attemptedAt = currentTime.toISOString()
        await report(latest, { lastAttemptAt: attemptedAt, nextRunAt: null, nextRunSignature: null, result: null, error: null })
        try {
          await executeWithTimeout(options.execute, latest, executionTimeoutMs)
          const completedAt = now()
          const calculated = calculateNextRun(latest, completedAt)
          state.nextRunAt = calculated.nextRunAt
          await report(latest, {
            nextRunAt: state.nextRunAt?.toISOString() ?? null,
            nextRunSignature: state.nextRunAt ? signature : null,
            ...(calculated.error ? { error: calculated.error } : {})
          })
        } catch (error) {
          state.nextRunAt = calculateNextRun(latest, now()).nextRunAt
          await report(latest, {
            nextRunAt: state.nextRunAt?.toISOString() ?? null,
            nextRunSignature: state.nextRunAt ? signature : null,
            result: null,
            error: sanitizeError(error)
          })
        }
      }
    } catch (error) {
      console.error('schedule coordinator poll failed', error)
    } finally {
      polling = false
    }
  }

  const schedulePoll = () => {
    if (stopped) return
    const currentTime = now().getTime()
    const earliestRun = [...states.values()]
      .map((state) => state.nextRunAt?.getTime())
      .filter((value): value is number => value !== undefined)
      .reduce<number | undefined>((earliest, value) => earliest === undefined ? value : Math.min(earliest, value), undefined)
    const delayMs = earliestRun === undefined ? pollIntervalMs : Math.max(1, Math.min(pollIntervalMs, earliestRun - currentTime))
    timer = setTimer(() => {
      void poll().finally(schedulePoll)
    }, delayMs)
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      void poll().finally(schedulePoll)
    },
    stop() {
      stopped = true
      if (timer) clearTimer(timer)
      timer = undefined
    },
    poll
  }
}

async function executeWithTimeout(
  execute: ScheduleCoordinatorOptions['execute'],
  schedule: Schedule,
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`Schedule execution timed out after ${timeoutMs}ms: ${schedule.id}`)), timeoutMs)
  try {
    await execute(schedule, controller.signal)
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

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

function nextRun(schedule: Schedule, from: Date): Date | null {
  if (!schedule.enabled || schedule.timing.kind === 'manual') return null
  if (schedule.timing.kind === 'interval') {
    return new Date(from.getTime() + schedule.timing.intervalSeconds * 1000)
  }
  return nextDailyRun(from, schedule.timing.time, schedule.timing.timezone)
}

function calculateNextRun(schedule: Schedule, from: Date): { nextRunAt: Date | null; error: string | null } {
  try {
    return { nextRunAt: nextRun(schedule, from), error: null }
  } catch (error) {
    return { nextRunAt: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function scheduleSignature(schedule: Schedule): string {
  return JSON.stringify([schedule.enabled, schedule.timing])
}

function nextDailyRun(from: Date, time: string, timezone: string | null): Date {
  const [hour, minute] = time.split(':').map(Number)
  const zone = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = zonedParts(from, zone)
  const currentMinutes = today.hour * 60 + today.minute
  const desiredMinutes = hour * 60 + minute
  let startOffset = currentMinutes >= desiredMinutes ? 1 : 0
  if (startOffset === 0) {
    const todayDate = new Date(Date.UTC(today.year, today.month - 1, today.day))
    const firstCandidate = dailyCandidates(todayDate, hour, minute, zone)[0]
    if (firstCandidate && firstCandidate.getTime() <= from.getTime()) startOffset = 1
  }

  for (let dayOffset = startOffset; dayOffset < startOffset + 8; dayOffset += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset))
    const candidates = dailyCandidates(date, hour, minute, zone)
    const candidate = candidates.find((value) => value.getTime() > from.getTime())
    if (candidate) return candidate
  }

  throw new Error(`Could not resolve daily schedule time ${time} in ${zone}`)
}

function dailyCandidates(date: Date, hour: number, minute: number, zone: string): Date[] {
  const desired = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour,
    minute
  }
  const nominal = Date.UTC(desired.year, desired.month - 1, desired.day, hour, minute)
  const offsets = new Set<number>()
  for (const sampleHours of [-12, 0, 12]) offsets.add(zoneOffset(new Date(nominal + sampleHours * 3_600_000), zone))
  return [...offsets]
    .map((offset) => new Date(nominal - offset))
    .filter((candidate) => sameParts(zonedParts(candidate, zone), desired))
    .sort((left, right) => left.getTime() - right.getTime())
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') }
}

function zoneOffset(date: Date, timezone: string): number {
  const parts = zonedParts(date, timezone)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(date.getTime() / 60_000) * 60_000
}

function sameParts(left: ReturnType<typeof zonedParts>, right: ReturnType<typeof zonedParts>): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute
}

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/https?:\/\/[^\s)]+/g, '[redacted URL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .slice(0, 500)
}
