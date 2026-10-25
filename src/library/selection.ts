// Selecting several books at once in the library, to shelve or mark them together.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { useEscape } from '../lib/hooks'

/** The books from `anchor` to `target` in display order, both included; [] if either is gone. */
export function rangeBetween(order: readonly string[], anchor: string, target: string): string[] {
  const from = order.indexOf(anchor)
  const to = order.indexOf(target)
  if (from < 0 || to < 0) return []
  return order.slice(Math.min(from, to), Math.max(from, to) + 1)
}

export interface BookSelection {
  /** Whether clicks select books instead of opening them. */
  selecting: boolean
  /** The selected books that are on screen, in display order. Actions apply to these only. */
  selected: string[]
  has: (fingerprint: string) => boolean
  /** Selects or deselects a book; with `range`, selects everything from the last book clicked. */
  click: (fingerprint: string, options?: { range?: boolean }) => void
  start: (fingerprint?: string) => void
  selectAll: () => void
  exit: () => void
}

/** Selection over `visible` (fingerprints in display order). Escape leaves it, Ctrl+A selects all. */
export function useBookSelection(visible: readonly string[]): BookSelection {
  const [selecting, setSelecting] = useState(false)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const anchor = useRef<string | null>(null)

  // Books hidden by a filter stay chosen but aren't acted on until they're back on screen.
  const selected = useMemo(() => visible.filter((fp) => chosen.has(fp)), [visible, chosen])

  const click = useCallback(
    (fingerprint: string, options: { range?: boolean } = {}) => {
      setSelecting(true)
      const from = anchor.current
      if (options.range && from) {
        const range = rangeBetween(visible, from, fingerprint)
        if (range.length) {
          setChosen((current) => new Set([...current, ...range]))
          return
        }
      }
      anchor.current = fingerprint
      setChosen((current) => {
        const next = new Set(current)
        if (!next.delete(fingerprint)) next.add(fingerprint)
        return next
      })
    },
    [visible],
  )

  const start = useCallback((fingerprint?: string) => {
    setSelecting(true)
    anchor.current = fingerprint ?? null
    setChosen(new Set(fingerprint ? [fingerprint] : []))
  }, [])

  const selectAll = useCallback(() => {
    setSelecting(true)
    setChosen((current) => new Set([...current, ...visible]))
  }, [visible])

  const exit = useCallback(() => {
    setSelecting(false)
    anchor.current = null
    setChosen(new Set())
  }, [])

  useEscape(exit, selecting)

  useEffect(() => {
    if (!selecting) return
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('input, textarea, [role="dialog"], [role="menu"]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAll()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selecting, selectAll])

  const has = useCallback((fingerprint: string) => chosen.has(fingerprint), [chosen])

  return { selecting, selected, has, click, start, selectAll, exit }
}

/** How long a finger rests on a book before it's selected. */
const LONG_PRESS_MS = 450
/** How far it can drift meanwhile: further is a scroll. */
const LONG_PRESS_SLOP = 10

/**
 * Pressing and holding a book with a finger selects it (or adds it to the selection), as in
 * Android's own apps; the menu a long press would open is for the mouse's right button. The
 * handlers go on the list, and each book's element carries `data-fingerprint`.
 */
export function useLongPressSelect(selection: BookSelection) {
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)
  const touch = useRef(false)
  // The click that ends a long press is part of it, not a tap on the book.
  const pressed = useRef(false)

  const cancel = () => {
    if (press.current) clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => cancel, [])

  return {
    onPointerDown: (e: PointerEvent) => {
      cancel()
      pressed.current = false
      touch.current = e.pointerType === 'touch'
      const book = (e.target as HTMLElement).closest<HTMLElement>('[data-fingerprint]')
      const fingerprint = book?.dataset.fingerprint
      if (!touch.current || !fingerprint) return
      const timer = window.setTimeout(() => {
        press.current = null
        pressed.current = true
        if (selection.selecting) selection.click(fingerprint)
        else selection.start(fingerprint)
      }, LONG_PRESS_MS)
      press.current = { timer, x: e.clientX, y: e.clientY }
    },
    onPointerMove: (e: PointerEvent) => {
      const start = press.current
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e: MouseEvent) => {
      if (!pressed.current) return
      pressed.current = false
      e.preventDefault()
      e.stopPropagation()
    },
    onContextMenuCapture: (e: MouseEvent) => {
      if (!touch.current) return
      e.preventDefault()
      e.stopPropagation()
    },
  }
}
