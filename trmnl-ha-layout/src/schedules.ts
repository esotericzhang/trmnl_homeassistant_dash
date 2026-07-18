import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  loadLayoutConfig,
  getRuntimeConfig,
  loadSettings,
  loadSettingsSafe,
  resolveLayoutPath,
  resolveSettingsPath,
  saveLayoutConfig
} from './config.js'
import type { Settings, TerminusMode } from './config.js'
import type { LayoutConfig } from './types.js'

export const SCHEDULES_INDEX_VERSION = 1
export const LEGACY_DEFAULT_SCHEDULE_ID = 'default'

export type ScheduleTiming =
  | { kind: 'manual' }
  | { kind: 'interval'; intervalSeconds: number }
  | { kind: 'daily'; time: string; timezone: string | null }

export interface ScheduleDestination {
  deviceId: string | null
  playlistId: string | null
  mode: TerminusMode | null
  screenId: string | null
  webhookUrl: string | null
  modelId: string | null
  screenName: string | null
  screenLabel: string | null
}

export interface ScheduleStatus {
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  nextRunAt: string | null
  nextRunSignature?: string | null
  result: string | null
  error: string | null
}

export interface Schedule {
  id: string
  name: string
  enabled: boolean
  order: number
  timing: ScheduleTiming
  destination: ScheduleDestination
  status: ScheduleStatus
}

export interface SchedulesIndex {
  version: typeof SCHEDULES_INDEX_VERSION
  defaultScheduleId: string
  schedules: Schedule[]
}

export interface SchedulePersistenceOptions {
  schedulesDirectory?: string
  legacyLayoutPath?: string
  settingsPath?: string
  idFactory?: () => string
}

export interface CreateScheduleInput {
  name: string
  enabled?: boolean
  order?: number
  timing?: ScheduleTiming
  destination?: Partial<ScheduleDestination>
  status?: Partial<ScheduleStatus>
}

export type UpdateScheduleInput = Partial<Omit<Schedule, 'id' | 'destination' | 'status'>> & {
  destination?: Partial<ScheduleDestination>
  status?: Partial<ScheduleStatus>
}

interface ResolvedSchedulePaths {
  schedulesDirectory: string
  indexPath: string
  legacyLayoutPath: string
  settingsPath: string
}

const EMPTY_DESTINATION: ScheduleDestination = {
  deviceId: null,
  playlistId: null,
  mode: null,
  screenId: null,
  webhookUrl: null,
  modelId: null,
  screenName: null,
  screenLabel: null
}

const EMPTY_STATUS: ScheduleStatus = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  nextRunAt: null,
  nextRunSignature: null,
  result: null,
  error: null
}

export function resolveSchedulesDirectory(baseDirectory = path.dirname(resolveSettingsPath())): string {
  return path.join(baseDirectory, 'schedules')
}

export function resolveSchedulesIndexPath(schedulesDirectory = resolveSchedulesDirectory()): string {
  return path.join(schedulesDirectory, 'index.json')
}

export function resolveScheduleLayoutPath(id: string, schedulesDirectory = resolveSchedulesDirectory()): string {
  validateScheduleId(id)
  return path.join(schedulesDirectory, id, 'layout.yaml')
}

export function ensureSchedules(options: SchedulePersistenceOptions = {}): SchedulesIndex {
  return migrateLegacySchedule(options)
}

export function migrateLegacySchedule(options: SchedulePersistenceOptions = {}): SchedulesIndex {
  const paths = resolvePaths(options)
  if (fs.existsSync(paths.indexPath)) return loadIndexFile(paths.indexPath)

  const legacyLayout = loadLayoutConfig(paths.legacyLayoutPath)
  const settings = fs.existsSync(paths.settingsPath)
    ? loadSettings(paths.settingsPath)
    : loadSettingsSafe(paths.settingsPath)
  const useRuntimeOverrides = !options.schedulesDirectory && !options.legacyLayoutPath && !options.settingsPath
  const schedule = legacySchedule(
    settings,
    useRuntimeOverrides ? getRuntimeConfig().refreshIntervalSeconds : settings.refreshIntervalSeconds,
    settings.terminus
  )
  const index: SchedulesIndex = {
    version: SCHEDULES_INDEX_VERSION,
    defaultScheduleId: schedule.id,
    schedules: [schedule]
  }

  validateSchedulesIndex(index)
  fs.mkdirSync(paths.schedulesDirectory, { recursive: true })
  copyLayoutAtomically(paths.legacyLayoutPath, resolveScheduleLayoutPath(schedule.id, paths.schedulesDirectory))
  // Validate before publishing the index while preserving the original YAML bytes.
  loadScheduleLayoutFile(schedule.id, paths.schedulesDirectory, legacyLayout)
  writeIndexFile(index, paths.indexPath)
  return clone(index)
}

