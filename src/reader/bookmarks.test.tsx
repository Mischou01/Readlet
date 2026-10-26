// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { highlight } from '../test/fixtures'
import type { Annotation } from '../lib/types'
import { bookmarksOnPage, inBookOrder } from './bookmarks'
import { ContentsSheet } from './ContentsSheet'
import { BookmarkNameDialog } from './ReaderPopovers'

afterEach(cleanup)

function bookmark(overrides: Partial<Annotation> = {}): Annotation {
  return highlight({
    id: 'b1',
    kind: 'bookmark',
    cfi: 'epubcfi(/6/4!/4/2/1:0)',
    text: 'It was a dark and stormy night',
    color: undefined,
    chapter: 'Chapter 1',
    fraction: 0.1,
    ...overrides,
  })
}

function showBookmarks(bookmarks: Annotation[]) {
  const onRename = vi.fn()
  render(
    <ContentsSheet
      toc={[]}
      currentTocId={undefined}
      bookmarks={bookmarks}
      bookmarkedTocIds={new Set()}
      highlights={[]}
      onGoTo={vi.fn()}
      onRenameBookmark={onRename}
      onDeleteBookmark={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('radio', { name: /Bookmarks/ }))
  return { onRename }
}

// What foliate-js reports for consecutive pages of one chapter (taken from a real layout). Pages 3
// and 5 start mid-paragraph, exactly where the page before them ends.
const PAGES = [
  'epubcfi(/6/2!/4,/2,/16/1:355)',
  'epubcfi(/6/2!/4,/18,/32/1:204)',
  'epubcfi(/6/2!/4,/32/1:204,/46/1:286)',
  'epubcfi(/6/2!/4,/48,/62/1:195)',
  'epubcfi(/6/2!/4,/62/1:195,/76/1:206)',
]

/** The pages (1-based) a bookmark shows on. */
function pagesShowing(cfi: string): number[] {
  const b = bookmark({ cfi })
  return PAGES.flatMap((page, i) => (bookmarksOnPage([b], page).length ? [i + 1] : []))
}

describe('bookmarksOnPage', () => {
  it('shows a bookmark on its own page only, even where a paragraph runs over the break', () => {
    expect(pagesShowing('epubcfi(/6/2!/4/32/1:204)')).toEqual([3])
    expect(pagesShowing('epubcfi(/6/2!/4/32/1:205)')).toEqual([3])
    expect(pagesShowing('epubcfi(/6/2!/4/48)')).toEqual([4])
    expect(pagesShowing('epubcfi(/6/2!/4/2)')).toEqual([1])
    expect(pagesShowing('epubcfi(/6/4!/4/2)')).toEqual([])
  })

  it('matches fixed-layout pages by their single position', () => {
    expect(bookmarksOnPage([bookmark({ cfi: 'epubcfi(/6/4)' })], 'epubcfi(/6/4)')).toHaveLength(1)
    expect(bookmarksOnPage([bookmark({ cfi: 'epubcfi(/6/4)' })], 'epubcfi(/6/6)')).toHaveLength(0)
  })

  it('ignores positions it can’t read', () => {
    expect(bookmarksOnPage([bookmark()], undefined)).toEqual([])
    expect(bookmarksOnPage([bookmark({ cfi: 'nonsense' })], PAGES[0])).toEqual([])
  })
})

describe('inBookOrder', () => {
  it('lists annotations by where they are in the book, not when they were made', () => {
    const later = bookmark({ id: 'later', cfi: 'epubcfi(/6/8!/4/2/1:0)', createdAt: 1 })
    const earlier = bookmark({ id: 'earlier', cfi: 'epubcfi(/6/4!/4/10/1:5)', createdAt: 2 })
    const first = bookmark({ id: 'first', cfi: 'epubcfi(/6/4!/4/2/1:0)', createdAt: 3 })
    expect(inBookOrder([later, earlier, first]).map((b) => b.id)).toEqual([
      'first',
      'earlier',
      'later',
    ])
  })
})

describe('bookmarks in Contents', () => {
  it('lists a named bookmark by its name, with its passage under it', () => {
    const named = bookmark({ name: 'The storm' })
    const { onRename } = showBookmarks([named])
    expect(screen.getByText('The storm')).toBeTruthy()
    expect(screen.getByText('It was a dark and stormy night')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rename bookmark' }))
    expect(onRename).toHaveBeenCalledWith(named)
  })

  it('offers to name a bookmark that has no name', () => {
    showBookmarks([bookmark()])
    expect(screen.getByText('It was a dark and stormy night')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Name bookmark' })).toBeTruthy()
  })
})

describe('BookmarkNameDialog', () => {
  it('saves the trimmed name on Enter', () => {
    const onSave = vi.fn()
    render(<BookmarkNameDialog passage="" initial="" onSave={onSave} onClose={vi.fn()} />)
    const input = screen.getByLabelText('Bookmark name')
    fireEvent.change(input, { target: { value: '  The storm  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('The storm')
  })

  it('suggests the chapter for a bookmark with no name, ready to accept or type over', () => {
    const onSave = vi.fn()
    render(
      <BookmarkNameDialog
        passage=""
        initial=""
        suggestion="Chapter 3: The Storm"
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByLabelText('Bookmark name') as HTMLInputElement
    expect(input.value).toBe('Chapter 3: The Storm')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('Chapter 3: The Storm')
  })

  it('starts from the current name when renaming', () => {
    render(<BookmarkNameDialog passage="" initial="The storm" onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Rename bookmark' })).toBeTruthy()
    expect((screen.getByLabelText('Bookmark name') as HTMLInputElement).value).toBe('The storm')
  })
})

describe('naming a bookmark over the Contents sheet', () => {
  it('closes only the dialog on Escape', () => {
    const closeSheet = vi.fn()
    const closeDialog = vi.fn()
    render(
      <>
        <ContentsSheet
          toc={[]}
          currentTocId={undefined}
          bookmarks={[]}
          bookmarkedTocIds={new Set()}
          highlights={[]}
          onGoTo={vi.fn()}
          onRenameBookmark={vi.fn()}
          onDeleteBookmark={vi.fn()}
          onClose={closeSheet}
        />
        <BookmarkNameDialog passage="" initial="" onSave={vi.fn()} onClose={closeDialog} />
      </>,
    )
    fireEvent.keyDown(screen.getByLabelText('Bookmark name'), { key: 'Escape' })
    expect(closeDialog).toHaveBeenCalledTimes(1)
    expect(closeSheet).not.toHaveBeenCalled()
  })
})
