// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { entry } from '../test/fixtures'
import {
  detailsForm,
  detailsPatch,
  differences,
  foundForm,
  parseSeriesIndex,
  searchQueryFor,
} from './details'

describe('detailsPatch', () => {
  const book = entry({
    authors: ['Tolkien, J. R. R.'],
    series: 'The Lord of the Rings',
    seriesIndex: 2,
    description: '<p>Frodo &amp; Sam</p><p>go on.</p>',
  })
  const initial = detailsForm(book)

  it('round-trips the book into the form', () => {
    expect(initial.authors).toBe('Tolkien, J. R. R.')
    expect(initial.seriesIndex).toBe('2')
    expect(initial.description).toBe('Frodo & Sam\n\ngo on.')
  })

  it('sends only the fields that changed', () => {
    expect(detailsPatch(initial, initial)).toEqual({})
    expect(detailsPatch(initial, { ...initial, title: '  The Two Towers ' })).toEqual({
      title: 'The Two Towers',
    })
  })

  it('splits authors by line and blanks emptied fields', () => {
    const form = { ...initial, authors: 'J. R. R. Tolkien\n\n Christopher Tolkien ', series: ' ' }
    expect(detailsPatch(initial, form)).toEqual({
      authors: ['J. R. R. Tolkien', 'Christopher Tolkien'],
      series: null,
    })
    expect(detailsPatch(initial, { ...initial, authors: '' })).toEqual({ authors: null })
  })

  it('turns typed paragraphs back into escaped HTML', () => {
    const form = { ...initial, description: 'A <b> & C\n\n\nNext  one' }
    expect(detailsPatch(initial, form).description).toBe(
      '<p>A &lt;b&gt; &amp; C</p><p>Next one</p>',
    )
  })
})

describe('parseSeriesIndex', () => {
  it('reads whole, decimal and comma numbers', () => {
    expect(parseSeriesIndex(' 3 ')).toBe(3)
    expect(parseSeriesIndex('2,5')).toBe(2.5)
    expect(parseSeriesIndex('')).toBeNull()
    expect(parseSeriesIndex('two')).toBeNaN()
  })
})

describe('finding details online', () => {
  it('searches by ISBN when the book has one', () => {
    expect(searchQueryFor(entry({ identifier: 'urn:isbn:9780425285930' }))).toBe('9780425285930')
    expect(searchQueryFor(entry({ identifier: 'uuid:1234' }))).toBe(
      'Pride and Prejudice Jane Austen',
    )
  })

  it('offers only what was found and differs, without overwriting anything', () => {
    const form = detailsForm(entry({ publisher: 'Penguin' }))
    const found = foundForm(
      {
        work: 'OL1W',
        edition: 'OL1M',
        title: 'Pride and Prejudice',
        authors: ['Jane Austen'],
        year: 1813,
        publisher: null,
        cover: 7,
      },
      {
        series: null,
        seriesIndex: null,
        publisher: 'Penguin',
        published: null,
        language: 'en',
        identifier: '9780141439518',
        description: 'A novel.',
        cover: 7,
      },
    )
    expect(found.series).toBeUndefined()
    expect(found.published).toBe('1813')
    expect(differences(form, found)).toEqual(['published', 'identifier', 'description'])
    const sameIsbn = { ...form, identifier: 'urn:isbn:9780141439518' }
    expect(differences(sameIsbn, found)).toEqual(['published', 'description'])
  })
})
