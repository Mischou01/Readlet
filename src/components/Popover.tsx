import { motion } from 'motion/react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useEscape, useLatest } from '../lib/hooks'
import styles from './floating.module.css'

interface PopoverProps {
  /** Viewport rect to attach to, e.g. a text selection. */
  anchor: DOMRect
  placement?: 'above' | 'below'
  onClose: () => void
  children: ReactNode
  label: string
  role?: 'dialog' | 'toolbar' | 'tooltip'
  className?: string
  style?: CSSProperties
  /** Keep it open when clicking outside (e.g. while the reader adjusts a selection). */
  persistent?: boolean
}

const GAP = 10
const MARGIN = 12

/** A floating glass panel next to a rect, flipped and clamped to stay on screen. */
export function Popover({
  anchor,
  placement = 'above',
  onClose,
  children,
  label,
  role = 'dialog',
  className,
  style,
  persistent,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const close = useLatest(onClose)
  useEscape(onClose)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const above = anchor.top - height - GAP
    const below = anchor.bottom + GAP
    let top =
      placement === 'above'
        ? above >= MARGIN
          ? above
          : below
        : below + height <= innerHeight - MARGIN
          ? below
          : above
    top = Math.min(Math.max(MARGIN, top), innerHeight - height - MARGIN)
    const left = Math.min(
      Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2),
      innerWidth - width - MARGIN,
    )
    setPosition({ left, top })
  }, [anchor, placement])

  useEffect(() => {
    if (persistent) return
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [persistent, close])

  return createPortal(
    <motion.div
      ref={ref}
      role={role}
      aria-label={label}
      className={`${styles.popover} ${className ?? ''}`}
      style={{ left: position?.left ?? -9999, top: position?.top ?? -9999, ...style }}
      initial={{ opacity: 0, y: placement === 'above' ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14 }}
    >
      {children}
    </motion.div>,
    document.body,
  )
}
