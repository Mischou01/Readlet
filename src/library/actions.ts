// Library actions shared by the header, menus and drag and drop.

import { open } from '@tauri-apps/plugin-dialog'
import { api, toAppError } from '../lib/ipc'
import { pluralize } from '../lib/format'
import { useApp, type OpeningCover } from '../state/app'
import { expectAddedFiles, useLibrary } from '../state/library'
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
  try {
    const added = await api.addBooks(paths)
    expectAddedFiles(added)
    const skipped = paths.length - added.length
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
  const selected = await open({
    multiple: true,
    title: 'Add books',
    filters: [{ name: 'Books', extensions: BOOK_EXTENSIONS }],
  })
  if (selected) await addBookFiles(Array.isArray(selected) ? selected : [selected])
}

/** Asks for a library folder and switches to it. Returns false if the reader cancelled. */
export async function pickLibraryFolder(): Promise<boolean> {
  const dir = await open({ directory: true, title: 'Choose your books folder' })
  if (typeof dir !== 'string') return false
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
