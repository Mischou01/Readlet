import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logRenderError } from '../lib/errors'
import { Button } from './Button'

interface State {
  error: Error | null
}

/**
 * The last line of defence for render errors: instead of a blank window, say what happened and
 * offer a reload. Reading data is written as it changes, so reloading loses nothing.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    logRenderError(error, { componentStack: info.componentStack ?? undefined })
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" style={{ maxWidth: 560, margin: '18vh auto 0', padding: '0 24px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 650 }}>Something went wrong</h1>
        <p style={{ marginTop: 10, color: 'var(--haze)', lineHeight: 1.5 }}>
          Readlet hit an unexpected problem and had to stop showing this screen. Your books and
          reading data are safe. The details are in Readlet’s log.
        </p>
        <p data-selectable style={{ marginTop: 14, fontSize: 14, color: 'var(--haze)' }}>
          {error.message}
        </p>
        <Button variant="primary" style={{ marginTop: 22 }} onClick={() => location.reload()}>
          Reload Readlet
        </Button>
      </div>
    )
  }
}
