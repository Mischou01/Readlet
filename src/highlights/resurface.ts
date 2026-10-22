// "From your highlights": each day the library shows older highlights, favouring ones that
// haven't been shown recently (docs/PLAN.md §6). Deterministic for a given day.

import type { Annotation, Resurfaced } from '../lib/types'
import type { LibraryBook } from '../library/model'

export interface HighlightRef {
  book: LibraryBook
  annotation: Annotation
}

const DAY_MS = 86_400_000
/** Highlights younger than this are still fresh in memory; they're used only as a last resort. */
const MIN_AGE_DAYS = 7

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

export function allHighlights(books: readonly LibraryBook[]): HighlightRef[] {
  return books.flatMap((book) => book.highlights.map((annotation) => ({ book, annotation })))
}

/**
 * Orders highlights for today: least recently shown first (never shown counts as oldest), older
 * highlights before recent ones, then a stable per-day shuffle.
 */
export function resurfaceOrder(
  highlights: readonly HighlightRef[],
  log: readonly Resurfaced[],
  today: string,
  now = Date.now(),
): HighlightRef[] {
  const lastShown = new Map<string, string>()
  for (const entry of log) {
    if (entry.day === today) continue // shown today: keep its place in today's order
    const previous = lastShown.get(entry.highlight)
    if (!previous || entry.day > previous) lastShown.set(entry.highlight, entry.day)
  }
  const fresh = (h: HighlightRef) => now - h.annotation.createdAt < MIN_AGE_DAYS * DAY_MS
  return [...highlights].sort((a, b) => {
    const ageOrder = Number(fresh(a)) - Number(fresh(b))
    if (ageOrder) return ageOrder
    const shownA = lastShown.get(a.annotation.id) ?? ''
    const shownB = lastShown.get(b.annotation.id) ?? ''
    if (shownA !== shownB) return shownA < shownB ? -1 : 1
    return hash(today + a.annotation.id) - hash(today + b.annotation.id)
  })
}
