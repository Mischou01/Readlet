import { ArrowLeft, Bookmark, List, Search, Volume2 } from 'lucide-react'
import { animate, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconButton } from '../components/Button'
import { WindowControls } from '../components/WindowControls'
import { useLatest } from '../lib/hooks'
import { usePhoneLayout } from '../lib/platform'
import styles from './reader.module.css'

export type ReaderSheet = 'contents' | 'search' | 'text'

interface ReaderToolbarProps {
  title: string
  chapter: string | undefined
  hidden: boolean
  /** Phones: something else is using the bottom of the screen (a sheet, the selection bar). */
  bottomBusy: boolean
  sheet: ReaderSheet | null
  bookmarked: boolean
  /**
   * Counts bookmarks added from here. On the desktop each new one flies into Contents; on phones,
   * where Contents is at the other end of the screen, the button pops instead.
   */
  bookmarksAdded: number
  readingAloud: boolean
  onBack: () => void
  onSheet: (sheet: ReaderSheet) => void
  onToggleBookmark: () => void
  onReadAloud: () => void
  onHover: (hovering: boolean) => void
}

/**
 * The floating glass toolbar; it slides away while you read. On phones it splits in two: the
 * title and bookmark stay at the top, and the tools move to a bar at the bottom, within reach of a
 * thumb.
 */
export function ReaderToolbar(props: ReaderToolbarProps) {
  const { title, chapter, hidden, sheet, bookmarked, bookmarksAdded, readingAloud } = props
  const phone = usePhoneLayout()
  const toggle = (s: ReaderSheet) => () => props.onSheet(s)
  const contentsIcon = useRef<HTMLSpanElement>(null)
  const bookmarkIcon = useRef<HTMLSpanElement>(null)
  const [landed, setLanded] = useState(0)

  const bookmark = (
    <IconButton
      label={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
      aria-pressed={bookmarked}
      onClick={props.onToggleBookmark}
    >
      <motion.span
        key={phone ? bookmarksAdded : undefined}
        ref={bookmarkIcon}
        className={styles.toolIcon}
        initial={phone && bookmarksAdded ? { scale: 1.45 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 12 }}
      >
        <Bookmark
          size={19}
          strokeWidth={1.8}
          fill={bookmarked ? 'currentColor' : 'none'}
          aria-hidden="true"
        />
      </motion.span>
    </IconButton>
  )
  const tools = (
    <>
      <IconButton label="Contents" aria-pressed={sheet === 'contents'} onClick={toggle('contents')}>
        <motion.span
          key={landed}
          ref={contentsIcon}
          className={styles.toolIcon}
          initial={landed ? { scale: 1.3 } : false}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 15 }}
        >
          <List size={19} strokeWidth={1.8} aria-hidden="true" />
        </motion.span>
      </IconButton>
      <IconButton
        label="Search in book"
        aria-pressed={sheet === 'search'}
        onClick={toggle('search')}
      >
        <Search size={19} strokeWidth={1.8} aria-hidden="true" />
      </IconButton>
      <IconButton label="Text settings" aria-pressed={sheet === 'text'} onClick={toggle('text')}>
        <span className={styles.aa} aria-hidden="true">
          Aa
        </span>
      </IconButton>
      <IconButton
        label={readingAloud ? 'Stop reading aloud' : 'Read aloud'}
        aria-pressed={readingAloud}
        onClick={props.onReadAloud}
      >
        <Volume2 size={19} strokeWidth={1.8} aria-hidden="true" />
      </IconButton>
    </>
  )
  const flight = !phone && bookmarksAdded > 0 && (
    <BookmarkFlight
      key={bookmarksAdded}
      from={bookmarkIcon}
      to={contentsIcon}
      onLanded={() => setLanded((n) => n + 1)}
    />
  )

  return (
    <>
      <header
        className={styles.toolbar}
        data-hidden={hidden || undefined}
        data-tauri-drag-region
        // Clicking a tool shouldn't leave it focused: the arrow keys and space turn pages, and a
        // focus ring left on (say) the bookmark reads as "this page is still bookmarked".
        onMouseDown={(e: MouseEvent) => {
          if ((e.target as Element).closest('button')) e.preventDefault()
        }}
        onPointerEnter={() => props.onHover(true)}
        onPointerLeave={() => props.onHover(false)}
        onFocus={() => props.onHover(true)}
        onBlur={() => props.onHover(false)}
      >
        {phone ? (
          <IconButton label="Back to library" onClick={props.onBack}>
            <ArrowLeft size={20} strokeWidth={1.8} aria-hidden="true" />
          </IconButton>
        ) : (
          <button type="button" className={styles.back} onClick={props.onBack}>
            <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
            Library
          </button>
        )}
        <div className={styles.titleBlock} data-tauri-drag-region>
          <span className={styles.bookTitle} data-tauri-drag-region>
            {title}
          </span>
          {chapter && (
            <span className={styles.chapter} data-tauri-drag-region>
              {chapter}
            </span>
          )}
        </div>
        <div className={styles.tools}>
          {!phone && tools}
          {bookmark}
          {flight}
          <WindowControls />
        </div>
      </header>
      {phone && (
        <nav
          className={styles.bottomTools}
          aria-label="Reading tools"
          data-hidden={hidden || props.bottomBusy || undefined}
        >
          {tools}
        </nav>
      )}
    </>
  )
}

/** A bookmark that hops from the bookmark button into Contents, where bookmarks are listed. */
function BookmarkFlight({
  from,
  to,
  onLanded,
}: {
  from: RefObject<HTMLElement | null>
  to: RefObject<HTMLElement | null>
  onLanded: () => void
}) {
  const reduceMotion = useReducedMotion()
  const flyer = useRef<HTMLSpanElement>(null)
  const landed = useLatest(onLanded)
  useEffect(() => {
    const el = flyer.current
    const a = from.current?.getBoundingClientRect()
    const b = to.current?.getBoundingClientRect()
    if (!el || !a || !b || reduceMotion) {
      landed.current()
      return
    }
    let cancelled = false
    el.style.left = `${a.left}px`
    el.style.top = `${a.top}px`
    el.style.visibility = 'visible'
    const dx = b.left - a.left
    const dy = b.top - a.top
    const flight = animate(
      el,
      { x: [0, dx / 2, dx], y: [0, -26, dy], scale: [1, 1.25, 0.7] },
      { duration: 0.55, ease: [0.45, 0, 0.25, 1] },
    )
    void flight.then(() => {
      el.style.visibility = 'hidden'
      if (!cancelled) landed.current()
    })
    return () => {
      cancelled = true
      flight.stop()
    }
  }, [from, to, reduceMotion, landed])
  return createPortal(
    <span ref={flyer} className={styles.flyingBookmark} aria-hidden="true">
      <Bookmark size={19} strokeWidth={1.8} fill="currentColor" />
    </span>,
    document.body,
  )
}
