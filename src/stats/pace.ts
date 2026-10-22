// Reading pace for "time left". The personal pace learned from whole sessions
// (`updatedReadingSpeed`) is where every book starts; the time spent on each page then pulls the
// estimate toward this book's own pace, since a dense history reads much slower than a thriller.
// Pace is in bytes of book text a minute, the unit foliate-js measures position in.

/** Reading seen in one book: bytes of text read over this much time. */
export interface BookPace {
  bytes: number
  ms: number
}

/** The personal pace counts as this many minutes of reading, so a few pages can't swing it. */
const PRIOR_MINUTES = 8
/** Evidence is kept to about this much reading, so the estimate follows the reader's current pace. */
const MAX_EVIDENCE_MS = 90 * 60_000
/** Pages shown more briefly than this were flipped past, not read. */
const MIN_PAGE_MS = 3_000
/** Plausible paces (the same bounds as the personal pace). Faster is skimming. */
const MIN_PACE = 300
const MAX_PACE = 10_000
/** Once the book has this much evidence, a page that took far longer than usual is ignored… */
const SETTLED_MS = 3 * 60_000
/** …where far longer means this many times as long (the reader looked away). */
const MAX_SLOWDOWN = 4

/** Bytes a minute for this book: the personal pace, refined by what was read in the book. */
export function paceFor(personal: number, book: BookPace | null | undefined): number {
  if (!book || book.ms <= 0) return personal
  return (personal * PRIOR_MINUTES + book.bytes) / (PRIOR_MINUTES + book.ms / 60_000)
}

/**
 * Adds a page that was read: `bytes` of text over `ms`. Returns the book's pace unchanged when
 * the page doesn't look like reading (flipped past, skimmed, or left open while away).
 */
export function addPage(book: BookPace | null, bytes: number, ms: number): BookPace | null {
  if (bytes <= 0 || ms < MIN_PAGE_MS) return book
  const pace = bytes / (ms / 60_000)
  if (pace < MIN_PACE || pace > MAX_PACE) return book
  // Measured against the book's own pace: the personal one may be far off for this book.
  if (book && book.ms >= SETTLED_MS && pace * MAX_SLOWDOWN < book.bytes / (book.ms / 60_000)) {
    return book
  }
  const next = { bytes: (book?.bytes ?? 0) + bytes, ms: (book?.ms ?? 0) + ms }
  if (next.ms <= MAX_EVIDENCE_MS) return next
  const keep = MAX_EVIDENCE_MS / next.ms
  return { bytes: next.bytes * keep, ms: MAX_EVIDENCE_MS }
}
