// The books (from the index) and their reading data (from the store), kept in step with the
// Rust core's events.

import { useMemo } from 'react'
import { create } from 'zustand'
import { api, toAppError } from '../lib/ipc'
import type {
  AppError,
  BookEntry,
  BookRecord,
  ReadingStatus,
  ScanReport,
  Shelf,
} from '../lib/types'
import { joinLibrary, type LibraryBook } from '../library/model'

interface LibraryState {
  books: Record<string, BookEntry>
  records: Record<string, BookRecord>
  shelves: Shelf[]
  loaded: boolean
  scanning: boolean
  lastScan: ScanReport | null
  error: AppError | null
  load: () => Promise<void>
  reset: () => void
  refreshBooks: () => Promise<void>
  refreshRecords: (fingerprints?: string[]) => Promise<void>
  refreshShelves: () => Promise<void>
  putBook: (entry: BookEntry) => void
  putRecord: (record: BookRecord) => void
  setScanning: (scanning: boolean) => void
  scanFinished: (report: ScanReport) => Promise<void>
  setStatus: (fingerprint: string, status: ReadingStatus) => Promise<void>
  setShelves: (shelves: Shelf[]) => void
}

function byFingerprint<T extends { fingerprint: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.fingerprint, item]))
}

export const useLibrary = create<LibraryState>((set, get) => ({
  books: {},
  records: {},
  shelves: [],
  loaded: false,
  scanning: true,
  lastScan: null,
  error: null,
  load: async () => {
    try {
      const [books, records, shelves] = await Promise.all([
        api.listBooks(),
        api.listRecords(),
        api.listShelves(),
      ])
      set({
        books: byFingerprint(books),
        records: byFingerprint(records),
        shelves,
        loaded: true,
        error: null,
      })
    } catch (e) {
      set({ error: toAppError(e), loaded: true })
    }
  },
  reset: () =>
    set({ books: {}, records: {}, shelves: [], loaded: false, scanning: true, lastScan: null }),
  refreshBooks: async () => {
    const books = await api.listBooks()
    set({ books: byFingerprint(books) })
  },
  refreshRecords: async (fingerprints) => {
    if (!fingerprints) {
      const records = await api.listRecords()
      set({ records: byFingerprint(records) })
      return
    }
    const fresh = await Promise.all(fingerprints.map((fp) => api.getRecord(fp)))
    set((s) => ({ records: { ...s.records, ...byFingerprint(fresh) } }))
  },
  refreshShelves: async () => set({ shelves: await api.listShelves() }),
  putBook: (entry) => set((s) => ({ books: { ...s.books, [entry.fingerprint]: entry } })),
  putRecord: (record) => set((s) => ({ records: { ...s.records, [record.fingerprint]: record } })),
  setScanning: (scanning) => set({ scanning }),
  scanFinished: async (report) => {
    set({ scanning: false, lastScan: report })
    await get().refreshBooks()
  },
  setStatus: async (fingerprint, status) => {
    get().putRecord(await api.setStatus(fingerprint, status))
  },
  setShelves: (shelves) => set({ shelves }),
}))

/** Every book joined with its reading data. */
export function useLibraryBooks(): LibraryBook[] {
  const books = useLibrary((s) => s.books)
  const records = useLibrary((s) => s.records)
  return useMemo(() => joinLibrary(books, records), [books, records])
}

export function useLibraryBook(fingerprint: string | undefined): LibraryBook | null {
  const books = useLibraryBooks()
  return useMemo(
    () => books.find((b) => b.fingerprint === fingerprint) ?? null,
    [books, fingerprint],
  )
}

export function useVisibleShelves(): Shelf[] {
  const shelves = useLibrary((s) => s.shelves)
  return useMemo(() => shelves.filter((s) => !s.deleted), [shelves])
}
