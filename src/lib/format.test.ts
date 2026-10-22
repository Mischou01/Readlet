import { describe, expect, it } from 'vitest'
import { dayKey, formatAgo, formatDay, formatMinutes, formatTimeLeft, pluralize } from './format'
import { guessFromFileName, matchesQuery, titleSortKey } from './text'

const now = new Date(2026, 9, 22, 15).getTime()

describe('format', () => {
  it('formats minutes', () => {
    expect(formatMinutes(0.4)).toBe('0 min')
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(65)).toBe('1 h 5 min')
    expect(formatTimeLeft(0.5, 'chapter')).toBe('Less than a minute left in chapter')
    expect(formatTimeLeft(9.2, 'book')).toBe('10 min left in book')
  })

  it('formats days relative to today', () => {
    expect(formatDay(now - 3_600_000, now)).toBe('Today')
    expect(formatDay(new Date(2026, 9, 21, 23).getTime(), now)).toBe('Yesterday')
    expect(formatAgo(new Date(2026, 9, 12).getTime(), now)).toBe('a week ago')
    expect(formatAgo(new Date(2026, 9, 19).getTime(), now)).toBe('3 days ago')
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05')
  })

  it('pluralizes', () => {
    expect(pluralize(1, 'book')).toBe('1 book')
    expect(pluralize(2, 'book')).toBe('2 books')
    expect(pluralize(2, 'library', 'libraries')).toBe('2 libraries')
  })
})

describe('text', () => {
  it('guesses author and title from file names', () => {
    expect(guessFromFileName('Fiction/Ursula K. Le Guin - The Dispossessed.epub')).toEqual({
      author: 'Ursula K. Le Guin',
      title: 'The Dispossessed',
    })
    expect(guessFromFileName('my_book.fb2.zip')).toEqual({ title: 'my book', author: null })
  })

  it('searches without regard to case or accents', () => {
    expect(matchesQuery('Les Misérables', 'miserables')).toBe(true)
    expect(matchesQuery('Emma', '  ')).toBe(true)
    expect(matchesQuery('Emma', 'dune')).toBe(false)
    expect(titleSortKey('The Waves')).toBe('waves')
  })
})
