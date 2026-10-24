import { describe, expect, it } from 'vitest'
import { touchZoneAt } from './tapZones'

// A 400 × 800 page, 10px from the window's left and 20px from its top.
const box = { left: 10, right: 410, top: 20, width: 400, height: 800 }

describe('touchZoneAt', () => {
  it('turns pages from the outer thirds and shows the chrome from the middle', () => {
    expect(touchZoneAt(20, 400, box)).toBe('left')
    expect(touchZoneAt(210, 400, box)).toBe('center')
    expect(touchZoneAt(400, 400, box)).toBe('right')
  })

  it('bookmarks from the top-right corner', () => {
    expect(touchZoneAt(405, 25, box)).toBe('bookmark')
    // The corner is the right 15% (from x 350) and the top 10% (down to y 100).
    expect(touchZoneAt(351, 99, box)).toBe('bookmark')
    expect(touchZoneAt(349, 50, box)).toBe('right')
    expect(touchZoneAt(400, 101, box)).toBe('right')
  })

  it('leaves the top-left corner turning pages', () => {
    expect(touchZoneAt(15, 25, box)).toBe('left')
  })
})
