import { Check, ChevronDown, LayoutGrid, List, MoreHorizontal } from 'lucide-react'
import { useMemo, useState, type MouseEvent } from 'react'
import { Button } from '../components/Button'
import { Cover } from '../components/Cover'
import { Dialog } from '../components/Dialog'
import fieldStyles from '../components/fields.module.css'
import { Menu, MenuButton, type MenuAnchor, type MenuEntry } from '../components/Menu'
import { ProgressBar } from '../components/Progress'
import { formatAuthors, formatDay, formatPercent } from '../lib/format'
import { newId } from '../lib/ids'
import { api, toAppError } from '../lib/ipc'
import type { ReadingStatus, Shelf } from '../lib/types'
import { useApp } from '../state/app'
import { useLibrary, useVisibleShelves } from '../state/library'
import { usePreferences, type LibrarySort, type LibraryTab } from '../state/preferences'
import { showError } from '../state/toasts'
import { openBook, revealBook } from './actions'
import styles from './library.module.css'
import { filterBooks, sortBooks, type LibraryBook } from './model'

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reading', label: 'Reading' },
  { id: 'toRead', label: 'To read' },
  { id: 'finished', label: 'Finished' },
]

const SORTS: { id: LibrarySort; label: string }[] = [
  { id: 'recent', label: 'Recently read' },
  { id: 'title', label: 'Title' },
  { id: 'author', label: 'Author' },
  { id: 'added', label: 'Recently added' },
]

const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  toRead: 'To read',
  finished: 'Finished',
}

/** The tabs, sort and view controls, and the books themselves. */
export function BookCollection({ books, query }: { books: LibraryBook[]; query: string }) {
  const { tab, sort, layout, shelf: shelfId } = usePreferences((s) => s.prefs.library)
  const update = usePreferences((s) => s.update)
  const shelves = useVisibleShelves()
  const shelf = shelves.find((s) => s.id === shelfId) ?? null
  const [menu, setMenu] = useState<{ book: LibraryBook; anchor: MenuAnchor } | null>(null)
  const [shelfDialog, setShelfDialog] = useState<{ shelf: Shelf | null; addBook?: string } | null>(
    null,
  )

  const counts = useMemo(() => {
    const c: Record<LibraryTab, number> = { all: 0, reading: 0, toRead: 0, finished: 0 }
    for (const b of filterBooks(books, { tab: 'all', query, shelf })) {
      c.all += 1
      c[b.status] += 1
    }
    return c
  }, [books, query, shelf])

  const visible = useMemo(
    () => sortBooks(filterBooks(books, { tab, query, shelf }), sort),
    [books, tab, query, shelf, sort],
  )

  const shelfItems: MenuEntry[] = [
    {
      id: 'all',
      label: 'All books',
      checked: shelf === null,
      onSelect: () => update({ library: { shelf: null } }),
    },
    ...shelves.map((s) => ({
      id: s.id,
      label: s.name,
      checked: s.id === shelf?.id,
      onSelect: () => update({ library: { shelf: s.id } }),
    })),
    { separator: true, id: 'sep' },
    { id: 'new', label: 'New shelf…', onSelect: () => setShelfDialog({ shelf: null }) },
    ...(shelf
      ? [
          {
            id: 'rename',
            label: `Rename “${shelf.name}”…`,
            onSelect: () => setShelfDialog({ shelf }),
          },
          {
            id: 'delete',
            label: `Delete “${shelf.name}”`,
            danger: true,
            onSelect: () => void deleteShelf(shelf),
          },
        ]
      : []),
  ]

  const openMenu = (book: LibraryBook, e: MouseEvent) => {
    e.preventDefault()
    const anchor =
      e.type === 'contextmenu'
        ? { x: e.clientX, y: e.clientY }
        : (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({ book, anchor })
  }

  return (
    <section className={styles.books} aria-label="Your books">
      <div className={styles.booksBar}>
        <div className={styles.tabs} role="tablist" aria-label="Filter books">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              className={styles.tab}
              onClick={() => update({ library: { tab: t.id } })}
            >
              {t.label}
              {query && <span className={styles.tabCount}>{counts[t.id]}</span>}
            </button>
          ))}
          <MenuButton label="Shelves" items={shelfItems} className={styles.shelfButton}>
            <span data-active={shelf ? '' : undefined}>{shelf ? shelf.name : 'Shelves'}</span>
            <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
          </MenuButton>
        </div>
        <div className={styles.barActions}>
          <MenuButton
            label="Sort books"
            title="Sort books"
            align="end"
            className={styles.dropdown}
            items={SORTS.map((s) => ({
              id: s.id,
              label: s.label,
              checked: s.id === sort,
              onSelect: () => update({ library: { sort: s.id } }),
            }))}
          >
            {SORTS.find((s) => s.id === sort)?.label}
            <ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
          </MenuButton>
          <div className={styles.viewToggle} role="group" aria-label="View">
            <button
              type="button"
              aria-label="Grid view"
              aria-pressed={layout === 'grid'}
              onClick={() => update({ library: { layout: 'grid' } })}
            >
              <LayoutGrid size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="List view"
              aria-pressed={layout === 'list'}
              onClick={() => update({ library: { layout: 'list' } })}
            >
              <List size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className={styles.empty}>{emptyMessage(tab, query, shelf)}</p>
      ) : layout === 'grid' ? (
        <ul className={styles.grid}>
          {visible.map((book) => (
            <BookTile key={book.fingerprint} book={book} onMenu={openMenu} />
          ))}
        </ul>
      ) : (
        <ul className={styles.list}>
          {visible.map((book) => (
            <BookRow key={book.fingerprint} book={book} onMenu={openMenu} />
          ))}
        </ul>
      )}

      {menu && (
        <Menu
          anchor={menu.anchor}
          align="end"
          label={`Actions for ${menu.book.title}`}
          items={bookMenuItems(menu.book, shelves, (fp) =>
            setShelfDialog({ shelf: null, addBook: fp }),
          )}
          onClose={() => setMenu(null)}
        />
      )}
      {shelfDialog && (
        <ShelfDialog
          shelf={shelfDialog.shelf}
          addBook={shelfDialog.addBook}
          onClose={() => setShelfDialog(null)}
        />
      )}
    </section>
  )
}

