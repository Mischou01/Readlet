import { describe, expect, it } from 'vitest'
import type { TocItem } from './foliate'
import { chapterLabel, tocPath } from './toc'

const chapterOne: TocItem = { id: 2, label: 'I', href: 'c1.xhtml' }
const toc: TocItem[] = [
  { id: 0, label: 'Titlepage', href: 'title.xhtml' },
  {
    id: 1,
    label: 'Book I',
    href: 'part1.xhtml',
    subitems: [chapterOne, { id: 3, label: 'II.', href: 'c2.xhtml' }],
  },
  { id: 4, label: '12', href: 'c12.xhtml' },
]

describe('tocPath', () => {
  it('finds an item and its ancestors', () => {
    expect(tocPath(toc, chapterOne).map((i) => i.label)).toEqual(['Book I', 'I'])
    expect(tocPath(toc, { id: 3, label: 'II.', href: 'c2.xhtml' }).map((i) => i.id)).toEqual([1, 3])
    expect(tocPath(toc, { label: 'missing', href: 'x' })).toEqual([])
  })
})

describe('chapterLabel', () => {
  it('keeps descriptive labels', () => {
    expect(chapterLabel(toc, toc[0])).toBe('Titlepage')
  })

  it('names bare numbers as chapters of their part', () => {
    expect(chapterLabel(toc, chapterOne)).toBe('Book I · Chapter I')
    expect(chapterLabel(toc, toc[1]?.subitems?.[1])).toBe('Book I · Chapter II')
    expect(chapterLabel(toc, toc[2])).toBe('Chapter 12')
  })

  it('handles missing items', () => {
    expect(chapterLabel(toc, null)).toBeUndefined()
    expect(chapterLabel(toc, { label: '  ', href: 'x' })).toBeUndefined()
  })
})
