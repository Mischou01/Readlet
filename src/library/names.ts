// Matching typed series and author names to the ones already in the library, so a book joins its
// series (or its author's other books) rather than starting a near-duplicate. Pure, covered by
// names.test.ts.

import { seriesKey } from './model'

/** What two spellings of the same name have in common. */
type NameKey = (name: string) => string

export interface KnownSeries {
  name: string
  /** The number after the series' last book. */
  next: number
}

const tidy = (name: string) => name.replace(/\s+/g, ' ').trim()

/** Suffixes that follow a comma without the name before it being a surname: "King, Jr." */
const SUFFIX = /^(jr|sr|i{2,3}|iv)\.?$/i

/**
 * Authors are written "J. R. R. Tolkien", "J.R.R. Tolkien" or "Tolkien, J. R. R."; with or
 * without accents. All of those share this.
 */
export function authorKey(name: string): string {
  const parts = name.split(',')
  const [last, first] = parts
  const ordered =
    parts.length === 2 && first?.trim() && !SUFFIX.test(first.trim()) ? `${first} ${last}` : name
  return ordered
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** The most used spelling of each name, by key, first seen first. */
function spellings(names: Iterable<string>, key: NameKey): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const raw of names) {
    const name = tidy(raw)
    const k = key(name)
    if (!k) continue
    const spelled = counts.get(k) ?? new Map<string, number>()
    spelled.set(name, (spelled.get(name) ?? 0) + 1)
    counts.set(k, spelled)
  }
  return new Map(
    [...counts].map(([k, spelled]) => [k, [...spelled].reduce((a, b) => (b[1] > a[1] ? b : a))[0]]),
  )
}

/** The library's series, each under the spelling most of its books use, by name. */
export function knownSeries(
  books: readonly { series: string | null; seriesIndex: number | null }[],
): KnownSeries[] {
  const last = new Map<string, number>()
  for (const { series, seriesIndex } of books) {
    const k = seriesKey(tidy(series ?? ''))
    if (k) last.set(k, Math.max(last.get(k) ?? 0, seriesIndex ?? 0))
  }
  const names = spellings(
    books.map((b) => b.series ?? ''),
    seriesKey,
  )
  return [...names]
    .map(([k, name]) => ({ name, next: Math.floor(last.get(k) ?? 0) + 1 }))
    .sort((a, b) => seriesKey(a.name).localeCompare(seriesKey(b.name)))
}

/** The library's authors, each under the spelling most of their books use. */
export function knownAuthors(books: readonly { authors: readonly string[] }[]): string[] {
  return [
    ...spellings(
      books.flatMap((b) => b.authors),
      authorKey,
    ).values(),
  ]
}

/** The known name `typed` is a spelling of, if any. */
function match<T>(typed: string, known: readonly T[], key: NameKey, name: (t: T) => string) {
  const k = key(typed)
  return (k && known.find((t) => key(name(t)) === k)) || null
}

/**
 * Names to suggest for what's typed: those containing it, the ones starting with it first, then
 * those with a word starting with it. Once it names one exactly there's nothing to suggest;
 * spelled differently, that one is.
 */
function suggest<T>(
  typed: string,
  known: readonly T[],
  key: NameKey,
  name: (t: T) => string,
  limit = 4,
): T[] {
  const text = tidy(typed).toLocaleLowerCase()
  if (!text) return []
  const exact = match(typed, known, key, name)
  if (exact) return name(exact) === tidy(typed) ? [] : [exact]
  const rank = (t: T) => {
    const lower = name(t).toLocaleLowerCase()
    if (lower.startsWith(text)) return 0
    if (` ${lower}`.includes(` ${text}`)) return 1
    return lower.includes(text) ? 2 : -1
  }
  return known
    .filter((t) => rank(t) >= 0)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, limit)
}

const seriesName = (s: KnownSeries) => s.name
const self = (s: string) => s

/** The known series `typed` names, ignoring capitals, spacing and a leading "The". */
export const matchSeries = (typed: string, known: readonly KnownSeries[]) =>
  match(typed, known, seriesKey, seriesName)

export const suggestSeries = (typed: string, known: readonly KnownSeries[]) =>
  suggest(typed, known, seriesKey, seriesName)

export const suggestAuthors = (typed: string, known: readonly string[]) =>
  suggest(typed, known, authorKey, self)

/** What to save for a typed series: the library's spelling of it, if it has the series. */
export function seriesToSave(typed: string, known: readonly KnownSeries[]): string {
  return matchSeries(typed, known)?.name ?? tidy(typed)
}

/** The authors as typed (one per line), each in the library's spelling if it has their books. */
export function authorsToSave(typed: string, known: readonly string[]): string {
  return typed
    .split('\n')
    .map((line) => (line.trim() ? (match(line, known, authorKey, self) ?? tidy(line)) : line))
    .join('\n')
}
