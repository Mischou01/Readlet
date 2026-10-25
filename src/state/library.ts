// The books (from the index) and their reading data (from the store), kept in step with the
// Rust core's events.

import { useMemo } from 'react'
import { create } from 'zustand'
import { api, toAppError } from '../lib/ipc'
import type {
  AppError,
  BookEntry,
  BookRecord,
  ElsewhereBook,
  ReadingStatus,
  ScanReport,
  Shelf,
} from '../lib/types'
import { joinElsewhere, joinLibrary, type LibraryBook } from '../library/model'
import { scanChanges, scanMessage } from '../library/scanChanges'
import { showError, useToasts } from './toasts'

interface LibraryState {
  books: Record<string, BookEntry>
  /** Books other devices have; those this one has too are left out where they're shown. */
  elsewhere: Record<string, ElsewhereBook>
  records: Record<string, BookRecord>
  shelves: Shelf[]
  loaded: boolean
  scanning: boolean
  /** The reader asked for the scan in progress, so its result gets reported even if empty. */
  rescanRequested: boolean
  lastScan: ScanReport | null
  error: AppError | null
  load: () => Promise<void>
  reset: () => void
  refreshBooks: () => Promise<void>
  refreshRecords: (fingerprints?: string[]) => Promise<void>
  /** Reloads some books, whose edited details may have changed on another device. */
  refreshBooksById: (fingerprints: string[]) => Promise<void>
  refreshShelves: () => Promise<void>
  refreshElsewhere: () => Promise<void>
  putBook: (entry: BookEntry) => void
  putRecord: (record: BookRecord) => void
  /** Drops books the reader deleted (see `expectDeleted`). */
  removeBooks: (fingerprints: string[]) => void
  setScanning: (scanning: boolean) => void
  /** Scans the folder because the reader asked to, and reports what changed. */
  rescan: () => void
  /** Reports which books came or went since the last scan. */
  scanFinished: (report: ScanReport) => Promise<void>
  setStatus: (fingerprint: string, status: ReadingStatus) => Promise<void>
  setShelves: (shelves: Shelf[]) => void
}

/** Files Readlet just copied into the folder and already announced ("Added 2 books"). */
const announcedFiles = new Set<string>()

/** Books the reader is deleting, so no scan announces them as gone. */
const deletedBooks = new Set<string>()

/**
 * Keeps scans from announcing these books as gone: the reader is deleting them. Call before
 * deleting (the folder watcher may scan before the deletion reports back), and again with
 * `false` for any that weren't deleted after all.
 */
export function expectDeleted(fingerprints: string[], expected = true) {
  for (const fp of fingerprints) {
    if (expected) deletedBooks.add(fp)
    else deletedBooks.delete(fp)
  }
}

/** Keeps the next scan from announcing these files (names in the folder) a second time. */
export function expectAddedFiles(names: string[]) {
  for (const name of names) announcedFiles.add(name)
}

function byFingerprint<T extends { fingerprint: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.fingerprint, item]))
}

export const useLibrary = create<LibraryState>((set, get) => ({
  books: {},
  elsewhere: {},
  records: {},
  shelves: [],
  loaded: false,
  scanning: true,
  rescanRequested: false,
  lastScan: null,
  error: null,
  load: async () => {
    try {
      const [books, records, shelves, elsewhere] = await Promise.all([
        api.listBooks(),
        api.listRecords(),
        api.listShelves(),
        // Other devices' books are a bonus: the library opens without them.
        api.listElsewhereBooks().catch((e: unknown) => {
          console.warn('listing other devices’ books failed', toAppError(e))
          return []
        }),
      ])
      set({
        books: byFingerprint(books),
        elsewhere: byFingerprint(elsewhere),
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
    set({
      books: {},
      elsewhere: {},
      records: {},
      shelves: [],
      loaded: false,
      scanning: true,
      rescanRequested: false,
      lastScan: null,
    }),
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
  refreshBooksById: async (fingerprints) => {
    const fresh = await api.getBooks(fingerprints)
    set((s) => ({ books: { ...s.books, ...byFingerprint(fresh) } }))
  },
  refreshShelves: async () => set({ shelves: await api.listShelves() }),
  refreshElsewhere: async () => set({ elsewhere: byFingerprint(await api.listElsewhereBooks()) }),
  putBook: (entry) => set((s) => ({ books: { ...s.books, [entry.fingerprint]: entry } })),
  putRecord: (record) => set((s) => ({ records: { ...s.records, [record.fingerprint]: record } })),
  removeBooks: (fingerprints) => {
    set((s) => {
      const books = { ...s.books }
      for (const fp of fingerprints) delete books[fp]
      return { books }
    })
  },
  setScanning: (scanning) => set({ scanning }),
  rescan: () => {
    set({ scanning: true, rescanRequested: true })
    useToasts.getState().show({ message: 'Looking for new books' })
    api.rescanLibrary().catch((e: unknown) => {
      set({ scanning: false, rescanRequested: false })
      showError(`Couldn’t look for new books: ${toAppError(e).message}`)
    })
  },
  scanFinished: async (report) => {
    const { books: before, loaded, rescanRequested: requested } = get()
    set({ scanning: false, rescanRequested: false, lastScan: report })
    await get().refreshBooks()
    // The first scan of a new folder finds everything; that isn't news.
    if (!requested && (!loaded || Object.keys(before).length === 0)) return
    const changes = scanChanges(before, get().books)
    changes.added = changes.added.filter(
      (b) => !announcedFiles.delete(b.path.split('/').pop() ?? b.path),
    )
    changes.removed = changes.removed.filter((b) => !deletedBooks.has(b.fingerprint))
    // A deleted book that's back (restored from the trash) is news again.
    for (const fp of Object.keys(get().books)) deletedBooks.delete(fp)
    const message = scanMessage(changes, requested)
    if (message) useToasts.getState().show({ message })
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

/** The books only other devices have, joined with their reading data. */
export function useElsewhereBooks(): LibraryBook[] {
  const books = useLibrary((s) => s.books)
  const elsewhere = useLibrary((s) => s.elsewhere)
  const records = useLibrary((s) => s.records)
  return useMemo(() => joinElsewhere(elsewhere, books, records), [elsewhere, books, records])
}

/**
 * This device's books and the other devices', for what reading data shows wherever it was
 * read: stats and highlights. The library itself keeps the two apart.
 */
export function useAllBooks(): LibraryBook[] {
  const local = useLibraryBooks()
  const elsewhere = useElsewhereBooks()
  return useMemo(() => [...local, ...elsewhere], [local, elsewhere])
}

/** One book, wherever it is (`elsewhere` says when it's only on other devices). */
export function useLibraryBook(fingerprint: string | undefined): LibraryBook | null {
  const books = useAllBooks()
  return useMemo(
    () => books.find((b) => b.fingerprint === fingerprint) ?? null,
    [books, fingerprint],
  )
}

export function useVisibleShelves(): Shelf[] {
  const shelves = useLibrary((s) => s.shelves)
  return useMemo(() => shelves.filter((s) => !s.deleted), [shelves])
}
