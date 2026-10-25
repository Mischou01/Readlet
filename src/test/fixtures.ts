// Builders for test data. Only used by *.test.ts files.

import type { Annotation, BookEntry, BookRecord, Session } from '../lib/types'
import { toLibraryBook, type LibraryBook } from '../library/model'

export function entry(overrides: Partial<BookEntry> = {}): BookEntry {
  return {
    fingerprint: 'fp-1',
    path: 'Jane Austen - Pride and Prejudice.epub',
    format: 'epub',
    size: 1000,
    drm: false,
    addedAt: 1_000,
    modifiedAt: 1_000,
    metadataReady: true,
    metadataError: null,
    title: 'Pride and Prejudice',
    authors: ['Jane Austen'],
    series: null,
    seriesIndex: null,
    language: 'en',
    publisher: null,
    published: null,
    description: null,
    identifier: null,
    edited: [],
    coverVersion: null,
    palette: null,
    ...overrides,
  }
}

export function highlight(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'h1',
    kind: 'highlight',
    cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:10)',
    text: 'It is a truth universally acknowledged',
    color: 'butter',
    createdAt: Date.UTC(2026, 9, 1),
    updatedAt: Date.UTC(2026, 9, 1),
    ...overrides,
  }
}

export function record(fingerprint: string, overrides: Partial<BookRecord> = {}): BookRecord {
  return { fingerprint, progress: null, status: null, annotations: [], ...overrides }
}

export function book(
  entryOverrides: Partial<BookEntry> = {},
  recordOverrides: Partial<BookRecord> = {},
): LibraryBook {
  const e = entry(entryOverrides)
  return toLibraryBook(e, record(e.fingerprint, recordOverrides))
}

/** A session of `minutes` active reading that starts at `start` (local time). */
export function session(start: Date, minutes: number, overrides: Partial<Session> = {}): Session {
  return {
    id: `s-${start.getTime()}-${overrides.book ?? 'fp-1'}`,
    book: 'fp-1',
    start: start.getTime(),
    end: start.getTime() + minutes * 60_000,
    activeMs: minutes * 60_000,
    startFraction: 0,
    endFraction: 0.1,
    words: 0,
    ...overrides,
  }
}
