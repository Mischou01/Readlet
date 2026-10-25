// Library actions shared by the header, menus and drag and drop.

import { open } from '@tauri-apps/plugin-dialog'
import { api, toAppError } from '../lib/ipc'
import { isAndroid, pickFolder } from '../lib/platform'
import { formatList, pluralize } from '../lib/format'
import { bookTitle } from '../lib/text'
import { useApp, type OpeningCover } from '../state/app'
import { expectAddedFiles, expectDeleted, useLibrary } from '../state/library'
import { showError, useToasts } from '../state/toasts'
import { resetIndexer } from './indexer'

export const BOOK_EXTENSIONS = [
  'epub',
  'mobi',
  'azw3',
  'azw',
  'prc',
  'fb2',
  'fbz',
  'zip',
  'cbz',
  'pdf',
]

/** Copies books into the library folder; the watcher indexes them. */
export async function addBookFiles(paths: string[]) {
  if (paths.length === 0) return
  await addBooks(() => api.addBooks(paths), paths.length)
}

/**
 * Runs `add` and reports how it went; `offered` is how many files were picked, if known. `add`
 * returns `null` when nothing was picked.
 */
async function addBooks(add: () => Promise<string[] | null>, offered?: number) {
  try {
    const added = await add()
    if (!added) return
    expectAddedFiles(added)
    const skipped = offered === undefined ? 0 : offered - added.length
    const message =
      added.length === 0
        ? 'Those books are already in your library'
        : `Added ${pluralize(added.length, 'book')}${skipped ? `; ${skipped} skipped` : ''}`
    useToasts.getState().show({ message })
  } catch (e) {
    showError(`Couldn’t add the books: ${toAppError(e).message}`)
  }
}

export async function pickAndAddBooks() {
  // Android's picker hands over documents rather than paths; the core copies them in.
  if (isAndroid) return addBooks(api.importBooks)
  let selected: string | string[] | null
  try {
    selected = await open({
      multiple: true,
      title: 'Add books',
      filters: [{ name: 'Books', extensions: BOOK_EXTENSIONS }],
    })
  } catch (e) {
    showError(`Couldn’t choose books: ${toAppError(e).message}`)
    return
  }
  if (selected) await addBookFiles(Array.isArray(selected) ? selected : [selected])
}

/** Asks for a library folder and switches to it. Returns false if the reader cancelled. */
export async function pickLibraryFolder(): Promise<boolean> {
  let dir: string | null
  try {
    dir = await pickFolder('Choose your books folder')
  } catch (e) {
    showError(toAppError(e).message)
    return false
  }
  if (!dir) return false
  try {
    resetIndexer()
    useLibrary.getState().reset()
    const info = await api.chooseLibrary(dir)
    useApp.getState().setInfo(info)
    useApp.getState().navigate({ name: 'library' })
    return true
  } catch (e) {
    showError(toAppError(e).message)
    return false
  }
}

export async function revealBook(fingerprint: string) {
  try {
    await api.revealBook(fingerprint)
  } catch (e) {
    showError(toAppError(e).message)
  }
}

interface OpenableBook {
  fingerprint: string
  title: string
  entry: { drm: boolean }
  /** The devices that have it, when this one doesn't. */
  elsewhere?: string[]
}

/** Where a cover is on screen and what it shows, so the reader can grow it into the page. */
function openingCover(fingerprint: string, from: Element | null | undefined): OpeningCover | null {
  const cover = from?.matches('[data-cover]') ? from : from?.querySelector('[data-cover]')
  if (!(cover instanceof HTMLElement)) return null
  const { x, y, width, height } = cover.getBoundingClientRect()
  if (width === 0 || height === 0) return null
  const image = cover.querySelector('img')?.currentSrc || null
  return {
    fingerprint,
    rect: { x, y, width, height },
    image,
    background: image ? null : cover.style.background || null,
  }
}

/**
 * Opens a book in the reader, or explains why it can't be opened. `from` is the element that
 * shows the book's cover, which then grows into the page.
 */
export function openBook(
  book: OpenableBook,
  options: { target?: string; readAloud?: boolean; from?: Element | null } = {},
) {
  const { from, ...view } = options
  const app = useApp.getState()
  if (book.elsewhere) {
    app.setNotice({
      title: 'This book is on another device',
      message: `“${book.title}” is on ${formatList(book.elsewhere)}, but not on this one. Put the book’s file in this device’s books folder to read it here: your place, highlights and notes will be waiting.`,
    })
    return
  }
  if (book.entry.drm) {
    app.setNotice({
      title: 'This book is locked',
      message: `“${book.title}” is protected by DRM, which ties it to the app or device it was bought for. Readlet can’t open it. If the store offers a DRM-free download, that copy will open here.`,
    })
    return
  }
  app.setOpening(openingCover(book.fingerprint, from))
  app.navigate({ name: 'reader', fingerprint: book.fingerprint, ...view })
}

/**
 * Deletes books once the reader has confirmed: to the trash on the desktop, for good on Android.
 * Their reading data stays, so a book added again picks up where it was.
 */
export async function deleteBooks(fingerprints: string[]): Promise<boolean> {
  const library = useLibrary.getState()
  const only = fingerprints.length === 1 ? library.books[fingerprints[0] ?? ''] : undefined
  let report: { deleted: string[]; errors: string[] }
  expectDeleted(fingerprints)
  try {
    report = await api.deleteBooks(fingerprints)
  } catch (e) {
    expectDeleted(fingerprints, false)
    showError(
      `Couldn’t delete ${only ? `“${bookTitle(only)}”` : 'the books'}: ${toAppError(e).message}`,
    )
    return false
  }
  const { deleted, errors } = report
  expectDeleted(
    fingerprints.filter((fp) => !deleted.includes(fp)),
    false,
  )
  library.removeBooks(deleted)
  const app = useApp.getState()
  if (app.details && deleted.includes(app.details)) app.showDetails(null)
  if (errors.length) {
    showError(
      deleted.length
        ? `Deleted ${pluralize(deleted.length, 'book')}; ${errors.length.toLocaleString()} couldn’t be: ${errors[0]}`
        : `Couldn’t delete ${only ? `“${bookTitle(only)}”` : 'the books'}: ${errors[0]}`,
    )
    return deleted.length > 0
  }
  const what = only ? `“${bookTitle(only)}”` : pluralize(deleted.length, 'book')
  useToasts
    .getState()
    .show({ message: isAndroid ? `Deleted ${what}` : `Moved ${what} to the trash` })
  return true
}
