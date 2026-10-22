import { describe, expect, it } from 'vitest'
import { entry } from '../test/fixtures'
import { scanChanges, scanMessage } from './scanChanges'

const pride = entry()
const emma = entry({ fingerprint: 'fp-2', title: 'Emma', path: 'Emma.epub' })
const persuasion = entry({ fingerprint: 'fp-3', title: 'Persuasion', path: 'Persuasion.epub' })
const books = (...list: (typeof pride)[]) => Object.fromEntries(list.map((b) => [b.fingerprint, b]))

describe('scanChanges', () => {
  it('finds books that came and went', () => {
    const changes = scanChanges(books(pride, emma), books(pride, persuasion))
    expect(changes.added).toEqual([persuasion])
    expect(changes.removed).toEqual([emma])
  })

  it('treats a moved or renamed file as the same book', () => {
    const moved = { ...emma, path: 'Austen/Emma (1815).epub' }
    expect(scanChanges(books(emma), books(moved))).toEqual({ added: [], removed: [] })
  })
})

describe('scanMessage', () => {
  it('names a single new or removed book', () => {
    expect(scanMessage({ added: [emma], removed: [] }, false)).toBe('New in your library: “Emma”')
    expect(scanMessage({ added: [], removed: [emma] }, false)).toBe(
      '“Emma” is no longer in your books folder',
    )
  })

  it('counts several, and both kinds together', () => {
    expect(scanMessage({ added: [emma, persuasion], removed: [] }, false)).toBe(
      '2 new books in your library',
    )
    expect(scanMessage({ added: [], removed: [emma, persuasion] }, false)).toBe(
      '2 books are no longer in your books folder',
    )
    expect(scanMessage({ added: [emma], removed: [pride] }, false)).toBe('1 new book, 1 removed')
  })

  it('falls back to the file name for books without metadata yet', () => {
    const fresh = entry({ fingerprint: 'fp-9', title: null, path: 'shelf/Middlemarch.epub' })
    expect(scanMessage({ added: [fresh], removed: [] }, false)).toBe(
      'New in your library: “Middlemarch”',
    )
  })

  it('only answers a scan with no changes when the reader asked for it', () => {
    expect(scanMessage({ added: [], removed: [] }, true)).toBe('No new or removed books')
    expect(scanMessage({ added: [], removed: [] }, false)).toBeNull()
  })
})
