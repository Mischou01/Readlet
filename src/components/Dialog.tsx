import { motion } from 'motion/react'
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEscape } from '../lib/hooks'
import styles from './floating.module.css'

interface DialogProps {
  title: string
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  actions: ReactNode
}

/** A small modal. Focus stays inside it until it closes; Escape or a click outside closes it. */
export function Dialog({ title, description, onClose, children, actions }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEscape(onClose)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button')
    ;(first ?? ref.current)?.focus()
    return () => previous?.focus?.()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    // Window-level Escape handlers run in the order they were added, so a sheet under this dialog
    // would otherwise close first. Handling it here marks the key as handled before they see it.
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !ref.current) return
    const focusable = Array.from(
      ref.current.querySelectorAll<HTMLElement>(
        'input, textarea, select, button:not(:disabled), [href]',
      ),
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <motion.div
      className={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16 }}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.dialog}
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        {description && <p className={styles.dialogDescription}>{description}</p>}
        {children}
        <div className={styles.dialogActions}>{actions}</div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
