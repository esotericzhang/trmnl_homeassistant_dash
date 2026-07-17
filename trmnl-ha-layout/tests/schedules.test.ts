import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadLayoutConfig, saveSettings } from '../src/config.js'
import {
  createSchedule,
  deleteSchedule,
  duplicateSchedule,
  ensureSchedules,
  getSchedule,
  LEGACY_DEFAULT_SCHEDULE_ID,
  listSchedules,
  loadScheduleLayout,
  loadSchedulesIndex,
  migrateLegacySchedule,
  resolveScheduleLayoutPath,
  saveScheduleLayout,
  setDefaultScheduleId,
  updateSchedule
} from '../src/schedules.js'
import type { SchedulePersistenceOptions } from '../src/schedules.js'
import type { LayoutConfig } from '../src/types.js'

describe('schedule persistence', () => {
  let directory: string
  let layoutPath: string
  let settingsPath: string
  let schedulesDirectory: string
  let options: SchedulePersistenceOptions
  let layout: LayoutConfig

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-schedules-'))
    layoutPath = path.join(directory, 'layout.yaml')
    settingsPath = path.join(directory, 'settings.json')
    schedulesDirectory = path.join(directory, 'schedules')
    fs.copyFileSync('data/default-layout.yaml', layoutPath)
    layout = loadLayoutConfig(layoutPath)
    saveSettings({
      homeAssistantUrl: 'http://ha.local',
      haToken: 'ha-token',
      publicBaseUrl: 'http://layout.local',
      refreshIntervalSeconds: 900,
      device: 'device-007',
      terminus: {
        apiUrl: 'http://terminus.local',
        mode: 'byos-base64',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        webhookUrl: 'http://terminus.local/hook',
        modelId: 'model-2',
        screenName: 'morning-screen',
        screenLabel: 'Morning Screen',
        playlistId: '42',
        screenId: '1234'
      }
    }, settingsPath)
    options = { schedulesDirectory, legacyLayoutPath: layoutPath, settingsPath }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('migrates legacy layout and settings without modifying either original', () => {
    const originalLayout = fs.readFileSync(layoutPath)
    const originalSettings = fs.readFileSync(settingsPath)

    const index = migrateLegacySchedule(options)
    const migratedLayoutPath = resolveScheduleLayoutPath(LEGACY_DEFAULT_SCHEDULE_ID, schedulesDirectory)

    expect(index).toEqual({
      version: 1,
      defaultScheduleId: 'default',
      schedules: [{
        id: 'default',
        name: 'Default schedule',
        enabled: true,
        order: 0,
        timing: { kind: 'interval', intervalSeconds: 900 },
        destination: {
          deviceId: 'device-007',
          playlistId: '42',
          mode: 'byos-base64',
          screenId: null,
          webhookUrl: 'http://terminus.local/hook',
          modelId: 'model-2',
          screenName: 'morning-screen',
          screenLabel: 'Morning Screen'
        },
        status: {
          lastAttemptAt: null,
          lastSuccessAt: null,
          nextRunAt: null,
          result: null,
          error: null
        }
      }]
    })
    expect(fs.readFileSync(layoutPath)).toEqual(originalLayout)
    expect(fs.readFileSync(settingsPath)).toEqual(originalSettings)
    expect(fs.readFileSync(migratedLayoutPath)).toEqual(originalLayout)
  })

  it('maps a disabled legacy refresh interval to manual timing', () => {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    settings.refreshIntervalSeconds = 0
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))

    expect(migrateLegacySchedule(options).schedules[0].timing).toEqual({ kind: 'manual' })
  })

  it('is idempotent and ignores later legacy changes once the index exists', () => {
    const first = ensureSchedules(options)
    const migratedLayoutPath = resolveScheduleLayoutPath('default', schedulesDirectory)
    const migratedLayout = fs.readFileSync(migratedLayoutPath, 'utf8')

    fs.writeFileSync(layoutPath, 'not: a valid layout\n')
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    settings.refreshIntervalSeconds = 60
    fs.writeFileSync(settingsPath, JSON.stringify(settings))

    expect(ensureSchedules(options)).toEqual(first)
    expect(fs.readFileSync(migratedLayoutPath, 'utf8')).toBe(migratedLayout)
  })

  it('atomically publishes the migrated index after the schedule layout', () => {
    const renameSpy = vi.spyOn(fs, 'renameSync')
    migrateLegacySchedule(options)

    const destinations = renameSpy.mock.calls.map((call) => String(call[1]))
    expect(destinations).toEqual([
      resolveScheduleLayoutPath('default', schedulesDirectory),
      path.join(schedulesDirectory, 'index.json')
    ])
    expect(fs.existsSync(path.join(schedulesDirectory, 'index.json.tmp'))).toBe(false)
  })

  it('creates, lists, updates, and retrieves schedules while keeping IDs immutable', () => {
    ensureSchedules(options)
    const created = createSchedule({
      name: 'Bedtime',
      enabled: true,
      timing: { kind: 'daily', time: '22:30', timezone: 'America/New_York' },
      destination: { deviceId: 'device-9', playlistId: '88' },
      status: { nextRunAt: '2026-07-18T02:30:00.000Z' }
    }, layout, { ...options, idFactory: () => 'schedule-2' })

    expect(created).toMatchObject({ id: 'schedule-2', name: 'Bedtime', order: 1 })
    expect(listSchedules(options).map((schedule) => schedule.id)).toEqual(['default', 'schedule-2'])
    expect(loadScheduleLayout('schedule-2', options)).toEqual(layout)

    const updated = updateSchedule('schedule-2', {
      name: 'Sleep',
      enabled: false,
      destination: { playlistId: '99' }
    }, options)
    expect(updated).toMatchObject({ id: 'schedule-2', name: 'Sleep', enabled: false })
    expect(updated.destination.playlistId).toBe('99')
    expect(getSchedule('schedule-2', options)).toEqual(updated)

    const forged = { name: 'Forged', id: 'different-id' } as unknown as Parameters<typeof updateSchedule>[1]
    expect(updateSchedule('schedule-2', forged, options).id).toBe('schedule-2')
  })

  it('derives the schedules directory from an explicit settings or legacy layout path', () => {
    const settingsBased = migrateLegacySchedule({ settingsPath, legacyLayoutPath: layoutPath })
    expect(settingsBased.defaultScheduleId).toBe('default')
    expect(fs.existsSync(path.join(directory, 'schedules', 'index.json'))).toBe(true)
  })

  it('duplicates layout and metadata but disables the copy and clears remote identity and status', () => {
    ensureSchedules(options)
    updateSchedule('default', {
      status: {
        lastAttemptAt: '2026-07-17T12:00:00.000Z',
        lastSuccessAt: '2026-07-17T12:00:00.000Z',
        nextRunAt: '2026-07-17T12:15:00.000Z',
        result: 'pushed',
        error: null
      }
    }, options)
    const sourceBytes = fs.readFileSync(resolveScheduleLayoutPath('default', schedulesDirectory))

    const duplicate = duplicateSchedule('default', 'Default copy', { ...options, idFactory: () => 'copy-id' })

    expect(duplicate).toMatchObject({ id: 'copy-id', name: 'Default copy', enabled: false, order: 1 })
    expect(duplicate.destination).toMatchObject({
      deviceId: 'device-007',
      playlistId: '42',
      screenId: null,
      screenName: null,
      screenLabel: null
    })
    expect(duplicate.status).toEqual({
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextRunAt: null,
      result: null,
      error: null
    })
    expect(fs.readFileSync(resolveScheduleLayoutPath('copy-id', schedulesDirectory))).toEqual(sourceBytes)
  })

  it('saves schedule layouts atomically and rejects unknown schedules', () => {
    ensureSchedules(options)
    const renameSpy = vi.spyOn(fs, 'renameSync')
    const title = layout.items.find((item) => item.id === 'title')
    if (!title || title.type !== 'text') throw new Error('title missing')
    title.text = 'Schedule-specific title'

    const saved = saveScheduleLayout('default', layout, options)
    const scheduleLayoutPath = resolveScheduleLayoutPath('default', schedulesDirectory)

    expect(saved.items.find((item) => item.id === 'title')).toMatchObject({ text: 'Schedule-specific title' })
    expect(renameSpy.mock.calls.some((call) => call[0] === `${scheduleLayoutPath}.tmp` && call[1] === scheduleLayoutPath)).toBe(true)
    expect(() => loadScheduleLayout('missing', options)).toThrow(/not found/)
    expect(() => saveScheduleLayout('missing', layout, options)).toThrow(/not found/)
  })

  it('updates the persistent legacy default when explicitly set or when deleting it', () => {
    ensureSchedules(options)
    createSchedule({ name: 'Second' }, layout, { ...options, idFactory: () => 'second' })
    createSchedule({ name: 'Third', order: 1 }, layout, { ...options, idFactory: () => 'third' })

    expect(setDefaultScheduleId('second', options).defaultScheduleId).toBe('second')
    deleteSchedule('second', options)
    expect(loadSchedulesIndex(options).defaultScheduleId).toBe('default')

    deleteSchedule('default', options)
    expect(loadSchedulesIndex(options).defaultScheduleId).toBe('third')
    expect(fs.existsSync(path.join(schedulesDirectory, 'default'))).toBe(false)
    expect(() => deleteSchedule('third', options)).toThrow(/only schedule/)
  })

  it('validates IDs, timing, destination text IDs, duplicate IDs, and index versions', () => {
    ensureSchedules(options)
    expect(() => createSchedule({ name: 'Bad' }, layout, { ...options, idFactory: () => '../bad' })).toThrow(/Invalid schedule id/)
    expect(() => createSchedule({
      name: 'Bad interval',
      timing: { kind: 'interval', intervalSeconds: 0 }
    }, layout, { ...options, idFactory: () => 'bad-interval' })).toThrow(/positive/)
    expect(() => createSchedule({
      name: 'Bad daily',
      timing: { kind: 'daily', time: '25:00', timezone: null }
    }, layout, { ...options, idFactory: () => 'bad-daily' })).toThrow(/HH:mm/)
    expect(() => createSchedule({
      name: 'Numeric ID',
      destination: { playlistId: 42 as unknown as string }
    }, layout, { ...options, idFactory: () => 'numeric-id' })).toThrow(/text or null/)
    expect(() => createSchedule({ name: 'Duplicate' }, layout, { ...options, idFactory: () => 'default' })).toThrow(/already exists/)

    const indexPath = path.join(schedulesDirectory, 'index.json')
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Record<string, unknown>
    index.version = 2
    fs.writeFileSync(indexPath, JSON.stringify(index))
    expect(() => loadSchedulesIndex(options)).toThrow(/Unsupported schedules index version/)
  })
})
