import { describe, expect, it } from 'vitest'
import { formatDate, formatMinutes, formatTime, interpolate } from '../src/formatters.js'

describe('formatters', () => {
  it('formats minutes as hours and minutes', () => {
    expect(formatMinutes('417')).toBe('6h 57m')
  })

  it('formats only strict timestamps and calendar dates', () => {
    expect(formatTime('2026-06-24T18:30:00Z')).not.toBe('2026-06-24T18:30:00Z')
    expect(formatDate('2026-06-24')).toMatch(/Jun 24/)
    expect(formatTime('72')).toBe('72')
    expect(formatDate('72')).toBe('72')
    expect(formatDate('2026-02-30')).toBe('2026-02-30')
    expect(formatTime('2026-06-24')).toBe('2026-06-24')
  })

  it('interpolates escaped values with filters', () => {
    expect(interpolate('Slept {{ minutes | minutes }} {{ unsafe }}', { minutes: '90', unsafe: '<ok>' })).toBe('Slept 1h 30m &lt;ok&gt;')
  })

  it('escapes literal text while preserving placeholders', () => {
    expect(interpolate('<b>{{ value }}</b>', { value: '<ok>' })).toBe('&lt;b&gt;&lt;ok&gt;&lt;/b&gt;')
  })
})
