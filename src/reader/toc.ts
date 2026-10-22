// Table-of-contents helpers. Pure functions over foliate's TOC items; covered by toc.test.ts.

import type { TocItem } from './foliate'

/** Labels that are only a number, like "IV" or "12.", which say little without their part. */
const BARE_NUMBER = /^(?:[ivxlcdm]+|\d+)\.?$/i

/** The items from the top of the TOC down to `item`, or `[]` if it isn't in the TOC. */
export function tocPath(toc: readonly TocItem[], item: TocItem): TocItem[] {
  for (const entry of toc) {
    if (entry === item || (item.id != null && entry.id === item.id)) return [entry]
    const below = tocPath(entry.subitems ?? [], item)
    if (below.length) return [entry, ...below]
  }
  return []
}

/**
 * A readable name for where the reader is: "Book I · Chapter IV" rather than the bare "IV" many
 * books use for chapter entries.
 */
export function chapterLabel(
  toc: readonly TocItem[],
  item: TocItem | null | undefined,
): string | undefined {
  const label = item?.label?.trim()
  if (!item || !label) return undefined
  if (!BARE_NUMBER.test(label)) return label
  const parent = tocPath(toc, item).at(-2)?.label?.trim()
  const chapter = `Chapter ${label.replace(/\.$/, '')}`
  return parent ? `${parent} · ${chapter}` : chapter
}
