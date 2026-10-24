// What differs when Readlet runs on Android rather than the desktop: the system's insets around
// the page, the on-screen keyboard, the back gesture, the system bars and the app lifecycle.
// Layout itself follows the screen size (PHONE_QUERY), not the platform.

import { onBackButtonPress } from '@tauri-apps/api/app'
import { open } from '@tauri-apps/plugin-dialog'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { api, events, subscribeAll } from './ipc'

export const isAndroid = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent)

/** Phone-sized screens: navigation moves to the bottom and sheets rise from the bottom. */
export const PHONE_QUERY = '(max-width: 640px)'
/** Touch screens, where nothing can be hovered. */
export const TOUCH_QUERY = '(hover: none) and (pointer: coarse)'

function mediaQuery(query: string) {
  const list = typeof matchMedia === 'function' ? matchMedia(query) : null
  return {
    subscribe: (onChange: () => void) => {
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    matches: () => list?.matches ?? false,
  }
}

const phone = mediaQuery(PHONE_QUERY)
const touch = mediaQuery(TOUCH_QUERY)

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(phone.subscribe, phone.matches, () => false)
}

export function isTouchScreen(): boolean {
  return touch.matches()
}

export function useTouchScreen(): boolean {
  return useSyncExternalStore(touch.subscribe, touch.matches, () => false)
}

/**
 * Sets up the page for the system around it: `data-platform` on `<html>` for CSS, the system
 * bars' insets as `--native-inset-*` (WebView 136 and later also provide them as
 * `safe-area-inset-*`; tokens.css takes whichever is larger) and the on-screen keyboard's height
 * as `--keyboard-inset`. Returns a cleanup function.
 */
export function initPlatform(): () => void {
  const root = document.documentElement
  root.dataset.platform = isAndroid ? 'android' : 'desktop'

  // Newer WebViews shrink only the visual viewport for the keyboard; dialogs and sheets lift by
  // the difference so their fields stay above it.
  const viewport = window.visualViewport
  const onViewport = () => {
    if (!viewport) return
    const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    root.style.setProperty('--keyboard-inset', `${Math.round(covered)}px`)
  }
  viewport?.addEventListener('resize', onViewport)

  const unsubscribe = isAndroid ? watchInsets() : () => {}
  return () => {
    viewport?.removeEventListener('resize', onViewport)
    unsubscribe()
  }
}

function watchInsets(): () => void {
  const apply = (insets: { top: number; right: number; bottom: number; left: number }) => {
    const style = document.documentElement.style
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      style.setProperty(`--native-inset-${side}`, `${insets[side]}px`)
    }
  }
  api.systemInsets().then(apply, (e) => console.warn('reading the system insets failed', e))
  return subscribeAll([events.onInsets(apply)])
}

const backEvents = new WeakSet<Event>()

/** Whether a keydown is Android's back gesture rather than a real Escape. */
export function isBackGesture(event: Event): boolean {
  return backEvents.has(event)
}

/**
 * Android's back gesture acts like Escape, which already closes whatever is on top (a menu, a
 * dialog, a sheet, a selection). When nothing takes it, `onUnhandled` runs: going back a view, or
 * leaving the app.
 */
export function useBackGesture(onUnhandled: () => void) {
  useEffect(() => {
    if (!isAndroid) return
    let disposed = false
    let unregister: (() => void) | undefined
    onBackButtonPress(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
      backEvents.add(event)
      ;(document.activeElement ?? document.body).dispatchEvent(event)
      if (!event.defaultPrevented) onUnhandled()
    })
      .then((listener) => {
        if (disposed) void listener.unregister()
        else unregister = () => void listener.unregister()
      })
      .catch((e) => console.warn('the back gesture is unavailable', e))
    return () => {
      disposed = true
      unregister?.()
    }
  }, [onUnhandled])
}

/** Sends the app to the background, as the back gesture does on other apps' first screen. */
export function leaveApp() {
  api.moveToBackground().catch((e) => console.warn('moving to the background failed', e))
}

/**
 * Matches the status and navigation bars to the screen behind them, and hides them while
 * `immersive` (reading). Does nothing on the desktop.
 */
export function useSystemBars(dark: boolean, immersive = false) {
  useEffect(() => {
    if (!isAndroid) return
    api
      .setSystemBars({ dark, hidden: immersive })
      .catch((e) => console.warn('styling the system bars failed', e))
  }, [dark, immersive])
}

/**
 * Runs `onHide` when the app goes to the background. A phone may stop the app at any time after
 * that, so this is the moment to save. (The desktop calls it when the window is minimised.)
 */
export function useOnHide(onHide: () => void) {
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const unsubscribe = isAndroid ? subscribeAll([events.onSuspended(onHide)]) : () => {}
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      unsubscribe()
    }
  }, [onHide])
}

/** Asks for a folder: the dialog plugin on the desktop, the system picker on Android. */
export async function pickFolder(title: string): Promise<string | null> {
  if (isAndroid) return api.pickFolder()
  const dir = await open({ directory: true, title })
  return typeof dir === 'string' ? dir : null
}

export type StorageAccess = 'checking' | 'granted' | 'denied'

/**
 * Whether Readlet may read the books folder: Android's "All files access", checked again whenever
 * the app comes back (the reader may have changed it in Settings). Always granted on the desktop.
 * `request` opens the setting.
 */
export function useStorageAccess(): { access: StorageAccess; request: () => Promise<void> } {
  const [access, setAccess] = useState<StorageAccess>(isAndroid ? 'checking' : 'granted')
  const check = useCallback(() => {
    api.storageAccess().then(
      (granted) => setAccess(granted ? 'granted' : 'denied'),
      (e) => {
        // Don't lock the reader out over a failed check; reading the folder will fail visibly.
        console.warn('checking file access failed', e)
        setAccess('granted')
      },
    )
  }, [])
  useEffect(() => {
    if (!isAndroid) return
    check()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [check])
  const request = useCallback(async () => {
    try {
      setAccess((await api.requestStorageAccess()) ? 'granted' : 'denied')
    } catch (e) {
      console.warn('asking for file access failed', e)
      check()
    }
  }, [check])
  return { access, request }
}
