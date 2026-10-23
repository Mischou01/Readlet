// What differs on phones and tablets: there's no window to manage, and the dialog plugin can't
// pick folders (it can only pick `content://` files, which the Rust core can't read by path).

import { open } from '@tauri-apps/plugin-dialog'
import { useApp } from '../state/app'
import { api } from './ipc'

const MOBILE = new Set(['android', 'ios'])

export const isMobile = () => MOBILE.has(useApp.getState().info?.platform ?? '')

export const useIsMobile = () => useApp((s) => MOBILE.has(s.info?.platform ?? ''))

/** Asks for a folder. Null if the reader cancelled. */
export async function chooseFolder(title: string): Promise<string | null> {
  if (isMobile()) return api.pickFolder()
  const dir = await open({ directory: true, title })
  return typeof dir === 'string' ? dir : null
}
