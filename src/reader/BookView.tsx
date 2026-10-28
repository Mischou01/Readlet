// The React wrapper around foliate-js's <foliate-view>. With foliate.ts, this is the only module
// that touches foliate-js (docs/PLAN.md §8). It renders the book, draws highlights, reports
// selections, taps and locations, and exposes navigation through a handle.

import { useEffect, useImperativeHandle, useRef, type CSSProperties, type Ref } from 'react'
import { useLatest } from '../lib/hooks'
import {
  collapseCFI,
  FootnoteHandler,
  Overlayer,
  PAGE_DRAWN,
  type Book,
  type Location,
  type SearchResult,
  type TocItem,
  type View,
  createView,
} from './foliate'
import { trimToPage } from './pageSelection'
import { touchZoneAt, type TapZone } from './tapZones'
import { chapterLabel } from './toc'
import {
  fitPageScale,
  MAX_ZOOM,
  normalizeZoom,
  parseViewportSize,
  scrollToKeep,
  stepZoom,
  type PageSize,
  type PageZoom,
} from './zoom'

export interface SelectionInfo {
  cfi: string
  text: string
  /** Where the selection starts, in window coordinates. */
  rect: DOMRect
  range: Range
}

export interface HighlightMark {
  cfi: string
  color: string
  /** It has a note: underlined, and hovering it reports it. */
  note: boolean
}

/** A highlight with a note under the pointer, in window coordinates. */
export interface NoteHover {
  cfi: string
  rect: DOMRect
}

export interface BookLayout {
  scrolled: boolean
  /** Column width limit in px. */
  maxInlineSize: number
  maxColumnCount: number
  /** Space above and below the text in px. */
  margin: number
  /** Space beside the text, as a CSS length (a percentage of the page). */
  gap: string
  animated: boolean
}

export interface BookViewHandle {
  next(): void
  prev(): void
  goLeft(): void
  goRight(): void
  /** Scrolled text: scrolls by `dy` pixels (negative is up). */
  scrollBy(dy: number): void
  /** Goes to a chapter (href or index) or a position (CFI). */
  goTo(target: string | number): Promise<void>
  /**
   * Goes to a search match (a CFI) and marks it in `color`. The mark, and the page it's on, hold
   * through changes of layout (a sheet closing, a window resized) until the reader moves on.
   */
  showMatch(cfi: string, color: string): Promise<void>
  goToFraction(fraction: number): Promise<void>
  /** Streams search results, outlining matches in `color`; call the returned function to stop. */
  search(query: string, color: string, onResult: (result: SearchResult) => void): () => void
  clearSearch(): void
  deselect(): void
  /** Where the book's chapters start (once it's open), for the progress bar. */
  chapterStarts(): ChapterStart[]
  /** Where the page on screen starts, for bookmarking it (a CFI). */
  pageStart(): string | null
  /** The table of contents entry a location falls under. */
  tocItemOf(cfi: string): Promise<TocItem | null>
  /** The underlying view, for read-aloud. */
  view(): View | null
  /** Marks the sentence being read aloud (or clears the mark) and keeps it on screen. */
  markSpeaking(range: Range | null, color: string): void
}

/** A chapter's start, as a fraction of the book. */
export interface ChapterStart {
  fraction: number
  item: TocItem
  /** Top-level entries are the book's parts or chapters; deeper ones, their sections. */
  depth: number
}

export type { TapZone } from './tapZones'
export type { PageZoom } from './zoom'

/** How a page-based book is zoomed, as the reader sees it. */
export interface ZoomInfo {
  /** The pages' size as a factor of the fit-page size. */
  factor: number
  /** The pages are bigger than the view, so it scrolls. */
  overflowing: boolean
}

/** The screen showing within the current section (chapter), when the text is paginated. */
export interface SectionPages {
  current: number
  total: number
}

interface BookViewProps {
  book: Book
  initialLocation: string | null
  styles: string
  layout: BookLayout
  highlights: HighlightMark[]
  dark: boolean
  onReady(info: { fixedLayout: boolean }): void
  onError(error: unknown): void
  /**
   * A new position is showing. `reason` is foliate's: 'page', 'snap' and 'scroll' when the reader
   * turned or scrolled there, 'navigation' for a jump, 'anchor' when the page was laid out again.
   */
  onRelocate(location: Location, pages: SectionPages | null, reason: string | undefined): void
  /** A link in the book is about to take the reader elsewhere in it (footnotes stay put). */
  onLinkJump(): void
  onSelection(selection: SelectionInfo | null): void
  onHighlightClick(cfi: string, rect: DOMRect): void
  /** The pointer moved onto a highlight with a note, or off it (null). */
  onNoteHover(hover: NoteHover | null): void
  onFootnote(footnote: { element: HTMLElement; rect: DOMRect }): void
  onExternalLink(href: string): void
  onActivity(): void
  /** The pointer moved over the page (reveals the chrome). */
  onPointerMove(): void
  onTap(zone: TapZone): void
  onKeyDown(event: KeyboardEvent): void
  /** Page-based books (PDF, comics, fixed layouts): how far the pages are zoomed. */
  zoom: PageZoom
  /** While zoomed: no sideways panning, and pinching or Ctrl+wheel leave the zoom alone. */
  viewLocked: boolean
  onZoomInfo(info: ZoomInfo): void
  /** A pinch or Ctrl+wheel asks for this zoom. */
  onZoomRequest(zoom: PageZoom): void
  ref?: Ref<BookViewHandle>
}

