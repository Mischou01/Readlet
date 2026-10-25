import { FolderOpen, Highlighter, PencilLine, Play, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Button, IconButton } from '../components/Button'
import { Cover } from '../components/Cover'
import { ProgressBar } from '../components/Progress'
import { Sheet } from '../components/Sheet'
import {
  formatAuthors,
  formatDay,
  formatFileSize,
  formatIdentifier,
  formatLanguage,
  formatPercent,
  formatPublished,
  formatSeries,
  pluralize,
} from '../lib/format'
import { isAndroid } from '../lib/platform'
import { htmlToParagraphs } from '../lib/text'
import type { ReadingStatus } from '../lib/types'
import { useApp } from '../state/app'
import { useLibraryBook } from '../state/library'
import { usePreferences } from '../state/preferences'
import { openBook, revealBook } from './actions'
import styles from './details.module.css'
import { EditDetails } from './EditDetailsForm'
import { seriesAnchor } from './model'

/** Shows the library sorted by series, scrolled to this one. */
function showSeries(series: string) {
  usePreferences.getState().update({ library: { sort: 'series', tab: 'all', shelf: null } })
  useApp.getState().showDetails(null)
  requestAnimationFrame(() =>
    document
      .getElementById(seriesAnchor(series))
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
  )
}

/** Shown as a line rather than a control: changing it from here reshuffled the library behind
 * the sheet, and it looked like the library's tabs. The book's menu has "Mark as". */
const STATUS_LABELS: Record<ReadingStatus, string> = {
  toRead: 'To read',
  reading: 'Reading',
  finished: 'Finished',
}

/** Descriptions longer than this many characters are folded until "More" is pressed. */
const FOLDED_LENGTH = 420

/** Everything Readlet knows about a book, with what can be done to it. */
export function BookDetailsSheet({ fingerprint }: { fingerprint: string }) {
  const book = useLibraryBook(fingerprint)
  const close = () => useApp.getState().showDetails(null)
  const cover = useRef<HTMLButtonElement>(null)
  const [unfolded, setUnfolded] = useState(false)
  // Opened to edit, the sheet closes when the edit is done: there was no "About" page before it.
  const [editedOnly] = useState(() => useApp.getState().editingDetails)
  const [editing, setEditing] = useState(editedOnly)
  const description = book?.entry.description
  const paragraphs = useMemo(
    () => (description ? htmlToParagraphs(description) : []),
    [description],
  )

  if (!book) return null
  const { entry } = book
  const authors = formatAuthors(book.authors)
  const started = book.fraction > 0
  const long = paragraphs.join(' ').length > FOLDED_LENGTH
  const folded = long && !unfolded
  const identifier = entry.identifier ? formatIdentifier(entry.identifier) : null
  const facts: [string, string][] = [
    ['Format', `${entry.format.toUpperCase()} · ${formatFileSize(entry.size)}`],
    ...(entry.language ? [['Language', formatLanguage(entry.language)] as [string, string]] : []),
    ...(entry.publisher ? [['Publisher', entry.publisher] as [string, string]] : []),
    ...(entry.published
      ? [['Published', formatPublished(entry.published)] as [string, string]]
      : []),
    ...(identifier ? [['Identifier', identifier] as [string, string]] : []),
    ['Added', formatDay(entry.addedAt)],
    ['File', entry.path],
  ]

  if (editing) {
    return <EditDetails entry={entry} onDone={editedOnly ? close : () => setEditing(false)} />
  }

  return (
    <Sheet
      title="About this book"
      onClose={close}
      style={{ top: 82 }}
      actions={
        <IconButton label="Edit details" onClick={() => setEditing(true)}>
          <PencilLine size={18} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
      }
    >
      <div className={styles.head}>
        <button
          ref={cover}
          type="button"
          className={styles.coverButton}
          aria-label={`Open ${book.title}`}
          onClick={() => openBook(book, { from: cover.current })}
        >
          <Cover entry={entry} title={book.title} authors={book.authors} width={104} />
        </button>
        <div className={styles.headText}>
          <h3 className={styles.title} data-selectable>
            {book.title}
          </h3>
          {authors && <p className={styles.authors}>{authors}</p>}
          {entry.series && (
            <button
              type="button"
              className={styles.series}
              title="Show the series in your library"
              onClick={() => showSeries(entry.series ?? '')}
            >
              {formatSeries(entry.series, entry.seriesIndex)}
            </button>
          )}
        </div>
      </div>

      {entry.drm ? (
        <p className={styles.drm}>
          This book is protected by DRM, so Readlet can’t open it. A DRM-free copy from the store
          will open here.
        </p>
      ) : (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="small"
            icon={<Play size={16} fill="currentColor" aria-hidden="true" />}
            onClick={() => openBook(book, { from: cover.current })}
          >
            {started ? 'Resume' : 'Start reading'}
          </Button>
          {book.highlights.length > 0 && (
            <Button
              size="small"
              icon={<Highlighter size={16} strokeWidth={1.8} aria-hidden="true" />}
              onClick={() =>
                useApp.getState().navigate({ name: 'highlights', book: book.fingerprint })
              }
            >
              {pluralize(book.highlights.length, 'highlight')}
            </Button>
          )}
        </div>
      )}

      <section className={styles.section} aria-label="Reading">
        <p className={styles.status}>
          {STATUS_LABELS[book.status]}
          {book.status === 'finished' && book.statusAt ? ` · ${formatDay(book.statusAt)}` : ''}
        </p>
        {started && book.status !== 'finished' && (
          <div className={styles.progress}>
            <ProgressBar
              value={book.fraction}
              height={4}
              label={`Progress in ${book.title}`}
              color={entry.palette?.accent ?? 'var(--accent)'}
            />
            <span>
              {formatPercent(book.fraction)}
              {book.lastReadAt ? ` · ${formatDay(book.lastReadAt)}` : ''}
            </span>
          </div>
        )}
      </section>

      {paragraphs.length > 0 && (
        <section className={styles.section} aria-label="Description">
          <div className={styles.description} data-folded={folded || undefined} data-selectable>
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {long && (
            <button
              type="button"
              className={styles.more}
              aria-expanded={unfolded}
              onClick={() => setUnfolded((u) => !u)}
            >
              {unfolded ? 'Less' : 'More'}
            </button>
          )}
        </section>
      )}

      <dl className={styles.facts}>
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd data-selectable>{value}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.footer}>
        {!isAndroid && (
          <Button
            size="small"
            variant="quiet"
            icon={<FolderOpen size={16} strokeWidth={1.8} aria-hidden="true" />}
            onClick={() => void revealBook(book.fingerprint)}
          >
            Show in folder
          </Button>
        )}
        <Button
          size="small"
          variant="danger"
          icon={<Trash2 size={16} strokeWidth={1.8} aria-hidden="true" />}
          onClick={() => useApp.getState().confirmDelete({ fingerprints: [book.fingerprint] })}
        >
          Delete…
        </Button>
      </div>
    </Sheet>
  )
}
