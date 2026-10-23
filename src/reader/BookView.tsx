// The React wrapper around foliate-js's <foliate-view>. With foliate.ts, this is the only module
// that touches foliate-js (docs/PLAN.md §8). It renders the book, draws highlights, reports
// selections, taps and locations, and exposes navigation through a handle.

import { useEffect, useImperativeHandle, useRef, type CSSProperties, type Ref } from 'react'
import { useLatest } from '../lib/hooks'
import {
  collapseCFI,
  FootnoteHandler,
  Overlayer,
  type Book,
  type Location,
  type SearchResult,
  type TocItem,
  type View,
  createView,
} from './foliate'
import { chapterLabel } from './toc'

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
  /** Goes to a chapter (href or index) or a position (CFI). */
  goTo(target: string | number): Promise<void>
  goToFraction(fraction: number): Promise<void>
  /** Streams search results, outlining matches in `color`; call the returned function to stop. */
  search(query: string, color: string, onResult: (result: SearchResult) => void): () => void
  clearSearch(): void
  deselect(): void
  sectionFractions(): number[]
  /** Where the page on screen starts, for bookmarking it (a CFI). */
  pageStart(): string | null
  /** The table of contents entry a location falls under. */
  tocItemOf(cfi: string): Promise<TocItem | null>
  /** The underlying view, for read-aloud. */
  view(): View | null
  /** Marks the sentence being read aloud (or clears the mark) and keeps it on screen. */
  markSpeaking(range: Range | null, color: string): void
}

export type TapZone = 'left' | 'center' | 'right'

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
  onRelocate(location: Location, pages: SectionPages | null): void
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
  ref?: Ref<BookViewHandle>
}

/** Wheel distance that turns a page in paginated mode, and the pause before the next turn. */
const WHEEL_THRESHOLD = 60
const WHEEL_COOLDOWN_MS = 450
/** Clicks this close to the window's sides turn pages even over text (for narrow windows). */
const EDGE_TAP_PX = 56
/** Where a tap turns the page when the text area is unknown (fixed layouts): the outer 22%. */
const EDGE_TAP_FRACTION = 0.22
/**
 * On a touch screen the text fills the page, so taps in the outer 30% on each side turn it,
 * whatever is under the finger; the middle shows the toolbar.
 */
const TOUCH_TAP_FRACTION = 0.3
/** How long a touch selection must hold still before its toolbar shows (handles may be moving). */
const TOUCH_SELECTION_SETTLE_MS = 350
/** How long a tap on the text waits for a second click before it counts as a tap. */
const DOUBLE_CLICK_MS = 260

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
  r.setAttribute('flow', layout.scrolled ? 'scrolled' : 'paginated')
  r.setAttribute('margin', `${layout.margin}px`)
  r.setAttribute('gap', layout.gap)
  r.setAttribute('max-inline-size', `${layout.maxInlineSize}px`)
  r.setAttribute('max-column-count', String(layout.maxColumnCount))
  r.toggleAttribute('animated', layout.animated)
}

/** Translates a rect from a book page (an iframe) into window coordinates. */
function toWindowRect(rect: DOMRect, doc: Document): DOMRect {
  const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
  return frame
    ? new DOMRect(rect.left + frame.left, rect.top + frame.top, rect.width, rect.height)
    : rect
}

