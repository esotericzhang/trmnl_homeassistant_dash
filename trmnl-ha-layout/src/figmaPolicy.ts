import { isSafeValuePath } from './config.js'

const ALLOWED_ATTRIBUTE_KEYS = new Set([
  'apparent_temperature', 'battery_level', 'cloud_coverage', 'condition', 'datetime',
  'dew_point', 'distance', 'duration', 'energy', 'forecast', 'frequency', 'humidity', 'mode',
  'ozone', 'percentage', 'power', 'precipitation', 'precipitation_probability', 'pressure',
  'temperature', 'templow', 'uv_index', 'visibility', 'voltage', 'volume',
  'wind_bearing', 'wind_gust_speed', 'wind_speed'
])

export function isAllowedFigmaAttributeKey(key: string): boolean {
  return ALLOWED_ATTRIBUTE_KEYS.has(key) && !isSecretLikeKey(key)
}

export function isSafeFigmaValuePath(path: string): boolean {
  if (path === 'state') return true
  if (!isSafeValuePath(path)) return false
  const segments = path.split('.')
  if (segments[0] !== 'attributes' || segments.length < 2) return false
  if (!isAllowedFigmaAttributeKey(segments[1])) return false
  return segments.slice(2).every(segment => /^\d+$/.test(segment) || isAllowedFigmaAttributeKey(segment))
}

function isSecretLikeKey(key: string): boolean {
  return /(?:^|_)(?:access|api|auth|code|cookie|credential|key|passcode|password|pin|secret|session|signature|token|webhook)(?:_|$)/i.test(key)
}
