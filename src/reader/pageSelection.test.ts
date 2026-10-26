// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { trimToPage } from './pageSelection'

/** Three paragraphs; the page showing holds the second one. */
let paras: Text[]
let page: Range

beforeEach(() => {
  document.body.innerHTML = '<p>first page</p><p>on this page</p><p>next page</p>'
  paras = Array.from(document.querySelectorAll('p'), (p) => p.firstChild as Text)
  page = document.createRange()
  page.setStart(paras[1]!, 0)
  page.setEnd(paras[1]!, 12)
})

const select = (from: [Text, number], to: [Text, number]) => {
  const selection = document.getSelection()!
  selection.setBaseAndExtent(from[0], from[1], to[0], to[1])
  return selection
}

describe('trimToPage', () => {
  it('leaves a selection on the page alone', () => {
    const selection = select([paras[1]!, 3], [paras[1]!, 7])
    expect(trimToPage(selection, page)).toBe(false)
    expect(selection.toString()).toBe('this')
  })

  it('stops a selection dragged past the end of the page at its end', () => {
    const selection = select([paras[1]!, 3], [paras[2]!, 4])
    expect(trimToPage(selection, page)).toBe(true)
    expect(selection.toString()).toBe('this page')
    expect(selection.anchorNode).toBe(paras[1])
    expect(selection.anchorOffset).toBe(3)
  })

  it('keeps a backward selection backward', () => {
    const selection = select([paras[1]!, 7], [paras[0]!, 2])
    expect(trimToPage(selection, page)).toBe(true)
    expect(selection.toString()).toBe('on this')
    expect(selection.anchorOffset).toBe(7)
    expect(selection.focusOffset).toBe(0)
  })

  it('trims select-all to the page', () => {
    const selection = select([paras[0]!, 0], [paras[2]!, 9])
    expect(trimToPage(selection, page)).toBe(true)
    expect(selection.toString()).toBe('on this page')
  })

  it('collapses a selection entirely off the page', () => {
    const selection = select([paras[2]!, 0], [paras[2]!, 4])
    expect(trimToPage(selection, page)).toBe(true)
    expect(selection.isCollapsed).toBe(true)
  })

  it('does nothing without a page', () => {
    const selection = select([paras[0]!, 0], [paras[2]!, 9])
    expect(trimToPage(selection, null)).toBe(false)
  })
})
