// Typed wrappers around the Rust commands and events. Nothing else calls `invoke` directly.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AppError,
  AppInfo,
  BookDetailsPatch,
  BookEntry,
  BookMetadata,
  BookRecord,
  DevicePosition,
  ElsewhereBook,
  FoundBook,
  FoundDetails,
  FreeBook,
  Profile,
  Resurfaced,
  ScanReport,
  Session,
  Shelf,
  StoreChanges,
  SyncStatus,
  YearlyGoal,
} from './types'

export interface AnnotationInput {
  id: string
  kind: 'highlight' | 'bookmark'
  cfi: string
  text: string
  color?: string
  note?: string
  /** Highlights only: it was made by adding a note. */
  fromNote?: boolean
  /** Bookmarks only. */
  name?: string
  chapter?: string
  fraction?: number
}

export interface ProgressInput {
  cfi: string
  fraction: number
  label?: string
}

export interface ExportFile {
  name: string
  content: string
}

export const api = {
  getAppInfo: () => invoke<AppInfo>('get_app_info'),
  setPreferences: (preferences: object) => invoke<void>('set_preferences', { preferences }),
  setDeviceName: (name: string) => invoke<AppInfo>('set_device_name', { name }),

  chooseLibrary: (path: string) => invoke<AppInfo>('choose_library', { path }),
  rescanLibrary: () => invoke<void>('rescan_library'),
  listBooks: () => invoke<BookEntry[]>('list_books'),
  getBooks: (fingerprints: string[]) => invoke<BookEntry[]>('get_books', { fingerprints }),
  listElsewhereBooks: () => invoke<ElsewhereBook[]>('list_elsewhere_books'),
  booksNeedingMetadata: () => invoke<string[]>('books_needing_metadata'),
  setBookMetadata: (fingerprint: string, metadata: BookMetadata, error?: string) =>
    invoke<BookEntry>('set_book_metadata', { fingerprint, metadata, error: error ?? null }),
  /** An empty `bytes` means the book has no cover. */
  setBookCover: (fingerprint: string, bytes: Uint8Array) =>
    invoke<BookEntry>('set_book_cover', bytes, { headers: { 'x-fingerprint': fingerprint } }),
  /** Changes some details; null leaves a field blank. Fields left out keep their value. */
  setBookDetails: (fingerprint: string, details: BookDetailsPatch) =>
    invoke<BookEntry>('set_book_details', { fingerprint, details }),
  resetBookDetails: (fingerprint: string) =>
    invoke<BookEntry>('reset_book_details', { fingerprint }),
  /** A cover the reader picked; empty `bytes` means no cover at all. */
  chooseBookCover: (fingerprint: string, bytes: Uint8Array) =>
    invoke<BookEntry>('choose_book_cover', bytes, { headers: { 'x-fingerprint': fingerprint } }),
  chooseBookCoverOnline: (fingerprint: string, cover: number) =>
    invoke<BookEntry>('choose_book_cover_online', { fingerprint, cover }),
  searchBookDetails: (query: string) => invoke<FoundBook[]>('search_book_details', { query }),
  fetchBookDetails: (work: string, edition: string | null) =>
    invoke<FoundDetails>('fetch_book_details', { work, edition }),
  addBooks: (paths: string[]) => invoke<string[]>('add_books', { paths }),
  searchFreeBooks: (query: string) => invoke<FreeBook[]>('search_free_books', { query }),
  /** Returns the name the book was added under; none if it's already in the folder. */
  downloadFreeBook: (book: FreeBook) =>
    invoke<string[]>('download_free_book', { id: book.id, title: book.title, author: book.author }),
  revealBook: (fingerprint: string) => invoke<void>('reveal_book', { fingerprint }),
  /** To the trash on the desktop, for good on Android; reading data is kept. */
  deleteBooks: (fingerprints: string[]) =>
    invoke<{ deleted: string[]; errors: string[] }>('delete_books', { fingerprints }),

  listRecords: () => invoke<BookRecord[]>('list_records'),
  getRecord: (fingerprint: string) => invoke<BookRecord>('get_record', { fingerprint }),
  getPositions: (fingerprint: string) => invoke<DevicePosition[]>('get_positions', { fingerprint }),
  setProgress: (fingerprint: string, progress: ProgressInput) =>
    invoke<BookRecord>('set_progress', { fingerprint, progress }),
  setStatus: (fingerprint: string, status: string) =>
    invoke<BookRecord>('set_status', { fingerprint, status }),
  putAnnotation: (fingerprint: string, annotation: AnnotationInput) =>
    invoke<BookRecord>('put_annotation', { fingerprint, annotation }),
  deleteAnnotation: (fingerprint: string, id: string) =>
    invoke<BookRecord>('delete_annotation', { fingerprint, id }),

  listSessions: (since: number) => invoke<Session[]>('list_sessions', { since }),
  checkpointSession: (session: Session) => invoke<void>('checkpoint_session', { session }),
  finishSession: (session: Session) => invoke<void>('finish_session', { session }),
  getProfile: () => invoke<Profile>('get_profile'),
  setDailyGoal: (minutes: number) => invoke<Profile>('set_daily_goal', { minutes }),
  setYearlyGoal: (goal: YearlyGoal) => invoke<Profile>('set_yearly_goal', { goal }),

  listShelves: () => invoke<Shelf[]>('list_shelves'),
  putShelf: (shelf: { id: string; name: string; books: string[] }) =>
    invoke<Shelf[]>('put_shelf', { shelf }),
  deleteShelf: (id: string) => invoke<Shelf[]>('delete_shelf', { id }),

  listResurfaced: () => invoke<Resurfaced[]>('list_resurfaced'),
  logResurfaced: (entries: Resurfaced[]) => invoke<void>('log_resurfaced', { entries }),

  exportMarkdown: (dir: string, files: ExportFile[]) =>
    invoke<number>('export_markdown', { dir, files }),

  ttsVoices: () => invoke<Voice[]>('tts_voices'),
  /** Returns the message id; events for other ids are stale. */
  ttsSpeak: (ssml: string, speed: number, voice: string | null, language: string | null) =>
    invoke<number>('tts_speak', { ssml, speed, voice, language }),
  ttsStop: () => invoke<void>('tts_stop'),
  /** Shows read-aloud in the system's media controls (Android), or removes it with `null`. */
  ttsSession: (session: PlaybackSession | null) => invoke<void>('tts_session', { session }),

  // Android (the desktop has trivial answers or uses Tauri's plugins instead).
  storageAccess: () => invoke<boolean>('storage_access'),
  requestStorageAccess: () => invoke<boolean>('request_storage_access'),
  pickFolder: () => invoke<string | null>('pick_folder'),
  /** Picks book files with the system's picker and copies them in; returns the added names, or
   * `null` if nothing was picked. */
  importBooks: () => invoke<string[] | null>('import_books'),
  setSystemBars: (bars: { dark: boolean; hidden: boolean }) =>
    invoke<void>('set_system_bars', { bars }),
  systemInsets: () => invoke<Insets>('system_insets'),
  /** While reading: keeps the screen on, and lets the volume keys turn pages (`onPageKey`). */
  setReaderControls: (controls: { keepScreenOn: boolean; volumeKeys: boolean }) =>
    invoke<void>('set_reader_controls', { controls }),
  moveToBackground: () => invoke<void>('move_to_background'),

  syncStatus: () => invoke<SyncStatus>('sync_status'),
  connectKDrive: (token: string, drive: string) =>
    invoke<SyncStatus>('connect_kdrive', { token, drive }),
  disconnectSync: () => invoke<SyncStatus>('disconnect_sync'),
  syncNow: () => invoke<SyncStatus>('sync_now'),
  /** A full pass unless one just happened (opening a book). */
  syncSoon: () => invoke<void>('sync_soon'),
}

