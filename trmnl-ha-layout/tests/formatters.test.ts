import { describe, expect, it } from 'vitest'
import { formatMinutes, interpolate } from '../src/formatters.js'

describe('formatters', () => {
  it('formats minutes as hours and minutes', () => {
    expect(formatMinutes('417')).toBe('6h 57m')
  })

  it('interpolates escaped values with filters', () => {
    expect(interpolate('Slept {{ minutes | minutes }} {{ unsafe }}', { minutes: '90', unsafe: '<ok>' })).toBe('Slept 1h 30m &lt;ok&gt;')
  })

  it('escapes literal text while preserving placeholders', () => {
    expect(interpolate('<b>{{ value }}</b>', { value: '<ok>' })).toBe('&lt;b&gt;&lt;ok&gt;&lt;/b&gt;')
  })
})
