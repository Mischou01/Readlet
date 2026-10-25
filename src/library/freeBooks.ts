// Finding books online: which results are already in the library, and where else to look.
// Pure, covered by freeBooks.test.ts.

import type { FreeBook } from '../lib/types'
import type { LibraryBook } from './model'

/** Lowercase letters and digits only, so "Pride & Prejudice" matches "Pride and Prejudice". */
function key(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\band\b/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Whether the library has this book: the same title, by the same author when both say. The
 * fingerprint can't be known before downloading, so this goes by title and author.
 */
export function inLibrary(book: FreeBook, library: readonly LibraryBook[]): boolean {
  const title = key(book.title)
  const author = book.author ? key(book.author) : null
  return library.some(
    (b) =>
      key(b.title) === title &&
      (!author || b.authors.length === 0 || b.authors.some((a) => key(a) === author)),
  )
}

export interface StoreLink {
  name: string
  url: string
  note: string
}

/**
 * Stores to try when no free edition turns up: plain links, no affiliate codes. Readlet can't
 * tell whether a store's copy is DRM-free (docs/ONLINE.md), so each says what it can.
 */
export function storeLinks(query: string): StoreLink[] {
  const q = encodeURIComponent(query.trim())
  return [
    {
      name: 'Kobo',
      url: `https://www.kobo.com/search?query=${q}`,
      note: 'Shows “DRM-Free” near the bottom of a book’s page',
    },
    {
      name: 'Baen',
      url: `https://www.baen.com/catalogsearch/result/?q=${q}`,
      note: 'Its own science fiction and fantasy, all DRM-free',
    },
    {
      name: 'Weightless Books',
      url: `https://weightlessbooks.com/?s=${q}`,
      note: 'Only DRM-free books',
    },
    {
      name: 'Smashwords',
      url: 'https://www.smashwords.com/',
      note: 'Mostly independent authors, DRM-free',
    },
    {
      name: 'Libreture',
      url: 'https://libreture.com/bookshops/',
      note: 'A directory of DRM-free bookshops',
    },
  ]
}
