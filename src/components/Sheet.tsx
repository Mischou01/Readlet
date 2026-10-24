import { X } from 'lucide-react'
import { motion, useDragControls, type PanInfo } from 'motion/react'
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { useEscape } from '../lib/hooks'
import { usePhoneLayout } from '../lib/platform'
import { IconButton } from './Button'
import styles from './floating.module.css'

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** Extra controls in the header, before the close button. */
  actions?: ReactNode
  /** Controls under the header that stay put while the body scrolls (tabs, a search field). */
  toolbar?: ReactNode
  style?: CSSProperties
  className?: string
}

/** How far (px) or how fast (px/s) a sheet must be pulled down to close. */
const DISMISS_DISTANCE = 110
const DISMISS_VELOCITY = 600

/**
 * A glass side sheet that slides in from the right; on phones, a bottom sheet that rises from the
 * bottom edge and closes when pulled down by its header. Escape (or the back gesture) closes it.
 */
export function Sheet({
  title,
  onClose,
  children,
  actions,
  toolbar,
  style,
  className,
}: SheetProps) {
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  const phone = usePhoneLayout()
  const drag = useDragControls()
  useEscape(onClose)
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) onClose()
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    // Without preventScroll, focusing the sheet while it's still off-screen scrolls its container
    // sideways, and the whole view lurches left and drifts back as the sheet slides in.
    ref.current?.focus({ preventScroll: true })
    return () => previous?.focus?.({ preventScroll: true })
  }, [])
  return (
    <motion.aside
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-labelledby={titleId}
      className={`${styles.sheet} ${className ?? ''}`}
      // A side sheet's offset from the top (`style.top`) doesn't apply to a bottom sheet: it
      // would hold the sheet up off the bottom edge, with the view showing through below it.
      style={phone && style?.top !== undefined ? { ...style, top: undefined } : style}
      // Slides in from the edge without fading: frosted glass that fades pops when the fade ends.
      initial={phone ? { y: '110%' } : { x: '110%' }}
      animate={phone ? { y: 0 } : { x: 0 }}
      exit={{
        ...(phone ? { y: '110%' } : { x: '110%' }),
        transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
      }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      // Pulled down by the header (not the body, which scrolls).
      drag={phone ? 'y' : false}
      dragListener={false}
      dragControls={drag}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.8 }}
      onDragEnd={onDragEnd}
    >
      {phone && (
        <div className={styles.handle} onPointerDown={(e) => drag.start(e)} aria-hidden="true" />
      )}
      <div className={styles.sheetHeader} onPointerDown={(e) => phone && drag.start(e)}>
        <h2 id={titleId}>{title}</h2>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {actions}
          <IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}>
            <X size={18} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {toolbar && <div className={styles.sheetToolbar}>{toolbar}</div>}
      <div className={styles.sheetBody}>{children}</div>
    </motion.aside>
  )
}
