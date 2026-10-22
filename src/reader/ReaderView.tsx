import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ArrowLeft } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuraField } from '../components/AuraField'
import { Button, IconButton } from '../components/Button'
import { copyText } from '../lib/clipboard'
import { debounce, useDebouncedCallback, useLatest } from '../lib/hooks'
import { HIGHLIGHTS } from '../lib/highlightColors'
import { newId } from '../lib/ids'
import { api, toAppError } from '../lib/ipc'
import { bookTitle } from '../lib/text'
import type { Annotation, BookRecord, HighlightColor } from '../lib/types'
import { FINISHED_FRACTION, liveAnnotations, statusOf } from '../library/model'
import { useApp } from '../state/app'
import { useLibrary } from '../state/library'
import { savePosition } from '../state/positions'
import { usePreferences } from '../state/preferences'
import { showError, useToasts } from '../state/toasts'
import { FALLBACK_PALETTE, useAuraFor, useSystemColorScheme, useThemeOverride } from '../theme/aura'
import {
  BookView,
  type BookLayout,
  type BookViewHandle,
  type SelectionInfo,
  type TapZone,
} from './BookView'
import { ContentsSheet } from './ContentsSheet'
import {
  BookOpenError,
  compareCFI,
  collapseCFI,
  fetchBookFile,
  loadBook,
  type Book,
  type Location,
  type TocItem,
} from './foliate'
import { ReadAloudBar } from './ReadAloudBar'
import {
  DefinitionPopover,
  FootnotePopover,
  HighlightBar,
  NoteDialog,
  SelectionBar,
} from './ReaderPopovers'
import { ReaderFooter } from './ReaderFooter'
import { ReaderToolbar, type ReaderSheet } from './ReaderToolbar'
import { readingCss } from './readingStyles'
import styles from './reader.module.css'
import { SearchSheet } from './SearchSheet'
import { TextSettingsSheet } from './TextSettingsSheet'
import { readerChromeVars, resolveReadingTheme } from './themes'
import { useReadAloud } from './useReadAloud'
import { chapterLabel } from './toc'
import { useReadingSession } from './useReadingSession'

/** foliate-js estimates "time left" at this many bytes a minute; we rescale to the reader's pace. */
const FOLIATE_BYTES_PER_MINUTE = 1600
/** foliate-js measures locations in units of this many bytes. */
const BYTES_PER_LOCATION = 1500
const CHROME_HIDE_MS = 2000
const PROGRESS_SAVE_MS = 1200
const MARGIN_WIDTHS = { narrow: 760, medium: 640, wide: 540 } as const
/** Two-page spreads only when there's room for two comfortable columns. */
const SPREAD_MIN_WIDTH = 1500

interface ReaderViewProps {
  fingerprint: string
  /** Open at this location (a CFI) instead of where the reader left off. */
  target?: string
  readAloud?: boolean
}

type OpenState =
  | { status: 'loading' }
  | { status: 'ready'; book: Book }
  | { status: 'error'; message: string; title: string }

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = debounce(() => setWidth(window.innerWidth), 150)
    window.addEventListener('resize', onResize)
    return () => {
      onResize.cancel()
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return width
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.closest?.(
    'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
  )
}

