// Titles, authors and sorting.

import type { BookEntry } from './types'

const ARTICLES = /^(the|a|an)\s+/i

/** "Ursula K. Le Guin - The Dispossessed.epub" → title and author guessed from the file name. */
export function guessFromFileName(path: string): { title: string; author: string | null } {
  const name = path.split('/').pop() ?? path
  const stem = name.replace(/\.fb2\.zip$/i, '').replace(/\.[^.]+$/, '')
  const cleaned = stem.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  const parts = cleaned.split(/\s+[-–—]\s+/)
  if (parts.length === 2 && parts[0] && parts[1]) return { author: parts[0], title: parts[1] }
  return { title: cleaned || name, author: null }
}

export function bookTitle(book: Pick<BookEntry, 'title' | 'path'>): string {
  return book.title?.trim() || guessFromFileName(book.path).title
}

export function bookAuthors(book: Pick<BookEntry, 'authors' | 'path' | 'title'>): string[] {
  if (book.authors.length > 0) return book.authors
  if (book.title) return []
  const guess = guessFromFileName(book.path).author
  return guess ? [guess] : []
}

/** Sort key that ignores leading articles and case: "The Waves" sorts under W. */
export function titleSortKey(title: string): string {
  return title.replace(ARTICLES, '').toLocaleLowerCase()
}

/** "Ursula K. Le Guin" sorts under L: the last word that isn't a suffix or particle-only. */
export function authorSortKey(author: string | undefined): string {
  if (!author) return '￿'
  const words = author.trim().split(/\s+/)
  const last = words[words.length - 1] ?? ''
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last)
  const surname = suffix && words.length > 1 ? (words[words.length - 2] ?? '') : last
  return `${surname} ${author}`.toLocaleLowerCase()
}

/** Accent- and case-insensitive substring search. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
}

export function matchesQuery(haystack: string, query: string): boolean {
  const q = normalizeForSearch(query.trim())
  return q === '' || normalizeForSearch(haystack).includes(q)
}

/** Strips tags from publisher HTML (book descriptions) without running or loading anything. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0
}
