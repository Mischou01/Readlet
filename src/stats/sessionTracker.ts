// Active reading time (docs/PLAN.md §6): a session only counts time while the window has focus
// and the reader has done something in the last two minutes (turned a page, moved the pointer,
// listened to read-aloud). A long pause splits it into two sessions. Pure and clock-driven, so
// it's covered by sessionTracker.test.ts.

import type { Session } from '../lib/types'

export const IDLE_MS = 2 * 60_000
/** After this long without activity, the next activity starts a new session. */
export const SPLIT_MS = 30 * 60_000
export const CHECKPOINT_MS = 60_000
/** Shorter sessions (a quick peek) aren't recorded. */
export const MIN_SESSION_MS = 20_000
/** Ticks further apart than this (the machine slept) count as this long at most. */
const MAX_TICK_MS = 10_000
/** A page counts as read if it was shown at least this long… */
const MIN_PAGE_MS = 4_000
/** …and not so long that the reader clearly walked away. */
const MAX_PAGE_MS = 15 * 60_000

export interface TickResult {
  /** Save this as the session in progress. */
  checkpoint?: Session
  /** This session ended (long pause); record it. */
  ended?: Session
}

export class SessionTracker {
  private session: Session | null = null
  private lastActivity = 0
  private lastTick = 0
  private lastCheckpoint = 0
  private fraction = 0
  private page: { words: number; shownAt: number } | null = null
  private readonly book: string
  private readonly newId: () => string

  constructor(book: string, newId: () => string, startFraction = 0) {
    this.book = book
    this.newId = newId
    this.fraction = startFraction
  }

  /** Any sign that the reader is reading. Starts a session if none is running. */
  activity(at: number) {
    this.lastActivity = at
    if (!this.session) {
      this.session = {
        id: this.newId(),
        book: this.book,
        start: at,
        end: at,
        activeMs: 0,
        startFraction: this.fraction,
        endFraction: this.fraction,
        words: 0,
      }
      this.lastTick = at
      this.lastCheckpoint = at
    }
  }

  /** A new page (or position) is showing. `forward` says whether the reader moved ahead. */
  relocated(at: number, fraction: number, pageWords: number, forward: boolean) {
    if (forward && this.session && this.page) {
      const shown = at - this.page.shownAt
      if (shown >= MIN_PAGE_MS && shown <= MAX_PAGE_MS) this.session.words += this.page.words
    }
    this.page = { words: pageWords, shownAt: at }
    this.fraction = fraction
    if (this.session) this.session.endFraction = fraction
    this.activity(at)
  }

  /** Call regularly (every few seconds). */
  tick(at: number, focused: boolean): TickResult {
    const session = this.session
    if (!session) return {}
    const elapsed = Math.min(Math.max(0, at - this.lastTick), MAX_TICK_MS)
    this.lastTick = at
    const idle = at - this.lastActivity
    if (focused && idle < IDLE_MS) {
      session.activeMs += elapsed
      session.end = at
    }
    if (idle >= SPLIT_MS) {
      const ended = this.finish()
      return ended ? { ended } : {}
    }
    if (at - this.lastCheckpoint >= CHECKPOINT_MS && session.activeMs >= MIN_SESSION_MS) {
      this.lastCheckpoint = at
      return { checkpoint: { ...session } }
    }
    return {}
  }

  /** Ends the session; returns it if it's long enough to keep. */
  finish(): Session | null {
    const session = this.session
    this.session = null
    this.page = null
    if (!session || session.activeMs < MIN_SESSION_MS) return null
    return { ...session, words: Math.min(session.words, Math.floor(session.activeMs / 20)) }
  }

  get current(): Session | null {
    return this.session ? { ...this.session } : null
  }
}

/**
 * Updates the personal reading speed (bytes of book text a minute, the unit foliate-js uses for
 * "time left") from a finished session. Short or odd sessions leave it unchanged.
 */
export function updatedReadingSpeed(previous: number, session: Session, bookBytes: number): number {
  const minutes = session.activeMs / 60_000
  const bytes = (session.endFraction - session.startFraction) * bookBytes
  if (minutes < 5 || bytes <= 0) return previous
  const speed = Math.min(10_000, Math.max(300, bytes / minutes))
  return Math.round(previous * 0.7 + speed * 0.3)
}
