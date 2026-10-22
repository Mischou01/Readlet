import { Check, ChevronDown, LayoutGrid, List, MoreHorizontal } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useMemo, useState, type MouseEvent } from 'react'
import { Button } from '../components/Button'
import { Cover } from '../components/Cover'
import { Dialog } from '../components/Dialog'
import fieldStyles from '../components/fields.module.css'
import { Menu, MenuButton, type MenuAnchor, type MenuEntry } from '../components/Menu'
import { ProgressBar } from '../components/Progress'
import { formatAuthors, formatDay, formatPercent, pluralize } from '../lib/format'
import { newId } from '../lib/ids'
import type { ReadingStatus, Shelf } from '../lib/types'
import { useApp } from '../state/app'
import { useVisibleShelves } from '../state/library'
import { usePreferences, type LibrarySort, type LibraryTab } from '../state/preferences'
import { useToasts } from '../state/toasts'
import { openBook, revealBook } from './actions'
import styles from './library.module.css'
import { filterBooks, sortBooks, type LibraryBook } from './model'
import { useBookSelection, type BookSelection } from './selection'
import { SelectionBar } from './SelectionBar'
import { deleteShelf, saveShelf, setStatusOf, shelfHasAll, toggleShelf } from './shelves'

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

/** What a new shelf starts with, and whether it was made from a selection. */
interface ShelfDialogState {
  shelf: Shelf | null
  books?: string[]
}