export interface PlaybackSession {
  title: string
  chapter: string | null
  fingerprint: string | null
  playing: boolean
}

/** Space taken by the system bars and display cutouts, in CSS pixels. */
export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/** A read-aloud control used outside the app: the lock screen, notification or a headset. */
export type RemoteAction = 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'stop'

export interface Voice {
  name: string
  language: string
  variant: string
}

export interface TtsEvent {
  kind: 'begin' | 'end' | 'canceled' | 'paused' | 'resumed' | 'mark' | 'error'
  message: number
  mark?: string
  /** Why speaking failed (`error`). */
  error?: string
}

export const events = {
  onLibraryChanged: (handler: (report: ScanReport) => void): Promise<UnlistenFn> =>
    listen<ScanReport>('library:changed', (e) => handler(e.payload)),
  onScanFailed: (handler: (error: AppError) => void): Promise<UnlistenFn> =>
    listen<AppError>('library:scan-failed', (e) => handler(e.payload)),
  onStoreChanged: (handler: (changes: StoreChanges) => void): Promise<UnlistenFn> =>
    listen<StoreChanges>('store:changed', (e) => handler(e.payload)),
  onSyncStatus: (handler: (status: SyncStatus) => void): Promise<UnlistenFn> =>
    listen<SyncStatus>('sync:status', (e) => handler(e.payload)),
  onTts: (handler: (event: TtsEvent) => void): Promise<UnlistenFn> =>
    listen<TtsEvent>('tts:event', (e) => handler(e.payload)),
  onTtsRemote: (handler: (action: RemoteAction) => void): Promise<UnlistenFn> =>
    listen<RemoteAction>('tts:remote', (e) => handler(e.payload)),
  onInsets: (handler: (insets: Insets) => void): Promise<UnlistenFn> =>
    listen<Insets>('system:insets', (e) => handler(e.payload)),
  /** A volume key turned the page (Android, when that setting is on). */
  onPageKey: (handler: (direction: 'next' | 'previous') => void): Promise<UnlistenFn> =>
    listen<'next' | 'previous'>('reader:page-key', (e) => handler(e.payload)),
  /** The app went to the background (mobile). */
  onSuspended: (handler: () => void): Promise<UnlistenFn> =>
    listen('app:suspended', () => handler()),
}

/** Normalises anything thrown by a command (or by JS) into `{ kind, message }`. */
export function toAppError(error: unknown): AppError {
  if (error && typeof error === 'object' && 'kind' in error && 'message' in error) {
    return { kind: String(error.kind), message: String(error.message) }
  }
  if (error instanceof Error) return { kind: 'internal', message: error.message }
  return { kind: 'internal', message: String(error) }
}

/** Subscribes to several events and returns one function that unsubscribes from all of them. */
export function subscribeAll(subscriptions: Promise<UnlistenFn>[]): () => void {
  let disposed = false
  const unlisteners: UnlistenFn[] = []
  for (const sub of subscriptions) {
    sub.then(
      (unlisten) => (disposed ? unlisten() : unlisteners.push(unlisten)),
      (e) => console.error('event subscription failed', e),
    )
  }
  return () => {
    disposed = true
    for (const unlisten of unlisteners.splice(0)) unlisten()
  }
}
