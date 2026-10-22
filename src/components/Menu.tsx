import { Check } from 'lucide-react'
import { motion } from 'motion/react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useLatest } from '../lib/hooks'
import styles from './floating.module.css'

export type MenuEntry =
  | {
      id: string
      label: string
      icon?: ReactNode
      checked?: boolean
      danger?: boolean
      disabled?: boolean
      onSelect: () => void
    }
  | { separator: true; id: string }
  | { heading: string; id: string }

export type MenuAnchor = DOMRect | { x: number; y: number }

interface MenuProps {
  anchor: MenuAnchor
  align?: 'start' | 'end'
  label: string
  items: MenuEntry[]
  onClose: () => void
}

const GAP = 8
const MARGIN = 12

/** A popup menu with keyboard support, rendered above everything else. */
export function Menu({ anchor, align = 'start', label, items, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const close = useLatest(onClose)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const rect = 'width' in anchor ? anchor : new DOMRect(anchor.x, anchor.y, 0, 0)
    let left = align === 'end' ? rect.right - width : rect.left
    let top = rect.bottom + (rect.height ? GAP : 0)
    if (top + height > innerHeight - MARGIN)
      top = Math.max(MARGIN, rect.top - height - (rect.height ? GAP : 0))
    left = Math.min(Math.max(MARGIN, left), innerWidth - width - MARGIN)
    setPosition({ left, top })
  }, [anchor, align])

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
    first?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current()
    }
    const onBlur = () => close.current()
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [close])

  const onKeyDown = (e: KeyboardEvent) => {
    const buttons = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    )
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const focus = (i: number) => buttons[(i + buttons.length) % buttons.length]?.focus()
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        focus(index + 1)
        break
      case 'ArrowUp':
        e.preventDefault()
        focus(index - 1)
        break
      case 'Home':
        e.preventDefault()
        focus(0)
        break
      case 'End':
        e.preventDefault()
        focus(buttons.length - 1)
        break
      case 'Escape':
      case 'Tab':
        e.preventDefault()
        e.stopPropagation()
        onClose()
        break
    }
  }

  return createPortal(
    <motion.div
      ref={ref}
      role="menu"
      aria-label={label}
      className={styles.menu}
      style={{ left: position?.left ?? -9999, top: position?.top ?? -9999 }}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.14 }}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        if ('separator' in item)
          return <div key={item.id} className={styles.separator} role="separator" />
        if ('heading' in item)
          return (
            <div key={item.id} className={styles.menuLabel} role="presentation">
              {item.heading}
            </div>
          )
        const checkable = item.checked !== undefined
        return (
          <button
            key={item.id}
            type="button"
            role={checkable ? 'menuitemradio' : 'menuitem'}
            aria-checked={checkable ? item.checked : undefined}
            className={styles.menuItem}
            data-danger={item.danger || undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.checked && <Check size={16} className={styles.check} aria-hidden="true" />}
          </button>
        )
      })}
    </motion.div>,
    document.body,
  )
}

interface MenuButtonProps {
  label: string
  items: MenuEntry[]
  align?: 'start' | 'end'
  className?: string
  title?: string
  children: ReactNode
}

/** A button that opens a `Menu` below itself and returns focus when it closes. */
export function MenuButton({ label, items, align, className, title, children }: MenuButtonProps) {
  const button = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={title ? undefined : label}
        title={title}
        onClick={() => setAnchor(button.current?.getBoundingClientRect() ?? null)}
      >
        {children}
      </button>
      {anchor && (
        <Menu
          anchor={anchor}
          align={align}
          label={label}
          items={items}
          onClose={() => {
            setAnchor(null)
            button.current?.focus()
          }}
        />
      )}
    </>
  )
}
