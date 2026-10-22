// Changes to shelves and reading status, for one book or several at once.

import { pluralize } from '../lib/format'
import { api, toAppError } from '../lib/ipc'
import type { ReadingStatus, Shelf } from '../lib/types'
import { useLibrary } from '../state/library'
import { usePreferences } from '../state/preferences'
import { showError, useToasts } from '../state/toasts'

/** Saves a shelf; false if that failed (the reader has been told). */
export async function saveShelf(shelf: { id: string; name: string; books: string[] }) {
  try {
    useLibrary.getState().setShelves(await api.putShelf(shelf))
    return true
  } catch (e) {
    showError(toAppError(e).message)
    return false
  }
}

export async function deleteShelf(shelf: Shelf) {
  try {
    useLibrary.getState().setShelves(await api.deleteShelf(shelf.id))
    usePreferences.getState().update({ library: { shelf: null } })
  } catch (e) {
    showError(toAppError(e).message)
  }
}

export function shelfHasAll(shelf: Shelf, fingerprints: readonly string[]): boolean {
  return fingerprints.length > 0 && fingerprints.every((fp) => shelf.books.includes(fp))
}

/** Puts the books on the shelf, or takes them all off if they're all on it already. */
export async function toggleShelf(shelf: Shelf, fingerprints: readonly string[]) {
  const remove = shelfHasAll(shelf, fingerprints)
  const books = remove
    ? shelf.books.filter((fp) => !fingerprints.includes(fp))
    : [...shelf.books, ...fingerprints.filter((fp) => !shelf.books.includes(fp))]
  const saved = await saveShelf({ id: shelf.id, name: shelf.name, books })
  if (saved && fingerprints.length > 1) {
    const count = pluralize(fingerprints.length, 'book')
    useToasts.getState().show({
      message: remove ? `Took ${count} off “${shelf.name}”` : `Put ${count} on “${shelf.name}”`,
    })
  }
  return saved
}

export async function setStatusOf(fingerprints: readonly string[], status: ReadingStatus) {
  const { setStatus } = useLibrary.getState()
  const results = await Promise.allSettled(fingerprints.map((fp) => setStatus(fp, status)))
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) showError(toAppError(failed.reason).message)
  return !failed
}
