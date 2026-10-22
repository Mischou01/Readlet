import { describe, expect, it } from 'vitest'
import { addPage, paceFor, type BookPace } from './pace'

const MINUTE = 60_000

/** Reads `pages` pages of `bytes` each at `pace` bytes a minute. */
function read(pages: number, bytes: number, pace: number, start: BookPace | null = null) {
  let book = start
  for (let i = 0; i < pages; i++) book = addPage(book, bytes, (bytes / pace) * MINUTE)
  return book
}

describe('paceFor', () => {
  it('is the personal pace until the book has been read', () => {
    expect(paceFor(1600, null)).toBe(1600)
    expect(paceFor(1600, { bytes: 0, ms: 0 })).toBe(1600)
  })

  it('moves toward the pace in the book as reading adds up', () => {
    const early = paceFor(1600, read(3, 1500, 800))
    const later = paceFor(1600, read(40, 1500, 800))
    expect(early).toBeLessThan(1600)
    expect(early).toBeGreaterThan(1200)
    expect(later).toBeLessThan(early)
    expect(later).toBeLessThan(900)
  })
})

describe('addPage', () => {
  it('ignores pages flipped past or skimmed', () => {
    expect(addPage(null, 1500, 1_000)).toBeNull()
    expect(addPage(null, 1500, 5_000)).toBeNull()
  })

  it('ignores a page left open while the reader was away, once the pace is known', () => {
    const settled = read(20, 1500, 1600)
    expect(addPage(settled, 1500, 10 * MINUTE)).toBe(settled)
  })

  it('learns a pace far slower than the personal one', () => {
    const book = read(40, 1500, 600)
    expect(paceFor(3_000, book)).toBeLessThan(900)
  })

  it('forgets old reading so the estimate keeps following the reader', () => {
    const slow = read(200, 1500, 800)
    const fastAfter = read(200, 1500, 2400, slow)
    expect(fastAfter?.ms).toBeLessThanOrEqual(90 * MINUTE)
    expect(paceFor(1600, slow)).toBeLessThan(900)
    expect(paceFor(1600, fastAfter)).toBeGreaterThan(1800)
  })
})
