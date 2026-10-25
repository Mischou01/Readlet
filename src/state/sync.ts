// How syncing reading data is going, kept in step with the Rust core (src-tauri/src/sync).

import { create } from 'zustand'
import { api, events, toAppError } from '../lib/ipc'
import type { SyncStatus } from '../lib/types'

interface SyncState {
  status: SyncStatus | null
  load: () => Promise<void>
  set: (status: SyncStatus) => void
}

export const useSync = create<SyncState>((set) => ({
  status: null,
  load: async () => {
    try {
      set({ status: await api.syncStatus() })
    } catch (e) {
      console.warn('reading the sync status failed', toAppError(e))
    }
  },
  set: (status) => set({ status }),
}))

/** Follows the core's sync status; returns the unsubscribe. */
export function followSync() {
  void useSync.getState().load()
  return events.onSyncStatus((status) => useSync.getState().set(status))
}

/** Whether a sync service is connected, so asking it for news is worth it. */
export function syncConnected(): boolean {
  return useSync.getState().status?.service != null
}
