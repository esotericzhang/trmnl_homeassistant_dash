export function formatValue(value: unknown, filter?: string): string {
  if (value === null || value === undefined || value === 'unknown' || value === 'unavailable') return '—'
  switch (filter?.trim()) {
    case 'time':
      return formatTime(value)
    case 'minutes':
      return formatMinutes(value)
    case 'date':
      return formatDate(value)
    default:
      return String(value)
  }
}

export function formatTime(value: unknown): string {
  const date = parseTimestamp(String(value))
  if (!date) return String(value)
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

export function formatDate(value: unknown): string {
  const input = String(value)
  const date = parseCalendarDate(input) ?? parseTimestamp(input)
  if (!date) return input
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function parseTimestamp(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6] ?? 0)
  const offset = match[7]
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 59) return null
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3))
    const offsetMinute = Number(offset.slice(4, 6))
    if (offsetHour > 23 || offsetMinute > 59) return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function formatMinutes(value: unknown): string {
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return String(value)
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours <= 0) return `${mins}m`
  return `${hours}h ${mins}m`
}

export function interpolate(template: string, values: Record<string, unknown>): string {
  return escapeXml(interpolateRaw(template, values))
}

export function interpolateRaw(template: string, values: Record<string, unknown>): string {
  let result = ''
  let lastIndex = 0
  for (const match of template.matchAll(/{{\s*([\w.-]+)(?:\s*\|\s*([\w-]+))?\s*}}/g)) {
    result += template.slice(lastIndex, match.index)
    result += formatValue(values[match[1]], match[2])
    lastIndex = match.index + match[0].length
  }
  return result + template.slice(lastIndex)
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
