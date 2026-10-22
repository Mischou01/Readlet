// The highlights hub as pure functions: filtering, grouping by book and the Markdown export.
// Covered by model.test.ts.

import { dayKey, formatAuthors } from '../lib/format'
import type { ExportFile } from '../lib/ipc'
import { HIGHLIGHTS, highlightColor } from '../lib/highlightColors'
import { matchesQuery } from '../lib/text'
import type { Annotation, HighlightColor } from '../lib/types'
import type { LibraryBook } from '../library/model'

export interface HighlightFilter {
  /** A book fingerprint, or `null` for every book. */
  book: string | null
  color: HighlightColor | null
  /** Book fingerprints on the chosen shelf, or `null` for no shelf filter. */
  shelf: ReadonlySet<string> | null
  query: string
}

export interface HighlightGroup {
  book: LibraryBook
  highlights: Annotation[]
}

const newestFirst = (a: Annotation, b: Annotation) =>
  b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)

/** Book order: the passage's position in the book, then when it was highlighted. */
export function byPosition(a: Annotation, b: Annotation): number {
  return (a.fraction ?? 0) - (b.fraction ?? 0) || a.createdAt - b.createdAt
}

function latest(highlights: readonly Annotation[]): number {
  return highlights.reduce((max, h) => Math.max(max, h.createdAt), 0)
}

/** Books that have highlights, most recently highlighted first. */
export function booksWithHighlights(books: readonly LibraryBook[]): LibraryBook[] {
  return books
    .filter((b) => b.highlights.length > 0)
    .sort((a, b) => latest(b.highlights) - latest(a.highlights))
}

function matches(book: LibraryBook, h: Annotation, filter: HighlightFilter): boolean {
  if (filter.color && highlightColor(h.color) !== filter.color) return false
  return matchesQuery([h.text, h.note ?? '', h.chapter ?? '', book.title].join('\n'), filter.query)
}

/** The highlights to show, grouped by book: books by latest highlight, highlights newest first. */
export function groupHighlights(
  books: readonly LibraryBook[],
  filter: HighlightFilter,
): HighlightGroup[] {
  return booksWithHighlights(books)
    .filter(
      (b) =>
        (!filter.book || b.fingerprint === filter.book) &&
        (!filter.shelf || filter.shelf.has(b.fingerprint)),
    )
    .map((book) => ({
      book,
      highlights: book.highlights.filter((h) => matches(book, h, filter)).sort(newestFirst),
    }))
    .filter((g) => g.highlights.length > 0)
}

export interface HighlightCounts {
  highlights: number
  notes: number
  books: number
}

export function countHighlights(books: readonly LibraryBook[]): HighlightCounts {
  let highlights = 0
  let notes = 0
  let withHighlights = 0
  for (const book of books) {
    if (book.highlights.length === 0) continue
    withHighlights += 1
    highlights += book.highlights.length
    notes += book.highlights.filter((h) => h.note?.trim()).length
  }
  return { highlights, notes, books: withHighlights }
}

/** The text put on the clipboard for one highlight: the quote, then where it's from. */
export function citation(book: LibraryBook, h: Annotation): string {
  const source = [book.title, formatAuthors(book.authors)].filter(Boolean).join(', ')
  return `“${h.text.trim()}”\n— ${source}`
}

// -- Markdown export ---------------------------------------------------------------------------

/** A YAML double-quoted scalar. JSON string escapes are a subset of YAML's. */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * Escapes text so Markdown (and Obsidian) shows it literally: no emphasis, links, HTML, tags,
 * headings or list items appearing out of a quoted passage.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<>#|]/g, '\\$&')
    .replace(/([=~])(?=\1)/g, '\\$1')
    .replace(/^(\s*)([-+])(?=\s)/gm, '$1\\$2')
    .replace(/^(\s*\d+)([.)])(?=\s)/gm, '$1\\$2')
}

/** Lines of a paragraph, keeping the reader's own line breaks. */
function paragraphLines(text: string): string[] {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => escapeMarkdown(line.trim()))
}

/** A file name that works on Linux, Windows and macOS (and passes the core's check). */
export function exportFileName(book: LibraryBook): string {
  const author = book.authors[0]
  const base = (author ? `${book.title} (${author})` : book.title)
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
  const short = Array.from(base).slice(0, 120).join('').trim()
  return `${short || 'Untitled'}.md`
}

/** One book's highlights as an Obsidian-friendly Markdown note with YAML front matter. */
export function bookToMarkdown(book: LibraryBook, exportedAt: number): string {
  const highlights = [...book.highlights].sort(byPosition)
  const { entry } = book
  const front = ['---', `title: ${yamlString(book.title)}`]
  if (book.authors.length) {
    front.push('author:', ...book.authors.map((a) => `  - ${yamlString(a)}`))
  }
  if (entry.series) front.push(`series: ${yamlString(entry.series)}`)
  if (entry.seriesIndex != null) front.push(`series_index: ${entry.seriesIndex}`)
  if (entry.publisher) front.push(`publisher: ${yamlString(entry.publisher)}`)
  if (entry.published) front.push(`published: ${yamlString(entry.published)}`)
  if (entry.language) front.push(`language: ${yamlString(entry.language)}`)
  if (entry.identifier) front.push(`identifier: ${yamlString(entry.identifier)}`)
  front.push(
    `highlights: ${highlights.length}`,
    `exported: ${dayKey(exportedAt)}`,
    'tags:',
    '  - readlet',
    '---',
  )

  const body = [`# ${escapeMarkdown(book.title)}`]
  if (book.authors.length) body.push(`*${escapeMarkdown(formatAuthors(book.authors))}*`)
  let chapter: string | undefined
  for (const h of highlights) {
    if (h.chapter && h.chapter !== chapter) {
      chapter = h.chapter
      body.push(`## ${escapeMarkdown(chapter)}`)
    }
    body.push(
      paragraphLines(h.text)
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n'),
    )
    if (h.note?.trim()) body.push(paragraphLines(h.note).join('\n'))
    const color = HIGHLIGHTS[highlightColor(h.color)].label
    body.push(`*Highlighted ${dayKey(h.createdAt)} · ${color}*`)
  }
  return `${front.join('\n')}\n\n${body.join('\n\n')}\n`
}

/** One file per book; books whose names would collide get a short fingerprint suffix. */
export function exportFiles(books: readonly LibraryBook[], exportedAt: number): ExportFile[] {
  const withHighlights = books.filter((b) => b.highlights.length > 0)
  const counts = new Map<string, number>()
  for (const book of withHighlights) {
    const key = exportFileName(book).toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return withHighlights.map((book) => {
    let name = exportFileName(book)
    if ((counts.get(name.toLowerCase()) ?? 0) > 1) {
      name = `${name.slice(0, -3)} ${book.fingerprint.slice(0, 6)}.md`
    }
    return { name, content: bookToMarkdown(book, exportedAt) }
  })
}
