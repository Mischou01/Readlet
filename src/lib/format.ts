// Formatting for the interface. Copy is in sentence case (docs/PLAN.md §5).

const LOCALE = undefined // the reader's own locale

const listFormat = new Intl.ListFormat(LOCALE, { style: 'long', type: 'conjunction' })
const percentFormat = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 0 })
const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' })
const dayMonthYear = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const monthOnly = new Intl.DateTimeFormat(LOCALE, { month: 'long' })
const timeOfDay = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' })

export function formatAuthors(authors: readonly string[]): string {
  return listFormat.format(authors)
}

/** "Pixel 8 and Laptop" */
export function formatList(items: readonly string[]): string {
  return listFormat.format(items)
}

export function formatPercent(fraction: number): string {
  return percentFormat.format(Math.max(0, Math.min(1, fraction)))
}

/** "18 min", "1 h 5 min". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Time left, rounded the way a person would say it. */
export function formatTimeLeft(minutes: number, where: 'chapter' | 'book'): string {
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 1) return `Less than a minute left in ${where}`
  return `${formatMinutes(minutes < 60 ? Math.ceil(minutes) : minutes)} left in ${where}`
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "Today", "Yesterday", "2 October", or "2 October 2024" for other years. */
export function formatDay(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear()
  return (sameYear ? dayMonth : dayMonthYear).format(ms)
}

/** "highlighted in March", "highlighted 3 weeks ago" — for resurfaced highlights. */
export function formatAgo(ms: number, now = Date.now()): string {
  const days = Math.floor((startOfDay(now) - startOfDay(ms)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 35) {
    const weeks = Math.round(days / 7)
    return weeks === 1 ? 'a week ago' : `${weeks} weeks ago`
  }
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear()
  return sameYear ? `in ${monthOnly.format(ms)}` : `in ${dayMonthYear.format(ms)}`
}

/** "just now", "5 min ago", "today at 14:05", "yesterday at 9:12", "12 October at 8:30". */
export function formatSince(ms: number, now = Date.now()): string {
  const minutes = Math.floor((now - ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const day = formatDay(ms, now)
  const when = day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day
  return `${when} at ${timeOfDay.format(ms)}`
}

/** Local calendar day as `YYYY-MM-DD`. */
export function dayKey(ms: number): string {
  const d = new Date(ms)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "Book 2 in The Expanse", or just the series when its position isn't known. */
export function formatSeries(series: string, index: number | null): string {
  if (index == null || !Number.isFinite(index) || index <= 0) return series
  return `Book ${index.toLocaleString(LOCALE, { maximumFractionDigits: 2 })} in ${series}`
}

/**
 * A publication date as books record it ("1871", "2003-05-14", "2003-01-01T00:00:00+00:00"):
 * the day when there is a real one, otherwise the year. Publishers who only know the year often
 * put 1 January; that's shown as the year too. Anything unrecognised is shown as it is.
 */
export function formatPublished(value: string): string {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(value.trim())
  if (!match) return value.trim()
  const [, year, month, day] = match
  if (!month || !day || (month === '01' && day === '01')) return year ?? value
  return dayMonthYear.format(new Date(Number(year), Number(month) - 1, Number(day)))
}

/** A book identifier worth showing ("ISBN 9780141439518"); `null` for internal ones (UUIDs). */
export function formatIdentifier(identifier: string): string | null {
  const id = identifier.trim().replace(/^urn:/i, '')
  const isbn = /^isbn:?\s*(.+)$/i.exec(id)
  if (isbn?.[1]) return `ISBN ${isbn[1].trim()}`
  if (/^[\d-]{10,17}[\dX]?$/i.test(id) && id.replace(/-/g, '').length >= 10) return `ISBN ${id}`
  if (/^uuid:|^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) || /^calibre:/i.test(id)) return null
  return id || null
}

/** A language code ("en", "de-AT") as its name in the reader's language ("English"). */
export function formatLanguage(code: string): string {
  try {
    const names = new Intl.DisplayNames(LOCALE, { type: 'language' })
    return names.of(code.trim()) ?? code
  } catch {
    return code
  }
}

export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`
}
