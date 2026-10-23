// Which bookmarks belong to the page on screen. Pure, covered by bookmarks.test.tsx.

import type { Annotation } from '../lib/types'
import { collapseCFI, compareCFI } from './foliate'

/**
 * The bookmarks on the page whose visible text is `pageCfi` (a range CFI). A bookmark marks the
 * start of a page, so a page owns the bookmarks from its start up to, but not including, its end:
 * when a paragraph runs over a page break, one page's end is exactly the next page's start, and a
 * bookmark there belongs to the later page only. Fixed layouts (PDF, comics) give each page a single
 * position, which its bookmarks equal.
 */
export function bookmarksOnPage(
  bookmarks: Annotation[],
  pageCfi: string | undefined,
): Annotation[] {
  if (!pageCfi) return []
  try {
    const start = collapseCFI(pageCfi)
    const end = collapseCFI(pageCfi, true)
    const singlePosition = compareCFI(start, end) === 0
    return bookmarks.filter((b) => {
      const fromStart = compareCFI(b.cfi, start)
      if (singlePosition) return fromStart === 0
      return fromStart >= 0 && compareCFI(b.cfi, end) < 0
    })
  } catch {
    return []
  }
}
