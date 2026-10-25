// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  dayKey,
  formatAgo,
  formatSince,
  formatDay,
  formatIdentifier,
  formatMinutes,
  formatPublished,
  formatSeries,
  formatTimeLeft,
  pluralize,
} from './format'
import { guessFromFileName, htmlToParagraphs, matchesQuery, titleSortKey } from './text'

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

  it('formats series positions', () => {
    expect(formatSeries('The Expanse', 2)).toBe('Book 2 in The Expanse')
    expect(formatSeries('The Expanse', 2.5)).toBe('Book 2.5 in The Expanse')
    expect(formatSeries('The Expanse', null)).toBe('The Expanse')
    expect(formatSeries('The Expanse', 0)).toBe('The Expanse')
  })

  it('formats publication dates, falling back to the year', () => {
    expect(formatPublished('1871')).toBe('1871')
    expect(formatPublished('2003-01-01T00:00:00+00:00')).toBe('2003')
    expect(formatPublished('2003-05')).toBe('2003')
    expect(formatPublished('2003-05-14')).toBe(
      new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(2003, 4, 14),
      ),
    )
    expect(formatPublished('Spring, 1920')).toBe('Spring, 1920')
  })

  it('shows identifiers readers care about', () => {
    expect(formatIdentifier('urn:isbn:9780141439518')).toBe('ISBN 9780141439518')
    expect(formatIdentifier('978-0-14-143951-8')).toBe('ISBN 978-0-14-143951-8')
    expect(formatIdentifier('urn:uuid:7c1e0a3e-1111-4c4c-9a9a-123456789abc')).toBeNull()
    expect(formatIdentifier('3c1e0a3e-1111-4c4c-9a9a-123456789abc')).toBeNull()
    expect(formatIdentifier('https://standardebooks.org/ebooks/jane-austen/emma')).toBe(
      'https://standardebooks.org/ebooks/jane-austen/emma',
    )
  })

  it('pluralizes', () => {
    expect(pluralize(1, 'book')).toBe('1 book')
    expect(pluralize(2, 'book')).toBe('2 books')
    expect(pluralize(2, 'library', 'libraries')).toBe('2 libraries')
  })
})

describe('text', () => {
  it('splits descriptions into paragraphs', () => {
    expect(htmlToParagraphs('<p>One <i>two</i>.</p><p>Three.</p>')).toEqual(['One two.', 'Three.'])
    expect(htmlToParagraphs('First line<br>second<br/><br>third')).toEqual([
      'First line',
      'second',
      'third',
    ])
    expect(htmlToParagraphs('Plain text\nwrapped.\n\nNext paragraph.')).toEqual([
      'Plain text wrapped.',
      'Next paragraph.',
    ])
    expect(htmlToParagraphs('   ')).toEqual([])
  })

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

describe('formatSince', () => {
  const now = new Date(2026, 9, 25, 15, 30).getTime()

  it('counts minutes, then names the day', () => {
    expect(formatSince(now - 20_000, now)).toBe('just now')
    expect(formatSince(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(formatSince(new Date(2026, 9, 25, 9, 5).getTime(), now)).toMatch(/^today at /)
    expect(formatSince(new Date(2026, 9, 24, 9, 5).getTime(), now)).toMatch(/^yesterday at /)
  })
})
