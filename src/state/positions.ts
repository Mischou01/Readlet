// Details about where each book was left off, cached on this device for the library ("Chapter 4
// of 12", "9 min left in chapter"). Synced progress only carries the position itself, so books
// last read on another device show less until they're opened here.

import type { BookPace } from '../stats/pace'

export interface PositionInfo {
  label?: string
  section: number
  sections: number
  /** Bytes of book text left in the chapter / the book, as foliate-js measures them. */
  bytesLeftInSection: number
  bytesLeftInBook: number
  /** The reading pace in this book (stats/pace.ts). */
  pace?: BookPace | null
  updatedAt: number
}

const KEY = 'readlet.positions'
const MAX_ENTRIES = 500

function readAll(): Record<string, PositionInfo> {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, PositionInfo>) : {}
  } catch {
    return {}
  }
}

export function readPosition(fingerprint: string): PositionInfo | null {
  return readAll()[fingerprint] ?? null
}

export function savePosition(fingerprint: string, info: PositionInfo) {
  try {
    const all = readAll()
    all[fingerprint] = info
    const entries = Object.entries(all)
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries.slice(0, MAX_ENTRIES))))
    } else {
      localStorage.setItem(KEY, JSON.stringify(all))
    }
  } catch {
    // Storage can be unavailable; the library just shows less detail.
  }
}