export function loadSchedulesIndex(options: SchedulePersistenceOptions = {}): SchedulesIndex {
  const paths = resolvePaths(options)
  if (!fs.existsSync(paths.indexPath)) return migrateLegacySchedule(options)
  return loadIndexFile(paths.indexPath)
}

export function listSchedules(options: SchedulePersistenceOptions = {}): Schedule[] {
  return loadSchedulesIndex(options).schedules
    .slice()
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

export function getSchedule(id: string, options: SchedulePersistenceOptions = {}): Schedule {
  validateScheduleId(id)
  const schedule = loadSchedulesIndex(options).schedules.find((candidate) => candidate.id === id)
  if (!schedule) throw new Error(`Schedule not found: ${id}`)
  return clone(schedule)
}

export function createSchedule(
  input: CreateScheduleInput,
  layout: LayoutConfig,
  options: SchedulePersistenceOptions = {}
): Schedule {
  const paths = resolvePaths(options)
  const index = loadSchedulesIndex(options)
  const id = (options.idFactory ?? randomUUID)()
  validateScheduleId(id)
  if (index.schedules.some((schedule) => schedule.id === id)) throw new Error(`Schedule already exists: ${id}`)

  const schedule: Schedule = {
    id,
    name: input.name,
    enabled: input.enabled ?? false,
    order: input.order ?? nextOrder(index.schedules),
    timing: input.timing ?? { kind: 'manual' },
    destination: { ...EMPTY_DESTINATION, ...input.destination },
    status: { ...EMPTY_STATUS, ...input.status }
  }
  validateSchedule(schedule)

  saveLayoutConfig(layout, resolveScheduleLayoutPath(id, paths.schedulesDirectory))
  index.schedules.push(schedule)
  writeIndexFile(index, paths.indexPath)
  return clone(schedule)
}

export function updateSchedule(
  id: string,
  changes: UpdateScheduleInput,
  options: SchedulePersistenceOptions = {}
): Schedule {
  validateScheduleId(id)
  const paths = resolvePaths(options)
  const index = loadSchedulesIndex(options)
  const position = index.schedules.findIndex((schedule) => schedule.id === id)
  if (position < 0) throw new Error(`Schedule not found: ${id}`)

  const current = index.schedules[position]
  const updated: Schedule = {
    ...current,
    ...changes,
    id,
    destination: changes.destination ? { ...current.destination, ...changes.destination } : current.destination,
    status: changes.status ? { ...current.status, ...changes.status } : current.status
  }
  if ((changes.enabled !== undefined && changes.enabled !== current.enabled)
    || (changes.timing !== undefined && JSON.stringify(changes.timing) !== JSON.stringify(current.timing))) {
    updated.status = { ...updated.status, nextRunAt: null, nextRunSignature: null }
  }
  validateSchedule(updated)
  index.schedules[position] = updated
  writeIndexFile(index, paths.indexPath)
  return clone(updated)
}

export function deleteSchedule(id: string, options: SchedulePersistenceOptions = {}): void {
  validateScheduleId(id)
  const paths = resolvePaths(options)
  const index = loadSchedulesIndex(options)
  const position = index.schedules.findIndex((schedule) => schedule.id === id)
  if (position < 0) throw new Error(`Schedule not found: ${id}`)
  if (index.schedules.length === 1) throw new Error('Cannot delete the only schedule')

  index.schedules.splice(position, 1)
  if (index.defaultScheduleId === id) index.defaultScheduleId = orderedSchedules(index.schedules)[0].id
  writeIndexFile(index, paths.indexPath)
  fs.rmSync(path.join(paths.schedulesDirectory, id), { recursive: true, force: true })
}

export function duplicateSchedule(
  id: string,
  name?: string,
  options: SchedulePersistenceOptions = {}
): Schedule {
  validateScheduleId(id)
  const paths = resolvePaths(options)
  const index = loadSchedulesIndex(options)
  const source = index.schedules.find((schedule) => schedule.id === id)
  if (!source) throw new Error(`Schedule not found: ${id}`)

  const duplicateId = (options.idFactory ?? randomUUID)()
  validateScheduleId(duplicateId)
  if (index.schedules.some((schedule) => schedule.id === duplicateId)) {
    throw new Error(`Schedule already exists: ${duplicateId}`)
  }
  const duplicate: Schedule = {
    ...clone(source),
    id: duplicateId,
    name: name ?? `${source.name} copy`,
    enabled: false,
    order: nextOrder(index.schedules),
    destination: { ...source.destination, screenId: null, screenName: null, screenLabel: null },
    status: { ...EMPTY_STATUS }
  }
  validateSchedule(duplicate)

  copyLayoutAtomically(
    resolveScheduleLayoutPath(id, paths.schedulesDirectory),
    resolveScheduleLayoutPath(duplicateId, paths.schedulesDirectory)
  )
  index.schedules.push(duplicate)
  writeIndexFile(index, paths.indexPath)
  return clone(duplicate)
}

export function setDefaultScheduleId(id: string, options: SchedulePersistenceOptions = {}): SchedulesIndex {
  validateScheduleId(id)
  const paths = resolvePaths(options)
  const index = loadSchedulesIndex(options)
  if (!index.schedules.some((schedule) => schedule.id === id)) throw new Error(`Schedule not found: ${id}`)
  index.defaultScheduleId = id
  writeIndexFile(index, paths.indexPath)
  return clone(index)
}

export function loadScheduleLayout(id: string, options: SchedulePersistenceOptions = {}): LayoutConfig {
  const paths = resolvePaths(options)
  getSchedule(id, options)
  return loadLayoutConfig(resolveScheduleLayoutPath(id, paths.schedulesDirectory))
}

export function saveScheduleLayout(
  id: string,
  layout: LayoutConfig,
  options: SchedulePersistenceOptions = {}
): LayoutConfig {
  const paths = resolvePaths(options)
  getSchedule(id, options)
  return saveLayoutConfig(layout, resolveScheduleLayoutPath(id, paths.schedulesDirectory))
}

export function emptyScheduleLayout(template: LayoutConfig): LayoutConfig {
  return {
    frame: structuredClone(template.frame),
    data: { entities: {} },
    items: []
  }
}

export function validateSchedulesIndex(index: SchedulesIndex): void {
  if (!index || index.version !== SCHEDULES_INDEX_VERSION) {
    throw new Error(`Unsupported schedules index version: ${String(index?.version)}`)
  }
  if (!Array.isArray(index.schedules) || index.schedules.length === 0) {
    throw new Error('Schedules index must contain at least one schedule')
  }
  const ids = new Set<string>()
  for (const schedule of index.schedules) {
    validateSchedule(schedule)
    if (ids.has(schedule.id)) throw new Error(`Duplicate schedule id: ${schedule.id}`)
    ids.add(schedule.id)
  }
  validateScheduleId(index.defaultScheduleId)
  if (!ids.has(index.defaultScheduleId)) {
    throw new Error(`Default schedule not found: ${index.defaultScheduleId}`)
  }
}

function resolvePaths(options: SchedulePersistenceOptions): ResolvedSchedulePaths {
  const explicitBaseDirectory = options.settingsPath
    ? path.dirname(options.settingsPath)
    : options.legacyLayoutPath
      ? path.dirname(options.legacyLayoutPath)
      : undefined
  const schedulesDirectory = options.schedulesDirectory ?? resolveSchedulesDirectory(explicitBaseDirectory)
  const baseDirectory = path.dirname(schedulesDirectory)
  return {
    schedulesDirectory,
    indexPath: resolveSchedulesIndexPath(schedulesDirectory),
    legacyLayoutPath: options.legacyLayoutPath ?? (options.schedulesDirectory ? path.join(baseDirectory, 'layout.yaml') : resolveLayoutPath()),
    settingsPath: options.settingsPath ?? (options.schedulesDirectory ? path.join(baseDirectory, 'settings.json') : resolveSettingsPath())
  }
}

function legacySchedule(settings: Settings, intervalSeconds: number, terminus: Settings['terminus']): Schedule {
  return {
    id: LEGACY_DEFAULT_SCHEDULE_ID,
    name: 'Default schedule',
    enabled: true,
    order: 0,
    timing: Number.isFinite(intervalSeconds) && intervalSeconds > 0
      ? { kind: 'interval', intervalSeconds }
      : { kind: 'manual' },
    destination: {
      deviceId: settings.device,
      playlistId: text(terminus.playlistId),
      mode: terminus.mode ?? settings.terminus.mode,
      screenId: null,
      webhookUrl: text(terminus.webhookUrl),
      modelId: text(terminus.modelId),
      screenName: text(terminus.screenName),
      screenLabel: text(terminus.screenLabel)
    },
    status: { ...EMPTY_STATUS }
  }
}

function loadIndexFile(indexPath: string): SchedulesIndex {
  const raw = fs.readFileSync(indexPath, 'utf8')
  const index = JSON.parse(raw) as SchedulesIndex
  validateSchedulesIndex(index)
  return clone(index)
}

function writeIndexFile(index: SchedulesIndex, indexPath: string): void {
  validateSchedulesIndex(index)
  fs.mkdirSync(path.dirname(indexPath), { recursive: true })
  const temporaryPath = `${indexPath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  fs.renameSync(temporaryPath, indexPath)
}

function copyLayoutAtomically(sourcePath: string, destinationPath: string): void {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  const temporaryPath = `${destinationPath}.tmp`
  fs.copyFileSync(sourcePath, temporaryPath)
  fs.renameSync(temporaryPath, destinationPath)
}

function loadScheduleLayoutFile(id: string, schedulesDirectory: string, expected: LayoutConfig): void {
  const loaded = loadLayoutConfig(resolveScheduleLayoutPath(id, schedulesDirectory))
  if (JSON.stringify(loaded) !== JSON.stringify(expected)) throw new Error('Migrated schedule layout does not match legacy layout')
}

function validateSchedule(schedule: Schedule): void {
  validateScheduleId(schedule?.id)
  if (typeof schedule.name !== 'string' || schedule.name.trim().length === 0) {
    throw new Error('Schedule name must not be empty')
  }
  if (typeof schedule.enabled !== 'boolean') throw new Error('Schedule enabled must be a boolean')
  if (!Number.isSafeInteger(schedule.order) || schedule.order < 0) {
    throw new Error('Schedule order must be a non-negative integer')
  }
  validateTiming(schedule.timing)
  validateDestination(schedule.destination)
  validateStatus(schedule.status)
}

function validateScheduleId(id: string): void {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    throw new Error(`Invalid schedule id: ${String(id)}`)
  }
}

function validateTiming(timing: ScheduleTiming): void {
  if (!timing || !['manual', 'interval', 'daily'].includes(timing.kind)) {
    throw new Error('Schedule timing kind must be manual, interval, or daily')
  }
  if (timing.kind === 'interval' && (!Number.isFinite(timing.intervalSeconds) || timing.intervalSeconds <= 0)) {
    throw new Error('Schedule intervalSeconds must be a positive number')
  }
  if (timing.kind === 'daily') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timing.time)) throw new Error('Schedule daily time must use HH:mm')
    if (timing.timezone !== null && (typeof timing.timezone !== 'string' || timing.timezone.length === 0)) {
      throw new Error('Schedule daily timezone must be text or null')
    }
  }
}

function validateDestination(destination: ScheduleDestination): void {
  if (!destination || typeof destination !== 'object') throw new Error('Schedule destination is required')
  for (const key of ['deviceId', 'playlistId', 'screenId', 'webhookUrl', 'modelId', 'screenName', 'screenLabel'] as const) {
    if (destination[key] !== null && typeof destination[key] !== 'string') {
      throw new Error(`Schedule destination ${key} must be text or null`)
    }
  }
  if (destination.mode !== null && !['screen-content', 'byos-uri', 'byos-base64', 'raw-webhook'].includes(destination.mode)) {
    throw new Error('Schedule destination mode is invalid')
  }
}

function validateStatus(status: ScheduleStatus): void {
  if (!status || typeof status !== 'object') throw new Error('Schedule status is required')
  for (const key of ['lastAttemptAt', 'lastSuccessAt', 'nextRunAt', 'result', 'error'] as const) {
    if (status[key] !== null && typeof status[key] !== 'string') {
      throw new Error(`Schedule status ${key} must be text or null`)
    }
  }
  if (status.nextRunSignature !== undefined && status.nextRunSignature !== null && typeof status.nextRunSignature !== 'string') {
    throw new Error('Schedule status nextRunSignature must be text or null')
  }
}

function nextOrder(schedules: Schedule[]): number {
  return schedules.reduce((maximum, schedule) => Math.max(maximum, schedule.order), -1) + 1
}

function orderedSchedules(schedules: Schedule[]): Schedule[] {
  return schedules.slice().sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

function text(value: string | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