function emptyMessage(tab: LibraryTab, query: string, shelf: Shelf | null): string {
  if (query) return `No books match “${query}”.`
  if (shelf) return `“${shelf.name}” is empty. Add books to it from their menu.`
  switch (tab) {
    case 'reading':
      return 'Nothing in progress. Open a book to start.'
    case 'toRead':
      return 'Nothing waiting. Books you haven’t started show up here.'
    case 'finished':
      return 'Books you finish will gather here.'
    default:
      return 'No books yet.'
  }
}

interface ItemProps {
  book: LibraryBook
  onMenu: (book: LibraryBook, e: MouseEvent) => void
}

function BookTile({ book, onMenu }: ItemProps) {
  return (
    <li className={styles.tile} onContextMenu={(e) => onMenu(book, e)}>
      <button type="button" className={styles.tileButton} onClick={() => openBook(book)}>
        <Cover entry={book.entry} title={book.title} authors={book.authors} width={150} />
        <span className={styles.tileTitle} title={book.title}>
          {book.title}
        </span>
        <span className={styles.tileAuthor}>{formatAuthors(book.authors) || ' '}</span>
      </button>
      {book.status === 'reading' && (
        <div className={styles.tileProgress}>
          <ProgressBar
            value={book.fraction}
            height={4}
            label={`Progress in ${book.title}`}
            color={book.entry.palette?.accent ?? 'var(--accent)'}
          />
          <span className={styles.numeric} style={{ fontSize: 12 }}>
            {formatPercent(book.fraction)}
          </span>
        </div>
      )}
      {book.status === 'finished' && (
        <div className={styles.tileMeta}>
          <Check size={14} strokeWidth={2.2} aria-hidden="true" />
          Finished
        </div>
      )}
    </li>
  )
}

