// What can be done to books, as menu entries. The book's menu (right-click on the desktop), the
// selection bar and its "More" menu all take theirs from here, so every action is reachable the
// same way wherever a book is.

import type { MenuEntry } from '../components/Menu'
import { pluralize } from '../lib/format'
import { isAndroid } from '../lib/platform'
import type { ReadingStatus, Shelf } from '../lib/types'
import { useApp } from '../state/app'
import { openBook, revealBook } from './actions'
import type { LibraryBook } from './model'
import { setStatusOf, shelfHasAll, toggleShelf } from './shelves'

export const STATUS_LABELS: Record<ReadingStatus, string> = {
  reading: 'Reading',
  toRead: 'To read',
  finished: 'Finished',
}

export interface BookMenuContext {
  /** The whole library, to find the books by fingerprint. */
  books: LibraryBook[]
  shelves: Shelf[]
  /** Whether books are being selected: then there's no "Select". */
  selecting: boolean
  select: (fingerprint: string) => void
  newShelf: (fingerprints: string[]) => void
  putInSeries: (fingerprints: string[]) => void
  /** Called once an action is taken on a selection (it ends the selection). */
  done?: () => void
}

/** The status shared by all the books, if they have one in common. */
function commonStatus(fingerprints: string[], books: LibraryBook[]): ReadingStatus | null {
  const statuses = new Set(
    books.filter((b) => fingerprints.includes(b.fingerprint)).map((b) => b.status),
  )
  const [only] = statuses
  return statuses.size === 1 && only ? only : null
}

export function statusItems(fingerprints: string[], ctx: BookMenuContext): MenuEntry[] {
  const status = commonStatus(fingerprints, ctx.books)
  return (['reading', 'toRead', 'finished'] as const).map((s) => ({
    id: s,
    label: STATUS_LABELS[s],
    checked: status === s,
    onSelect: () => void setStatusOf(fingerprints, s).then((ok) => ok && ctx.done?.()),
  }))
}

export function shelfItems(fingerprints: string[], ctx: BookMenuContext): MenuEntry[] {
  return [
    ...ctx.shelves.map((shelf): MenuEntry => ({
      id: `shelf-${shelf.id}`,
      label: shelf.name,
      checked: shelfHasAll(shelf, fingerprints),
      onSelect: () => void toggleShelf(shelf, fingerprints).then((ok) => ok && ctx.done?.()),
    })),
    ...(ctx.shelves.length ? [{ separator: true, id: 's-new-shelf' } as const] : []),
    {
      id: 'new-shelf',
      label: fingerprints.length > 1 ? 'New shelf with these books…' : 'New shelf…',
      onSelect: () => ctx.newShelf(fingerprints),
    },
  ]
}

/** Opening, looking at and editing the books: what the selection bar keeps under "More". */
export function moreItems(fingerprints: string[], ctx: BookMenuContext): MenuEntry[] {
  const app = useApp.getState()
  const then = (action: () => void) => () => {
    ctx.done?.()
    action()
  }
  const book = fingerprints.length === 1 && ctx.books.find((b) => b.fingerprint === fingerprints[0])
  if (book && book.elsewhere) {
    // On another device only: its details and highlights are here, its file isn't. Its details
    // are edited where the file is.
    return [
      {
        id: 'details',
        label: 'About this book',
        onSelect: then(() => app.showDetails(book.fingerprint)),
      },
      ...(book.highlights.length
        ? [
            {
              id: 'hl',
              label: 'Highlights',
              onSelect: then(() => app.navigate({ name: 'highlights', book: book.fingerprint })),
            },
          ]
        : []),
    ]
  }
  if (!book) {
    return [
      {
        id: 'series',
        label: 'Put in a series…',
        onSelect: () => ctx.putInSeries(fingerprints),
      },
    ]
  }
  return [
    { id: 'open', label: 'Open', onSelect: then(() => openBook(book)) },
    {
      id: 'details',
      label: 'About this book',
      onSelect: then(() => app.showDetails(book.fingerprint)),
    },
    {
      id: 'edit',
      label: 'Edit details…',
      onSelect: then(() => app.showDetails(book.fingerprint, { edit: true })),
    },
    ...(book.highlights.length
      ? [
          {
            id: 'hl',
            label: 'Highlights',
            onSelect: then(() => app.navigate({ name: 'highlights', book: book.fingerprint })),
          },
        ]
      : []),
    // Android has no file manager to hand a file to.
    ...(isAndroid
      ? []
      : [
          {
            id: 'reveal',
            label: 'Show in folder',
            onSelect: () => void revealBook(book.fingerprint),
          },
        ]),
    ...(ctx.selecting
      ? []
      : [{ id: 'select', label: 'Select', onSelect: () => ctx.select(book.fingerprint) }]),
  ]
}

export function deleteItem(fingerprints: string[], ctx: BookMenuContext): MenuEntry {
  return {
    id: 'delete',
    label:
      fingerprints.length > 1 ? `Delete ${pluralize(fingerprints.length, 'book')}…` : 'Delete…',
    danger: true,
    onSelect: () => useApp.getState().confirmDelete({ fingerprints, onDeleted: ctx.done }),
  }
}

/** Everything that can be done to the books, as their menu lists it. */
export function bookMenuItems(fingerprints: string[], ctx: BookMenuContext): MenuEntry[] {
  const elsewhere = ctx.books.some((b) => b.elsewhere && fingerprints.includes(b.fingerprint))
  return [
    ...moreItems(fingerprints, ctx),
    { separator: true, id: 's1' },
    { heading: 'Mark as', id: 'h-status' },
    ...statusItems(fingerprints, ctx),
    { separator: true, id: 's2' },
    { heading: 'Shelves', id: 'h-shelves' },
    ...shelfItems(fingerprints, ctx),
    // A book only other devices have has no file here to delete.
    ...(elsewhere ? [] : [{ separator: true, id: 's3' } as const, deleteItem(fingerprints, ctx)]),
  ]
}
