import { AnimatePresence, motion } from 'motion/react'
import { useToasts } from '../state/toasts'
import { Button } from './Button'
import styles from './floating.module.css'

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className={styles.toasts} aria-live="polite">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={styles.toast}
            data-tone={toast.tone}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
          >
            {toast.swatch && (
              <span className={styles.toastSwatch} style={{ background: toast.swatch }} />
            )}
            <span className={styles.toastMessage}>{toast.message}</span>
            {toast.action && (
              <Button
                size="small"
                variant="quiet"
                style={{ background: 'var(--hover)' }}
                onClick={() => {
                  dismiss(toast.id)
                  toast.action?.run()
                }}
              >
                {toast.action.label}
              </Button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
