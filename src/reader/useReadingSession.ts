// Tracks active reading time for the open book and records sessions (docs/PLAN.md §6).

import { useCallback, useEffect, useRef } from 'react'
import { newId } from '../lib/ids'
import { api } from '../lib/ipc'
import { countWords } from '../lib/text'
import type { Session } from '../lib/types'
import { usePreferences } from '../state/preferences'
import { useStats } from '../state/stats'
import { MIN_SESSION_MS, SessionTracker, updatedReadingSpeed } from '../stats/sessionTracker'

const TICK_MS = 5_000

export interface ReadingSession {
  /** Pointer, keyboard or listening activity. */
  activity: () => void
  /** A new position is showing. */
  relocated: (fraction: number, visibleText: string, bookBytes: number) => void
  /** Records the session now (closing the book or the window). */
  finish: () => Promise<void>
  /**
   * Saves the session so far without ending it (the app went to the background). If the app is
   * stopped, it's recorded when Readlet next starts.
   */
  checkpoint: () => void
}

export function useReadingSession(
  fingerprint: string,
  startFraction: number,
  listening: boolean,
): ReadingSession {
  const tracker = useRef<SessionTracker | null>(null)
  const lastFraction = useRef(startFraction)
  const bookBytes = useRef(0)

  const record = useCallback(async (session: Session | null) => {
    if (!session) return
    useStats.getState().putSession(session)
    if (bookBytes.current > 0) {
      const prefs = usePreferences.getState()
      const speed = updatedReadingSpeed(prefs.prefs.bytesPerMinute, session, bookBytes.current)
      if (speed !== prefs.prefs.bytesPerMinute) prefs.update({ bytesPerMinute: speed })
    }
    try {
      await api.finishSession(session)
    } catch (e) {
      console.warn('saving the reading session failed', e)
    }
  }, [])

  useEffect(() => {
    const t = new SessionTracker(fingerprint, newId, lastFraction.current)
    tracker.current = t
    t.activity(Date.now())
    const timer = setInterval(() => {
      const { checkpoint, ended } = t.tick(Date.now(), document.hasFocus())
      if (checkpoint)
        api.checkpointSession(checkpoint).catch((e) => console.warn('checkpoint failed', e))
      if (ended) void record(ended)
    }, TICK_MS)
    return () => {
      clearInterval(timer)
      void record(t.finish())
      tracker.current = null
    }
  }, [fingerprint, record])

  // Listening to read-aloud counts as reading.
  useEffect(() => {
    if (!listening) return
    const timer = setInterval(() => tracker.current?.activity(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [listening])

  const activity = useCallback(() => tracker.current?.activity(Date.now()), [])
  const relocated = useCallback((fraction: number, visibleText: string, bytes: number) => {
    bookBytes.current = bytes
    const forward = fraction > lastFraction.current
    lastFraction.current = fraction
    tracker.current?.relocated(Date.now(), fraction, countWords(visibleText), forward)
  }, [])
  const finish = useCallback(async () => {
    const t = tracker.current
    if (t) await record(t.finish())
  }, [record])

  const checkpoint = useCallback(() => {
    const current = tracker.current?.current
    if (!current || current.activeMs < MIN_SESSION_MS) return
    // Today's reading so far counts already (the widgets show it): the session replaces it when
    // it ends.
    useStats.getState().putSession({ ...current })
    api.checkpointSession(current).catch((e) => console.warn('checkpoint failed', e))
  }, [])

  return { activity, relocated, finish, checkpoint }
}