/** Wheel distance that turns a page in paginated mode, and the pause before the next turn. */
const WHEEL_THRESHOLD = 60
const WHEEL_COOLDOWN_MS = 450
/** Clicks this close to the window's sides turn pages even over text (for narrow windows). */
const EDGE_TAP_PX = 56
/** Where a tap turns the page when the text area is unknown (fixed layouts): the outer 22%. */
const EDGE_TAP_FRACTION = 0.22
/** How long a touch selection must hold still before its toolbar shows (handles may be moving). */
const TOUCH_SELECTION_SETTLE_MS = 350
/** How long a tap on the text waits for a second click before it counts as a tap. */
const DOUBLE_CLICK_MS = 260
/** Ctrl+wheel distance for one zoom step, and the pause before the next. */
const WHEEL_ZOOM_THRESHOLD = 40
const WHEEL_ZOOM_COOLDOWN_MS = 120
/** Zoomed in, "next" scrolls this much of the view before it turns the page. */
const ZOOMED_SCROLL_FRACTION = 0.85
/** Older engines can't centre content that overflows without cutting off its start. */
const SAFE_CENTER =
  typeof CSS !== 'undefined' && CSS.supports?.('justify-content', 'safe center') === true

/**
 * The box the text is laid out in. foliate's paginator puts each page's iframe in a `#container`
 * inside its (closed) shadow root; the iframe's ancestors lead there. Fixed layouts have none.
 */
function textAreaOf(doc: Document): Element | null {
  let el = doc.defaultView?.frameElement?.parentElement ?? null
  while (el && el.id !== 'container') el = el.parentElement
  return el
}

function applyLayout(view: View, layout: BookLayout) {
  const r = view.renderer
  // Setting some of these lays the whole section out again, even to the value it already has.
  const set = (name: string, value: string) => {
    if (r.getAttribute(name) !== value) r.setAttribute(name, value)
  }
  set('flow', layout.scrolled ? 'scrolled' : 'paginated')
  set('margin', `${layout.margin}px`)
  set('gap', layout.gap)
  set('max-inline-size', `${layout.maxInlineSize}px`)
  set('max-column-count', String(layout.maxColumnCount))
  r.toggleAttribute('animated', layout.animated)
}

/**
 * Where a book page (an iframe) is in the window, and how much it's scaled: fixed-layout pages
 * other than PDFs are drawn at their own size and shrunk or grown with a CSS transform, so points
 * inside them are in the page's own pixels.
 */
function frameBox(doc: Document): { left: number; top: number; scale: number } | null {
  const frame = doc.defaultView?.frameElement
  if (!(frame instanceof HTMLElement)) return null
  const rect = frame.getBoundingClientRect()
  const scale = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1
  return { left: rect.left, top: rect.top, scale: scale || 1 }
}

/** Translates a point in a book page (an iframe) into window coordinates. */
function toWindowPoint(x: number, y: number, doc: Document): { x: number; y: number } {
  const box = frameBox(doc)
  return box ? { x: box.left + x * box.scale, y: box.top + y * box.scale } : { x, y }
}

/** Translates a rect from a book page (an iframe) into window coordinates. */
function toWindowRect(rect: DOMRect, doc: Document): DOMRect {
  const box = frameBox(doc)
  return box
    ? new DOMRect(
        box.left + rect.left * box.scale,
        box.top + rect.top * box.scale,
        rect.width * box.scale,
        rect.height * box.scale,
      )
    : rect
}

function sectionPages(view: View): SectionPages | null {
  const { page, pages } = view.renderer
  if (view.isFixedLayout || view.renderer.getAttribute('flow') === 'scrolled') return null
  if (page === undefined || pages === undefined || pages < 3) return null
  const total = pages - 2
  return { current: Math.min(Math.max(page, 1), total), total }
}

// -- Zoom (page-based books) -------------------------------------------------------------------
// foliate's fixed-layout renderer (`<foliate-fxl>`) scales its pages by its `zoom` attribute
// ("fit-page", "fit-width" or a scale) and scrolls itself when they're bigger than the view.

interface PageFrame {
  frame: HTMLIFrameElement
  /** The size the page declares; `null` for the empty half of a spread. */
  size: PageSize | null
}

function pageSize(doc: Document, frame: HTMLIFrameElement): PageSize | null {
  const declared = parseViewportSize(
    doc.querySelector('meta[name="viewport"]')?.getAttribute('content'),
  )
  if (declared) return declared
  const root = doc.documentElement
  if (root?.localName === 'svg') {
    const [, , width, height] = (root.getAttribute('viewBox') ?? '').split(/\s+/).map(Number)
    if (width && height) return { width, height }
  }
  // Pages that don't declare a size (comic images) get an unscaled frame of the image's size.
  const width = parseFloat(frame.style.width)
  const height = parseFloat(frame.style.height)
  return width > 0 && height > 0 ? { width, height } : null
}

/** The pages on screen: one, or both halves of a spread. */
function visiblePages(view: View): PageFrame[] {
  const pages: PageFrame[] = []
  for (const { doc } of view.renderer.getContents()) {
    const frame = doc?.defaultView?.frameElement
    if (!(frame instanceof HTMLIFrameElement)) continue
    // The other half of a spread, on a screen too narrow to show both.
    if (frame.parentElement?.style.display === 'none') continue
    const blank = frame.style.display === 'none'
    pages.push({ frame, size: blank ? null : pageSize(doc, frame) })
  }
  return pages
}

