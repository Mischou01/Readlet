import { formatPercent, formatTimeLeft } from '../lib/format'
import styles from './reader.module.css'

interface ReaderFooterProps {
  fraction: number
  /** Minutes left in the chapter at the reader's own pace. */
  minutesLeft: number | null
  pageLabel?: string
  onSeek: (fraction: number) => void
}

/** Time left and progress, with an invisible slider over the bar for jumping around. */
export function ReaderFooter({ fraction, minutesLeft, pageLabel, onSeek }: ReaderFooterProps) {
  const pct = Math.round(fraction * 1000) / 10
  return (
    <footer className={styles.footer}>
      <div className={styles.footerText}>
        <span>{minutesLeft != null ? formatTimeLeft(minutesLeft, 'chapter') : ''}</span>
        <span>
          {pageLabel ? `Page ${pageLabel} · ${formatPercent(fraction)}` : formatPercent(fraction)}
        </span>
      </div>
      <div className={styles.seek}>
        <div className={styles.seekFill} style={{ width: `${pct}%` }} />
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
