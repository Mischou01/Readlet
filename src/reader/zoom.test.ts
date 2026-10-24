import { describe, expect, it } from 'vitest'
import {
  fitPageScale,
  normalizeZoom,
  parseViewportSize,
  scrollToKeep,
  stepZoom,
  zoomLabel,
} from './zoom'

describe('zoom', () => {
  it('steps through the zoom levels and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.25)
    expect(stepZoom(1.25, 1)).toBe(1.5)
    expect(stepZoom(4, 1)).toBe(4)
    expect(stepZoom(1.5, -1)).toBe(1.25)
    expect(stepZoom(1.25, -1)).toBe('fit-page')
    expect(stepZoom(1, -1)).toBe('fit-page')
    // From fit width (here 1.7× the fit-page size) to the nearest step either way.
    expect(stepZoom(1.7, 1)).toBe(2)
    expect(stepZoom(1.7, -1)).toBe(1.5)
  })

  it('snaps factors near or below the page size back to fitting it', () => {
    expect(normalizeZoom(1.03)).toBe('fit-page')
    expect(normalizeZoom(0.5)).toBe('fit-page')
    expect(normalizeZoom(9)).toBe(4)
    expect(normalizeZoom(2.2)).toBe(2.2)
    expect(normalizeZoom(2.04)).toBe(2)
    expect(normalizeZoom(1.47)).toBe(1.5)
    expect(normalizeZoom('fit-width')).toBe('fit-width')
  })

  it('labels the zoom', () => {
    expect(zoomLabel('fit-page', 1)).toBe('Fit page')
    expect(zoomLabel('fit-width', 1.6)).toBe('Fit width')
    expect(zoomLabel(1.5, 1.5)).toBe('150%')
  })

  it('fits one page or a spread the way the renderer does', () => {
    const view = { width: 1000, height: 800 }
    expect(fitPageScale(view, [{ width: 600, height: 800 }])).toBe(1)
    expect(fitPageScale(view, [{ width: 500, height: 400 }])).toBe(2)
    expect(
      fitPageScale(view, [
        { width: 600, height: 800 },
        { width: 600, height: 800 },
      ]),
    ).toBeCloseTo(1000 / 1200)
    expect(fitPageScale(view, [])).toBeNull()
  })

  it('reads the page size a page declares', () => {
    expect(parseViewportSize('width=612, height=792')).toEqual({ width: 612, height: 792 })
    expect(parseViewportSize('width=1200,height=1800')).toEqual({ width: 1200, height: 1800 })
    expect(parseViewportSize('width=device-width')).toBeNull()
    expect(parseViewportSize(null)).toBeNull()
  })

  it('keeps the point under a pinch in place', () => {
    // 288px into a page, doubled: 576px in. With the page's top now at the view's top and the
    // fingers 396px down, scroll 180px further.
    expect(scrollToKeep(0, 288, 2, 396)).toBe(180)
    // Already scrolled: the page's edge is above the view.
    expect(scrollToKeep(-100, 50, 1.5, 200)).toBe(-225)
  })
})
