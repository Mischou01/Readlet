// The window's own controls. Readlet draws its title bar itself (no system decorations), so it
// provides minimise, maximise, full screen and close.

import { getCurrentWindow } from '@tauri-apps/api/window'

export async function toggleFullscreen() {
  const window = getCurrentWindow()
  await window.setFullscreen(!(await window.isFullscreen()))
}

/**
 * Handles window-wide shortcuts (F11 for full screen). Returns true if it handled the key. Book
 * pages are separate documents, so the reader passes their key presses here too.
 */
export function handleWindowShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.key !== 'F11' || e.ctrlKey || e.altKey || e.metaKey) return false
  e.preventDefault()
  toggleFullscreen().catch((err) => console.warn('toggling full screen failed', err))
  return true
}
