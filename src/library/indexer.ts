// Metadata extraction (docs/PLAN.md D8): foliate-js parses each new book in the webview, and the
// Rust core caches the result. Runs in the background after every scan.

import { create } from 'zustand'
import { api } from '../lib/ipc'
import { guessFromFileName } from '../lib/text'
import type { BookEntry } from '../lib/types'
import { extractCover, extractMetadata, fetchBookFile, loadBook } from '../reader/foliate'
import { useLibrary } from '../state/library'

/** Parsing happens on the UI thread, so keep it to a couple of books at a time. */
const CONCURRENCY = 2
const BOOK_TIMEOUT_MS = 60_000

interface IndexerState {
  running: boolean
  done: number
  total: number
}

export const useIndexer = create<IndexerState>(() => ({ running: false, done: 0, total: 0 }))

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms)
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error) => (clearTimeout(timer), reject(error)),
    )
  })
}

async function indexOne(entry: BookEntry): Promise<BookEntry> {
  const { fingerprint } = entry
  try {
    const file = await fetchBookFile(entry)
    const book = await loadBook(file)
    try {
      const metadata = extractMetadata(book, entry)
      const cover = await extractCover(book)
      await api.setBookCover(fingerprint, cover ?? new Uint8Array())
      return await api.setBookMetadata(fingerprint, metadata)
    } finally {
      book.destroy?.()
    }
  } catch (e) {
    // Record the failure so the book isn't retried on every start; it still gets a title from
    // its file name and a generated cover.
    const message = e instanceof Error ? e.message : String(e)
    const guess = guessFromFileName(entry.path)
    await api.setBookCover(fingerprint, new Uint8Array())
    return api.setBookMetadata(
      fingerprint,
      { title: guess.title, authors: guess.author ? [guess.author] : [] },
      message,
    )
  }
}

let queue: string[] = []
let active = 0

async function worker() {
  while (queue.length > 0) {
    const fingerprint = queue.shift()
    if (!fingerprint) break
    const entry = useLibrary.getState().books[fingerprint]
    if (entry && !entry.metadataReady) {
      try {
        const updated = await withTimeout(indexOne(entry), BOOK_TIMEOUT_MS)
        useLibrary.getState().putBook(updated)
      } catch (e) {
        console.warn('indexing a book failed', e)
      }
    }
    useIndexer.setState((s) => ({ done: s.done + 1 }))
    // Let the UI breathe between books.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  active -= 1
  if (active === 0) useIndexer.setState({ running: false })
}

/** Queues every book whose metadata hasn't been extracted yet. Safe to call repeatedly. */
export async function indexPendingBooks() {
  const pending = await api.booksNeedingMetadata()
  const queued = new Set(queue)
  const fresh = pending.filter((fp) => !queued.has(fp))
  if (fresh.length === 0) return
  queue.push(...fresh)
  const state = useIndexer.getState()
  useIndexer.setState(
    state.running
      ? { total: state.total + fresh.length }
      : { running: true, done: 0, total: fresh.length },
  )
  while (active < CONCURRENCY) {
    active += 1
    void worker()
  }
}

/** Drops pending work, e.g. when the library folder changes. */
export function resetIndexer() {
  queue = []
  useIndexer.setState({ done: 0, total: 0 })
}
