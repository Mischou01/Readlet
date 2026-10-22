import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { useEscape } from '../lib/hooks'
import { IconButton } from './Button'
import styles from './floating.module.css'

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** Extra controls in the header, before the close button. */
  actions?: ReactNode
  style?: CSSProperties
  className?: string
}

/** A glass side sheet that slides in from the right. Escape closes it. */
export function Sheet({ title, onClose, children, actions, style, className }: SheetProps) {
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  useEscape(onClose)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => previous?.focus?.()
  }, [])
  return (
    <motion.aside
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-labelledby={titleId}
      className={`${styles.sheet} ${className ?? ''}`}
      style={style}
      // Slides in from the edge without fading: frosted glass that fades pops when the fade ends.
      initial={{ x: '110%' }}
      animate={{ x: 0 }}
      exit={{ x: '110%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className={styles.sheetHeader}>
        <h2 id={titleId}>{title}</h2>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {actions}
          <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <div className={styles.sheetBody}>{children}</div>
    </motion.aside>
  )
}
