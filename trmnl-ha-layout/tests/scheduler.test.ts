import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveSettings } from '../src/config.js'
import { startScheduler } from '../src/scheduler.js'

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
})
