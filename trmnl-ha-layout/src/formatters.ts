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
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

export function formatDate(value: unknown): string {
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
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
  let result = ''
  let lastIndex = 0
  for (const match of template.matchAll(/{{\s*([\w.-]+)(?:\s*\|\s*([\w-]+))?\s*}}/g)) {
    result += escapeXml(template.slice(lastIndex, match.index))
    result += escapeXml(formatValue(values[match[1]], match[2]))
    lastIndex = match.index + match[0].length
  }
  return result + escapeXml(template.slice(lastIndex))
}

export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
