// Per-device preferences. They're stored by the Rust core in the app config dir (never in the
// synced book folder) as one JSON object; this module owns its shape and defaults.

import { create } from 'zustand'
import { api } from '../lib/ipc'

export type Appearance = 'system' | 'light' | 'dark'
export type ReadingThemeId = 'system' | 'paper' | 'sepia' | 'dusk' | 'night'
export type ReadingFont = 'literata' | 'newsreader' | 'atkinson' | 'publisher'
export type LineSpacing = 'compact' | 'comfortable' | 'airy'
export type Margins = 'narrow' | 'medium' | 'wide'
export type LibrarySort = 'recent' | 'title' | 'author' | 'series' | 'added'
export type LibraryTab = 'all' | 'reading' | 'toRead' | 'finished'
export type LibraryLayout = 'grid' | 'list'
/** How long the screen stays on after the last page turn or tap, in minutes; 0 leaves it to
 * the system's own timeout. */
export type ScreenOnMinutes = 0 | 5 | 10 | 30
export const SCREEN_ON_MINUTES: readonly ScreenOnMinutes[] = [0, 5, 10, 30]

export interface ReaderPreferences {
  theme: ReadingThemeId
  font: ReadingFont
  /** Pixels. */
  fontSize: number
  spacing: LineSpacing
  margins: Margins
  justify: boolean
  scrolled: boolean
  /** Two pages side by side when the window is wide enough. */
  spread: boolean
  animatePages: boolean
  /** Android: keep the screen on while reading, for this long after the last page turn or tap. */
  screenOnMinutes: ScreenOnMinutes
  /** Android: the volume keys turn pages. */
  volumeKeys: boolean
}

export interface Preferences {
  appearance: Appearance
  reduceTransparency: boolean
  library: { layout: LibraryLayout; sort: LibrarySort; tab: LibraryTab; shelf: string | null }
  reader: ReaderPreferences
  readAloud: { rate: number; voice: string | null }
  /** Looking up words sends them to Wikimedia, so it asks first. */
  onlineDictionary: boolean | null
  /** Personal reading speed for "time left", learned from sessions (bytes of book per minute). */
  bytesPerMinute: number
  /** The "Bookmark added, name it" hint has been shown; once is enough to learn it. */
  bookmarkHintSeen: boolean
}

export const FONT_SIZES: readonly number[] = [15, 16, 17, 18, 19, 20, 22, 24, 26, 28]
const MIN_FONT_SIZE = 15
const MAX_FONT_SIZE = 28
export const DEFAULT_BYTES_PER_MINUTE = 1600

export const DEFAULT_PREFERENCES: Preferences = {
  appearance: 'system',
  reduceTransparency: false,
  library: { layout: 'grid', sort: 'recent', tab: 'all', shelf: null },
  reader: {
    theme: 'paper',
    font: 'literata',
    fontSize: 19,
    spacing: 'comfortable',
    margins: 'medium',
    justify: true,
    scrolled: false,
    spread: true,
    animatePages: true,
    screenOnMinutes: 10,
    volumeKeys: false,
  },
  readAloud: { rate: 1, voice: null },
  onlineDictionary: null,
  bytesPerMinute: DEFAULT_BYTES_PER_MINUTE,
  bookmarkHintSeen: false,
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** Fills in defaults and drops anything invalid, so a hand-edited or old file never breaks the UI. */
export function normalizePreferences(raw: unknown): Preferences {
  const d = DEFAULT_PREFERENCES
  const r = obj(raw)
  const lib = obj(r.library)
  const reader = obj(r.reader)
  const aloud = obj(r.readAloud)
  return {
    appearance: oneOf(r.appearance, ['system', 'light', 'dark'], d.appearance),
    reduceTransparency: bool(r.reduceTransparency, d.reduceTransparency),
    library: {
      layout: oneOf(lib.layout, ['grid', 'list'], d.library.layout),
      sort: oneOf(lib.sort, ['recent', 'title', 'author', 'series', 'added'], d.library.sort),
      tab: oneOf(lib.tab, ['all', 'reading', 'toRead', 'finished'], d.library.tab),
      shelf: typeof lib.shelf === 'string' ? lib.shelf : null,
    },
    reader: {
      theme: oneOf(reader.theme, ['system', 'paper', 'sepia', 'dusk', 'night'], d.reader.theme),
      font: oneOf(reader.font, ['literata', 'newsreader', 'atkinson', 'publisher'], d.reader.font),
      fontSize: num(reader.fontSize, MIN_FONT_SIZE, MAX_FONT_SIZE, d.reader.fontSize),
      spacing: oneOf(reader.spacing, ['compact', 'comfortable', 'airy'], d.reader.spacing),
      margins: oneOf(reader.margins, ['narrow', 'medium', 'wide'], d.reader.margins),
      justify: bool(reader.justify, d.reader.justify),
      scrolled: bool(reader.scrolled, d.reader.scrolled),
      spread: bool(reader.spread, d.reader.spread),
      animatePages: bool(reader.animatePages, d.reader.animatePages),
      screenOnMinutes: SCREEN_ON_MINUTES.includes(reader.screenOnMinutes as ScreenOnMinutes)
        ? (reader.screenOnMinutes as ScreenOnMinutes)
        : d.reader.screenOnMinutes,
      volumeKeys: bool(reader.volumeKeys, d.reader.volumeKeys),
    },
    readAloud: {
      rate: num(aloud.rate, 0.5, 2, d.readAloud.rate),
      voice: typeof aloud.voice === 'string' ? aloud.voice : null,
    },
    onlineDictionary: typeof r.onlineDictionary === 'boolean' ? r.onlineDictionary : null,
    bytesPerMinute: num(r.bytesPerMinute, 300, 10_000, d.bytesPerMinute),
    bookmarkHintSeen: bool(r.bookmarkHintSeen, d.bookmarkHintSeen),
  }
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] }

interface PreferencesState {
  prefs: Preferences
  load: (raw: unknown) => void
  update: (patch: DeepPartial<Preferences>) => void
}

const SAVE_DELAY_MS = 400
let saveTimer: ReturnType<typeof setTimeout> | undefined

function scheduleSave(prefs: Preferences) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    api.setPreferences(prefs).catch((e) => console.error('saving preferences failed', e))
  }, SAVE_DELAY_MS)
}

export const usePreferences = create<PreferencesState>((set, get) => ({
  prefs: DEFAULT_PREFERENCES,
  load: (raw) => set({ prefs: normalizePreferences(raw) }),
  update: (patch) => {
    const current = get().prefs
    const next = normalizePreferences({
      ...current,
      ...patch,
      library: { ...current.library, ...patch.library },
      reader: { ...current.reader, ...patch.reader },
      readAloud: { ...current.readAloud, ...patch.readAloud },
    })
    set({ prefs: next })
    scheduleSave(next)
  },
}))
