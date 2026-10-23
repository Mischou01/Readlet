import { BookOpen, Copy, Download, PencilLine, Search, SlidersVertical } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { AuraField } from '../components/AuraField'
import { Button, IconButton } from '../components/Button'
import { Cover } from '../components/Cover'
import { copyText } from '../lib/clipboard'
import { formatAuthors, formatDay, pluralize } from '../lib/format'
import { HIGHLIGHTS, markerBackground } from '../lib/highlightColors'
import { api, toAppError } from '../lib/ipc'
import { pickFolder } from '../lib/platform'
import { HIGHLIGHT_COLORS, type Annotation, type HighlightColor } from '../lib/types'
import { openBook } from '../library/actions'
import type { LibraryBook } from '../library/model'
import { useApp } from '../state/app'
import { useLibraryBooks, useVisibleShelves } from '../state/library'
import { showError, useToasts } from '../state/toasts'
import { useAuraFor, useColorScheme } from '../theme/aura'
import styles from './highlights.module.css'
import {
  booksWithHighlights,
  citation,
  countHighlights,
  exportFiles,
  groupHighlights,
} from './model'

/** Every highlight in one place, with filters, search and Markdown export (docs/PLAN.md §6). */
export function HighlightsView({ initialBook }: { initialBook?: string }) {
  const books = useLibraryBooks()
  const shelves = useVisibleShelves()
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const dark = useColorScheme() === 'dark'
  const [book, setBook] = useState<string | null>(initialBook ?? null)
  const [color, setColor] = useState<HighlightColor | null>(null)
  const [shelfId, setShelfId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)

  const withHighlights = useMemo(() => booksWithHighlights(books), [books])
  const counts = useMemo(() => countHighlights(books), [books])
  const shelf = shelves.find((s) => s.id === shelfId) ?? null
  const groups = useMemo(
    () =>
      groupHighlights(books, {
        book,
        color,
        shelf: shelf ? new Set(shelf.books) : null,
        query,
      }),
    [books, book, color, shelf, query],
  )
  const selected = withHighlights.find((b) => b.fingerprint === book) ?? null
  useAuraFor(selected?.entry.palette ?? withHighlights[0]?.entry.palette)

  const exportMarkdown = async () => {
    const scope = selected ? [selected] : withHighlights
    if (scope.length === 0) return
    let dir: string | null
    try {
      dir = await pickFolder('Export highlights to a folder')
    } catch (e) {
      showError(toAppError(e).message)
      return
    }
    if (!dir) return
    setExporting(true)
    try {
      const written = await api.exportMarkdown(dir, exportFiles(scope, Date.now()))
      useToasts.getState().show({ message: `Exported ${pluralize(written, 'file')} to ${dir}` })
    } catch (e) {
      showError(`Couldn’t export your highlights: ${toAppError(e).message}`)
    } finally {
      setExporting(false)
    }
  }

  const actions = (
    <IconButton glass label="Settings" onClick={() => setSettingsOpen(true)}>
      <SlidersVertical size={19} strokeWidth={1.8} aria-hidden="true" />
    </IconButton>
  )

  return (
    <div className={styles.page}>
      <AuraField placement="corner" />
      <AppHeader section="highlights" actions={actions} />
      <main className={styles.main}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title}>Highlights</h1>
            <p className={styles.summary}>
              {counts.highlights === 0
                ? 'Passages you highlight while reading gather here'
                : `${pluralize(counts.highlights, 'highlight')} and ${pluralize(counts.notes, 'note')} from ${pluralize(counts.books, 'book')}`}
            </p>
          </div>
          {counts.highlights > 0 && (
            <div className={styles.titleActions}>
              <label className={styles.search}>
                <Search size={18} strokeWidth={1.8} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search highlights and notes"
                  placeholder="Search highlights and notes"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === 'Escape' && query && (e.preventDefault(), setQuery(''))
                  }
                />
              </label>
              <Button
                variant="primary"
                icon={<Download size={17} strokeWidth={1.8} aria-hidden="true" />}
                disabled={exporting}
                onClick={() => void exportMarkdown()}
                title={
                  selected
                    ? `Export the highlights from “${selected.title}”`
                    : 'Export the highlights from every book, one file per book'
                }
              >
                Export to Markdown
              </Button>
            </div>
          )}
        </div>

        {counts.highlights === 0 ? (
          <NoHighlights />
        ) : (
          <div className={styles.layout}>
            <nav className={styles.filters} aria-label="Filter highlights">
              <div>
                <h2 className={styles.filterHeading}>Books</h2>
                <div className={styles.bookFilters}>
                  <button
                    type="button"
                    className={styles.bookFilter}
                    aria-pressed={book === null}
                    onClick={() => setBook(null)}
                  >
                    <span className={styles.allBooks} aria-hidden="true" />
                    <span className={styles.bookFilterTitle}>All books</span>
                    <span className={styles.count}>{counts.highlights}</span>
                  </button>
                  {withHighlights.map((b) => (
                    <button
                      key={b.fingerprint}
                      type="button"
                      className={styles.bookFilter}
                      aria-pressed={book === b.fingerprint}
                      onClick={() => setBook(b.fingerprint)}
                    >
                      <Cover entry={b.entry} title={b.title} authors={b.authors} width={24} />
                      <span className={styles.bookFilterTitle}>{b.title}</span>
                      <span className={styles.count}>{b.highlights.length}</span>
                    </button>
                  ))}
                </div>
              </div>
              {shelves.length > 0 && (
                <div>
                  <h2 className={styles.filterHeading}>Shelves</h2>
                  <div className={styles.chips}>
                    <button
                      type="button"
                      className={styles.chip}
                      aria-pressed={shelfId === null}
                      onClick={() => setShelfId(null)}
                    >
                      Any shelf
                    </button>
                    {shelves.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={styles.chip}
                        aria-pressed={shelfId === s.id}
                        onClick={() => setShelfId(s.id)}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h2 className={styles.filterHeading}>Colour</h2>
                <div className={styles.swatches}>
                  <button
                    type="button"
                    className={styles.swatchButton}
                    aria-label="Any colour"
                    title="Any colour"
                    aria-pressed={color === null}
                    onClick={() => setColor(null)}
                  >
                    <span className={`${styles.swatch} ${styles.anyColour}`} />
                  </button>
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={styles.swatchButton}
                      aria-label={HIGHLIGHTS[c].label}
                      title={HIGHLIGHTS[c].label}
                      aria-pressed={color === c}
                      onClick={() => setColor(c)}
                    >
                      <span className={styles.swatch} style={{ background: HIGHLIGHTS[c].hex }} />
                    </button>
                  ))}
                </div>
              </div>
            </nav>

            <div className={styles.groups}>
              {groups.map((g) => (
                <BookGroup
                  key={g.book.fingerprint}
                  book={g.book}
                  highlights={g.highlights}
                  dark={dark}
                />
              ))}
              {groups.length === 0 && (
                <p className={styles.empty} role="status">
                  {query.trim()
                    ? `No highlights or notes match “${query.trim()}”.`
                    : 'No highlights match these filters. Pick another colour or show all books.'}
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function BookGroup({
  book,
  highlights,
  dark,
}: {
  book: LibraryBook
  highlights: Annotation[]
  dark: boolean
}) {
  const author = formatAuthors(book.authors)
  return (
    <section aria-label={book.title}>
      <div className={styles.groupHeader}>
        <Cover entry={book.entry} title={book.title} authors={book.authors} width={40} />
        <div className={styles.groupText}>
          <h2 className={styles.groupTitle}>{book.title}</h2>
          {author && <div className={styles.muted}>{author}</div>}
        </div>
        <Button size="small" onClick={() => openBook(book)}>
          Open book
        </Button>
      </div>
      <div className={styles.items}>
        {highlights.map((h) => (
          <HighlightItem key={h.id} book={book} highlight={h} dark={dark} />
        ))}
      </div>
    </section>
  )
}

function HighlightItem({
  book,
  highlight,
  dark,
}: {
  book: LibraryBook
  highlight: Annotation
  dark: boolean
}) {
  const copy = async () => {
    const ok = await copyText(citation(book, highlight))
    if (ok) useToasts.getState().show({ message: 'Copied to the clipboard' })
    else showError('Couldn’t copy the highlight')
  }
  return (
    <article className={styles.item}>
      <blockquote className={styles.quote} data-selectable>
        <span style={{ backgroundImage: markerBackground(highlight.color, dark) }}>
          {highlight.text}
        </span>
      </blockquote>
      {highlight.note?.trim() && (
        <p className={styles.note} data-selectable>
          <PencilLine size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{highlight.note}</span>
        </p>
      )}
      <div className={styles.meta}>
        {highlight.chapter && <span>{highlight.chapter}</span>}
        <span>{formatDay(highlight.createdAt)}</span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.link}
          onClick={() => openBook(book, { target: highlight.cfi })}
        >
          <BookOpen size={15} strokeWidth={1.8} aria-hidden="true" />
          Go to passage
        </button>
        <IconButton label="Copy highlight" className={styles.copy} onClick={() => void copy()}>
          <Copy size={15} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
      </div>
    </article>
  )
}

function NoHighlights() {
  return (
    <div className={styles.noHighlights}>
      <h2>No highlights yet</h2>
      <p>
        While reading, select a passage and pick a colour. Every highlight and note you make lands
        here, grouped by book, ready to search or export to Markdown.
      </p>
    </div>
  )
}
