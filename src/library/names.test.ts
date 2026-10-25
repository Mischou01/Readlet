import { describe, expect, it } from 'vitest'
import {
  authorKey,
  authorsToSave,
  knownAuthors,
  knownSeries,
  matchSeries,
  seriesToSave,
  suggestAuthors,
  suggestSeries,
} from './names'

const books = [
  { series: 'Red Rising', seriesIndex: 1 },
  { series: 'Red Rising', seriesIndex: 3 },
  { series: 'red  rising', seriesIndex: 2 },
  { series: 'The Expanse', seriesIndex: 2.5 },
  { series: 'Rising Tide', seriesIndex: null },
  { series: null, seriesIndex: null },
]
const known = knownSeries(books)

describe('knownSeries', () => {
  it('gathers spellings under the most used one, with the next number', () => {
    expect(known).toEqual([
      { name: 'The Expanse', next: 3 },
      { name: 'Red Rising', next: 4 },
      { name: 'Rising Tide', next: 1 },
    ])
  })
})

describe('matching typed series', () => {
  it('ignores capitals, spacing and a leading article', () => {
    expect(matchSeries(' RED rising ', known)?.name).toBe('Red Rising')
    expect(matchSeries('expanse', known)?.name).toBe('The Expanse')
    expect(matchSeries('Red', known)).toBeNull()
    expect(matchSeries('  ', known)).toBeNull()
  })

  it('suggests series containing the text, those starting with it first', () => {
    expect(suggestSeries('ris', known).map((s) => s.name)).toEqual(['Rising Tide', 'Red Rising'])
    expect(suggestSeries('', known)).toEqual([])
    expect(suggestSeries('Discworld', known)).toEqual([])
  })

  it('suggests nothing once a series is named exactly, its spelling when not', () => {
    expect(suggestSeries('Red Rising', known)).toEqual([])
    expect(suggestSeries('red rising', known).map((s) => s.name)).toEqual(['Red Rising'])
  })

  it('saves the library’s spelling of a series it has', () => {
    expect(seriesToSave('red rising', known)).toBe('Red Rising')
    expect(seriesToSave(' Discworld  ', known)).toBe('Discworld')
  })
})

describe('matching typed authors', () => {
  const authors = knownAuthors([
    { authors: ['J. R. R. Tolkien'] },
    { authors: ['J. R. R. Tolkien', 'Christopher Tolkien'] },
    { authors: ['J.R.R. Tolkien'] },
    { authors: ['Charlotte Brontë'] },
    { authors: ['Martin Luther King, Jr.'] },
  ])

  it('gathers spellings under the most used one', () => {
    expect(authors).toEqual([
      'J. R. R. Tolkien',
      'Christopher Tolkien',
      'Charlotte Brontë',
      'Martin Luther King, Jr.',
    ])
  })

  it('ignores punctuation, accents and "Surname, Given names" order', () => {
    expect(authorKey('Tolkien, J.R.R.')).toBe(authorKey('J. R. R. Tolkien'))
    expect(authorKey('charlotte bronte')).toBe(authorKey('Charlotte Brontë'))
    expect(authorKey('Martin Luther King, Jr.')).toBe(authorKey('Martin Luther King Jr'))
    expect(authorKey('Christopher Tolkien')).not.toBe(authorKey('J. R. R. Tolkien'))
  })

  it('suggests authors containing the text, at the start of a word first', () => {
    expect(suggestAuthors('tolk', authors)).toEqual(['J. R. R. Tolkien', 'Christopher Tolkien'])
    expect(suggestAuthors('ar', authors)).toEqual(['Charlotte Brontë', 'Martin Luther King, Jr.'])
    expect(suggestAuthors('Tolkien, J.R.R.', authors)).toEqual(['J. R. R. Tolkien'])
    expect(suggestAuthors('J. R. R. Tolkien', authors)).toEqual([])
  })

  it('saves each line in the library’s spelling', () => {
    expect(authorsToSave('tolkien, j r r\n Someone  New ', authors)).toBe(
      'J. R. R. Tolkien\nSomeone New',
    )
  })
})
