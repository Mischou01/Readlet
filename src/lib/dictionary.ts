// Online dictionary lookups through Wiktionary's REST API. Only called after the reader agrees,
// because it sends the word to Wikimedia (docs/PLAN.md §8).

import { htmlToText } from './text'

export interface DefinitionGroup {
  partOfSpeech: string
  definitions: string[]
}

interface WiktionaryEntry {
  partOfSpeech?: string
  language?: string
  definitions?: { definition?: string }[]
}

const ENDPOINT = 'https://en.wiktionary.org/api/rest_v1/page/definition/'
const MAX_PER_GROUP = 4

/** Trims punctuation and quotes that come along with a double-click selection. */
export function cleanWord(selection: string): string {
  return selection
    .trim()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
    .replace(/[’']s$/u, '')
}

/** Picks the entries for the book's language, falling back to English, then anything. */
export function parseDefinitions(json: unknown, language: string | null): DefinitionGroup[] {
  if (!json || typeof json !== 'object') return []
  const byLang = json as Record<string, WiktionaryEntry[] | undefined>
  const lang = (language ?? 'en').split('-')[0]?.toLowerCase() ?? 'en'
  const entries: WiktionaryEntry[] =
    byLang[lang] ?? byLang.en ?? Object.values(byLang).find((v) => Array.isArray(v)) ?? []
  return entries
    .map((entry) => ({
      partOfSpeech: entry.partOfSpeech ?? '',
      definitions: (entry.definitions ?? [])
        .map((d) => htmlToText(d.definition ?? ''))
        .filter((d) => d.length > 0)
        .slice(0, MAX_PER_GROUP),
    }))
    .filter((g) => g.definitions.length > 0)
}

export async function lookUp(
  word: string,
  language: string | null,
  signal?: AbortSignal,
): Promise<DefinitionGroup[]> {
  for (const candidate of new Set([word, word.toLowerCase()])) {
    const response = await fetch(ENDPOINT + encodeURIComponent(candidate.replace(/ /g, '_')), {
      headers: { Accept: 'application/json' },
      signal,
    })
    if (response.status === 404) continue
    if (!response.ok) throw new Error(`Wiktionary answered ${response.status}`)
    const groups = parseDefinitions(await response.json(), language)
    if (groups.length) return groups
  }
  return []
}

export function wiktionaryPage(word: string): string {
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(word.replace(/ /g, '_'))}`
}
