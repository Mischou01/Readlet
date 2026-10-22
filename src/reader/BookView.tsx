// The React wrapper around foliate-js's <foliate-view>. With foliate.ts, this is the only module
// that touches foliate-js (docs/PLAN.md §8). It renders the book, draws highlights, reports
// selections, taps and locations, and exposes navigation through a handle.

import { useEffect, useImperativeHandle, useRef, type CSSProperties, type Ref } from 'react'
import { useLatest } from '../lib/hooks'
import {
  FootnoteHandler,
  Overlayer,
  type Book,
  type Location,
  type SearchResult,
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
}

export interface BookLayout {
  scrolled: boolean
  /** Column width limit in px. */
  maxInlineSize: number
  maxColumnCount: number
  /** Space above and below the text in px. */
  margin: number
  animated: boolean
}

export interface BookViewHandle {
  next(): void
  prev(): void
  goLeft(): void
  goRight(): void
  goTo(target: string | number): Promise<void>
  goToFraction(fraction: number): Promise<void>
  /** Streams search results, outlining matches in `color`; call the returned function to stop. */
  search(query: string, color: string, onResult: (result: SearchResult) => void): () => void
  clearSearch(): void
  deselect(): void
  sectionFractions(): number[]
  /** The underlying view, for read-aloud. */
  view(): View | null
  /** Marks the sentence being read aloud (or clears the mark) and keeps it on screen. */
  markSpeaking(range: Range | null, color: string): void
}

export type TapZone = 'left' | 'center' | 'right'

interface BookViewProps {
  book: Book
  initialLocation: string | null
  styles: string
  layout: BookLayout
  highlights: HighlightMark[]
  dark: boolean
  onReady(info: { fixedLayout: boolean }): void
  onError(error: unknown): void
  onRelocate(location: Location): void
  onSelection(selection: SelectionInfo | null): void
  onHighlightClick(cfi: string, rect: DOMRect): void
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

function applyLayout(view: View, layout: BookLayout) {
  const r = view.renderer
  r.setAttribute('flow', layout.scrolled ? 'scrolled' : 'paginated')
  r.setAttribute('margin', `${layout.margin}px`)
  r.setAttribute('gap', '6%')
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

function firstVisibleRect(range: Range): DOMRect {
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0)
  return rects[0] ?? range.getBoundingClientRect()
}

export function BookView(props: BookViewProps) {
  const { book, styles, layout, highlights, dark, ref } = props
  const container = useRef<HTMLDivElement>(null)
  const viewRef = useRef<View | null>(null)
  const ready = useRef(false)
  const marks = useRef(new Map<string, string>())
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
        await viewRef.current?.goTo(target)
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
    let lastLinkRect = new DOMRect()
    let wheelDelta = 0
    let wheelLockedUntil = 0
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

    const attachToPage = (doc: Document, index: number) => {
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
        if (doc.getSelection()?.isCollapsed) callbacks.current.onSelection(null)
      })
      doc.addEventListener('keydown', (e) => {
        callbacks.current.onActivity()
        callbacks.current.onKeyDown(e)
      })
      let lastPointer = { x: -1, y: -1 }
      doc.addEventListener('pointermove', (e) => {
        // WebKit sends synthetic moves when the page scrolls under a still pointer.
        if (e.screenX === lastPointer.x && e.screenY === lastPointer.y) return
        lastPointer = { x: e.screenX, y: e.screenY }
        callbacks.current.onActivity()
        callbacks.current.onPointerMove()
      })
      doc.addEventListener('wheel', onWheel, { passive: true })
      doc.addEventListener('click', (e) => {
        callbacks.current.onActivity()
        if (e.defaultPrevented || (e.target as Element | null)?.closest?.('a[href]')) return
        if (!doc.getSelection()?.isCollapsed) return
        const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
        const x = e.clientX + (frame?.left ?? 0)
        const box = host.getBoundingClientRect()
        // foliate reports highlight clicks from its own listener, after this one.
        setTimeout(() => {
          if (highlightClicked) {
            highlightClicked = false
            return
          }
          const at = (x - box.left) / box.width
          callbacks.current.onTap(at < 0.22 ? 'left' : at > 0.78 ? 'right' : 'center')
        }, 0)
      })
    }

    view.addEventListener('load', ((e: CustomEvent<{ doc: Document; index: number }>) =>
      attachToPage(e.detail.doc, e.detail.index)) as EventListener)
    view.addEventListener('relocate', ((e: CustomEvent<Location>) =>
      callbacks.current.onRelocate(e.detail)) as EventListener)
    view.addEventListener('create-overlay', () => {
      for (const [cfi, color] of marks.current) void view.addAnnotation({ value: cfi, color })
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
      } else {
        draw(Overlayer.highlight, { color: annotation.color })
      }
    }) as EventListener)
    view.addEventListener('show-annotation', ((e: CustomEvent<{ value: string; range: Range }>) => {
      highlightClicked = true
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
      host.removeEventListener('wheel', onWheel)
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
    const next = new Map(highlights.map((h) => [h.cfi, h.color]))
    const previous = marks.current
    marks.current = next
    // Before the book is open, pages draw their marks as they load ('create-overlay').
    if (!view || !ready.current) return
    for (const [cfi, color] of previous) {
      if (next.get(cfi) !== color) void view.deleteAnnotation({ value: cfi })
    }
    for (const [cfi, color] of next) {
      if (previous.get(cfi) !== color) void view.addAnnotation({ value: cfi, color })
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
