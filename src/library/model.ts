// The library as the UI sees it: index entries joined with reading data, plus sorting and
// filtering. Pure functions, covered by model.test.ts.

import { authorSortKey, bookAuthors, bookTitle, matchesQuery, titleSortKey } from '../lib/text'
import type { Annotation, BookEntry, BookRecord, ReadingStatus, Shelf } from '../lib/types'
import type { LibrarySort, LibraryTab } from '../state/preferences'

export interface LibraryBook {
  entry: BookEntry
  record: BookRecord | null
  fingerprint: string
  title: string
  authors: string[]
  status: ReadingStatus
  /** 0–1 */
  fraction: number
  /** When it was last read on any device (0 if never). */
  lastReadAt: number
  /** When the status last changed (e.g. when it was finished). */
  statusAt: number
  highlights: Annotation[]
}

/** Books past this point count as read to the end. */
export const FINISHED_FRACTION = 0.995

export function statusOf(record: BookRecord | null): ReadingStatus {
  const explicit = record?.status?.value
  if (explicit === 'reading' || explicit === 'toRead' || explicit === 'finished') return explicit
  return (record?.progress?.fraction ?? 0) > 0 ? 'reading' : 'toRead'
}

export function liveAnnotations(record: BookRecord | null, kind: string): Annotation[] {
  return record?.annotations.filter((a) => a.kind === kind && !a.deleted) ?? []
}

export function toLibraryBook(entry: BookEntry, record: BookRecord | null): LibraryBook {
  return {
    entry,
    record,
    fingerprint: entry.fingerprint,
    title: bookTitle(entry),
    authors: bookAuthors(entry),
    status: statusOf(record),
    fraction: record?.progress?.fraction ?? 0,
    lastReadAt: record?.progress?.updatedAt ?? 0,
    statusAt: record?.status?.updatedAt ?? 0,
    highlights: liveAnnotations(record, 'highlight'),
  }
}

export function joinLibrary(
  books: Record<string, BookEntry>,
  records: Record<string, BookRecord>,
): LibraryBook[] {
  return Object.values(books).map((entry) =>
    toLibraryBook(entry, records[entry.fingerprint] ?? null),
  )
}

const byTitle = (a: LibraryBook, b: LibraryBook) =>
  titleSortKey(a.title).localeCompare(titleSortKey(b.title))

/** Series books sort by their position when the titles otherwise tie on author. */
const bySeries = (a: LibraryBook, b: LibraryBook) =>
  seriesKey(a.entry.series).localeCompare(seriesKey(b.entry.series)) ||
  (a.entry.seriesIndex ?? Infinity) - (b.entry.seriesIndex ?? Infinity)

/** Books name the same series with different spacing or capitals; this is what they share. */
export function seriesKey(series: string | null): string {
  return titleSortKey((series ?? '').replace(/\s+/g, ' ').trim()).toLocaleLowerCase()
}

/** Finished books sink below the rest when sorting by recent reading: they're done with. */
const finishedLast = (a: LibraryBook, b: LibraryBook) =>
  Number(a.status === 'finished') - Number(b.status === 'finished')

export function sortBooks(books: LibraryBook[], sort: LibrarySort): LibraryBook[] {
  const sorted = [...books]
  switch (sort) {
    case 'recent':
      return sorted.sort(
        (a, b) =>
          finishedLast(a, b) ||
          Math.max(b.lastReadAt, b.statusAt) - Math.max(a.lastReadAt, a.statusAt) ||
          b.entry.addedAt - a.entry.addedAt ||
          byTitle(a, b),
      )
    case 'title':
      return sorted.sort(byTitle)
    case 'author':
      return sorted.sort(
        (a, b) =>
          authorSortKey(a.authors[0]).localeCompare(authorSortKey(b.authors[0])) ||
          bySeries(a, b) ||
          byTitle(a, b),
      )
    case 'series':
      return sorted.sort(
        (a, b) =>
          Number(!a.entry.series) - Number(!b.entry.series) || bySeries(a, b) || byTitle(a, b),
      )
    case 'added':
      return sorted.sort((a, b) => b.entry.addedAt - a.entry.addedAt || byTitle(a, b))
  }
}

export interface SeriesGroup {
  /** The series' name as the first of its books gives it; `null` for books in no series. */
  series: string | null
  /** For linking to the group (`seriesAnchor`). */
  key: string
  books: LibraryBook[]
}

/**
 * Books sorted by series (`sortBooks(…, 'series')`), grouped: one group per series in order, then
 * the books that aren't in one.
 */
export function groupBySeries(sorted: LibraryBook[]): SeriesGroup[] {
  const groups: SeriesGroup[] = []
  for (const book of sorted) {
    const series = book.entry.series?.replace(/\s+/g, ' ').trim() || null
    const key = series ? seriesKey(series) : ''
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.books.push(book)
    else groups.push({ series, key, books: [book] })
  }
  return groups
}

/** The element id of a series' group in the library, for scrolling to it. */
export function seriesAnchor(series: string | null): string {
  return `series-${encodeURIComponent(seriesKey(series)).replace(/%/g, '')}`
}

export interface LibraryFilter {
  tab: LibraryTab
  query: string
  shelf: Shelf | null
}

export function filterBooks(
  books: LibraryBook[],
  { tab, query, shelf }: LibraryFilter,
): LibraryBook[] {
  const onShelf = shelf ? new Set(shelf.books) : null
  return books.filter(
    (book) =>
      (tab === 'all' || book.status === tab) &&
      (!onShelf || onShelf.has(book.fingerprint)) &&
      matchesQuery([book.title, ...book.authors, book.entry.series ?? ''].join(' '), query),
  )
}

/** The book for the "continue reading" hero: the most recently read unfinished book. */
export function pickCurrentBook(books: LibraryBook[]): LibraryBook | null {
  let best: LibraryBook | null = null
  for (const book of books) {
    if (book.status !== 'reading' || book.entry.drm) continue
    if (!best || book.lastReadAt > best.lastReadAt) best = book
  }
  return best
}
