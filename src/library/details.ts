// Editing a book's details: the form's text, and the changes it makes. Pure, covered by
// details.test.ts.

import { formatIdentifier } from '../lib/format'
import { bookAuthors, bookTitle, htmlToParagraphs } from '../lib/text'
import type { BookDetailsPatch, BookEntry, FoundBook, FoundDetails } from '../lib/types'

export interface DetailsForm {
  title: string
  /** One per line: names can hold commas ("Tolkien, J. R. R."). */
  authors: string
  series: string
  seriesIndex: string
  language: string
  publisher: string
  published: string
  identifier: string
  /** Plain text, paragraphs separated by blank lines. */
  description: string
}

export function detailsForm(entry: BookEntry): DetailsForm {
  return {
    title: entry.title ?? '',
    authors: entry.authors.join('\n'),
    series: entry.series ?? '',
    seriesIndex: entry.seriesIndex == null ? '' : String(entry.seriesIndex),
    language: entry.language ?? '',
    publisher: entry.publisher ?? '',
    published: entry.published ?? '',
    identifier: entry.identifier ?? '',
    description: entry.description ? htmlToParagraphs(entry.description).join('\n\n') : '',
  }
}

/** A series number as typed ("2", "2.5", "2,5"): null when blank, NaN when it isn't one. */
export function parseSeriesIndex(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (!trimmed) return null
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : NaN
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

/** Descriptions are HTML, as books carry them; typed paragraphs become `<p>`s. */
function paragraphsToHtml(text: string): string | null {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (!paragraphs.length) return null
  return paragraphs.map((p) => `<p>${p.replace(/[&<>]/g, (c) => ESCAPES[c] ?? c)}</p>`).join('')
}

/** The fields whose text changed, as `set_book_details` takes them. Untouched fields stay out, so
 * they keep following the book (or an edit made on another device). */
export function detailsPatch(initial: DetailsForm, form: DetailsForm): BookDetailsPatch {
  const patch: BookDetailsPatch = {}
  const changed = (field: keyof DetailsForm) => form[field] !== initial[field]
  const text = (value: string) => value.trim() || null
  if (changed('title')) patch.title = text(form.title)
  if (changed('authors')) {
    const authors = form.authors
      .split('\n')
      .map((a) => a.trim())
      .filter(Boolean)
    patch.authors = authors.length ? authors : null
  }
  if (changed('series')) patch.series = text(form.series)
  if (changed('seriesIndex')) patch.seriesIndex = parseSeriesIndex(form.seriesIndex)
  if (changed('language')) patch.language = text(form.language)
  if (changed('publisher')) patch.publisher = text(form.publisher)
  if (changed('published')) patch.published = text(form.published)
  if (changed('identifier')) patch.identifier = text(form.identifier)
  if (changed('description')) patch.description = paragraphsToHtml(form.description)
  return patch
}

// -- Finding details online --------------------------------------------------------------------

/** The first search for a book: its ISBN when it has one, otherwise its title and first author. */
export function searchQueryFor(entry: BookEntry): string {
  const identifier = entry.identifier ? formatIdentifier(entry.identifier) : null
  if (identifier?.startsWith('ISBN ')) return identifier.slice('ISBN '.length)
  return [bookTitle(entry), bookAuthors(entry)[0]].filter(Boolean).join(' ')
}

/** What Open Library found, as the form's text; blank where it found nothing. */
export function foundForm(book: FoundBook, details: FoundDetails): Partial<DetailsForm> {
  const found: Partial<DetailsForm> = {
    title: book.title,
    authors: book.authors.join('\n'),
    series: details.series ?? '',
    seriesIndex: details.seriesIndex == null ? '' : String(details.seriesIndex),
    language: details.language ?? '',
    publisher: details.publisher ?? book.publisher ?? '',
    published: details.published ?? (book.year == null ? '' : String(book.year)),
    identifier: details.identifier ?? '',
    description: details.description ?? '',
  }
  return Object.fromEntries(Object.entries(found).filter(([, value]) => value.trim()))
}

/** How a field's text compares: ISBNs by their number, whatever prefix they're written with. */
function comparable(field: keyof DetailsForm, text: string): string {
  const trimmed = text.trim()
  return field === 'identifier' ? (formatIdentifier(trimmed) ?? trimmed) : trimmed
}

/** The found fields that would change the form, in the form's order. */
export function differences(form: DetailsForm, found: Partial<DetailsForm>): (keyof DetailsForm)[] {
  return (Object.keys(form) as (keyof DetailsForm)[]).filter((field) => {
    const value = found[field]
    return value !== undefined && comparable(field, value) !== comparable(field, form[field])
  })
}
