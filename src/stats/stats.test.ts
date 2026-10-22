import { describe, expect, it } from 'vitest'
import { session } from '../test/fixtures'
import {
  averageMinutesPerReadingDay,
  currentStreak,
  dayTotals,
  favouriteTimeOfDay,
  longestStreak,
  mainBookOf,
  readingDays,
  topBooks,
  weekDays,
  wordsPerMinute,
  yearCalendar,
} from './stats'

const at = (month: number, day: number, hour = 20) => new Date(2026, month, day, hour)

describe('dayTotals', () => {
  it('adds up active minutes per local day and per book', () => {
    const totals = dayTotals([
      session(at(9, 20), 10),
      session(at(9, 20, 22), 5, { book: 'fp-2' }),
      session(at(9, 21), 0),
    ])
    const day = totals.get('2026-10-20')
    expect(day?.minutes).toBe(15)
    expect(mainBookOf(day)).toBe('fp-1')
    expect(totals.has('2026-10-21')).toBe(false)
  })
})

describe('streaks', () => {
  const totals = dayTotals([
    session(at(9, 15), 5),
    session(at(9, 16), 5),
    session(at(9, 17), 5),
    session(at(9, 19), 5),
    session(at(9, 20), 5),
  ])

  it('counts back from today, or from yesterday before today’s reading', () => {
    expect(currentStreak(totals, at(9, 20, 0))).toBe(2)
    expect(currentStreak(totals, at(9, 21, 0))).toBe(2)
    expect(currentStreak(totals, at(9, 22, 0))).toBe(0)
  })

  it('finds the longest run in the year', () => {
    expect(longestStreak(totals, 2026, at(9, 22, 0))).toBe(3)
  })
})

describe('averages', () => {
  it('reports words a minute only with enough data', () => {
    expect(wordsPerMinute([session(at(1, 1), 2, { words: 500 })])).toBeNull()
    expect(wordsPerMinute([session(at(1, 1), 10, { words: 2500 })])).toBe(250)
  })

  it('averages over days with reading', () => {
    const totals = dayTotals([
      session(at(1, 1), 10),
      session(at(1, 2), 30),
      session(at(1, 2, 8), 20),
    ])
    expect(averageMinutesPerReadingDay(totals, 2026)).toBe(30)
    expect(averageMinutesPerReadingDay(totals, 2025)).toBeNull()
    expect(readingDays(totals, 2026)).toBe(2)
  })

  it('names a favourite time of day only when there is a clear one', () => {
    expect(favouriteTimeOfDay([session(at(1, 1, 21), 40)])).toBe('evening')
    expect(favouriteTimeOfDay([session(at(1, 1, 8), 20), session(at(1, 1, 21), 20)])).toBeNull()
    expect(favouriteTimeOfDay([session(at(1, 1, 21), 10)])).toBeNull()
  })
})

describe('weekDays', () => {
  it('runs Monday to Sunday', () => {
    const days = weekDays(at(9, 22)) // a Thursday
    expect(days).toHaveLength(7)
    expect(days[0]?.getDay()).toBe(1)
    expect(days[0]?.getDate()).toBe(19)
    expect(days[6]?.getDate()).toBe(25)
  })
})

describe('yearCalendar', () => {
  it('lays the year out in Monday-first weeks', () => {
    const { weeks, months } = yearCalendar(dayTotals([session(at(9, 22), 12)]), 2026, at(9, 22, 0))
    // 1 January 2026 is a Thursday: three empty cells first.
    expect(weeks[0]?.slice(0, 3)).toEqual([null, null, null])
    expect(weeks[0]?.[3]?.key).toBe('2026-01-01')
    expect(weeks.flat().filter(Boolean)).toHaveLength(365)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(months).toHaveLength(12)
    expect(months[0]).toEqual({ month: 0, column: 0 })
    const days = weeks.flat()
    const today = days.find((d) => d?.today)
    expect(today?.key).toBe('2026-10-22')
    expect(today?.minutes).toBe(12)
    expect(days.find((d) => d?.key === '2026-10-23')?.future).toBe(true)
  })
})

describe('topBooks', () => {
  it('names the most-read books and groups the rest', () => {
    const sessions = [
      session(at(1, 1), 30, { book: 'a' }),
      session(at(1, 2), 20, { book: 'b' }),
      session(at(1, 3), 5, { book: 'c' }),
      session(at(1, 4), 5, { book: 'd' }),
    ]
    expect(topBooks(sessions, 2)).toEqual([
      { book: 'a', minutes: 30 },
      { book: 'b', minutes: 20 },
      { book: null, minutes: 10 },
    ])
    expect(topBooks(sessions, 4)).toHaveLength(4)
  })
})
