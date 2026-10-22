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

/** A message that needs acknowledging, shown in a dialog. */
export interface Notice {
  title: string
  message: string
}

interface AppState {
  info: AppInfo | null
  status: 'loading' | 'ready' | 'error'
  error: AppError | null
  view: View
  settingsOpen: boolean
  notice: Notice | null
  init: () => Promise<void>
  setInfo: (info: AppInfo) => void
  navigate: (view: View) => void
  setSettingsOpen: (open: boolean) => void
  setNotice: (notice: Notice | null) => void
}

export const useApp = create<AppState>((set) => ({
  info: null,
  status: 'loading',
  error: null,
  view: { name: 'library' },
  settingsOpen: false,
  notice: null,
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
  navigate: (view) => set({ view, settingsOpen: false }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setNotice: (notice) => set({ notice }),
}))
