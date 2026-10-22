import { BookOpen, Clock, Play, Volume2 } from 'lucide-react'
import { useRef } from 'react'
import { Button } from '../components/Button'
import { Cover } from '../components/Cover'
import { ProgressBar } from '../components/Progress'
import { formatAuthors, formatPercent, formatTimeLeft } from '../lib/format'
import { readPosition } from '../state/positions'
import { usePreferences } from '../state/preferences'
import { paceFor } from '../stats/pace'
import { openBook } from './actions'
import styles from './library.module.css'
import type { LibraryBook } from './model'

/** "Continue reading" (or "Up next" for an unstarted book) at the top of the library. */
export function Hero({ book }: { book: LibraryBook }) {
  const bytesPerMinute = usePreferences((s) => s.prefs.bytesPerMinute)
  const cover = useRef<HTMLButtonElement>(null)
  const started = book.fraction > 0
  const position = readPosition(book.fingerprint)
  const chapter = position?.label ?? book.record?.progress?.label
  const minutesLeft = position
    ? position.bytesLeftInSection / paceFor(bytesPerMinute, position.pace)
    : null
  const authors = formatAuthors(book.authors)

  return (
    <div className={styles.heroBook}>
      <button
        ref={cover}
        type="button"
        className={styles.heroCoverButton}
        aria-label={`Open ${book.title}`}
        onClick={() => openBook(book, { from: cover.current })}
      >
        <Cover entry={book.entry} title={book.title} authors={book.authors} width={210} large />
      </button>
      <div className={styles.heroText}>
        <p className={styles.eyebrow}>{started ? 'Continue reading' : 'Up next'}</p>
        <h1 className={styles.heroTitle}>{book.title}</h1>
        {authors && <p className={styles.heroAuthor}>{authors}</p>}
        {started && (chapter || minutesLeft != null) && (
          <div className={styles.chips}>
            {chapter && (
              <span className={styles.chip}>
                <BookOpen size={16} strokeWidth={1.8} aria-hidden="true" />
                {chapter}
              </span>
            )}
            {minutesLeft != null && (
              <span className={styles.chip}>
                <Clock size={16} strokeWidth={1.8} aria-hidden="true" />
                {formatTimeLeft(minutesLeft, 'chapter')}
              </span>
            )}
          </div>
        )}
        {started && (
          <div className={styles.heroProgress}>
            <ProgressBar value={book.fraction} label={`Progress in ${book.title}`} />
            <span className={styles.numeric}>{formatPercent(book.fraction)}</span>
          </div>
        )}
        <div className={styles.heroActions}>
          <Button
            variant="primary"
            icon={<Play size={18} fill="currentColor" aria-hidden="true" />}
            onClick={() => openBook(book, { from: cover.current })}
          >
            {started ? 'Resume' : 'Start reading'}
          </Button>
          <Button
            icon={<Volume2 size={18} strokeWidth={1.8} aria-hidden="true" />}
            onClick={() => openBook(book, { readAloud: true, from: cover.current })}
          >
            Read aloud
          </Button>
        </div>
      </div>
    </div>
  )
}