/** The scale at which the pages on screen fit the view. */
function fitPage(view: View): number | null {
  const pages = visiblePages(view)
  const first = pages.find((p) => p.size)?.size
  if (!first) return null
  // An empty half of a spread takes the size of the page beside it, as the renderer does.
  const { width, height } = view.renderer.getBoundingClientRect()
  return fitPageScale(
    { width, height },
    pages.map((p) => p.size ?? first),
  )
}

/** The scale the pages are drawn at now. */
function currentScale(view: View): number | null {
  const page = visiblePages(view).find((p) => p.size)
  if (!page?.size) return null
  return page.frame.getBoundingClientRect().width / page.size.width
}

function zoomInfo(view: View): ZoomInfo {
  const r = view.renderer
  const fit = fitPage(view)
  const scale = currentScale(view)
  return {
    factor: fit && scale ? scale / fit : 1,
    overflowing: r.scrollHeight > r.clientHeight + 1 || r.scrollWidth > r.clientWidth + 1,
  }
}

/**
 * Zooms the pages. `focus` (a point in the view) stays where it is, as under a pinch. Returns
 * whether anything changed.
 */
function applyZoom(view: View, zoom: PageZoom, focus?: { x: number; y: number }): boolean {
  if (!view.isFixedLayout) return false
  const r = view.renderer
  let value: string
  if (typeof zoom === 'number') {
    const fit = fitPage(view)
    if (!fit) return false
    value = String(Math.round(fit * zoom * 10_000) / 10_000)
  } else value = zoom
  if ((r.getAttribute('zoom') ?? 'fit-page') === value) return false
  const before = currentScale(view)
  const page = visiblePages(view).find((p) => p.size)?.frame
  const box = r.getBoundingClientRect()
  const start = page?.getBoundingClientRect()
  // Pages taller than the view start at the top rather than being centred off the top edge (the
  // pages' own auto margins still centre them when they're smaller); pages wider than the view
  // are centred without cutting off their left edge.
  r.style.alignItems = 'flex-start'
  r.style.justifyContent = SAFE_CENTER ? 'safe center' : value === 'fit-page' ? '' : 'flex-start'
  r.setAttribute('zoom', value)
  const after = currentScale(view)
  const end = page?.isConnected ? page.getBoundingClientRect() : null
  if (focus && before && after && start && end) {
    const ratio = after / before
    r.scrollLeft += scrollToKeep(
      end.left - box.left,
      focus.x - (start.left - box.left),
      ratio,
      focus.x,
    )
    r.scrollTop += scrollToKeep(end.top - box.top, focus.y - (start.top - box.top), ratio, focus.y)
  }
  return true
}

/**
 * Moves a range's start past whitespace. Where a paragraph runs over a page break, the visible text
 * starts with the space before the page's first word, and that space is laid out at the end of the
 * previous page: going to it would show the wrong page.
 */
function skipLeadingSpace<T extends Range | Element>(anchor: T): T {
  if (!('startContainer' in anchor)) return anchor
  const { startContainer: node, startOffset } = anchor
  if (node.nodeType !== Node.TEXT_NODE) return anchor
  const text = node.nodeValue ?? ''
  let offset = startOffset
  while (offset < text.length && /\s/.test(text.charAt(offset))) offset++
  if (offset === startOffset || offset === text.length) return anchor
  const moved = anchor.cloneRange()
  moved.setStart(node, offset)
  return moved as T
}

/**
 * foliate's fixed-layout renderer gives its pages no overlayer to draw highlights on (its
 * getContents() leaves them as a TODO), so highlights in PDFs were saved but never shown. Each page
 * gets one here, made by the view's own `create-overlayer` handler as the text renderer does.
 */
