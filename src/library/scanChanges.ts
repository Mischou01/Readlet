// What a scan of the books folder changed, as the reader sees it: books are matched by
// fingerprint, so a renamed or moved file is neither new nor gone.

import { pluralize } from '../lib/format'
import { bookTitle } from '../lib/text'
import type { BookEntry } from '../lib/types'

export interface ScanChanges {
  added: BookEntry[]
  removed: BookEntry[]
}

const MAX_TITLE = 48

export function scanChanges(
  before: Record<string, BookEntry>,
  after: Record<string, BookEntry>,
): ScanChanges {
  return {
    added: Object.values(after).filter((b) => !(b.fingerprint in before)),
    removed: Object.values(before).filter((b) => !(b.fingerprint in after)),
  }
}

function quoted(book: BookEntry): string {
  const title = bookTitle(book)
  return `“${title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title}”`
}

/**
 * The toast after a scan. Scans the reader asked for always get an answer; automatic ones (the
 * folder changed, the app started) only speak up when books came or went.
 */
export function scanMessage({ added, removed }: ScanChanges, requested: boolean): string | null {
  if (added.length && removed.length) {
    return `${pluralize(added.length, 'new book')}, ${removed.length.toLocaleString()} removed`
  }
  const [onlyAdded] = added.length === 1 ? added : []
  if (onlyAdded) return `New in your library: ${quoted(onlyAdded)}`
  if (added.length) return `${pluralize(added.length, 'new book')} in your library`
  const [onlyRemoved] = removed.length === 1 ? removed : []
  if (onlyRemoved) return `${quoted(onlyRemoved)} is no longer in your books folder`
  if (removed.length) {
    return `${pluralize(removed.length, 'book')} are no longer in your books folder`
  }
  return requested ? 'No new or removed books' : null
}
