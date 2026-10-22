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

export function formatAuthors(authors: readonly string[]): string {
  return listFormat.format(authors)
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

export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`
}