/** The tabs, sort and view controls, and the books themselves. */
export function BookCollection({ books, query }: { books: LibraryBook[]; query: string }) {
  const { tab, sort, layout, shelf: shelfId } = usePreferences((s) => s.prefs.library)
  const update = usePreferences((s) => s.update)
  const shelves = useVisibleShelves()
  const shelf = shelves.find((s) => s.id === shelfId) ?? null
  const [menu, setMenu] = useState<{ book: LibraryBook; anchor: MenuAnchor } | null>(null)
  const [shelfDialog, setShelfDialog] = useState<ShelfDialogState | null>(null)

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
  const visibleIds = useMemo(() => visible.map((b) => b.fingerprint), [visible])
  const selection = useBookSelection(visibleIds)

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

  // Ctrl/Cmd-click and Shift-click select (as in a file manager); while selecting, clicks do.
  const onBookClick = (book: LibraryBook, e: MouseEvent<HTMLElement>) => {
    if (selection.selecting || e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault()
      selection.click(book.fingerprint, { range: e.shiftKey })
    } else {
      openBook(book, { from: e.currentTarget })
    }
  }

  // The menu of a book that's part of a selection acts on the whole selection.
  const menuBooks =
    menu && selection.selected.length > 1 && selection.has(menu.book.fingerprint)
      ? selection.selected
      : null

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
          {!selection.selecting && visible.length > 0 && (
            <button type="button" className={styles.dropdown} onClick={() => selection.start()}>
              Select
            </button>
          )}
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
      ) : (
        <ul
          className={layout === 'grid' ? styles.grid : styles.list}
          data-selecting={selection.selecting || undefined}
        >
          {visible.map((book) => {
            const Item = layout === 'grid' ? BookTile : BookRow
            return (
              <Item
                key={book.fingerprint}
                book={book}
                selection={selection}
                onClick={onBookClick}
                onMenu={openMenu}
              />
            )
          })}
        </ul>
      )}

      {menu && (
        <Menu
          anchor={menu.anchor}
          align="end"
          label={
            menuBooks
              ? `Actions for ${pluralize(menuBooks.length, 'book')}`
              : `Actions for ${menu.book.title}`
          }
          items={
            menuBooks
              ? selectionMenuItems(menuBooks, books, shelves, {
                  newShelf: () => setShelfDialog({ shelf: null, books: menuBooks }),
                  done: selection.exit,
                })
              : bookMenuItems(menu.book, shelves, {
                  newShelf: () => setShelfDialog({ shelf: null, books: [menu.book.fingerprint] }),
                  select: () => selection.start(menu.book.fingerprint),
                })
          }
          onClose={() => setMenu(null)}
        />
      )}
      {shelfDialog && (
        <ShelfDialog
          shelf={shelfDialog.shelf}
          books={shelfDialog.books}
          onCreated={() => {
            if ((shelfDialog.books?.length ?? 0) > 1) selection.exit()
          }}
          onClose={() => setShelfDialog(null)}
        />
      )}
      <AnimatePresence>
        {selection.selecting && (
          <SelectionBar
            count={selection.selected.length}
            total={visible.length}
            onSelectAll={selection.selectAll}
            onDone={selection.exit}
            shelfItems={shelfMenuItems(selection.selected, shelves, {
              newShelf: () => setShelfDialog({ shelf: null, books: selection.selected }),
              done: selection.exit,
            })}
            statusItems={statusMenuItems(
              selection.selected,
              commonStatus(selection.selected, books),
              selection.exit,
            )}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

function emptyMessage(tab: LibraryTab, query: string, shelf: Shelf | null): string {
  if (query) return `No books match “${query}”.`
  if (shelf)
    return `“${shelf.name}” is empty. Add books from their menu, or select several at once.`
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
  selection: BookSelection
  onClick: (book: LibraryBook, e: MouseEvent<HTMLElement>) => void
  onMenu: (book: LibraryBook, e: MouseEvent) => void
}

/** The round tick on a book: shows on hover, and on every book while selecting. */
function SelectToggle({ book, selection }: Pick<ItemProps, 'book' | 'selection'>) {
  const selected = selection.has(book.fingerprint)
  return (
    <button
      type="button"
      className={styles.selectToggle}
      aria-label={`Select ${book.title}`}
      aria-pressed={selected}
      onClick={(e) => selection.click(book.fingerprint, { range: e.shiftKey })}
    >
      {selected && <Check size={15} strokeWidth={3} aria-hidden="true" />}
    </button>
  )
}

function BookTile({ book, selection, onClick, onMenu }: ItemProps) {
  const selected = selection.selecting && selection.has(book.fingerprint)
  return (
    <li
      className={styles.tile}
      data-selected={selected || undefined}
      onContextMenu={(e) => onMenu(book, e)}
    >
      <SelectToggle book={book} selection={selection} />
      <button
        type="button"
        className={styles.tileButton}
        aria-pressed={selection.selecting ? selected : undefined}
        onClick={(e) => onClick(book, e)}
      >
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

function BookRow({ book, selection, onClick, onMenu }: ItemProps) {
  const lastRead = book.lastReadAt ? formatDay(book.lastReadAt) : ''
  const selected = selection.selecting && selection.has(book.fingerprint)
  return (
    <li
      className={styles.row}
      data-selected={selected || undefined}
      onContextMenu={(e) => onMenu(book, e)}
    >
      <button
        type="button"
        className={styles.rowMain}
        aria-pressed={selection.selecting ? selected : undefined}
        onClick={(e) => onClick(book, e)}
      >
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
      {selection.selecting && <SelectToggle book={book} selection={selection} />}
    </li>
  )
}

interface MenuActions {
  newShelf: () => void
  /** Called once a change is saved (ends a selection). */
  done?: () => void
}

function statusMenuItems(
  fingerprints: string[],
  status: ReadingStatus | null,
  done?: () => void,
): MenuEntry[] {
  const entry = (s: ReadingStatus): MenuEntry => ({
    id: s,
    label: STATUS_LABELS[s],
    checked: status === s,
    onSelect: () => void setStatusOf(fingerprints, s).then((ok) => ok && done?.()),
  })
  return [entry('reading'), entry('toRead'), entry('finished')]
}

function shelfMenuItems(fingerprints: string[], shelves: Shelf[], actions: MenuActions) {
  return [
    ...shelves.map((shelf): MenuEntry => ({
      id: `shelf-${shelf.id}`,
      label: shelf.name,
      checked: shelfHasAll(shelf, fingerprints),
      onSelect: () => void toggleShelf(shelf, fingerprints).then((ok) => ok && actions.done?.()),
    })),
    ...(shelves.length ? [{ separator: true, id: 's-new-shelf' } as const] : []),
    {
      id: 'new-shelf',
      label: fingerprints.length > 1 ? 'New shelf with these books…' : 'New shelf…',
      onSelect: actions.newShelf,
    },
  ]
}

/** The status shared by all the books, if they have one in common. */
function commonStatus(fingerprints: string[], books: LibraryBook[]): ReadingStatus | null {
  const statuses = new Set(
    books.filter((b) => fingerprints.includes(b.fingerprint)).map((b) => b.status),
  )
  const [only] = statuses
  return statuses.size === 1 && only ? only : null
}

function bookMenuItems(
  book: LibraryBook,
  shelves: Shelf[],
  actions: MenuActions & { select: () => void },
): MenuEntry[] {
  const navigate = useApp.getState().navigate
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
    { id: 'select', label: 'Select', onSelect: actions.select },
    { separator: true, id: 's1' },
    { heading: 'Mark as', id: 'h-status' },
    ...statusMenuItems([book.fingerprint], book.status),
    { separator: true, id: 's2' },
    { heading: 'Shelves', id: 'h-shelves' },
    ...shelfMenuItems([book.fingerprint], shelves, actions),
  ]
}

/** The menu for several selected books. */
function selectionMenuItems(
  fingerprints: string[],
  books: LibraryBook[],
  shelves: Shelf[],
  actions: Required<MenuActions>,
): MenuEntry[] {
  return [
    { heading: 'Mark as', id: 'h-status' },
    ...statusMenuItems(fingerprints, commonStatus(fingerprints, books), actions.done),
    { separator: true, id: 's2' },
    { heading: 'Shelves', id: 'h-shelves' },
    ...shelfMenuItems(fingerprints, shelves, actions),
  ]
}

/** Renames `shelf`, or creates a shelf holding `books`. */
function ShelfDialog({
  shelf,
  books,
  onCreated,
  onClose,
}: {
  shelf: Shelf | null
  books?: string[]
  onCreated: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(shelf?.name ?? '')
  const valid = name.trim().length > 0 && name.trim().length <= 100
  const submit = async () => {
    if (!valid) return
    const id = shelf?.id ?? newId()
    const trimmed = name.trim()
    const saved = await saveShelf({ id, name: trimmed, books: shelf?.books ?? books ?? [] })
    if (!saved) return
    onClose()
    if (shelf) return
    onCreated()
    const count = books?.length ?? 0
    // An empty shelf, or one made from a selection, opens so you can see what's on it.
    if (count !== 1) usePreferences.getState().update({ library: { shelf: id } })
    if (count > 1) {
      useToasts.getState().show({ message: `Put ${pluralize(count, 'book')} on “${trimmed}”` })
    }
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
