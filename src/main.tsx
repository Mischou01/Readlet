import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { forwardUncaughtErrors, logRenderError } from './lib/errors'
import { initPlatform } from './lib/platform'
import './styles/fonts'
import './styles/global.css'

forwardUncaughtErrors()
initPlatform()

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

// Errors the boundary doesn't see (in its own render, say) still reach the log.
createRoot(root, { onUncaughtError: logRenderError }).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
)