function sectionPages(view: View): SectionPages | null {
  const { page, pages } = view.renderer
  if (view.isFixedLayout || view.renderer.getAttribute('flow') === 'scrolled') return null
  if (page === undefined || pages === undefined || pages < 3) return null
  const total = pages - 2
  return { current: Math.min(Math.max(page, 1), total), total }
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
  const callbacks = useLatest(props)
  const initialLocation = useRef(props.initialLocation)
  const initialStyles = useLatest(styles)
  const initialLayout = useLatest(layout)

  useImperativeHandle(
    ref,
    () => ({
      next: () => void viewRef.current?.next(),
      prev: () => void viewRef.current?.prev(),
      goLeft: () => void viewRef.current?.goLeft(),
      goRight: () => void viewRef.current?.goRight(),
      goTo: async (target) => {
        const view = viewRef.current
        if (!view) return
        const resolved =
          typeof target === 'string' && target.startsWith('epubcfi(')
            ? view.resolveNavigation(target)
            : undefined
        const anchor = resolved?.anchor
        if (resolved && anchor && view.renderer.goTo) {
          // Bookmarks saved before pageStart() skipped the space at a page break still land right.
          await view.renderer.goTo({
            index: resolved.index,
            anchor: (doc) => skipLeadingSpace(anchor(doc)),
          })
        } else {
          await view.goTo(target)
        }
      },
      goToFraction: async (fraction) => {
        await viewRef.current?.goToFraction(fraction)
      },
      search: (query, color, onResult) => {
        const view = viewRef.current
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
      sectionFractions: () => viewRef.current?.getSectionFractions() ?? [],
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
        if (speaking.current) void view.deleteAnnotation({ value: speaking.current })
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
    const zoneAt = (x: number): TapZone => {
      const box = host.getBoundingClientRect()
      if (touch) {
        const edge = box.width * TOUCH_TAP_FRACTION
        return x < box.left + edge ? 'left' : x > box.right - edge ? 'right' : 'center'
      }
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
      callbacks.current.onTap(zoneAt(e.clientX))
    }

    const attachToPage = (doc: Document, index: number) => {
      textArea = textAreaOf(doc) ?? textArea
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
      doc.addEventListener('selectionchange', () => {
        clearTimeout(settleSelection)
        if (doc.getSelection()?.isCollapsed) callbacks.current.onSelection(null)
        // A long press selects a word and the handles adjust it, with no pointerup in the page:
        // report the selection once it settles.
        else if (touch) settleSelection = setTimeout(reportSelection, TOUCH_SELECTION_SETTLE_MS)
      })
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
        const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
        const x = e.clientX + (frame?.left ?? 0)
        // foliate reports highlight clicks from its own listener, after this one.
        setTimeout(() => {
          if (highlightClicked) {
            highlightClicked = false
            return
          }
          const zone = zoneAt(x)
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
      callbacks.current.onRelocate(e.detail, sectionPages(view))
    }) as EventListener)
    view.addEventListener('create-overlay', () => {
      for (const mark of marks.current.values()) void view.addAnnotation(markAnnotation(mark))
    })
    view.addEventListener('draw-annotation', ((e: CustomEvent) => {
      const { draw, annotation } = e.detail as {
        draw: (f: unknown, o: unknown) => void
        annotation: { color: string; kind?: string }
      }
      if (annotation.kind === 'speaking') {
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
    host.addEventListener('pointerdown', onHostPointerDown)
    host.addEventListener('click', onHostClick)

    ;(async () => {
      await view.open(book)
      if (cancelled) return
      applyLayout(view, initialLayout.current)
      view.renderer.setStyles?.(initialStyles.current)
      await view.init({
        lastLocation: initialLocation.current,
        showTextStart: !initialLocation.current,
      })
      if (cancelled) return
      ready.current = true
      callbacks.current.onReady({ fixedLayout: view.isFixedLayout })
    })().catch((e) => {
      if (!cancelled) callbacks.current.onError(e)
    })

    return () => {
      cancelled = true
      cancelPendingTap()
      clearTimeout(settleSelection)
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('pointerdown', onHostPointerDown)
      host.removeEventListener('click', onHostClick)
      view.close()
      view.remove()
      viewRef.current = null
    }
  }, [book, callbacks, initialLayout, initialStyles])

  useEffect(() => {
    const view = viewRef.current
    if (view && ready.current) view.renderer.setStyles?.(styles)
  }, [styles])

  useEffect(() => {
    const view = viewRef.current
    if (view && ready.current) applyLayout(view, layout)
  }, [layout])

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
          '--overlayer-highlight-opacity': dark ? '0.3' : '1',
          '--overlayer-highlight-blend-mode': dark ? 'normal' : 'multiply',
        } as CSSProperties
      }
    />
  )
}
