import { describe, expect, it } from 'vitest'
import { book, highlight } from '../test/fixtures'
import {
  bookToMarkdown,
  citation,
  countHighlights,
  escapeMarkdown,
  exportFileName,
  exportFiles,
  groupHighlights,
  type HighlightFilter,
} from './model'

const all: HighlightFilter = { book: null, color: null, shelf: null, query: '' }

const pride = book(
  {},
  {
    annotations: [
      highlight({
        id: 'a',
        text: 'She stared, coloured, doubted',
        color: 'butter',
        createdAt: 3,
        fraction: 0.6,
        note: 'Four verbs',
        chapter: 'Chapter 34',
      }),
      highlight({
        id: 'b',
        text: 'I could easily forgive his pride',
        color: 'peach',
        createdAt: 2,
        fraction: 0.1,
        chapter: 'Chapter 5',
      }),
      highlight({ id: 'gone', deleted: true, createdAt: 9 }),
      { ...highlight({ id: 'mark' }), kind: 'bookmark' },
    ],
  },
)
const moby = book(
  { fingerprint: 'fp-2', title: 'Moby-Dick', authors: ['Herman Melville'], path: 'moby.epub' },
  {
    annotations: [
      highlight({ id: 'c', text: 'true places never are', color: 'sky', createdAt: 5 }),
    ],
  },
)
const unread = book({ fingerprint: 'fp-3', title: 'Unread', path: 'unread.epub' })

describe('groupHighlights', () => {
  it('groups live highlights by book, most recently highlighted book first', () => {
    const groups = groupHighlights([pride, moby, unread], all)
    expect(groups.map((g) => g.book.fingerprint)).toEqual(['fp-2', 'fp-1'])
    expect(groups[1]?.highlights.map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('filters by book, colour, shelf and query', () => {
    expect(groupHighlights([pride, moby], { ...all, book: 'fp-1' })).toHaveLength(1)
    const peach = groupHighlights([pride, moby], { ...all, color: 'peach' })
    expect(peach.flatMap((g) => g.highlights.map((h) => h.id))).toEqual(['b'])
    expect(
      groupHighlights([pride, moby], { ...all, shelf: new Set(['fp-2']) })[0]?.book.title,
    ).toBe('Moby-Dick')
    // Search covers notes and is accent-insensitive.
    const note = groupHighlights([pride, moby], { ...all, query: 'four VERBS' })
    expect(note.flatMap((g) => g.highlights.map((h) => h.id))).toEqual(['a'])
    expect(groupHighlights([pride, moby], { ...all, query: 'nothing like this' })).toEqual([])
  })
})

describe('countHighlights', () => {
  it('counts highlights, notes and books with highlights', () => {
    expect(countHighlights([pride, moby, unread])).toEqual({ highlights: 3, notes: 1, books: 2 })
  })
})

describe('citation', () => {
  it('quotes the text and names the source', () => {
    expect(citation(moby, highlight({ text: ' true places ' }))).toBe(
      '“true places”\n— Moby-Dick, Herman Melville',
    )
  })
})

describe('escapeMarkdown', () => {
  it('neutralises Markdown and Obsidian syntax', () => {
    expect(escapeMarkdown('*bold* _it_ [link](x) <b> #tag a|b ==mark== ~~del~~')).toBe(
      '\\*bold\\* \\_it\\_ \\[link\\](x) \\<b\\> \\#tag a\\|b \\==mark\\== \\~~del\\~~',
    )
    expect(escapeMarkdown('- not a list')).toBe('\\- not a list')
    expect(escapeMarkdown('1. not a list')).toBe('1\\. not a list')
    expect(escapeMarkdown('plain text, 2 + 2 = 4')).toBe('plain text, 2 + 2 = 4')
  })
})

describe('exportFileName', () => {
  it('names the file after the title and first author, without unsafe characters', () => {
    expect(exportFileName(pride)).toBe('Pride and Prejudice (Jane Austen).md')
    const odd = book({ title: 'What? A/B: "Test"...', authors: [] })
    expect(exportFileName(odd)).toBe('What AB Test.md')
    expect(exportFileName(book({ title: '...', authors: [] }))).toBe('Untitled.md')
  })

  it('keeps names short', () => {
    const long = book({ title: 'x'.repeat(300), authors: [] })
    expect(Array.from(exportFileName(long)).length).toBeLessThanOrEqual(123)
  })
})

describe('exportFiles', () => {
  it('writes one file per book with highlights and disambiguates clashing names', () => {
    const twin = book(
      { fingerprint: 'abcdef123', path: 'twin.epub' },
      { annotations: [highlight({ id: 'z' })] },
    )
    const files = exportFiles([pride, twin, unread], 0)
    expect(files.map((f) => f.name)).toEqual([
      'Pride and Prejudice (Jane Austen) fp-1.md',
      'Pride and Prejudice (Jane Austen) abcdef.md',
    ])
  })
})

describe('bookToMarkdown', () => {
  it('writes front matter and the highlights in book order, grouped by chapter', () => {
    const md = bookToMarkdown(
      book(
        { title: 'Pride "and" Prejudice', series: 'Austen', seriesIndex: 2 },
        { annotations: pride.highlights },
      ),
      new Date(2026, 9, 22, 12).getTime(),
    )
    expect(
      md.startsWith('---\ntitle: "Pride \\"and\\" Prejudice"\nauthor:\n  - "Jane Austen"\n'),
    ).toBe(true)
    expect(md).toContain('series: "Austen"\nseries_index: 2\n')
    expect(md).toContain('highlights: 2\nexported: 2026-10-22\ntags:\n  - readlet\n---\n')
    expect(md.indexOf('## Chapter 5')).toBeLessThan(md.indexOf('## Chapter 34'))
    expect(md).toContain('> She stared, coloured, doubted\n\nFour verbs\n\n*Highlighted ')
    expect(md).toContain('· Butter*')
    expect(md.endsWith('\n')).toBe(true)
  })

  it('quotes every line of a multi-line highlight', () => {
    const md = bookToMarkdown(book({}, { annotations: [highlight({ text: 'one\n\ntwo' })] }), 0)
    expect(md).toContain('> one\n>\n> two')
  })
})
