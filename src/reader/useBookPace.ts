// Learns the reading pace in the open book from how long each page stays up (see stats/pace.ts),
// so "time left" fits this book rather than books in general.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatest } from '../lib/hooks'
import { readPosition } from '../state/positions'
import { usePreferences } from '../state/preferences'
import { addPage, paceFor, type BookPace } from '../stats/pace'

/** A forward move larger than this is a jump (contents, search, the slider), not a page turn. */
const MAX_PAGE_BYTES = 12_000

export interface BookPaceState {
  /** Bytes a minute to estimate time left with. */
  bytesPerMinute: number
  /** A new position is showing; returns what's been learned about the book so far. */
  relocated: (bytesLeftInBook: number) => BookPace | null
}

/** `paused` while reading aloud: listening isn't reading pace. */
export function useBookPace(fingerprint: string, paused: boolean): BookPaceState {
  const personal = usePreferences((s) => s.prefs.bytesPerMinute)
  const [pace, setPace] = useState<BookPace | null>(() => readPosition(fingerprint)?.pace ?? null)
  const paceRef = useRef(pace)
  const lastPage = useRef<{ bytesLeft: number; at: number } | null>(null)
  const pausedRef = useLatest(paused)

  // Time away from the window isn't time on the page. The window also blurs when focus moves into
  // the page itself (an iframe), so this checks where focus went.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const forget = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!document.hasFocus() || document.hidden) lastPage.current = null
      }, 0)
    }
    window.addEventListener('blur', forget)
    document.addEventListener('visibilitychange', forget)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('blur', forget)
      document.removeEventListener('visibilitychange', forget)
    }
  }, [])

  const relocated = useCallback(
    (bytesLeft: number) => {
      const at = performance.now()
      const previous = lastPage.current
      const bytes = previous ? previous.bytesLeft - bytesLeft : 0
      // The same page laid out again (a resize, a new font size) is still the same page.
      if (previous && bytes === 0) return paceRef.current
      lastPage.current = { bytesLeft, at }
      if (!previous || pausedRef.current) return paceRef.current
      if (bytes > MAX_PAGE_BYTES) return paceRef.current
      const next = addPage(paceRef.current, bytes, at - previous.at)
      if (next !== paceRef.current) {
        paceRef.current = next
        setPace(next)
      }
      return next
    },
    [pausedRef],
  )

  return { bytesPerMinute: paceFor(personal, pace), relocated }
}
