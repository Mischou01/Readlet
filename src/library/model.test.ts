import { describe, expect, it } from 'vitest'
import { book, highlight } from '../test/fixtures'
import { filterBooks, pickCurrentBook, sortBooks, statusOf } from './model'

const progress = (fraction: number, updatedAt: number) => ({ cfi: 'x', fraction, updatedAt })

describe('statusOf', () => {
  it('prefers the explicit status, then infers from progress', () => {
    expect(statusOf(null)).toBe('toRead')
    expect(
      statusOf({ fingerprint: 'a', progress: progress(0.3, 1), status: null, annotations: [] }),
    ).toBe('reading')
    expect(
      statusOf({
        fingerprint: 'a',
        progress: progress(0.3, 1),
        status: { value: 'finished', updatedAt: 2 },
        annotations: [],
      }),
    ).toBe('finished')
    // Unknown values written by a newer version fall back to inference.
    expect(
      statusOf({
        fingerprint: 'a',
        progress: null,
        status: { value: 'paused', updatedAt: 2 },
        annotations: [],
      }),
    ).toBe('toRead')
  })
})

describe('toLibraryBook', () => {
  it('keeps only live highlights', () => {
    const b = book(
      {},
      {
        annotations: [
          highlight({ id: 'a' }),
          highlight({ id: 'b', deleted: true }),
          { ...highlight({ id: 'c' }), kind: 'bookmark' },
        ],
      },
    )
    expect(b.highlights.map((h) => h.id)).toEqual(['a'])
  })
})

const waves = book(
  { fingerprint: 'w', title: 'The Waves', authors: ['Virginia Woolf'], addedAt: 3 },
  { progress: progress(0.5, 50) },
)
const dune = book(
  { fingerprint: 'd', title: 'Dune', authors: ['Frank Herbert'], addedAt: 2 },
  { progress: progress(0.2, 80) },
)
const emma = book({ fingerprint: 'e', title: 'Emma', authors: ['Jane Austen'], addedAt: 1 })
const locked = book(
  { fingerprint: 'l', title: 'Locked', drm: true },
  { progress: progress(0.1, 999) },
)

describe('sortBooks', () => {
  it('sorts by title ignoring articles, by author surname, by date added and by recent reading', () => {
    expect(sortBooks([waves, dune, emma], 'title').map((b) => b.title)).toEqual([
      'Dune',
      'Emma',
      'The Waves',
    ])
    expect(sortBooks([waves, dune, emma], 'author').map((b) => b.fingerprint)).toEqual([
      'e',
      'd',
      'w',
    ])
    expect(sortBooks([emma, dune, waves], 'added').map((b) => b.fingerprint)).toEqual([
      'w',
      'd',
      'e',
    ])
    expect(sortBooks([emma, waves, dune], 'recent').map((b) => b.fingerprint)).toEqual([
      'd',
      'w',
      'e',
    ])
  })
})

describe('filterBooks', () => {
  it('filters by tab, shelf and query', () => {
    const books = [waves, dune, emma]
    expect(filterBooks(books, { tab: 'reading', query: '', shelf: null })).toHaveLength(2)
    expect(filterBooks(books, { tab: 'toRead', query: '', shelf: null })).toEqual([emma])
    expect(filterBooks(books, { tab: 'all', query: 'woolf', shelf: null })).toEqual([waves])
    const shelf = { id: 's', name: 'Classics', books: ['e'], updatedAt: 0 }
    expect(filterBooks(books, { tab: 'all', query: '', shelf })).toEqual([emma])
  })
})

describe('pickCurrentBook', () => {
  it('picks the most recently read unfinished book that can be opened', () => {
    expect(pickCurrentBook([waves, dune, emma, locked])?.fingerprint).toBe('d')
    expect(pickCurrentBook([emma])).toBeNull()
  })
})
