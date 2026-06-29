import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadSettings,
  loadSettingsSafe,
  loadSettingsMasked,
  maskToken,
  normalizeSettings,
  saveSettings,
  validateSettings
} from '../src/config.js'
import type { Settings } from '../src/config.js'
import { terminusOptionsFromEnv } from '../src/terminus.js'
describe('settings persistence', () => {
  let dir: string
  let settingsPath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-settings-'))
    settingsPath = path.join(dir, 'settings.json')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns defaults and bootstraps the file on first run', () => {
    expect(fs.existsSync(settingsPath)).toBe(false)
    const settings = loadSettingsSafe(settingsPath)
    expect(settings.homeAssistantUrl).toBe('')
    expect(settings.refreshIntervalSeconds).toBe(0)
    expect(settings.device).toBeNull()
    expect(settings.terminus.mode).toBe('byos-uri')
    expect(fs.existsSync(settingsPath)).toBe(true)
    expect(JSON.parse(fs.readFileSync(settingsPath, 'utf8'))).toEqual(settings)
  })

  it('round-trips a full settings object through save and load', () => {
    const input: Settings = {
      homeAssistantUrl: 'http://ha.local:8123',
      haToken: 'long-lived-token',
      publicBaseUrl: 'http://addon.local:10000',
      refreshIntervalSeconds: 600,
      device: null,
      terminus: {
        apiUrl: 'http://terminus.local:2300',
        mode: 'byos-base64',
        accessToken: 'access-jwt',
        refreshToken: 'refresh-jwt',
        obtainedAt: 1234567890,
        modelId: 'og',
        screenName: 'ha-screen',
        screenLabel: 'Home Assistant',
        playlistId: '42'
      }
    }
    const saved = saveSettings(input, settingsPath)
    expect(saved.haToken).toBe('long-lived-token')
    const loaded = loadSettings(settingsPath)
    expect(loaded).toEqual(input)
  })

  it('writes atomically via a tmp file then rename', () => {
    const renameSpy = vi.spyOn(fs, 'renameSync')
    const input = normalizeSettings({ homeAssistantUrl: 'http://ha.local' })
    saveSettings(input, settingsPath)
    const renameCalls = renameSpy.mock.calls
    const matching = renameCalls.find((args) => String(args[1]) === settingsPath)
    expect(matching).toBeDefined()
    expect(String(matching![0])).toBe(`${settingsPath}.tmp`)
    expect(fs.existsSync(`${settingsPath}.tmp`)).toBe(false)
    expect(fs.existsSync(settingsPath)).toBe(true)
    renameSpy.mockRestore()
  })

  it('validates refreshIntervalSeconds and mode', () => {
    expect(() => validateSettings(normalizeSettings({ refreshIntervalSeconds: -1 }))).toThrow(/non-negative/)
    expect(normalizeSettings({ terminus: { apiUrl: '', mode: 'bogus' as never } }).terminus.mode).toBe('byos-uri')
  })
})

describe('settings masking', () => {
  it('masks tokens to last-4 in masked output', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-mask-'))
    const settingsPath = path.join(dir, 'settings.json')
    try {
      saveSettings({
        homeAssistantUrl: 'http://ha.local',
        haToken: 'secret-ha-token-1234',
        publicBaseUrl: '',
        refreshIntervalSeconds: 0,
        device: null,
        terminus: {
          apiUrl: 'http://terminus.local',
          mode: 'byos-uri',
          accessToken: 'access-jwt-5678',
          refreshToken: 'refresh-jwt-9012'
        },
        settingsToken: 'guard-token-abcd'
      }, settingsPath)
      const masked = loadSettingsMasked(settingsPath)
      expect(masked.haToken).toBe('••••1234')
      expect(masked.terminus.accessToken).toBe('••••5678')
      expect(masked.terminus.refreshToken).toBe('••••9012')
      expect(masked.settingsToken).toBe('••••abcd')
      expect(masked.homeAssistantUrl).toBe('http://ha.local')
      expect(masked.terminus.login).toBeUndefined()
      expect(masked.terminus.password).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('maskToken handles short and empty values', () => {
    expect(maskToken(undefined)).toBeUndefined()
    expect(maskToken('')).toBeUndefined()
    expect(maskToken('ab')).toBe('••••')
    expect(maskToken('abcdefgh')).toBe('••••efgh')
  })
})

describe('env-overrides-settings precedence', () => {
  const originalEnv = { ...process.env }
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnl-prec-'))
    process.env.LAYOUT_PATH = path.join(dir, 'layout.yaml')
    process.env.HOME_ASSISTANT_URL = 'http://env-ha.local'
    process.env.ACCESS_TOKEN = 'env-ha-token'
    process.env.TERMINUS_API_URL = 'http://env-terminus.local'
    process.env.TERMINUS_MODE = 'raw-webhook'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('env vars win over settings.json for terminus options', () => {
    const settingsPath = path.join(dir, 'settings.json')
    saveSettings({
      homeAssistantUrl: 'http://settings-ha.local',
      haToken: 'settings-ha-token',
      publicBaseUrl: 'http://settings-addon.local',
      refreshIntervalSeconds: 0,
      device: null,
      terminus: {
        apiUrl: 'http://settings-terminus.local',
        mode: 'byos-base64',
        accessToken: 'settings-access'
      }
    }, settingsPath)
    const options = terminusOptionsFromEnv()
    expect(options.apiUrl).toBe('http://env-terminus.local')
    expect(options.mode).toBe('raw-webhook')
    expect(options.publicBaseUrl).toBe('http://settings-addon.local')
  })

  it('settings.json provides values when env vars absent', () => {
    delete process.env.TERMINUS_API_URL
    delete process.env.TERMINUS_MODE
    delete process.env.HOME_ASSISTANT_URL
    delete process.env.ACCESS_TOKEN
    const settingsPath = path.join(dir, 'settings.json')
    saveSettings({
      homeAssistantUrl: 'http://settings-ha.local',
      haToken: 'settings-ha-token',
      publicBaseUrl: '',
      refreshIntervalSeconds: 0,
      device: null,
      terminus: {
        apiUrl: 'http://settings-terminus.local',
        mode: 'byos-base64',
        accessToken: 'settings-access'
      }
    }, settingsPath)
    const options = terminusOptionsFromEnv()
    expect(options.apiUrl).toBe('http://settings-terminus.local')
    expect(options.mode).toBe('byos-base64')
    expect(options.accessToken).toBe('settings-access')
  })
})
