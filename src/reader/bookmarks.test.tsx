// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { highlight } from '../test/fixtures'
import type { Annotation } from '../lib/types'
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
