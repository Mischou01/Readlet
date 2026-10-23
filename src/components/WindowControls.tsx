import { getCurrentWindow } from '@tauri-apps/api/window'
import { Copy, Minimize2, Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isAndroid } from '../lib/platform'
import { toggleFullscreen } from '../lib/window'
import { IconButton } from './Button'
import controls from './controls.module.css'

type WindowState = 'normal' | 'maximized' | 'fullscreen'

function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>('normal')
  useEffect(() => {
    const window = getCurrentWindow()
    let disposed = false
    const refresh = async () => {
      const [fullscreen, maximized] = await Promise.all([
        window.isFullscreen(),
        window.isMaximized(),
      ])
      if (!disposed) setState(fullscreen ? 'fullscreen' : maximized ? 'maximized' : 'normal')
    }
    const report = (e: unknown) => console.warn('reading the window state failed', e)
    refresh().catch(report)
    const unlisten = window.onResized(() => void refresh().catch(report))
    return () => {
      disposed = true
      void unlisten.then((fn) => fn())
    }
  }, [])
  return state
}

const run = (action: () => Promise<void>) => () =>
  void action().catch((e) => console.warn('window action failed', e))

/**
 * Minimise, maximise (or leave full screen) and close, with a divider before them. Closing flushes
 * pending writes through the close-requested handlers first. Phones have no windows to control.
 */
export function WindowControls({ divider = true }: { divider?: boolean }) {
  return isAndroid ? null : <DesktopWindowControls divider={divider} />
}

function DesktopWindowControls({ divider }: { divider: boolean }) {
  const state = useWindowState()
  const window = getCurrentWindow()
  return (
    // Like the system's own title bar buttons, these don't take focus when clicked.
    <div className={controls.windowControls} onMouseDown={(e) => e.preventDefault()}>
      {divider && <span className={controls.divider} aria-hidden="true" />}
      <IconButton
        label="Minimize"
        className={controls.windowButton}
        onClick={run(() => window.minimize())}
      >
        <span className={controls.windowGlyph}>
          <Minus size={13} strokeWidth={2.4} aria-hidden="true" />
        </span>
      </IconButton>
      {state === 'fullscreen' ? (
        <IconButton
          label="Leave full screen (F11)"
          className={controls.windowButton}
          onClick={run(toggleFullscreen)}
        >
          <span className={controls.windowGlyph}>
            <Minimize2 size={12} strokeWidth={2.4} aria-hidden="true" />
          </span>
        </IconButton>
      ) : (
        <IconButton
          label={state === 'maximized' ? 'Restore' : 'Maximize (F11 for full screen)'}
          className={controls.windowButton}
          onClick={run(() => window.toggleMaximize())}
        >
          <span className={controls.windowGlyph}>
            {state === 'maximized' ? (
              <Copy size={11} strokeWidth={2.4} aria-hidden="true" />
            ) : (
              <Square size={10} strokeWidth={2.6} aria-hidden="true" />
            )}
          </span>
        </IconButton>
      )}
      <IconButton
        label="Close window"
        className={controls.windowButton}
        onClick={run(() => window.close())}
      >
        <span className={controls.windowGlyph}>
          <X size={13} strokeWidth={2.4} aria-hidden="true" />
        </span>
      </IconButton>
    </div>
  )
}
