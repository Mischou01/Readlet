// Reading statistics from sessions. Pure functions over local calendar days; covered by
// stats.test.ts.

import { dayKey } from '../lib/format'
import type { Session } from '../lib/types'

export interface DayTotal {
  /** Active reading minutes that day. */
  minutes: number
  /** Minutes per book fingerprint. */
  books: Map<string, number>
}

/** A day counts towards a streak once you've read for a minute. */
export const STREAK_MINUTES = 1

export function dayTotals(sessions: readonly Session[]): Map<string, DayTotal> {
  const totals = new Map<string, DayTotal>()
  for (const session of sessions) {
    const minutes = session.activeMs / 60_000
    if (minutes <= 0) continue
    const key = dayKey(session.start)
    const total = totals.get(key) ?? { minutes: 0, books: new Map<string, number>() }
    total.minutes += minutes
    total.books.set(session.book, (total.books.get(session.book) ?? 0) + minutes)
    totals.set(key, total)
  }
  return totals
}

export function minutesOn(totals: Map<string, DayTotal>, day: Date): number {
  return totals.get(dayKey(day.getTime()))?.minutes ?? 0
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function readOn(totals: Map<string, DayTotal>, day: Date): boolean {
  return minutesOn(totals, day) >= STREAK_MINUTES
}

/** Consecutive reading days ending today, or yesterday if today hasn't started yet. */
export function currentStreak(totals: Map<string, DayTotal>, today: Date): number {
  let day = readOn(totals, today) ? today : addDays(today, -1)
  let streak = 0
  while (readOn(totals, day)) {
    streak += 1
    day = addDays(day, -1)
  }
  return streak
}

/** The longest run of reading days that falls within `year`. */
export function longestStreak(totals: Map<string, DayTotal>, year: number, until: Date): number {
  let best = 0
  let run = 0
  const end = until.getFullYear() === year ? until : new Date(year, 11, 31)
  for (let day = new Date(year, 0, 1); day <= end; day = addDays(day, 1)) {
    run = readOn(totals, day) ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

export function inYear(sessions: readonly Session[], year: number): Session[] {
  return sessions.filter((s) => new Date(s.start).getFullYear() === year)
}

export function totalMinutes(sessions: readonly Session[]): number {
  return sessions.reduce((sum, s) => sum + s.activeMs / 60_000, 0)
}

/** Words a minute over sessions that counted words; `null` without enough data. */
export function wordsPerMinute(sessions: readonly Session[]): number | null {
  let words = 0
  let minutes = 0
  for (const s of sessions) {
    if (s.words <= 0) continue
    words += s.words
    minutes += s.activeMs / 60_000
  }
  return minutes >= 5 ? Math.round(words / minutes) : null
}

export function averageMinutesPerReadingDay(
  totals: Map<string, DayTotal>,
  year: number,
): number | null {
  let days = 0
  let minutes = 0
  for (const [key, total] of totals) {
    if (!key.startsWith(`${year}-`) || total.minutes < STREAK_MINUTES) continue
    days += 1
    minutes += total.minutes
  }
  return days ? Math.round(minutes / days) : null
}

export function minutesPerBook(sessions: readonly Session[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const s of sessions) result.set(s.book, (result.get(s.book) ?? 0) + s.activeMs / 60_000)
  return result
}

/** Monday to Sunday of the week containing `today`. */
export function weekDays(today: Date): Date[] {
  const start = new Date(today)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

/** When most of the reading happens, if there's a clear favourite. */
export function favouriteTimeOfDay(sessions: readonly Session[]): TimeOfDay | null {
  const buckets: Record<TimeOfDay, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 }
  let total = 0
  for (const s of sessions) {
    const hour = new Date(s.start).getHours()
    const bucket: TimeOfDay =
      hour >= 5 && hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 22 ? 'evening' : 'night'
    buckets[bucket] += s.activeMs
    total += s.activeMs
  }
  if (total < 30 * 60_000) return null
  const [best, ms] = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0] as [TimeOfDay, number]
  return ms / total >= 0.45 ? best : null
}

/** The book read the most on a given day (used to tint that day's pebble). */
export function mainBookOf(total: DayTotal | undefined): string | null {
  if (!total) return null
  let best: string | null = null
  let bestMinutes = 0
  for (const [book, minutes] of total.books) {
    if (minutes > bestMinutes) {
      best = book
      bestMinutes = minutes
    }
  }
  return best
}
