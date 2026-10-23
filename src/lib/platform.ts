// What differs on phones and tablets: there's no window to manage, the dialog plugin can't pick
// folders (it can only pick `content://` files, which the Rust core can't read by path), and on
// Android Readlet has the whole screen, camera cutout included (src-tauri/plugins/android).

import { open } from '@tauri-apps/plugin-dialog'
import { useApp } from '../state/app'
import { api } from './ipc'
import type { ScreenInsets } from './types'

const MOBILE = new Set(['android', 'ios'])

export const isMobile = () => MOBILE.has(useApp.getState().info?.platform ?? '')

export const useIsMobile = () => useApp((s) => MOBILE.has(s.info?.platform ?? ''))

/** Asks for a folder. Null if the reader cancelled. */
export async function chooseFolder(title: string): Promise<string | null> {
  if (isMobile()) return api.pickFolder()
  const dir = await open({ directory: true, title })
  return typeof dir === 'string' ? dir : null
}

declare global {
  interface Window {
    /** Called by the Android plugin when the screen's insets change. */
    __readletSetInsets?: (insets: ScreenInsets) => void
  }
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const

/** Sets the `--system-inset-*` properties that `--safe-*` in global.css are made from. */
function applyInsets(insets: ScreenInsets) {
  const style = document.documentElement.style
  for (const side of SIDES) style.setProperty(`--system-inset-${side}`, `${insets[side]}px`)
}

/** Fields that need Android's own text menu, for cut and paste. */
const TEXT_FIELD =
  'textarea, [contenteditable="true"], input:not([type]), input:is([type="text"], [type="search"], [type="email"], [type="url"], [type="password"], [type="number"])'

/**
 * Android only: keeps the UI clear of the camera cutout, and lets Android show its own text menu
 * only while a text field has focus (book pages get Readlet's selection bar instead). Returns a
 * function that undoes it.
 */
export function fitAndroidScreen(): () => void {
  window.__readletSetInsets = applyInsets
  api.screenInsets().then(applyInsets, (e) => console.warn('reading the screen insets failed', e))

  let nativeMenu = false
  const update = () => {
    const wanted = !!document.activeElement?.matches(TEXT_FIELD)
    if (wanted === nativeMenu) return
    nativeMenu = wanted
    api.setNativeTextMenu(wanted).catch((e) => console.warn('switching the text menu failed', e))
  }
  // Focus has moved on by the time a timer runs; during `focusout` it's still on its way.
  const updateSoon = () => setTimeout(update, 0)
  document.addEventListener('focusin', update)
  document.addEventListener('focusout', updateSoon)
  return () => {
    delete window.__readletSetInsets
    document.removeEventListener('focusin', update)
    document.removeEventListener('focusout', updateSoon)
  }
}
