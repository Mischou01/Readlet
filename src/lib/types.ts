// Types shared with the Rust core (src-tauri/src). Field names follow the serde camelCase output.

export type BookFormat = 'epub' | 'mobi' | 'azw3' | 'fb2' | 'fbz' | 'cbz' | 'pdf'

/** A book's aura and accent, as `#rrggbb`. */
export interface Palette {
  light: [string, string, string]
  dark: [string, string, string]
  accent: string
  accentDark: string
}

/** A book file in the library and its cached metadata. */
export interface BookEntry {
  fingerprint: string
  /** Relative to the library folder, with `/` separators. */
  path: string
  format: BookFormat
  size: number
  drm: boolean
  addedAt: number
  modifiedAt: number
  metadataReady: boolean
  metadataError: string | null
  title: string | null
  authors: string[]
  series: string | null
  seriesIndex: number | null
  language: string | null
  publisher: string | null
  published: string | null
  description: string | null
  identifier: string | null
  coverVersion: number | null
  palette: Palette | null
}

export interface BookMetadata {
  title?: string | null
  authors?: string[]
  series?: string | null
  seriesIndex?: number | null
  language?: string | null
  publisher?: string | null
  published?: string | null
  description?: string | null
  identifier?: string | null
}

export type ReadingStatus = 'reading' | 'toRead' | 'finished'
export const READING_STATUSES: readonly ReadingStatus[] = ['reading', 'toRead', 'finished']

export type HighlightColor = 'butter' | 'peach' | 'mint' | 'sky' | 'lilac'
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  'butter',
  'peach',
  'mint',
  'sky',
  'lilac',
]

export interface Stamped<T> {
  value: T
  updatedAt: number
}

export interface Progress {
  cfi: string
  fraction: number
  label?: string
  updatedAt: number
}

export type AnnotationKind = 'highlight' | 'bookmark'

export interface Annotation {
  id: string
  /** A string rather than `AnnotationKind`: files written by newer versions may hold others. */
  kind: string
  cfi: string
  text: string
  color?: string
  note?: string
  /** A highlight made by adding a note, rather than picked: removing the note removes it. */
  fromNote?: boolean
  /** A bookmark's name, if the reader gave it one. */
  name?: string
  chapter?: string
  fraction?: number
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

/** A book's reading data, merged across devices. */
export interface BookRecord {
  fingerprint: string
  progress: Progress | null
  status: Stamped<string> | null
  annotations: Annotation[]
}

export interface Session {
  id: string
  book: string
  start: number
  end: number
  activeMs: number
  startFraction: number
  endFraction: number
  words: number
}

export type GoalUnit = 'books' | 'minutes'

export interface YearlyGoal {
  unit: GoalUnit
  target: number
}

export interface Profile {
  dailyMinutes: Stamped<number> | null
  yearlyGoal: Stamped<YearlyGoal> | null
}

export interface Shelf {
  id: string
  name: string
  books: string[]
  updatedAt: number
  deleted?: boolean
}

export interface Resurfaced {
  highlight: string
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
}

export interface ScanReport {
  added: number
  updated: number
  removed: number
  total: number
}

export interface StoreChanges {
  books: string[]
  sessions: boolean
  profile: boolean
  shelves: boolean
  resurfaced: boolean
}

export interface AppInfo {
  version: string
  deviceId: string
  deviceName: string
  libraryRoot: string | null
  /** The configured folder when it couldn't be opened. */
  missingLibraryRoot: string | null
  preferences: Record<string, unknown>
  platform: string
}

/** Errors from commands arrive as `{ kind, message }`. */
export interface AppError {
  kind: string
  message: string
}
