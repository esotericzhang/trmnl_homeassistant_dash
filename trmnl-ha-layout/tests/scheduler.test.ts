import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveSettings } from '../src/config.js'
import { createScheduleCoordinator, startScheduler } from '../src/scheduler.js'
import type { Schedule, ScheduleTiming } from '../src/schedules.js'

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveSettings({
      homeAssistantUrl: '',
      haToken: '',
      publicBaseUrl: '',
      refreshIntervalSeconds: 1,
      device: null,
      terminus: { apiUrl: '', mode: 'byos-uri' }
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('stops scheduled refreshes when settings change to manual only', async () => {
    const job = vi.fn().mockResolvedValue(undefined)
    const timer = startScheduler(1, job)

    saveSettings({
      homeAssistantUrl: '',
      haToken: '',
      publicBaseUrl: '',
      refreshIntervalSeconds: 0,
      device: null,
      terminus: { apiUrl: '', mode: 'byos-uri' }
    })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(job).not.toHaveBeenCalled()
    if (timer) clearTimeout(timer)
  })

  it('starts scheduled refreshes when manual-only settings become nonzero', async () => {
    saveSettings({
      homeAssistantUrl: '',
      haToken: '',
      publicBaseUrl: '',
      refreshIntervalSeconds: 0,
      device: null,
      terminus: { apiUrl: '', mode: 'byos-uri' }
    })
    const job = vi.fn().mockResolvedValue(undefined)
    const timer = startScheduler(0, job)

    saveSettings({
      homeAssistantUrl: '',
      haToken: '',
      publicBaseUrl: '',
      refreshIntervalSeconds: 1,
      device: null,
      terminus: { apiUrl: '', mode: 'byos-uri' }
    })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(job).toHaveBeenCalledTimes(1)
    if (timer) clearTimeout(timer)
  })

  it('never runs manual or disabled schedules and reports no next run', async () => {
    const execute = vi.fn()
    const onStatus = vi.fn()
    const coordinator = createScheduleCoordinator({
      loadSchedules: () => [schedule('manual', true, { kind: 'manual' }), schedule('disabled', false, { kind: 'interval', intervalSeconds: 1 })],
      execute,
      onStatus,
      now: () => new Date('2026-07-17T12:00:00.000Z')
    })

    await coordinator.poll()

    expect(execute).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenCalledTimes(2)
    expect(onStatus.mock.calls.map((call) => [call[0].id, call[1]])).toEqual([
      ['manual', { nextRunAt: null, error: null }],
      ['disabled', { nextRunAt: null, error: null }]
    ])
  })

  it('runs due intervals serially, isolates errors, and prevents overlapping polls', async () => {
    let current = new Date('2026-07-17T12:00:00.000Z')
    let releaseFirst: (() => void) | undefined
    const firstRun = new Promise<void>((resolve) => { releaseFirst = resolve })
    const execute = vi.fn(async (value: Schedule) => {
      if (value.id === 'first') await firstRun
      if (value.id === 'second') throw new Error('second failed')
      return 'sent'
    })
    const onStatus = vi.fn()
    const schedules = [
      schedule('first', true, { kind: 'interval', intervalSeconds: 10 }, '2026-07-17T11:59:59.000Z'),
      schedule('second', true, { kind: 'interval', intervalSeconds: 10 }, '2026-07-17T11:59:59.000Z')
    ]
    const coordinator = createScheduleCoordinator({ loadSchedules: () => schedules, execute, onStatus, now: () => current })

    const polling = coordinator.poll()
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    await coordinator.poll()
    expect(execute).toHaveBeenCalledTimes(1)
    current = new Date('2026-07-17T12:00:01.000Z')
    releaseFirst?.()
    await polling

    expect(execute.mock.calls.map((call) => call[0].id)).toEqual(['first', 'second'])
    expect(onStatus.mock.calls.some((call) => call[0].id === 'first' && call[1].result === 'sent')).toBe(true)
    expect(onStatus.mock.calls.some((call) => call[0].id === 'second' && call[1].error === 'second failed')).toBe(true)
  })

  it('uses fresh schedule definitions without restarting', async () => {
    let current = new Date('2026-07-17T12:00:00.000Z')
    let timing: ScheduleTiming = { kind: 'interval', intervalSeconds: 60 }
    const execute = vi.fn().mockResolvedValue(undefined)
    const onStatus = vi.fn()
    const coordinator = createScheduleCoordinator({
      loadSchedules: () => [schedule('changing', true, timing)],
      execute,
      onStatus,
      now: () => current
    })

    await coordinator.poll()
    expect(onStatus).toHaveBeenLastCalledWith(expect.anything(), { nextRunAt: '2026-07-17T12:01:00.000Z', error: null })

    current = new Date('2026-07-17T12:00:10.000Z')
    timing = { kind: 'interval', intervalSeconds: 5 }
    await coordinator.poll()
    expect(onStatus).toHaveBeenLastCalledWith(expect.anything(), { nextRunAt: '2026-07-17T12:00:15.000Z', error: null })

    current = new Date('2026-07-17T12:00:15.000Z')
    await coordinator.poll()
    expect(execute).toHaveBeenCalledTimes(1)

    timing = { kind: 'manual' }
    await coordinator.poll()
    expect(onStatus).toHaveBeenLastCalledWith(expect.anything(), { nextRunAt: null, error: null })
  })

  it('computes daily next runs in the configured timezone across DST', async () => {
    let current = new Date('2026-03-08T06:00:00.000Z')
    const onStatus = vi.fn()
    const coordinator = createScheduleCoordinator({
      loadSchedules: () => [schedule('daily', true, { kind: 'daily', time: '09:30', timezone: 'America/New_York' })],
      execute: vi.fn().mockResolvedValue(undefined),
      onStatus,
      now: () => current
    })

    await coordinator.poll()
    expect(onStatus).toHaveBeenLastCalledWith(expect.anything(), { nextRunAt: '2026-03-08T13:30:00.000Z', error: null })

    current = new Date('2026-03-08T14:00:00.000Z')
    await coordinator.poll()
    expect(onStatus.mock.calls.at(-1)?.[1]).toMatchObject({
      lastSuccessAt: '2026-03-08T14:00:00.000Z',
      nextRunAt: '2026-03-09T13:30:00.000Z'
    })
  })

  it('runs a repeated fall-back wall time only once per local date', async () => {
    let current = new Date('2026-11-01T04:00:00.000Z')
    const execute = vi.fn().mockResolvedValue(undefined)
    const onStatus = vi.fn()
    const coordinator = createScheduleCoordinator({
      loadSchedules: () => [schedule('daily', true, { kind: 'daily', time: '01:30', timezone: 'America/New_York' })],
      execute,
      onStatus,
      now: () => current
    })

    await coordinator.poll()
    expect(onStatus).toHaveBeenLastCalledWith(expect.anything(), { nextRunAt: '2026-11-01T05:30:00.000Z', error: null })

    current = new Date('2026-11-01T05:30:00.000Z')
    await coordinator.poll()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(onStatus.mock.calls.at(-1)?.[1]).toMatchObject({ nextRunAt: '2026-11-02T06:30:00.000Z' })
  })

  it('does not re-run after restart during the second repeated hour', async () => {
    const onStatus = vi.fn()
    const coordinator = createScheduleCoordinator({
      loadSchedules: () => [schedule('daily', true, { kind: 'daily', time: '01:30', timezone: 'America/New_York' })],
      execute: vi.fn(),
      onStatus,
      now: () => new Date('2026-11-01T06:10:00.000Z')
    })

    await coordinator.poll()
    expect(onStatus).toHaveBeenLastCalledWith(expect.anything(), { nextRunAt: '2026-11-02T06:30:00.000Z', error: null })
  })

  it('caps the automatic polling interval at 30 seconds', () => {
    const setTimer = vi.fn(() => 1 as unknown as NodeJS.Timeout)
    const coordinator = createScheduleCoordinator({
      loadSchedules: () => [],
      execute: vi.fn(),
      pollIntervalMs: 60_000,
      setTimer,
      clearTimer: vi.fn()
    })

    coordinator.start()
    return vi.waitFor(() => expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 30_000))
  })

  it('wakes at the earliest interval deadline below 30 seconds', async () => {
    const setTimer = vi.fn(() => 1 as unknown as NodeJS.Timeout)
    const coordinator = createScheduleCoordinator({
      loadSchedules: () => [schedule('fast', true, { kind: 'interval', intervalSeconds: 5 })],
      execute: vi.fn(),
      now: () => new Date('2026-07-17T12:00:00.000Z'),
      setTimer,
      clearTimer: vi.fn()
    })

    coordinator.start()
    await vi.waitFor(() => expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 5_000))
    coordinator.stop()
  })

  it('times out a hung schedule and continues to the next due schedule', async () => {
    const execute = vi.fn((value: Schedule) => value.id === 'hung'
      ? new Promise<never>(() => undefined)
      : Promise.resolve('sent'))
    const onStatus = vi.fn()
    const coordinator = createScheduleCoordinator({
      loadSchedules: () => [
        schedule('hung', true, { kind: 'interval', intervalSeconds: 1 }, '2026-07-17T11:59:59.000Z'),
        schedule('next', true, { kind: 'interval', intervalSeconds: 1 }, '2026-07-17T11:59:59.000Z')
      ],
      execute,
      onStatus,
      executionTimeoutMs: 5,
      now: () => new Date('2026-07-17T12:00:00.000Z')
    })

    const polling = coordinator.poll()
    await vi.advanceTimersByTimeAsync(5)
    await polling
    expect(execute.mock.calls.map((call) => call[0].id)).toEqual(['hung', 'next'])
    expect(onStatus.mock.calls.some((call) => call[0].id === 'hung' && String(call[1].error).includes('timed out'))).toBe(true)
  })
})

function schedule(id: string, enabled: boolean, timing: ScheduleTiming, nextRunAt: string | null = null): Schedule {
  return {
    id,
    name: id,
    enabled,
    order: 0,
    timing,
    destination: {
      deviceId: null,
      playlistId: null,
      mode: null,
      screenId: null,
      webhookUrl: null,
      modelId: null,
      screenName: null,
      screenLabel: null
    },
    status: {
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextRunAt,
      result: null,
      error: null
    }
  }
}
