// Top-level app state: startup, the library folder and which view is showing.

import { create } from 'zustand'
import { api, toAppError } from '../lib/ipc'
import type { AppError, AppInfo } from '../lib/types'
import { usePreferences } from './preferences'

export type View =
  | { name: 'library' }
  | { name: 'highlights'; book?: string }
  | { name: 'stats' }
  | { name: 'reader'; fingerprint: string; target?: string; readAloud?: boolean }

export type Section = 'library' | 'highlights' | 'stats'

/** The cover a book is being opened from, for the "open book" transition. */
export interface OpeningCover {
  fingerprint: string
  rect: { x: number; y: number; width: number; height: number }
  /** The cover image, or the CSS background of a generated cover. */
  image: string | null
  background: string | null
}

/** A message that needs acknowledging, shown in a dialog. */
export interface Notice {
  title: string
  message: string
}

export interface PendingDelete {
  fingerprints: string[]
  /** Runs once they're deleted (ends a selection, say). */
  onDeleted?: () => void
}

interface AppState {
  info: AppInfo | null
  status: 'loading' | 'ready' | 'error'
  error: AppError | null
  view: View
  settingsOpen: boolean
  notice: Notice | null
  /** The book whose details sheet is open. */
  details: string | null
  /** Books waiting for the reader to confirm deleting them. */
  deleting: PendingDelete | null
  opening: OpeningCover | null
  /** The reader wants the whole screen: the phone's system bars are hidden. */
  immersive: boolean
  init: () => Promise<void>
  setInfo: (info: AppInfo) => void
  navigate: (view: View) => void
  setSettingsOpen: (open: boolean) => void
  setNotice: (notice: Notice | null) => void
  showDetails: (fingerprint: string | null) => void
  /** Asks before deleting books (`DeleteBooksDialog`); `null` closes the question. */
  confirmDelete: (pending: PendingDelete | null) => void
  /** Starts the "open book" transition; the reader ends it once the book is on screen. */
  setOpening: (opening: OpeningCover | null) => void
  setImmersive: (immersive: boolean) => void
}

export const useApp = create<AppState>((set) => ({
  info: null,
  status: 'loading',
  error: null,
  view: { name: 'library' },
  settingsOpen: false,
  notice: null,
  details: null,
  deleting: null,
  opening: null,
  immersive: false,
  init: async () => {
    try {
      const info = await api.getAppInfo()
      usePreferences.getState().load(info.preferences)
      set({ info, status: 'ready', error: null })
    } catch (e) {
      set({ status: 'error', error: toAppError(e) })
    }
  },
  setInfo: (info) => set({ info }),
  navigate: (view) =>
    set((s) => ({
      view,
      settingsOpen: false,
      details: null,
      opening: view.name === 'reader' ? s.opening : null,
    })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setNotice: (notice) => set({ notice }),
  showDetails: (details) => set({ details }),
  confirmDelete: (deleting) => set({ deleting }),
  setOpening: (opening) => set({ opening }),
  setImmersive: (immersive) => set({ immersive }),
}))
