// Android's home-screen widgets (src-tauri/gen/android/.../Widgets.kt): what they show, sent
// whenever it changes, and the books and stats they open. A widget draws without the app running,
// so it gets a snapshot rather than asking. The snapshot is pure, covered by widgets.test.ts.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { dayKey } from '../lib/format'
import { useToday } from '../lib/hooks'
import { api, events, subscribeAll } from '../lib/ipc'
import { isAndroid, useOnHide } from '../lib/platform'
import type { Palette, Session } from '../lib/types'
import { pickCurrentBook, type LibraryBook } from '../library/model'
import { paceFor } from '../stats/pace'
import { currentStreak, dayTotals, minutesOn, STREAK_MINUTES } from '../stats/stats'
import { FALLBACK_PALETTE } from '../theme/aura'
import { useApp } from './app'
import { useLibrary, useLibraryBooks } from './library'
import { readPosition, type PositionInfo } from './positions'
import { usePreferences } from './preferences'
import { useDailyGoal, useStats } from './stats'

export interface WidgetBook {
  fingerprint: string
  title: string
  author: string | null
  chapter: string | null
  /** 0–1 */
  fraction: number
  /** Left in the chapter at the reader's pace; null until the book's been opened here. */
  minutesLeft: number | null
  /** For the widget's colours, as in the app. */
  palette: Palette
}

export interface WidgetSnapshot {
  /** The local day it was made (`YYYY-MM-DD`): the next day, today's minutes start again. */
  day: string
  /** The book Continue reading shows. */
  current: WidgetBook | null
  /** The books being read, most recently read first. */
  shelf: WidgetBook[]
  goal: {
    minutes: number
    target: number
    streak: number
    /** Read today, so the streak carries on into tomorrow. */
    readToday: boolean
  }
}

/** The most covers a shelf widget has room for. */
export const SHELF_SIZE = 6

export interface SnapshotInput {
  books: readonly LibraryBook[]
  sessions: readonly Session[]
  dailyGoal: number
  bytesPerMinute: number
  today: Date
  position: (fingerprint: string) => PositionInfo | null
}

export function widgetSnapshot({
  books,
  sessions,
  dailyGoal,
  bytesPerMinute,
  today,
  position,
}: SnapshotInput): WidgetSnapshot {
  const book = (b: LibraryBook): WidgetBook => {
    const where = position(b.fingerprint)
    return {
      fingerprint: b.fingerprint,
      title: b.title,
      author: b.authors[0] ?? null,
      chapter: b.record?.progress?.label ?? where?.label ?? null,
      fraction: b.fraction,
      minutesLeft: where ? where.bytesLeftInSection / paceFor(bytesPerMinute, where.pace) : null,
      palette: b.entry.palette ?? FALLBACK_PALETTE,
    }
  }
  const current = pickCurrentBook([...books])
  const shelf = books
    .filter((b) => b.status === 'reading' && !b.entry.drm)
    .sort((a, b) => b.lastReadAt - a.lastReadAt)
    .slice(0, SHELF_SIZE)
  const totals = dayTotals(sessions)
  const minutes = minutesOn(totals, today)
  return {
    day: dayKey(today.getTime()),
    current: current ? book(current) : null,
    shelf: shelf.map(book),
    goal: {
      minutes: Math.floor(minutes),
      target: dailyGoal,
      streak: currentStreak(totals, today),
      readToday: minutes >= STREAK_MINUTES,
    },
  }
}

/** Wait this long after a change before sending it, so a burst of changes goes as one. */
const SEND_DELAY_MS = 500
/** Going to the background, wait this long for the reader to save its session first. */
const HIDE_DELAY_MS = 300

function send(snapshot: string) {
  api
    .updateWidgets(JSON.parse(snapshot) as WidgetSnapshot)
    .catch((e) => console.warn('updating the widgets failed', e))
}

/**
 * Keeps the widgets up to date (Android only), once the library and the stats have loaded:
 * before that, the snapshot would empty them. While a book is open, the widgets aren't on screen
 * and every page turn would redraw them, so they're brought up to date on leaving the book or the
 * app instead.
 */
export function useWidgetSync() {
  const books = useLibraryBooks()
  const libraryLoaded = useLibrary((s) => s.loaded)
  const sessions = useStats((s) => s.sessions)
  const statsLoaded = useStats((s) => s.loaded)
  const dailyGoal = useDailyGoal()
  const bytesPerMinute = usePreferences((s) => s.prefs.bytesPerMinute)
  const today = useToday()
  const ready = isAndroid && libraryLoaded && statsLoaded
  const snapshot = useMemo(
    () =>
      ready
        ? JSON.stringify(
            widgetSnapshot({
              books,
              sessions,
              dailyGoal,
              bytesPerMinute,
              today,
              position: readPosition,
            }),
          )
        : null,
    [ready, books, sessions, dailyGoal, bytesPerMinute, today],
  )
  const reading = useApp((s) => s.view.name === 'reader')
  const latest = useRef(snapshot)
  const sent = useRef<string | null>(null)
  useEffect(() => {
    latest.current = snapshot
    if (!snapshot || reading || snapshot === sent.current) return
    const timer = setTimeout(() => {
      sent.current = snapshot
      send(snapshot)
    }, SEND_DELAY_MS)
    return () => clearTimeout(timer)
  }, [snapshot, reading])
  useOnHide(
    useCallback(() => {
      setTimeout(() => {
        const snapshot = latest.current
        if (!snapshot || snapshot === sent.current) return
        sent.current = snapshot
        send(snapshot)
      }, HIDE_DELAY_MS)
    }, []),
  )
}

/**
 * Opens what a tap on a widget asked for: a book, or the stats. The app asks once the library
 * has loaded (it may have been started by the tap), and again whenever a tap brings it back.
 */
export function useWidgetOpenRequests() {
  const loaded = useLibrary((s) => s.loaded)
  useEffect(() => {
    if (!isAndroid || !loaded) return
    const open = async () => {
      const target = await api.takeOpenRequest().catch(() => null)
      const { navigate } = useApp.getState()
      if (target === 'stats') navigate({ name: 'stats' })
      else if (target?.startsWith('book:')) {
        const fingerprint = target.slice('book:'.length)
        // A book removed since the widget was drawn opens the library instead.
        if (useLibrary.getState().books[fingerprint]) navigate({ name: 'reader', fingerprint })
        else navigate({ name: 'library' })
      }
    }
    void open()
    return subscribeAll([events.onOpenRequest(() => void open())])
  }, [loaded])
}
