// Which positions belong to the page on screen, and book order. Pure, covered by
// bookmarks.test.tsx.

import type { Annotation } from '../lib/types'
import { collapseCFI, compareCFI } from './foliate'

/**
 * Whether the position `cfi` is on the page whose visible text is `pageCfi` (a range CFI). A page
 * owns the positions from its start up to, but not including, its end: when a paragraph runs over
 * a page break, one page's end is exactly the next page's start, and a position there belongs to
 * the later page only. Fixed layouts (PDF, comics) give each page a single position, which the
 * positions on it equal.
 */
export function isOnPage(cfi: string, pageCfi: string | undefined): boolean {
  if (!pageCfi) return false
  try {
    const start = collapseCFI(pageCfi)
    const end = collapseCFI(pageCfi, true)
    const fromStart = compareCFI(cfi, start)
    if (compareCFI(start, end) === 0) return fromStart === 0
    return fromStart >= 0 && compareCFI(cfi, end) < 0
  } catch {
    return false
  }
}

/** The bookmarks on the page whose visible text is `pageCfi`; a bookmark marks a page's start. */
export function bookmarksOnPage(
  bookmarks: Annotation[],
  pageCfi: string | undefined,
): Annotation[] {
  return bookmarks.filter((b) => isOnPage(b.cfi, pageCfi))
}

/**
 * Bookmarks or highlights in the order they come in the book (they're stored in the order they
 * were made). Where a position can't be read, the fraction of the book stands in.
 */
export function inBookOrder(annotations: readonly Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => {
    try {
      const order = compareCFI(a.cfi, b.cfi)
      if (order) return order
    } catch {
      const order = (a.fraction ?? 0) - (b.fraction ?? 0)
      if (order) return order
    }
    return a.createdAt - b.createdAt
  })
}