function BookRow({ book, onMenu }: ItemProps) {
  const lastRead = book.lastReadAt ? formatDay(book.lastReadAt) : ''
  return (
    <li className={styles.row} onContextMenu={(e) => onMenu(book, e)}>
      <button type="button" className={styles.rowMain} onClick={() => openBook(book)}>
        <Cover entry={book.entry} title={book.title} authors={book.authors} width={40} />
        <span>
          <span className={styles.tileTitle} style={{ marginTop: 0 }}>
            {book.title}
          </span>
          <span className={styles.tileAuthor}>{formatAuthors(book.authors)}</span>
        </span>
      </button>
      <span className={styles.numeric}>
        {book.status === 'reading'
          ? `${formatPercent(book.fraction)} read`
          : STATUS_LABELS[book.status]}
      </span>
      <span className={styles.numeric}>{lastRead}</span>
      <button
        type="button"
        className={styles.viewToggle}
        style={{
          border: 'none',
          background: 'transparent',
          width: 44,
          height: 44,
          justifyContent: 'center',
          alignItems: 'center',
        }}
        aria-label={`More actions for ${book.title}`}
        onClick={(e) => onMenu(book, e)}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
    </li>
  )
}

function bookMenuItems(
  book: LibraryBook,
  shelves: Shelf[],
  newShelfWith: (fp: string) => void,
): MenuEntry[] {
  const { setStatus } = useLibrary.getState()
  const navigate = useApp.getState().navigate
  const status = (s: ReadingStatus): MenuEntry => ({
    id: s,
    label: STATUS_LABELS[s],
    checked: book.status === s,
    onSelect: () => setStatus(book.fingerprint, s).catch((e) => showError(toAppError(e).message)),
  })
  return [
    { id: 'open', label: 'Open', onSelect: () => openBook(book) },
    ...(book.highlights.length
      ? [
          {
            id: 'hl',
            label: 'Highlights',
            onSelect: () => navigate({ name: 'highlights', book: book.fingerprint }),
          },
        ]
      : []),
    { id: 'reveal', label: 'Show in folder', onSelect: () => void revealBook(book.fingerprint) },
    { separator: true, id: 's1' },
    { heading: 'Mark as', id: 'h1' },
    status('reading'),
    status('toRead'),
    status('finished'),
    { separator: true, id: 's2' },
    { heading: 'Shelves', id: 'h2' },
    ...shelves.map((shelf) => {
      const on = shelf.books.includes(book.fingerprint)
      return {
        id: `shelf-${shelf.id}`,
        label: shelf.name,
        checked: on,
        onSelect: () =>
          void saveShelf({
            id: shelf.id,
            name: shelf.name,
            books: on
              ? shelf.books.filter((b) => b !== book.fingerprint)
              : [...shelf.books, book.fingerprint],
          }),
      }
    }),
    { id: 'new-shelf', label: 'New shelf…', onSelect: () => newShelfWith(book.fingerprint) },
  ]
}

async function saveShelf(shelf: { id: string; name: string; books: string[] }) {
  try {
    useLibrary.getState().setShelves(await api.putShelf(shelf))
  } catch (e) {
    showError(toAppError(e).message)
  }
}

async function deleteShelf(shelf: Shelf) {
  try {
    useLibrary.getState().setShelves(await api.deleteShelf(shelf.id))
    usePreferences.getState().update({ library: { shelf: null } })
  } catch (e) {
    showError(toAppError(e).message)
  }
}

function ShelfDialog({
  shelf,
  addBook,
  onClose,
}: {
  shelf: Shelf | null
  addBook?: string
  onClose: () => void
}) {
  const [name, setName] = useState(shelf?.name ?? '')
  const valid = name.trim().length > 0 && name.trim().length <= 100
  const submit = async () => {
    if (!valid) return
    const id = shelf?.id ?? newId()
    const books = shelf?.books ?? (addBook ? [addBook] : [])
    await saveShelf({ id, name: name.trim(), books })
    if (!shelf && !addBook) usePreferences.getState().update({ library: { shelf: id } })
    onClose()
  }
  return (
    <Dialog
      title={shelf ? 'Rename shelf' : 'New shelf'}
      onClose={onClose}
      actions={
        <>
          <Button variant="quiet" size="small" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="small" disabled={!valid} onClick={() => void submit()}>
            {shelf ? 'Rename' : 'Create'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        style={{ marginTop: 16 }}
      >
        <label className="visually-hidden" htmlFor="shelf-name">
          Shelf name
        </label>
        <input
          id="shelf-name"
          className={fieldStyles.textInput}
          value={name}
          maxLength={100}
          placeholder="Shelf name"
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Dialog>
  )
}
