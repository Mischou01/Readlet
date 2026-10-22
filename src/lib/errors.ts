// Uncaught errors in the webview are written to Readlet's log file (via the Rust log plugin), so
// problems can be diagnosed from a bug report. Messages never include book text.

import { error as logError } from '@tauri-apps/plugin-log'

function describe(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}\n${reason.stack ?? ''}`
  return String(reason)
}

export function forwardUncaughtErrors() {
  window.addEventListener('error', (e) => {
    void logError(`uncaught: ${describe(e.error ?? e.message)}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    void logError(`unhandled rejection: ${describe(e.reason)}`)
  })
}

/** For React's root error callbacks: logs a render error with the component stack. */
export function logRenderError(error: unknown, info: { componentStack?: string }) {
  void logError(`render error: ${describe(error)}${info.componentStack ?? ''}`)
}