function overlayFixedPages(view: View): (doc: Document, index: number) => void {
  const r = view.renderer
  const pages = new WeakMap<Document, { index: number; overlayer: { element: SVGElement } }>()
  const getContents = r.getContents.bind(r)
  r.getContents = () => getContents().map((c) => ({ ...c, ...(c.doc && pages.get(c.doc)) }))
  return (doc, index) => {
    const attach = (overlayer: { element: SVGElement }) => {
      // The page is paper whatever the theme, and the view's variables don't reach into its frame.
      overlayer.element.style.setProperty('--overlayer-highlight-opacity', '1')
      overlayer.element.style.setProperty('--overlayer-highlight-blend-mode', 'multiply')
      doc.body.append(overlayer.element)
      pages.set(doc, { index, overlayer })
    }
    r.dispatchEvent(new CustomEvent('create-overlayer', { detail: { doc, index, attach } }))
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** A highlight with a dotted underline, which says there's a note to read. */
function drawNoted(rects: DOMRectList, color: string, dark: boolean): SVGElement {
  const g = document.createElementNS(SVG_NS, 'g')
  g.append(Overlayer.highlight(rects, { color }))
  const line = document.createElementNS(SVG_NS, 'g')
  line.setAttribute('stroke', dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.45)')
  line.setAttribute('stroke-width', '1.5')
  line.setAttribute('stroke-dasharray', '2 3')
  for (const { left, right, bottom, width } of Array.from(rects)) {
    if (!width) continue
    const l = document.createElementNS(SVG_NS, 'line')
    l.setAttribute('x1', String(left))
    l.setAttribute('x2', String(right))
    l.setAttribute('y1', String(bottom - 1))
    l.setAttribute('y2', String(bottom - 1))
    line.append(l)
  }
  g.append(line)
  return g
}

/** The annotation foliate-js draws for a highlight. */
const markAnnotation = ({ cfi, color, note }: HighlightMark) => ({
  value: cfi,
  color,
  kind: note ? 'note' : undefined,
})

type HitTest = (point: { x: number; y: number }) => [string?, Range?]

function firstVisibleRect(range: Range): DOMRect {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
  return rects[0] ?? range.getBoundingClientRect()
}

export function BookView(props: BookViewProps) {
  const { book, styles, layout, highlights, dark, ref } = props
  const container = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View | null>(null)
  const ready = useRef(false)
  const marks = useRef(new Map<string, HighlightMark>())
  const speaking = useRef<string | null>(null)
  /** The search match gone to, while it's marked. */
  const found = useRef<{ cfi: string; range: Range | null } | null>(null)
  /** Where the zoom asked for by a pinch or Ctrl+wheel was centred, in the view. */
  const pendingFocus = useRef<{ x: number; y: number } | null>(null)
  const callbacks = useLatest(props)
  const initialLocation = useRef(props.initialLocation)
  const initialStyles = useLatest(styles)
  const initialLayout = useLatest(layout)

  /** Where a zoomed page turned to should be scrolled: to its top, or (going back) its bottom. */
  const landing = useRef<{ at: 'top' | 'bottom'; left: number } | null>(null)

  /**
   * Turns the page forward (1) or back (-1). Zoomed into a page, it scrolls down (or up) a screen
   * first, and turns the page only at the bottom (or top).
   */
  const advance = (direction: 1 | -1) => {
    const view = viewRef.current
    if (!view) return
    const r = view.renderer
    if (view.isFixedLayout && r.scrollHeight - r.clientHeight > 2) {
      const max = r.scrollHeight - r.clientHeight
      const behavior = callbacks.current.layout.animated ? 'smooth' : 'auto'
      const step = r.clientHeight * ZOOMED_SCROLL_FRACTION
      if (direction > 0 ? r.scrollTop < max - 2 : r.scrollTop > 2) {
        r.scrollBy({ top: direction * step, behavior })
        return
      }
      landing.current = { at: direction > 0 ? 'top' : 'bottom', left: r.scrollLeft }
    }
    void (direction > 0 ? view.next() : view.prev())
  }
  const rtl = () => viewRef.current?.book.dir === 'rtl'

  /** Takes a passing mark (read-aloud, a search match) off; a highlight it covered comes back. */
  const unmark = (cfi: string) => {
    const view = viewRef.current
    if (!view) return
    const mark = marks.current.get(cfi)
    void (mark ? view.addAnnotation(markAnnotation(mark)) : view.deleteAnnotation({ value: cfi }))
  }
  const clearFound = () => {
    if (found.current) unmark(found.current.cfi)
    found.current = null
  }

  /** Goes to a chapter (href or index) or a position (CFI); for a CFI, returns its range. */
  const goTo = async (target: string | number): Promise<Range | null> => {
    const view = viewRef.current
    if (!view) return null
    const resolved =
      typeof target === 'string' && target.startsWith('epubcfi(')
        ? view.resolveNavigation(target)
        : undefined
    const anchor = resolved?.anchor
    if (resolved && anchor && view.renderer.goTo) {
      let range: Range | null = null
      // Bookmarks saved before pageStart() skipped the space at a page break still land right.
      await view.renderer.goTo({
        index: resolved.index,
        anchor: (doc) => {
          const target = skipLeadingSpace(anchor(doc))
          if ('startContainer' in target) range = target
          return target
        },
      })
      return range
    }
    await view.goTo(target)
    return null
  }

  useImperativeHandle(
    ref,
    () => ({
      next: () => advance(1),
      prev: () => advance(-1),
      goLeft: () => advance(rtl() ? 1 : -1),
      goRight: () => advance(rtl() ? -1 : 1),
      scrollBy: (dy) => {
        const doc = viewRef.current?.renderer.getContents()[0]?.doc
        if (doc) textAreaOf(doc)?.scrollBy({ top: dy })
      },
      goTo: async (target) => {
        await goTo(target)
      },
      showMatch: async (cfi, color) => {
        clearFound()
        const range = await goTo(cfi)
        const view = viewRef.current
        if (!view) return
        found.current = { cfi, range }
        void view.addAnnotation({ value: cfi, color, kind: 'found' })
      },
      goToFraction: async (fraction) => {
        await viewRef.current?.goToFraction(fraction)
      },
      search: (query, color, onResult) => {
        const view = viewRef.current
        clearFound()
        let stopped = false
        if (view) {
          void (async () => {
            for await (const result of view.search({ query, drawOptions: { color } })) {
              if (stopped) break
              // Name result groups the way the toolbar names chapters ("Book I · Chapter IV").
              const first = typeof result === 'object' && 'subitems' in result && result.subitems[0]
              if (first) {
                const item = await view.getTOCItemOf(first.cfi)
                if (stopped) break
                onResult({
                  ...result,
                  label: chapterLabel(view.book.toc ?? [], item) ?? result.label,
                })
              } else onResult(result)
            }
          })().catch((e) => console.warn('search failed', e))
        }
        return () => {
          stopped = true
        }
      },
      clearSearch: () => viewRef.current?.clearSearch(),
      deselect: () => viewRef.current?.deselect(),
      chapterStarts: () => {
        const view = viewRef.current
        if (!view) return []
        const fractions = view.getSectionFractions()
        const starts: ChapterStart[] = []
        // Entries that share a section (anchors within one file) can't be placed more precisely
        // than the section's start; the first of them names it.
        const placed = new Set<number>()
        const walk = (items: readonly TocItem[], depth: number) => {
          for (const item of items) {
            const index = item.href ? view.resolveNavigation(item.href)?.index : undefined
            const fraction = index === undefined ? undefined : fractions[index]
            if (index !== undefined && fraction !== undefined && !placed.has(index)) {
              placed.add(index)
              starts.push({ fraction, item, depth })
            }
            if (item.subitems?.length) walk(item.subitems, depth + 1)
          }
        }
        walk(view.book.toc ?? [], 0)
        return starts.sort((a, b) => a.fraction - b.fraction)
      },
      pageStart: () => {
        const view = viewRef.current
        const location = view?.lastLocation
        if (!view || !location?.cfi) return null
        const index = view.renderer.getContents()[0]?.index
        // Fixed layouts have no text range: the page is its own position.
        if (!location.range || index === undefined) return collapseCFI(location.cfi)
        const start = skipLeadingSpace(location.range).cloneRange()
        start.collapse(true)
        return view.getCFI(index, start)
      },
      tocItemOf: async (cfi) => (await viewRef.current?.getTOCItemOf(cfi)) ?? null,
      view: () => viewRef.current,
      markSpeaking: (range, color) => {
        const view = viewRef.current
        if (!view) return
        if (speaking.current) unmark(speaking.current)
        speaking.current = null
        if (!range) return
        const index = view.renderer.getContents()[0]?.index
        if (index === undefined) return
        const cfi = view.getCFI(index, range)
        speaking.current = cfi
        void view.addAnnotation({ value: cfi, color, kind: 'speaking' })
        void view.renderer.scrollToAnchor?.(range)
      },
    }),
    // `advance` reads everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Open the book once per book object.
  useEffect(() => {
    const host = container.current
    if (!host) return
    const view = createView()
    viewRef.current = view
    ready.current = false
    view.setAttribute('autohide-cursor', '')
    view.style.cssText = 'display:block;width:100%;height:100%'
    host.append(view)

    let cancelled = false
    let highlightClicked = false
    let textArea: Element | null = null
    let lastLinkRect = new DOMRect()
    let overlayPage: ((doc: Document, index: number) => void) | null = null
    let hoveredNote: string | null = null
    const setHoveredNote = (hover: NoteHover | null) => {
      if ((hover?.cfi ?? null) === hoveredNote) return
      hoveredNote = hover?.cfi ?? null
      callbacks.current.onNoteHover(hover)
    }
    let wheelDelta = 0
    let wheelLockedUntil = 0
    let pendingTap: ReturnType<typeof setTimeout> | undefined
    const cancelPendingTap = () => clearTimeout(pendingTap)
    /** Whether the last press was a finger rather than a mouse or pen. */
    let touch = false
    let settleSelection: ReturnType<typeof setTimeout> | undefined
    /** The text on the page showing (paginated text). */
    let pageRange: Range | null = null
    const footnotes = new FootnoteHandler()

    const onWheel = (e: WheelEvent) => {
      callbacks.current.onActivity()
      if (callbacks.current.layout.scrolled || view.isFixedLayout) return
      const now = performance.now()
      if (now < wheelLockedUntil) return
      wheelDelta += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (Math.abs(wheelDelta) >= WHEEL_THRESHOLD) {
        void (wheelDelta > 0 ? view.next() : view.prev())
        wheelDelta = 0
        wheelLockedUntil = now + WHEEL_COOLDOWN_MS
      }
    }

    // Pages turn from the margins beside the text; a click on the text itself shows the chrome.
    const zoneAt = (x: number, y: number): TapZone => {
      const box = host.getBoundingClientRect()
      if (touch) return touchZoneAt(x, y, box)
      const text = textArea?.isConnected ? textArea.getBoundingClientRect() : null
      const left = text
        ? Math.max(text.left, box.left + EDGE_TAP_PX)
        : box.left + box.width * EDGE_TAP_FRACTION
      const right = text
        ? Math.min(text.right, box.right - EDGE_TAP_PX)
        : box.right - box.width * EDGE_TAP_FRACTION
      return x < left ? 'left' : x > right ? 'right' : 'center'
    }

    const onHostPointerDown = (e: PointerEvent) => {
      touch = e.pointerType === 'touch'
    }
    // Clicks in the margins land on the view itself, outside the page's iframe.
    const onHostClick = (e: MouseEvent) => {
      callbacks.current.onActivity()
      callbacks.current.onTap(zoneAt(e.clientX, e.clientY))
    }

    // Ctrl+wheel (and touchpad pinches, which arrive as it) zooms page-based books a step at a time.
    let wheelZoom = 0
    let wheelZoomLockedUntil = 0
    const onWheelZoom = (e: WheelEvent, doc: Document | null) => {
      if (!e.ctrlKey || !view.isFixedLayout) return
      e.preventDefault()
      if (callbacks.current.viewLocked) return
      const now = performance.now()
      if (now < wheelZoomLockedUntil) return
      wheelZoom += e.deltaY
      if (Math.abs(wheelZoom) < WHEEL_ZOOM_THRESHOLD) return
      const box = view.renderer.getBoundingClientRect()
      const at = doc ? toWindowPoint(e.clientX, e.clientY, doc) : { x: e.clientX, y: e.clientY }
      pendingFocus.current = { x: at.x - box.left, y: at.y - box.top }
      callbacks.current.onZoomRequest(stepZoom(zoomInfo(view).factor, wheelZoom < 0 ? 1 : -1))
      wheelZoom = 0
      wheelZoomLockedUntil = now + WHEEL_ZOOM_COOLDOWN_MS
    }
    const onHostWheel = (e: WheelEvent) => onWheelZoom(e, null)

    // Pinching a page-based book: the view scales under the fingers, and the pages are drawn at
    // the new size when they let go.
    let pinch: { distance: number; factor: number; ratio: number; x: number; y: number } | null =
      null
    const spread = (t: TouchList) => {
      const [a, b] = [t[0], t[1]]
      return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0
    }
    const endPinch = () => {
      if (!pinch) return
      const { factor, ratio, x, y } = pinch
      pinch = null
      const r = view.renderer
      r.style.transform = ''
      r.style.transformOrigin = ''
      pendingFocus.current = { x, y }
      callbacks.current.onZoomRequest(normalizeZoom(factor * ratio))
    }

    const drawMarks = () => {
      for (const mark of marks.current.values()) void view.addAnnotation(markAnnotation(mark))
    }
    const attachToPage = (doc: Document, index: number) => {
      textArea = textAreaOf(doc) ?? textArea
      if (overlayPage) {
        // A PDF page's text comes later, and again at each new size: its marks follow it.
        if (doc.querySelector('.textLayer')) {
          let overlaid = false
          doc.addEventListener(PAGE_DRAWN, () => {
            if (overlaid) drawMarks()
            else overlayPage?.(doc, index)
            overlaid = true
          })
        } else overlayPage(doc, index)
      }
      doc.addEventListener('wheel', (e) => onWheelZoom(e, doc), { passive: false })
      doc.addEventListener(
        'touchstart',
        (e) => {
          if (e.touches.length !== 2 || !view.isFixedLayout || callbacks.current.viewLocked) return
          const [a, b] = [e.touches[0], e.touches[1]]
          if (!a || !b) return
          const box = view.renderer.getBoundingClientRect()
          const at = toWindowPoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, doc)
          pinch = {
            distance: spread(e.touches),
            factor: zoomInfo(view).factor,
            ratio: 1,
            x: at.x - box.left,
            y: at.y - box.top,
          }
          view.renderer.style.transformOrigin = `${pinch.x}px ${pinch.y}px`
        },
        { passive: true },
      )
      doc.addEventListener(
        'touchmove',
        (e) => {
          if (!pinch || e.touches.length !== 2 || pinch.distance === 0) return
          e.preventDefault()
          const raw = spread(e.touches) / pinch.distance
          // Out to the fit-page size (with a little give) and in to the largest zoom.
          pinch.ratio = Math.min(MAX_ZOOM / pinch.factor, Math.max(0.85 / pinch.factor, raw))
          view.renderer.style.transform = `scale(${pinch.ratio})`
        },
        { passive: false },
      )
      doc.addEventListener('touchend', endPinch)
      doc.addEventListener('touchcancel', endPinch)
      const reportSelection = () => {
        const selection = doc.getSelection()
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          callbacks.current.onSelection(null)
          return
        }
        const range = selection.getRangeAt(0)
        const text = range.toString().trim()
        if (!text) return
        callbacks.current.onSelection({
          cfi: view.getCFI(index, range),
          text,
          rect: toWindowRect(firstVisibleRect(range), doc),
          range,
        })
      }
      doc.addEventListener('pointerup', () => setTimeout(reportSelection, 0))
      doc.addEventListener('keyup', (e) => e.shiftKey && reportSelection())
      // Captured, so it runs before foliate's own listener: when a selection is dragged or
      // extended past the page, foliate turns the page so it can go on. Selections stay on the
      // page showing instead (scrolled text scrolls as it's selected, as anywhere else).
      const onSelectionChange = (e: Event) => {
        if (!view.isFixedLayout && !callbacks.current.layout.scrolled) {
          e.stopImmediatePropagation()
          // Trimming it changes it again, which comes back here.
          if (trimToPage(doc.getSelection(), pageRange)) return
        }
        clearTimeout(settleSelection)
        if (doc.getSelection()?.isCollapsed) callbacks.current.onSelection(null)
        // A long press selects a word and the handles adjust it, with no pointerup in the page:
        // report the selection once it settles.
        else if (touch) settleSelection = setTimeout(reportSelection, TOUCH_SELECTION_SETTLE_MS)
      }
      doc.addEventListener('selectionchange', onSelectionChange, true)
      doc.addEventListener('keydown', (e) => {
        callbacks.current.onActivity()
        callbacks.current.onKeyDown(e)
      })
      let lastPointer = { x: -1, y: -1 }
      const noteAt = (x: number, y: number): NoteHover | null => {
        const overlayer = view.renderer.getContents().find((c) => c.doc === doc)?.overlayer as
          { hitTest: HitTest } | undefined
        const [cfi, range] = overlayer?.hitTest({ x, y }) ?? []
        if (!cfi || !range || !marks.current.get(cfi)?.note) return null
        return { cfi, rect: toWindowRect(firstVisibleRect(range), doc) }
      }
      doc.addEventListener('pointermove', (e) => {
        // WebKit sends synthetic moves when the page scrolls under a still pointer.
        if (e.screenX === lastPointer.x && e.screenY === lastPointer.y) return
        lastPointer = { x: e.screenX, y: e.screenY }
        callbacks.current.onActivity()
        // A moving finger is turning the page or selecting text, not looking for the toolbar (and
        // the slight movement in a tap would show it just before the tap toggles it off again).
        if (e.pointerType === 'touch') return
        callbacks.current.onPointerMove()
        if (e.pointerType === 'mouse') setHoveredNote(noteAt(e.clientX, e.clientY))
      })
      doc.addEventListener('pointerout', (e) => {
        if (!e.relatedTarget) setHoveredNote(null)
      })
      doc.addEventListener('wheel', onWheel, { passive: true })
      // A second press means a double-click (selecting a word), so a tap still waiting is dropped.
      let lastPress = 0
      doc.addEventListener('pointerdown', (e) => {
        lastPress = e.timeStamp
        touch = e.pointerType === 'touch'
        cancelPendingTap()
      })
      doc.addEventListener('click', (e) => {
        callbacks.current.onActivity()
        // The later clicks of a double or triple click select text; they aren't taps.
        if (e.detail > 1) return
        if (e.defaultPrevented || (e.target as Element | null)?.closest?.('a[href]')) return
        if (!doc.getSelection()?.isCollapsed) return
        const { x, y } = toWindowPoint(e.clientX, e.clientY, doc)
        // foliate reports highlight clicks from its own listener, after this one.
        setTimeout(() => {
          if (highlightClicked) {
            highlightClicked = false
            return
          }
          const zone = zoneAt(x, y)
          // Margins turn the page at once. A click on the text waits to see whether it's the start
          // of a double-click, so selecting a word doesn't flash the toolbar or the selection bar.
          // (Touch selects with a long press instead, so taps needn't wait.)
          if (zone !== 'center' || touch) {
            callbacks.current.onTap(zone)
            return
          }
          pendingTap = setTimeout(() => {
            if (lastPress > e.timeStamp || !doc.getSelection()?.isCollapsed) return
            callbacks.current.onTap('center')
          }, DOUBLE_CLICK_MS)
        }, 0)
      })
    }

    view.addEventListener('load', ((e: CustomEvent<{ doc: Document; index: number }>) =>
      attachToPage(e.detail.doc, e.detail.index)) as EventListener)
    view.addEventListener('relocate', ((e: CustomEvent<Location>) => {
      setHoveredNote(null)
      if (view.isFixedLayout) {
        // A new page keeps the zoom (re-fitted, if its size differs) and the column being read,
        // and starts at its top, or at its bottom when going back from the top of the next.
        const r = view.renderer
        const land = landing.current
        landing.current = null
        const left = land?.left ?? r.scrollLeft
        applyZoom(view, callbacks.current.zoom)
        r.scrollTop = land?.at === 'bottom' ? r.scrollHeight : 0
        r.scrollLeft = left
        callbacks.current.onZoomInfo(zoomInfo(view))
      }
      callbacks.current.onRelocate(e.detail, sectionPages(view), lastReason)
    }) as EventListener)
    view.addEventListener('create-overlay', drawMarks)
    view.addEventListener('draw-annotation', ((e: CustomEvent) => {
      const { draw, annotation } = e.detail as {
        draw: (f: unknown, o: unknown) => void
        annotation: { color: string; kind?: string }
      }
      if (annotation.kind === 'speaking' || annotation.kind === 'found') {
        // A translucent wash rather than a highlighter stroke, whatever the theme.
        draw((rects: DOMRectList) => {
          const g = Overlayer.highlight(rects, { color: annotation.color })
          g.style.opacity = '1'
          g.style.mixBlendMode = 'normal'
          return g
        }, {})
      } else if (annotation.kind === 'note') {
        draw((rects: DOMRectList) => drawNoted(rects, annotation.color, callbacks.current.dark), {})
      } else {
        draw(Overlayer.highlight, { color: annotation.color })
      }
    }) as EventListener)
    view.addEventListener('show-annotation', ((e: CustomEvent<{ value: string; range: Range }>) => {
      // A passing mark (read-aloud, a search match) isn't a highlight: a click on it is a tap.
      if (!marks.current.has(e.detail.value)) return
      highlightClicked = true
      setHoveredNote(null)
      const { value, range } = e.detail
      const doc = range.startContainer.ownerDocument
      const rect = doc ? toWindowRect(firstVisibleRect(range), doc) : firstVisibleRect(range)
      callbacks.current.onHighlightClick(value, rect)
    }) as EventListener)
    view.addEventListener('external-link', ((
      e: CustomEvent<{ a: HTMLAnchorElement; href_: string }>,
    ) => {
      e.preventDefault()
      callbacks.current.onExternalLink(e.detail.a.href || e.detail.href_)
    }) as EventListener)
    view.addEventListener('link', ((e: CustomEvent<{ a: HTMLAnchorElement; href: string }>) => {
      const { a } = e.detail
      lastLinkRect = toWindowRect(a.getBoundingClientRect(), a.ownerDocument)
      footnotes.handle(view.book, e)?.catch((err) => console.warn('footnote failed', err))
      // A footnote shows in a popover; any other link goes there.
      if (!e.defaultPrevented) callbacks.current.onLinkJump()
    }) as EventListener)

    footnotes.addEventListener('before-render', ((e: CustomEvent<{ view: View }>) => {
      const note = e.detail.view
      note.renderer.setAttribute('flow', 'scrolled')
      note.renderer.setAttribute('margin', '0px')
      note.renderer.setAttribute('gap', '8%')
      note.renderer.setStyles?.(initialStyles.current)
      note.addEventListener('external-link', ((ev: CustomEvent<{ a: HTMLAnchorElement }>) => {
        ev.preventDefault()
        callbacks.current.onExternalLink(ev.detail.a.href)
      }) as EventListener)
    }) as EventListener)
    footnotes.addEventListener('render', ((e: CustomEvent<{ view: View }>) => {
      const note = e.detail.view
      note.style.cssText = 'display:block;width:100%;height:100%'
      callbacks.current.onFootnote({ element: note, rect: lastLinkRect })
    }) as EventListener)

    host.addEventListener('wheel', onWheel, { passive: true })
    host.addEventListener('wheel', onHostWheel, { passive: false })
    host.addEventListener('pointerdown', onHostPointerDown)
    host.addEventListener('click', onHostClick)
    // Zoomed to a factor of the fit-page size, the pages follow the window's size.
    let refit: ReturnType<typeof setTimeout> | undefined
    const resizes = new ResizeObserver(() => {
      clearTimeout(refit)
      refit = setTimeout(() => {
        if (!ready.current || !view.isFixedLayout) return
        applyZoom(view, callbacks.current.zoom)
        callbacks.current.onZoomInfo(zoomInfo(view))
      }, 150)
    })
    resizes.observe(host)

    // A search match keeps its mark while it's on screen; moving off it (a page turn, a jump)
    // takes the mark away. A new layout (a sheet closing, a resize) keeps it on screen: foliate
    // re-anchors on it, and in case that lands a page off, it's gone to again.
    let refinding = false
    let lastReason: string | undefined
    const onRendererRelocate = ((e: CustomEvent<{ reason?: string; range?: Range | null }>) => {
      const { reason, range } = e.detail
      lastReason = reason
      pageRange = range ?? null
      const match = found.current
      if (!match || refinding || reason === 'selection') return
      let onPage = false
      try {
        const start = match.range
        onPage =
          !!start && !!range && range.comparePoint(start.startContainer, start.startOffset) === 0
      } catch {
        // The match is in a section that's no longer showing.
      }
      if (onPage) return
      if (reason !== 'anchor') clearFound()
      // Scrolled text puts the match at the very top, just outside what foliate counts as showing.
      else if (match.range && !callbacks.current.layout.scrolled) {
        refinding = true
        void view.renderer.scrollToAnchor?.(match.range)
        refinding = false
      }
    }) as EventListener

    ;(async () => {
      await view.open(book)
      if (cancelled) return
      if (view.isFixedLayout) overlayPage = overlayFixedPages(view)
      // Captured, to run before the view's own listener, which reports the move without its reason.
      view.renderer.addEventListener('relocate', onRendererRelocate, true)
      applyLayout(view, initialLayout.current)
      view.renderer.setStyles?.(initialStyles.current)
      await view.init({
        lastLocation: initialLocation.current,
        showTextStart: !initialLocation.current,
      })
      if (cancelled) return
      ready.current = true
      callbacks.current.onReady({ fixedLayout: view.isFixedLayout })
      if (view.isFixedLayout) {
        applyZoom(view, callbacks.current.zoom)
        callbacks.current.onZoomInfo(zoomInfo(view))
      }
    })().catch((e) => {
      if (!cancelled) callbacks.current.onError(e)
    })

    return () => {
      cancelled = true
      cancelPendingTap()
      clearTimeout(settleSelection)
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('wheel', onHostWheel)
      resizes.disconnect()
      clearTimeout(refit)
      host.removeEventListener('pointerdown', onHostPointerDown)
      host.removeEventListener('click', onHostClick)
      view.close()
      view.remove()
      viewRef.current = null
    }
    // `clearFound` reads everything through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, callbacks, initialLayout, initialStyles])

  useEffect(() => {
    const view = viewRef.current
    if (view && ready.current) view.renderer.setStyles?.(styles)
  }, [styles])

  useEffect(() => {
    const view = viewRef.current
    if (view && ready.current) applyLayout(view, layout)
  }, [layout])

  const { zoom, viewLocked } = props
  useEffect(() => {
    const view = viewRef.current
    if (!view || !ready.current || !view.isFixedLayout) return
    const focus = pendingFocus.current ?? undefined
    pendingFocus.current = null
    if (applyZoom(view, zoom, focus)) callbacks.current.onZoomInfo(zoomInfo(view))
  }, [zoom, callbacks])

  // Locked, the view holds its place across: no sideways panning.
  useEffect(() => {
    const view = viewRef.current
    if (view?.isFixedLayout) view.renderer.style.overflowX = viewLocked ? 'hidden' : ''
  }, [viewLocked])

  // Highlights: draw what's new or changed, remove what's gone.
  useEffect(() => {
    const view = viewRef.current
    const next = new Map(highlights.map((h) => [h.cfi, h]))
    const previous = marks.current
    marks.current = next
    // Before the book is open, pages draw their marks as they load ('create-overlay').
    if (!view || !ready.current) return
    const same = (a?: HighlightMark, b?: HighlightMark) =>
      a?.color === b?.color && a?.note === b?.note
    for (const [cfi, mark] of previous) {
      if (!same(next.get(cfi), mark)) void view.deleteAnnotation({ value: cfi })
    }
    for (const [cfi, mark] of next) {
      if (!same(previous.get(cfi), mark)) void view.addAnnotation(markAnnotation(mark))
    }
  }, [highlights])

  return (
    <div
      ref={container}
      style={
        {
          width: '100%',
          height: '100%',
          // A pinch scales the whole view until the fingers lift; it mustn't spill over the chrome.
          overflow: 'hidden',
          '--overlayer-highlight-opacity': dark ? '0.3' : '1',
          '--overlayer-highlight-blend-mode': dark ? 'normal' : 'multiply',
        } as CSSProperties
      }
    />
  )
}
