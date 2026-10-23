// The one place (with BookView.tsx) that talks to foliate-js. It turns foliate's loosely typed
// book objects into Readlet's types, so the rest of the app never depends on its API directly.

import {
  makeBook,
  UnsupportedTypeError,
  type Book,
  type Contributor,
  type LanguageMap,
  type View,
} from 'foliate-js/view.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import { collapse as collapseCFI, compare as compareCFI } from 'foliate-js/epubcfi.js'
import { FootnoteHandler } from 'foliate-js/footnotes.js'
import { htmlToText, guessFromFileName } from '../lib/text'
import { injectCsp } from './csp'
import type { BookEntry, BookFormat, BookMetadata } from '../lib/types'
import { bookUrl } from '../lib/urls'

export type { Book, Location, SearchExcerpt, SearchResult, TocItem, View } from 'foliate-js/view.js'
export { collapseCFI, compareCFI, FootnoteHandler, Overlayer }

const EXTENSIONS: Record<BookFormat, string> = {
  epub: '.epub',
  mobi: '.mobi',
  azw3: '.azw3',
  fb2: '.fb2',
  fbz: '.fb2.zip',
  cbz: '.cbz',
  pdf: '.pdf',
}

/** Raised for books Readlet knows it can't open, with a message for the reader. */
export class BookOpenError extends Error {
  readonly reason: 'drm' | 'missing' | 'unsupported' | 'damaged'
  constructor(reason: BookOpenError['reason'], message: string) {
    super(message)
    this.reason = reason
  }
}

/**
 * Loads a book's bytes through the `book://` scheme. foliate-js picks the parser partly from the
 * file name, so the name gets the canonical lowercase extension.
 */
export async function fetchBookFile(
  entry: Pick<BookEntry, 'fingerprint' | 'path' | 'format'>,
): Promise<File> {
  const response = await fetch(bookUrl(entry.fingerprint))
  if (response.status === 404) {
    throw new BookOpenError('missing', 'The book file is no longer in your library folder.')
  }
  if (!response.ok) throw new Error(`Couldn't load the book (${response.status})`)
  const blob = await response.blob()
  const base = (entry.path.split('/').pop() ?? 'book').replace(/(\.fb2)?\.[^.]+$/i, '')
  return new File([blob], base + EXTENSIONS[entry.format], { type: blob.type })
}

function harden(book: Book) {
  const target = book.transformTarget
  if (!target) return
  target.addEventListener('load', ((e: CustomEvent<{ isScript: boolean; allow: boolean }>) => {
    if (e.detail.isScript) e.detail.allow = false
  }) as EventListener)
  target.addEventListener('data', ((e: CustomEvent<{ data: unknown; type: string }>) => {
    const { detail } = e
    if (!/html/i.test(detail.type)) return
    detail.data = Promise.resolve(detail.data).then((data) =>
      typeof data === 'string' ? injectCsp(data, location.origin) : data,
    )
  }) as EventListener)
}

let pdfWorker: Worker | undefined

/**
 * Readlet starts the pdf.js worker itself rather than letting pdf.js load its own script, so the
 * polyfills pdf.js needs can run there first. One worker serves every PDF.
 */
async function preparePdfjs() {
  await import('./pdfjsPolyfills')
  await import('foliate-js/pdf.js')
  pdfWorker ??= new Worker(new URL('./pdfWorker.ts', import.meta.url), { type: 'module' })
  const { pdfjsLib } = globalThis as unknown as {
    pdfjsLib: { GlobalWorkerOptions: { workerPort: Worker | null } }
  }
  pdfjsLib.GlobalWorkerOptions.workerPort = pdfWorker
}

async function isPdf(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  return String.fromCharCode(...head) === '%PDF-'
}

export async function loadBook(file: File): Promise<Book> {
  try {
    if (await isPdf(file)) await preparePdfjs()
    const book = await makeBook(file)
    harden(book)
    return book
  } catch (e) {
    if (e instanceof UnsupportedTypeError) {
      throw new BookOpenError('unsupported', 'Readlet can’t read this kind of file.')
    }
    console.warn('opening book failed', e)
    throw new BookOpenError('damaged', 'This book seems to be damaged, so it can’t be opened.')
  }
}

export function createView(): View {
  // Registers <foliate-view> as a side effect of importing view.js above.
  return document.createElement('foliate-view') as View
}

// -- Metadata ----------------------------------------------------------------------------------

const preferredLanguages = typeof navigator !== 'undefined' ? navigator.languages : []

function fromLanguageMap(value: LanguageMap | undefined): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') return value
  for (const lang of preferredLanguages) {
    const exact = value[lang] ?? value[lang.split('-')[0] ?? '']
    if (exact) return exact
  }
  return Object.values(value)[0]
}

function contributorNames(value: Contributor | Contributor[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value]
  return list
    .map((c) => (typeof c === 'string' ? c : fromLanguageMap(c.name)))
    .filter((name): name is string => !!name && name.trim() !== '')
    .map((name) => name.trim())
}

function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Normalises foliate's per-format metadata into Readlet's shape. */
export function extractMetadata(
  book: Book,
  entry: Pick<BookEntry, 'path' | 'format'>,
): BookMetadata {
  const meta = book.metadata ?? {}
  const guess = guessFromFileName(entry.path)
  let title = fromLanguageMap(meta.title)?.trim()
  // Comic archives have no metadata; foliate uses the file name, extension and all.
  if (!title || entry.format === 'cbz' || title === entry.path.split('/').pop()) title = guess.title
  const authors = contributorNames(meta.author)
  const seriesList = meta.belongsTo?.series
  const series = Array.isArray(seriesList) ? seriesList[0] : seriesList
  const position = series?.position != null ? Number(series.position) : NaN
  const description = meta.description ? htmlToText(meta.description) : undefined
  return {
    title,
    authors: authors.length ? authors : guess.author ? [guess.author] : [],
    series: fromLanguageMap(series?.name) ?? null,
    seriesIndex: Number.isFinite(position) ? position : null,
    language: firstString(meta.language) ?? null,
    publisher: contributorNames(meta.publisher)[0] ?? null,
    published: meta.published ?? null,
    description: description || null,
    identifier: typeof meta.identifier === 'string' ? meta.identifier : null,
  }
}

/** Image types the Rust core decodes; anything else is rasterised here first. */
const DECODABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', ''])

async function rasterize(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const width = img.naturalWidth || 600
    const height = img.naturalHeight || 900
    const scale = Math.min(1, 1200 / height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The cover as bytes the Rust core can decode, or `null` if the book has none. */
export async function extractCover(book: Book): Promise<Uint8Array | null> {
  let blob: Blob | null | undefined
  try {
    blob = await book.getCover?.()
  } catch {
    return null
  }
  if (!blob || blob.size === 0) return null
  if (!DECODABLE.has(blob.type)) blob = await rasterize(blob)
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}
