import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { formatPercent, formatTimeLeft } from '../lib/format'
import { useLatest } from '../lib/hooks'
import type { SectionPages } from './BookView'
import styles from './reader.module.css'

/** Where a chapter starts, as a fraction of the book, and its name. */
export interface ChapterMark {
  fraction: number
  label: string
  /** A part or chapter, rather than a section within one: these get a notch on the bar. */
  top: boolean
}

/** More chapters than this and the notches would run together into a dotted line. */
const MAX_NOTCHES = 60

interface ReaderFooterProps {
  /** While the toolbar is away, so is the footer on a phone; elsewhere the bar is only a gauge. */
  chromeHidden: boolean
  fraction: number
  /** Minutes left in the chapter at the reader's own pace. */
  minutesLeft: number | null
  /** Where the reader is in the chapter, in screens (paginated text only). */
  sectionPages: SectionPages | null
  pageLabel?: string
  /** Where the bookmarks are, as fractions of the book. */
  bookmarks: number[]
  /** In book order. */
  chapters: ChapterMark[]
  onSeek: (fraction: number) => void
}

/** The chapter that `fraction` falls in. */
function chapterAt(chapters: ChapterMark[], fraction: number): string | undefined {
  let label: string | undefined
  for (const c of chapters) {
    if (c.fraction > fraction) break
    label = c.label
  }
  return label
}

/**
 * Time and pages left in the chapter, and progress, with marks for bookmarks and notches where
 * chapters start. An invisible slider over the bar goes elsewhere in the book: while it's dragged,
 * it shows the chapter it would land in, and it goes there once let go; on the desktop, pointing at
 * the bar shows the same.
 */
export function ReaderFooter({
  chromeHidden,
  fraction,
  minutesLeft,
  sectionPages,
  pageLabel,
  bookmarks,
  chapters,
  onSeek,
}: ReaderFooterProps) {
  /**
   * Where the slider was moved to, from position `at`. It shows there until the book has moved
   * (`fraction` changes), so the bar doesn't spring back while the new place loads.
   */
  const [draft, setDraft] = useState<{ to: number; at: number } | null>(null)
  /** It's being dragged (or clicked): not let go of yet. */
  const [moving, setMoving] = useState(false)
  /** Where the pointer is over the bar (mouse and pen only). */
  const [pointing, setPointing] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const seek = useLatest(onSeek)

  // A range input reports each move as `input` (React's onChange) and the value it's let go at
  // as `change`: once at the end of a drag or a click, and on every step from the keyboard.
  useEffect(() => {
    const el = input.current
    if (!el) return
    const commit = () => {
      setMoving(false)
      seek.current(Number(el.value) / 1000)
    }
    el.addEventListener('change', commit)
    return () => el.removeEventListener('change', commit)
  }, [seek])

  const shown = draft && draft.at === fraction ? draft.to : fraction
  const pct = Math.round(shown * 1000) / 10
  const preview = moving ? shown : pointing
  const previewChapter = preview != null ? chapterAt(chapters, preview) : undefined
  const chapter = chapterAt(chapters, shown)
  const notches = chapters.filter((c) => c.top && c.fraction > 0.001)

  const point = (e: PointerEvent<HTMLInputElement>) => {
    if (e.pointerType === 'touch') return
    const box = e.currentTarget.getBoundingClientRect()
    setPointing(box.width > 0 ? Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) : null)
  }

  return (
    <footer className={styles.footer} data-chrome-hidden={chromeHidden || undefined}>
      <div className={styles.footerText}>
        <span className={styles.chapterProgress}>
          <span>{minutesLeft != null ? formatTimeLeft(minutesLeft, 'chapter') : ''}</span>
          {sectionPages && (
            <span
              aria-label={`Page ${sectionPages.current} of ${sectionPages.total} in this chapter`}
            >
              {sectionPages.current} / {sectionPages.total} pages
            </span>
          )}
        </span>
        <span>
          {pageLabel ? `Page ${pageLabel} · ${formatPercent(fraction)}` : formatPercent(fraction)}
        </span>
      </div>
      <div className={styles.seek} data-moving={moving || undefined}>
        <div className={styles.seekFill} style={{ width: `${pct}%` }} />
        {notches.length <= MAX_NOTCHES &&
          notches.map((c, i) => (
            <span
              key={i}
              className={styles.seekNotch}
              style={{ left: `${c.fraction * 100}%` }}
              aria-hidden="true"
            />
          ))}
        {bookmarks.map((f, i) => (
          <span
            key={i}
            className={styles.seekMark}
            style={{ left: `${f * 100}%` }}
            aria-hidden="true"
          />
        ))}
        {preview != null && (
          <span
            className={styles.seekPreview}
            style={{ left: `clamp(80px, ${preview * 100}%, calc(100% - 80px))` }}
            aria-hidden="true"
          >
            {previewChapter && <span className={styles.seekPreviewChapter}>{previewChapter}</span>}
            <span>{formatPercent(preview)}</span>
          </span>
        )}
        <input
          ref={input}
          type="range"
          min={0}
          max={1000}
          value={Math.round(shown * 1000)}
          aria-label="Position in book"
          aria-valuetext={chapter ? `${formatPercent(shown)}, ${chapter}` : formatPercent(shown)}
          onPointerMove={point}
          onPointerLeave={() => setPointing(null)}
          onChange={(e) => {
            setMoving(true)
            setDraft({ to: Number(e.target.value) / 1000, at: fraction })
          }}
        />
      </div>
    </footer>
  )
}
