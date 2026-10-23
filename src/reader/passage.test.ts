// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { passageFromRange } from './passage'
import { markNames, ssmlFromMark } from './ssml'

function page(html: string): Document {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html')
}

/** A range from `from` (an occurrence of that text) to the end of `to`. */
function select(doc: Document, from: string, to: string): Range {
  const find = (needle: string) => {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n as Text).data.indexOf(needle)
      if (i >= 0) return [n, i] as const
    }
    throw new Error(`no “${needle}”`)
  }
  const [startNode, startOffset] = find(from)
  const [endNode, endOffset] = find(to)
  const range = doc.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset + to.length)
  return range
}

describe('passageFromRange', () => {
  it('says exactly the selection, from mid-sentence, with a mark before each sentence', () => {
    const doc = page('<p>It was dark. The <em>storm</em> came in fast. Nobody slept.</p>')
    const passage = passageFromRange(select(doc, 'storm', 'fast.'), 'en')
    expect(passage?.ssml).toBe(
      '<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en">' +
        '<mark name="0"/>storm came in fast.</speak>',
    )
    expect(passage?.sentences.get('0')?.toString()).toBe('storm came in fast.')
  })

  it('splits sentences across paragraphs and maps each back to the book', () => {
    const doc = page('<p>One fish. Two fish.</p><p>Red fish & blue fish.</p><p>Not this.</p>')
    const passage = passageFromRange(select(doc, 'Two', 'blue fish.'), 'en')
    expect(passage && markNames(passage.ssml)).toEqual(['0', '1'])
    expect([...(passage?.sentences.values() ?? [])].map((r) => r.toString())).toEqual([
      'Two fish.',
      'Red fish & blue fish.',
    ])
    expect(passage?.ssml).toContain('Red fish &amp; blue fish.')
    expect(passage?.ssml).not.toContain('Not this')
    // Pausing and skipping work on it like on a paragraph from tts.js.
    expect(passage && ssmlFromMark(passage.ssml, '1')).toContain('Red fish')
    expect(passage && ssmlFromMark(passage.ssml, '1')).not.toContain('Two fish')
  })

  it('has nothing to say for a blank selection', () => {
    const doc = page('<p>Words</p><p>   </p>')
    const range = doc.createRange()
    range.selectNodeContents(doc.body.lastChild as Node)
    expect(passageFromRange(range, null)).toBeNull()
  })
})