export function ReaderView({ fingerprint, target, readAloud: startReadingAloud }: ReaderViewProps) {
  const entry = useLibrary((s) => s.books[fingerprint])
  const record = useLibrary((s) => s.records[fingerprint]) ?? null
  const putRecord = useLibrary((s) => s.putRecord)
  const navigate = useApp((s) => s.navigate)
  const readerPrefs = usePreferences((s) => s.prefs.reader)
  const reduceTransparency = usePreferences((s) => s.prefs.reduceTransparency)
  const bytesPerMinute = usePreferences((s) => s.prefs.bytesPerMinute)
  const systemScheme = useSystemColorScheme()
  const windowWidth = useWindowWidth()

  const [open, setOpen] = useState<OpenState>({ status: 'loading' })
  /** The open book's TOC, for naming chapters in event handlers. */
  const tocRef = useRef<TocItem[]>([])
  const [ready, setReady] = useState(false)
  const [location, setLocation] = useState<Location | null>(null)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [hoveringChrome, setHoveringChrome] = useState(false)
  const [sheet, setSheet] = useState<ReaderSheet | null>(null)
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const [activeHighlight, setActiveHighlight] = useState<{
    annotation: Annotation
    rect: DOMRect
  } | null>(null)
  const [noteFor, setNoteFor] = useState<{
    annotation: Annotation | null
    text: string
    cfi: string
  } | null>(null)
  const [definition, setDefinition] = useState<{ text: string; rect: DOMRect } | null>(null)
  const [footnote, setFootnote] = useState<{ element: HTMLElement; rect: DOMRect } | null>(null)
  const [readingAloud, setReadingAloud] = useState(!!startReadingAloud)
  const handle = useRef<BookViewHandle>(null)

  const palette = entry?.palette ?? FALLBACK_PALETTE
  const theme = resolveReadingTheme(readerPrefs.theme, systemScheme)
  const accent = theme.dark ? palette.accentDark : palette.accent
  const title = entry ? bookTitle(entry) : ''
  useAuraFor(entry?.palette)

  // The chrome (toolbar, sheets, popovers, toasts) takes on the reading theme.
  useEffect(() => {
    useThemeOverride.setState({
      override: {
        scheme: theme.dark ? 'dark' : 'light',
        vars: readerChromeVars(theme, palette, reduceTransparency),
      },
    })
  }, [theme, palette, reduceTransparency])
  useEffect(() => () => useThemeOverride.setState({ override: null }), [])

  // Load the book file once.
  const entryRef = useLatest(entry)
  const hasEntry = !!entry
  useEffect(() => {
    const current = entryRef.current
    if (!current) return
    let book: Book | null = null
    let cancelled = false
    const name = bookTitle(current)
    ;(async () => {
      if (current.drm)
        throw new BookOpenError('drm', 'This book is protected by DRM, so Readlet can’t open it.')
      const file = await fetchBookFile(current)
      book = await loadBook(file)
      if (cancelled) book.destroy?.()
      else {
        tocRef.current = book.toc ?? []
        setOpen({ status: 'ready', book })
      }
    })().catch((e: unknown) => {
      if (cancelled) return
      const message =
        e instanceof BookOpenError
          ? e.message
          : `Something went wrong opening this book. (${toAppError(e).message})`
      setOpen({ status: 'error', message, title: name })
    })
    return () => {
      cancelled = true
      book?.destroy?.()
    }
  }, [fingerprint, hasEntry, entryRef])

  // Make sure we have this book's reading data (it may not have been in the library list yet).
  useEffect(() => {
    if (record) return
    api
      .getRecord(fingerprint)
      .then(putRecord, (e) => console.warn('loading reading data failed', e))
  }, [fingerprint, record, putRecord])

  // Where to open: captured once, when the reading data first arrives.
  const [initialLocation, setInitialLocation] = useState<string | null | undefined>(() =>
    record ? (target ?? record.progress?.cfi ?? null) : undefined,
  )
  if (initialLocation === undefined && record)
    setInitialLocation(target ?? record.progress?.cfi ?? null)
  const [fixedLayout, setFixedLayout] = useState(false)

  const session = useReadingSession(fingerprint, record?.progress?.fraction ?? 0, readingAloud)

  // -- Progress ---------------------------------------------------------------------------------

  const pendingProgress = useRef<{ cfi: string; fraction: number; label?: string } | null>(null)
  const saveProgress = useCallback(async () => {
    const progress = pendingProgress.current
    pendingProgress.current = null
    if (!progress) return
    try {
      putRecord(await api.setProgress(fingerprint, progress))
    } catch (e) {
      console.warn('saving progress failed', e)
    }
  }, [fingerprint, putRecord])
  const saveProgressSoon = useDebouncedCallback(() => void saveProgress(), PROGRESS_SAVE_MS)

  const recordRef = useLatest(record)
  const statusChecked = useRef(false)
  const onRelocate = useCallback(
    (loc: Location) => {
      setLocation(loc)
      const label = chapterLabel(tocRef.current, loc.tocItem)
      if (loc.cfi) {
        pendingProgress.current = { cfi: loc.cfi, fraction: loc.fraction, label }
        saveProgressSoon()
      }
      const bookBytes = (loc.location?.total ?? 0) * BYTES_PER_LOCATION
      session.relocated(loc.fraction, loc.range?.toString() ?? '', bookBytes)
      if (loc.time && loc.section) {
        savePosition(fingerprint, {
          label,
          section: loc.section.current,
          sections: loc.section.total,
          bytesLeftInSection: loc.time.section * FOLIATE_BYTES_PER_MINUTE,
          bytesLeftInBook: loc.time.total * FOLIATE_BYTES_PER_MINUTE,
          updatedAt: Date.now(),
        })
      }
      // Status follows reading: opening a book starts it, reaching the end finishes it.
      const current = recordRef.current
      const status = statusOf(current)
      if (!statusChecked.current && current?.status?.value === 'toRead') {
        statusChecked.current = true
        void useLibrary.getState().setStatus(fingerprint, 'reading')
      }
      if (loc.fraction >= FINISHED_FRACTION && status !== 'finished') {
        void useLibrary
          .getState()
          .setStatus(fingerprint, 'finished')
          .then(() =>
            useToasts.getState().show({
              message: 'Marked as finished',
              action: {
                label: 'Undo',
                run: () => void useLibrary.getState().setStatus(fingerprint, 'reading'),
              },
            }),
          )
      }
    },
    [fingerprint, saveProgressSoon, session, recordRef],
  )

  // Flush progress and the session when leaving the book or closing the window.
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      saveProgressSoon.cancel()
      await Promise.all([saveProgress(), session.finish()])
    })
    return () => {
      saveProgressSoon.cancel()
      void saveProgress()
      void unlisten.then((fn) => fn())
    }
  }, [saveProgress, saveProgressSoon, session])

  // -- Chrome visibility ------------------------------------------------------------------------

  // The toolbar shows while anything needs it, and otherwise fades 2 s after the last movement.
  const overlayOpen = !!(sheet || selection || activeHighlight || noteFor || definition || footnote)
  const keepChrome = overlayOpen || hoveringChrome || !ready || readingAloud
  const [pokes, setPokes] = useState(0)
  const lastPoke = useRef(0)
  const showChrome = useCallback(() => {
    const now = performance.now()
    if (now - lastPoke.current < 250) return
    lastPoke.current = now
    setChromeVisible(true)
    setPokes((n) => n + 1)
  }, [])
  useEffect(() => {
    if (keepChrome || !chromeVisible) return
    const timer = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS)
    return () => clearTimeout(timer)
  }, [keepChrome, chromeVisible, pokes])
  const toolbarHidden = !keepChrome && !chromeVisible

  const lastPointer = useRef({ x: -1, y: -1 })
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.clientX === lastPointer.current.x && e.clientY === lastPointer.current.y) return
    lastPointer.current = { x: e.clientX, y: e.clientY }
    session.activity()
    showChrome()
  }

  // -- Annotations ------------------------------------------------------------------------------

  const highlights = useMemo(() => liveAnnotations(record, 'highlight'), [record])
  const bookmarks = useMemo(() => liveAnnotations(record, 'bookmark'), [record])
  const highlightMarks = useMemo(
    () =>
      highlights.map((h) => ({
        cfi: h.cfi,
        color: HIGHLIGHTS[(h.color as HighlightColor) ?? 'butter']?.hex ?? HIGHLIGHTS.butter.hex,
      })),
    [highlights],
  )

  const apply = useCallback(
    async (change: Promise<BookRecord>) => {
      try {
        putRecord(await change)
      } catch (e) {
        showError(toAppError(e).message)
      }
    },
    [putRecord],
  )

  const addHighlight = async (
    sel: SelectionInfo,
    color: HighlightColor,
    note?: string,
  ): Promise<Annotation | null> => {
    const id = newId()
    try {
      const updated = await api.putAnnotation(fingerprint, {
        id,
        kind: 'highlight',
        cfi: sel.cfi,
        text: sel.text,
        color,
        note,
        chapter: chapterLabel(tocRef.current, location?.tocItem),
        fraction: location?.fraction,
      })
      putRecord(updated)
      handle.current?.deselect()
      setSelection(null)
      return updated.annotations.find((a) => a.id === id) ?? null
    } catch (e) {
      showError(toAppError(e).message)
      return null
    }
  }

  const onHighlight = async (color: HighlightColor) => {
    if (!selection) return
    const created = await addHighlight(selection, color)
    if (!created) return
    useToasts.getState().show({
      message: 'Highlight added',
      swatch: HIGHLIGHTS[color].hex,
      action: {
        label: 'Undo',
        run: () => void apply(api.deleteAnnotation(fingerprint, created.id)),
      },
    })
  }

  const updateHighlight = (
    annotation: Annotation,
    patch: Partial<Pick<Annotation, 'color' | 'note'>>,
  ) =>
    apply(
      api.putAnnotation(fingerprint, {
        id: annotation.id,
        kind: 'highlight',
        cfi: annotation.cfi,
        text: annotation.text,
        color: patch.color ?? annotation.color,
        note: patch.note !== undefined ? patch.note : annotation.note,
        chapter: annotation.chapter,
        fraction: annotation.fraction,
      }),
    )

  const removeHighlight = async (annotation: Annotation) => {
    await apply(api.deleteAnnotation(fingerprint, annotation.id))
    useToasts.getState().show({
      message: 'Highlight removed',
      action: {
        label: 'Undo',
        run: () =>
          void apply(
            api.putAnnotation(fingerprint, {
              id: annotation.id,
              kind: 'highlight',
              cfi: annotation.cfi,
              text: annotation.text,
              color: annotation.color,
              note: annotation.note,
              chapter: annotation.chapter,
              fraction: annotation.fraction,
            }),
          ),
      },
    })
  }

  const pageBookmarks = useMemo(() => {
    if (!location?.cfi) return []
    try {
      const start = collapseCFI(location.cfi)
      const end = collapseCFI(location.cfi, true)
      return bookmarks.filter((b) => compareCFI(b.cfi, start) >= 0 && compareCFI(b.cfi, end) <= 0)
    } catch {
      return []
    }
  }, [bookmarks, location])

  const toggleBookmark = async () => {
    if (pageBookmarks.length) {
      for (const b of pageBookmarks) await apply(api.deleteAnnotation(fingerprint, b.id))
      return
    }
    if (!location?.cfi) return
    const text = (location.range?.toString() ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
    await apply(
      api.putAnnotation(fingerprint, {
        id: newId(),
        kind: 'bookmark',
        cfi: collapseCFI(location.cfi),
        text,
        chapter: chapterLabel(tocRef.current, location.tocItem),
        fraction: location.fraction,
      }),
    )
  }

  // -- Read-aloud -------------------------------------------------------------------------------

  const readAloud = useReadAloud({
    handle,
    active: readingAloud && ready,
    language: entry?.language ?? null,
    accent,
    onEnded: () => setReadingAloud(false),
  })

  const startReadAloud = (from?: Range) => {
    setSheet(null)
    setSelection(null)
    setReadingAloud(true)
    readAloud.start(from)
  }

  // -- Input ------------------------------------------------------------------------------------

  const closeOverlays = useCallback((): boolean => {
    if (definition || footnote || activeHighlight || noteFor) {
      setDefinition(null)
      setFootnote(null)
      setActiveHighlight(null)
      setNoteFor(null)
      return true
    }
    if (selection) {
      handle.current?.deselect()
      setSelection(null)
      return true
    }
    if (sheet) {
      setSheet(null)
      return true
    }
    return false
  }, [definition, footnote, activeHighlight, noteFor, selection, sheet])

  const onKey = useLatest((e: KeyboardEvent) => {
    const h = handle.current
    if (!h || e.defaultPrevented) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      setSheet('search')
      return
    }
    if (mod || e.altKey) return
    switch (e.key) {
      case 'ArrowRight':
        h.goRight()
        break
      case 'ArrowLeft':
        h.goLeft()
        break
      case 'PageDown':
      case 'ArrowDown':
        if (!readerPrefs.scrolled || e.key === 'PageDown') h.next()
        else return
        break
      case 'PageUp':
      case 'ArrowUp':
        if (!readerPrefs.scrolled || e.key === 'PageUp') h.prev()
        else return
        break
      case ' ':
        if (e.shiftKey) h.prev()
        else h.next()
        break
      case 'Escape':
        if (!closeOverlays()) {
          if (readingAloud) {
            readAloud.stop()
            setReadingAloud(false)
          } else {
            setChromeVisible((v) => !v)
          }
        }
        break
      default:
        return
    }
    e.preventDefault()
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      onKey.current(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKey])

  const onTap = (zone: TapZone) => {
    if (closeOverlays()) return
    if (zone === 'center' || readerPrefs.scrolled) {
      setChromeVisible((v) => !v)
      return
    }
    if (zone === 'left') handle.current?.goLeft()
    else handle.current?.goRight()
  }

  const seek = useDebouncedCallback((f: number) => void handle.current?.goToFraction(f), 120)

  const goTo = (target: string) => {
    void handle.current?.goTo(target)
    if (windowWidth < 900) setSheet(null)
  }

  const layout = useMemo<BookLayout>(
    () => ({
      scrolled: readerPrefs.scrolled,
      maxInlineSize: MARGIN_WIDTHS[readerPrefs.margins],
      maxColumnCount:
        readerPrefs.spread && windowWidth - (sheet ? 412 : 0) >= SPREAD_MIN_WIDTH ? 2 : 1,
      margin: 96,
      animated: readerPrefs.animatePages && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    }),
    [readerPrefs, windowWidth, sheet],
  )
  const css = useMemo(
    () => readingCss({ theme, prefs: readerPrefs, accent }),
    [theme, readerPrefs, accent],
  )

  // -- Render -----------------------------------------------------------------------------------

  if (open.status === 'error') {
    return (
      <div className={styles.page}>
        <div className={styles.centered} role="alert">
          <h1>{open.title || 'This book'} won’t open</h1>
          <p>{open.message}</p>
          <Button variant="primary" onClick={() => navigate({ name: 'library' })}>
            Back to library
          </Button>
        </div>
      </div>
    )
  }

  const toc: TocItem[] = open.status === 'ready' ? (open.book.toc ?? []) : []
  const chapter = chapterLabel(toc, location?.tocItem)
  const minutesLeft = location?.time
    ? (location.time.section * FOLIATE_BYTES_PER_MINUTE) / bytesPerMinute
    : null
  const canDefine =
    !!selection && selection.text.split(/\s+/).length <= 3 && selection.text.length <= 60

  return (
    <div
      className={`${styles.page} ${sheet ? styles.withSheet : ''}`}
      style={{ cursor: toolbarHidden ? 'none' : undefined }}
      onPointerMove={onPointerMove}
    >
      {readingAloud && <AuraField placement="bottom" />}
      <div className={styles.book}>
        {open.status === 'ready' && initialLocation !== undefined && (
          <BookView
            ref={handle}
            book={open.book}
            initialLocation={initialLocation}
            styles={css}
            layout={layout}
            highlights={highlightMarks}
            dark={theme.dark}
            onReady={(info) => {
              setFixedLayout(info.fixedLayout)
              setReady(true)
              // "Read aloud" in the library opens the book already speaking.
              if (startReadingAloud) readAloud.start()
            }}
            onError={(e) =>
              setOpen({
                status: 'error',
                title,
                message: `This book couldn’t be displayed. (${toAppError(e).message})`,
              })
            }
            onRelocate={onRelocate}
            onSelection={(sel) => {
              setSelection(sel)
              if (sel) setActiveHighlight(null)
            }}
            onHighlightClick={(cfi, rect) => {
              const annotation = highlights.find((h) => h.cfi === cfi)
              if (annotation) setActiveHighlight({ annotation, rect })
            }}
            onFootnote={setFootnote}
            onExternalLink={(href) =>
              void openUrl(href).catch((e) => showError(toAppError(e).message))
            }
            onActivity={session.activity}
            onPointerMove={showChrome}
            onTap={onTap}
            onKeyDown={(e) => onKey.current(e)}
          />
        )}
      </div>

      {readingAloud ? (
        <IconButton
          glass
          label="Back to reading"
          style={{ position: 'absolute', zIndex: 10, top: 20, left: 20 }}
          onClick={() => {
            readAloud.stop()
            setReadingAloud(false)
          }}
        >
          <ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" />
        </IconButton>
      ) : (
        <ReaderToolbar
          title={title}
          chapter={chapter}
          hidden={toolbarHidden}
          sheet={sheet}
          bookmarked={pageBookmarks.length > 0}
          readingAloud={readingAloud}
          onBack={() => navigate({ name: 'library' })}
          onSheet={(s) => setSheet((current) => (current === s ? null : s))}
          onToggleBookmark={() => void toggleBookmark()}
          onReadAloud={() => startReadAloud()}
          onHover={setHoveringChrome}
        />
      )}

      {!readingAloud && (
        <ReaderFooter
          fraction={location?.fraction ?? record?.progress?.fraction ?? 0}
          minutesLeft={minutesLeft}
          pageLabel={location?.pageItem?.label}
          onSeek={seek}
        />
      )}

      {readingAloud && entry && (
        <ReadAloudBar
          readAloud={readAloud}
          entry={entry}
          title={title}
          chapter={chapter}
          minutesLeft={minutesLeft}
        />
      )}

      <AnimatePresence>
        {sheet === 'text' && (
          <TextSettingsSheet key="text" onClose={() => setSheet(null)} fixedLayout={fixedLayout} />
        )}
        {sheet === 'contents' && (
          <ContentsSheet
            key="contents"
            toc={toc}
            currentTocId={location?.tocItem?.id}
            bookmarks={bookmarks}
            highlights={highlights}
            onGoTo={goTo}
            onDeleteBookmark={(b) => void apply(api.deleteAnnotation(fingerprint, b.id))}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet === 'search' && (
          <SearchSheet
            key="search"
            search={(q, onResult) => handle.current?.search(q, accent, onResult) ?? (() => {})}
            onGoTo={goTo}
            onClose={() => {
              handle.current?.clearSearch()
              setSheet(null)
            }}
          />
        )}
      </AnimatePresence>

      {selection && !noteFor && !definition && (
        <SelectionBar
          anchor={selection.rect}
          canDefine={canDefine}
          onHighlight={(c) => void onHighlight(c)}
          onNote={() => setNoteFor({ annotation: null, text: selection.text, cfi: selection.cfi })}
          onDefine={() => setDefinition({ text: selection.text, rect: selection.rect })}
          onCopy={() => {
            void copyText(selection.text).then((ok) =>
              useToasts
                .getState()
                .show({ message: ok ? 'Copied' : 'Couldn’t copy', tone: ok ? 'info' : 'error' }),
            )
            handle.current?.deselect()
            setSelection(null)
          }}
          onReadFromHere={() => startReadAloud(selection.range)}
          onClose={() => setSelection(null)}
        />
      )}

      {activeHighlight && (
        <HighlightBar
          anchor={activeHighlight.rect}
          annotation={activeHighlight.annotation}
          onColor={(color) => {
            void updateHighlight(activeHighlight.annotation, { color })
            setActiveHighlight(null)
          }}
          onNote={() => {
            setNoteFor({
              annotation: activeHighlight.annotation,
              text: activeHighlight.annotation.text,
              cfi: activeHighlight.annotation.cfi,
            })
            setActiveHighlight(null)
          }}
          onCopy={() => {
            void copyText(activeHighlight.annotation.text)
            setActiveHighlight(null)
          }}
          onDelete={() => {
            void removeHighlight(activeHighlight.annotation)
            setActiveHighlight(null)
          }}
          onClose={() => setActiveHighlight(null)}
        />
      )}

      {noteFor && (
        <NoteDialog
          quote={noteFor.text}
          initial={noteFor.annotation?.note ?? ''}
          onClose={() => setNoteFor(null)}
          onSave={(note) => {
            const target = noteFor
            setNoteFor(null)
            if (target.annotation) void updateHighlight(target.annotation, { note })
            else if (selection) void addHighlight(selection, 'butter', note || undefined)
          }}
        />
      )}

      {definition && (
        <DefinitionPopover
          anchor={definition.rect}
          selection={definition.text}
          language={entry?.language ?? null}
          onOpenExternal={(url) => void openUrl(url)}
          onClose={() => setDefinition(null)}
        />
      )}

      {footnote && (
        <FootnotePopover
          anchor={footnote.rect}
          element={footnote.element}
          onClose={() => setFootnote(null)}
        />
      )}

      {open.status === 'loading' && (
        <div className={styles.centered} aria-live="polite">
          <p>Opening {title}…</p>
        </div>
      )}
    </div>
  )
}
