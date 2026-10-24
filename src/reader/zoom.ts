// Zooming page-based books (PDF, comics, fixed-layout EPUB). Pure, covered by zoom.test.ts;
// BookView.tsx applies it to foliate-js's fixed-layout renderer.

/** Fit the page, fit its width, or a factor of the fit-page size (above 1). */
export type PageZoom = 'fit-page' | 'fit-width' | number

/** Zoom steps, as factors of the fit-page size. */
export const ZOOM_STEPS: readonly number[] = [1, 1.25, 1.5, 2, 2.5, 3, 4]
export const MAX_ZOOM = 4

/** A pinch that ends this close to the fit-page size snaps back to it. */
const SNAP = 0.06
/** …and this close (as a fraction) to a zoom step, to that step. */
const STEP_SNAP = 0.04

/**
 * What a zoom request becomes: factors at or below 1 (or close to it) fit the page, and a pinch
 * that ends near a zoom step lands on it.
 */
export function normalizeZoom(zoom: PageZoom): PageZoom {
  if (typeof zoom !== 'number') return zoom
  if (!Number.isFinite(zoom) || zoom <= 1 + SNAP) return 'fit-page'
  const near = ZOOM_STEPS.find((step) => Math.abs(zoom - step) / step < STEP_SNAP)
  return Math.min(MAX_ZOOM, near ?? zoom)
}

/**
 * The next zoom step in or out from the current factor of the fit-page size (`factor` is what
 * fit width works out to when that's the zoom).
 */
export function stepZoom(factor: number, direction: 1 | -1): PageZoom {
  const steps = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse()
  const next = steps.find((s) => (direction > 0 ? s > factor + 0.01 : s < factor - 0.01))
  return normalizeZoom(next ?? (direction > 0 ? MAX_ZOOM : 1))
}

export function zoomLabel(zoom: PageZoom, factor: number): string {
  if (zoom === 'fit-page') return 'Fit page'
  if (zoom === 'fit-width') return 'Fit width'
  return `${Math.round(factor * 100)}%`
}

export interface PageSize {
  width: number
  height: number
}

/**
 * The scale at which the pages on screen (one, or two side by side) fit the view: as foliate's
 * fixed-layout renderer works it out for `zoom="fit-page"`.
 */
export function fitPageScale(view: PageSize, pages: readonly PageSize[]): number | null {
  const width = pages.reduce((sum, p) => sum + p.width, 0)
  const height = Math.max(0, ...pages.map((p) => p.height))
  if (!(width > 0 && height > 0 && view.width > 0 && view.height > 0)) return null
  return Math.min(view.width / width, view.height / height)
}

/** The page size a fixed-layout page declares (`<meta name="viewport" content="width=…">`). */
export function parseViewportSize(content: string | null | undefined): PageSize | null {
  if (!content) return null
  const entries = content
    .split(/[,;\s]+/)
    .map((part) => part.split('=').map((s) => s.trim()))
    .filter((kv): kv is [string, string] => kv.length === 2)
  const values = Object.fromEntries(entries)
  const width = parseFloat(values.width ?? '')
  const height = parseFloat(values.height ?? '')
  return width > 0 && height > 0 ? { width, height } : null
}

/**
 * How much further to scroll so the point under a pinch stays under it: the point was `inPage`
 * px into the page, the page grew by `ratio`, and its edge is now at `edge` in the view, where
 * the fingers are at `focus`.
 */
export function scrollToKeep(edge: number, inPage: number, ratio: number, focus: number): number {
  return edge + inPage * ratio - focus
}
