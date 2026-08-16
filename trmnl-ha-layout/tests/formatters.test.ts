import { describe, expect, it } from 'vitest'
import { formatMinutes, formatValue, interpolate } from '../src/formatters.js'

describe('formatters', () => {
  it('formats minutes as hours and minutes', () => {
    expect(formatMinutes('417')).toBe('6h 57m')
  })

  it('interpolates escaped values with filters', () => {
    expect(interpolate('Slept {{ minutes | minutes }} {{ unsafe }}', { minutes: '90', unsafe: '<ok>' })).toBe('Slept 1h 30m &lt;ok&gt;')
  })

  it('uses a named format only when a placeholder has no inline filter', () => {
    expect(interpolate('{{ duration }} at {{ startedAt | time }}', {
      duration: '125',
      startedAt: '2026-06-24T08:30:00Z'
    }, 'minutes')).toMatch(/^2h 5m at (?!33774096h)/)
  })

  it('preserves explicit raw state strings without changing legacy defaults', () => {
    expect(interpolate('{{ state }}', { state: 'unknown' }, 'raw')).toBe('unknown')
    expect(interpolate('{{ state }}', { state: 'unknown' })).toBe('—')
    expect(interpolate('{{ state | minutes }}', { state: '125' }, 'raw')).toBe('2h 5m')
    expect(formatValue(null, 'raw')).toBe('—')
    expect(formatValue(undefined, 'raw')).toBe('—')
  })

  it('escapes literal text while preserving placeholders', () => {
    expect(interpolate('<b>{{ value }}</b>', { value: '<ok>' })).toBe('&lt;b&gt;&lt;ok&gt;&lt;/b&gt;')
  })
})
