import { formatPercent, formatTimeLeft } from '../lib/format'
import type { SectionPages } from './BookView'
import styles from './reader.module.css'

interface ReaderFooterProps {
  fraction: number
  /** Minutes left in the chapter at the reader's own pace. */
  minutesLeft: number | null
  /** Where the reader is in the chapter, in screens (paginated text only). */
  sectionPages: SectionPages | null
  pageLabel?: string
  /** Where the bookmarks are, as fractions of the book. */
  bookmarks: number[]
  /** Tucked away with the toolbar (on phones). */
  hidden: boolean
  onSeek: (fraction: number) => void
}

/**
 * Time and pages left in the chapter, and progress, with marks for bookmarks and an invisible
 * slider over the bar for jumping around.
 */
export function ReaderFooter({
  fraction,
  minutesLeft,
  sectionPages,
  pageLabel,
  bookmarks,
  hidden,
  onSeek,
}: ReaderFooterProps) {
  const pct = Math.round(fraction * 1000) / 10
  return (
    <footer className={styles.footer} data-hidden={hidden || undefined}>
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
      <div className={styles.seek}>
        <div className={styles.seekFill} style={{ width: `${pct}%` }} />
        {bookmarks.map((f, i) => (
          <span
            key={i}
            className={styles.seekMark}
            style={{ left: `${f * 100}%` }}
            aria-hidden="true"
          />
        ))}
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(fraction * 1000)}
          aria-label="Position in book"
          aria-valuetext={formatPercent(fraction)}
          onChange={(e) => onSeek(Number(e.target.value) / 1000)}
        />
      </div>
    </footer>
  )
}
