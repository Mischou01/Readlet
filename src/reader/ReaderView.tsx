import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ArrowLeft, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AuraField } from '../components/AuraField'
import { Button, IconButton } from '../components/Button'
import { copyText } from '../lib/clipboard'
import { debounce, useDebouncedCallback, useLatest } from '../lib/hooks'
import { HIGHLIGHTS } from '../lib/highlightColors'
import { newId } from '../lib/ids'
import { api, toAppError } from '../lib/ipc'
import { bookTitle } from '../lib/text'
import { isBackGesture, useOnHide, usePhoneLayout, useTouchScreen } from '../lib/platform'
import { handleWindowShortcut } from '../lib/window'
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
  type NoteHover,
  type SectionPages,
  type SelectionInfo,
  type TapZone,
  type ZoomInfo,
} from './BookView'
import { ContentsSheet } from './ContentsSheet'
import { bookmarksOnPage, inBookOrder } from './bookmarks'
import { backLabel, jumped, NO_JUMP, relocated, wayBack, type JumpBack } from './jumpBack'
import {
  BookOpenError,
  fetchBookFile,
  loadBook,
  type Book,
  type Location,
  type TocItem,
} from './foliate'
import { ReadAloudBar } from './ReadAloudBar'
import {
  BookmarkNameDialog,
  DefinitionPopover,
  FootnotePopover,
  HighlightBar,
  NoteDialog,
  NotePreview,
  SelectionBar,
} from './ReaderPopovers'
import { ReaderFooter, type ChapterMark } from './ReaderFooter'
import { ReaderToolbar, type ReaderSheet } from './ReaderToolbar'
import { readingCss } from './readingStyles'
import styles from './reader.module.css'
import { SearchSheet } from './SearchSheet'
import { TextSettingsSheet } from './TextSettingsSheet'
import { readerChromeVars, resolveReadingTheme, withAlpha } from './themes'
import { useDevicePositions } from './devicePositions'
import { useBookPace } from './useBookPace'
import { useReadAloud } from './useReadAloud'
import { useReaderControls } from './useReaderControls'
import { ZoomBar } from './ZoomBar'
import { normalizeZoom, stepZoom, type PageZoom } from './zoom'
import { chapterLabel } from './toc'
import { useReadingSession } from './useReadingSession'

/** foliate-js estimates "time left" at this many bytes a minute; we rescale to the reader's pace. */
const FOLIATE_BYTES_PER_MINUTE = 1600
/** foliate-js measures locations in units of this many bytes. */
const BYTES_PER_LOCATION = 1500
const CHROME_HIDE_MS = 2000
const PROGRESS_SAVE_MS = 1200
const MARGIN_WIDTHS = { narrow: 760, medium: 640, wide: 540 } as const
/** Phones: the space above and below the text, inside the system bars' insets. */
const PHONE_MARGIN = 20
/** On a phone the text always fills the width, so the margin setting sets the space beside it. */
const PHONE_GAPS = { narrow: '4%', medium: '6%', wide: '9%' } as const
/** Two-page spreads only when there's room for two comfortable columns. */
const SPREAD_MIN_WIDTH = 1500
const NOTE_PREVIEW_DELAY_MS = 250
/** How far an arrow key scrolls scrolled text. */
const ARROW_SCROLL_PX = 80

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
  const systemScheme = useSystemColorScheme()
  const windowWidth = useWindowWidth()
  const phone = usePhoneLayout()
  const touchScreen = useTouchScreen()

  const [open, setOpen] = useState<OpenState>({ status: 'loading' })
  /** The open book's TOC, for naming chapters in event handlers. */
  const tocRef = useRef<TocItem[]>([])
  const [ready, setReady] = useState(false)
  const [location, setLocation] = useState<Location | null>(null)
  const [sectionPages, setSectionPages] = useState<SectionPages | null>(null)
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
  const [namingBookmark, setNamingBookmark] = useState<Annotation | null>(null)
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

  // The "open book" transition holds until the book is on screen, or couldn't open.
  const endOpening = useCallback(() => {
    if (useApp.getState().opening?.fingerprint === fingerprint) useApp.getState().setOpening(null)
  }, [fingerprint])

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
      endOpening()
    })
    return () => {
      cancelled = true
      book?.destroy?.()
    }
  }, [fingerprint, hasEntry, entryRef, endOpening])

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
  /** Where the chapters start, for the progress bar; known once the book is on screen. */
  const [chapterMarks, setChapterMarks] = useState<ChapterMark[]>([])

  // Page-based books zoom; zoomed in, the view can be locked against sliding sideways.
  const [zoom, setZoom] = useState<PageZoom>('fit-page')
  const [zoomInfo, setZoomInfo] = useState<ZoomInfo>({ factor: 1, overflowing: false })
  const [viewLockRequested, setViewLocked] = useState(false)
  const zoomed = zoom !== 'fit-page' && zoomInfo.overflowing
  const viewLocked = viewLockRequested && zoomed
  const requestZoom = useCallback((next: PageZoom) => {
    const zoom = normalizeZoom(next)
    setZoom(zoom)
    // Back to the whole page, the lock has done its job.
    if (zoom === 'fit-page') setViewLocked(false)
  }, [])
  const onZoomInfo = useCallback(
    (info: ZoomInfo) =>
      setZoomInfo((current) =>
        Math.abs(current.factor - info.factor) < 0.005 && current.overflowing === info.overflowing
          ? current
          : info,
      ),
    [],
  )

  const session = useReadingSession(fingerprint, record?.progress?.fraction ?? 0, readingAloud)
  const { bytesPerMinute, relocated: paceRelocated } = useBookPace(fingerprint, readingAloud)

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

  /** The way back after a jump (see markJump), and the page last shown, to tell turns apart. */
  const [jump, setJump] = useState<JumpBack>(NO_JUMP)
  const lastPage = useRef<string | undefined>(undefined)

  const recordRef = useLatest(record)
  const statusChecked = useRef(false)
  /** When the reader last moved in the book here, to tell news from other devices from old. */
  const movedAt = useRef(0)
  const onRelocate = useCallback(
    (loc: Location, pages: SectionPages | null, reason: string | undefined) => {
      // While a section is still being laid out, foliate can report a position with no fraction;
      // the real one follows. Saving it would store NaN as the progress.
      if (!Number.isFinite(loc.fraction)) return
      movedAt.current = Date.now()
      setLocation(loc)
      setSectionPages(pages)
      // A tap on a touch screen settles the page where it is, which foliate reports as a turn.
      const turned =
        (reason === 'page' || reason === 'snap' || reason === 'scroll') &&
        loc.cfi !== lastPage.current
      lastPage.current = loc.cfi
      setJump((state) => relocated(state, loc.cfi, turned))
      const label = chapterLabel(tocRef.current, loc.tocItem)
      if (loc.cfi) {
        pendingProgress.current = { cfi: loc.cfi, fraction: loc.fraction, label }
        saveProgressSoon()
      }
      const bookBytes = (loc.location?.total ?? 0) * BYTES_PER_LOCATION
      session.relocated(loc.fraction, loc.range?.toString() ?? '', bookBytes)
      if (loc.time && loc.section) {
        const bytesLeftInBook = loc.time.total * FOLIATE_BYTES_PER_MINUTE
        savePosition(fingerprint, {
          label,
          section: loc.section.current,
          sections: loc.section.total,
          bytesLeftInSection: loc.time.section * FOLIATE_BYTES_PER_MINUTE,
          bytesLeftInBook,
          pace: paceRelocated(bytesLeftInBook),
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
    [fingerprint, saveProgressSoon, session, paceRelocated, recordRef],
  )

  const locationRef = useLatest(location)

  /** Call before going elsewhere in the book: offers the way back to the page showing now. */
  const markJump = useCallback(() => {
    const loc = locationRef.current
    if (!loc?.cfi) return
    const from = {
      cfi: loc.cfi,
      fraction: loc.fraction,
      chapter: chapterLabel(tocRef.current, loc.tocItem),
    }
    setJump((state) => jumped(state, from))
  }, [locationRef])

  const back = wayBack(jump)
  const goBack = () => {
    if (!back) return
    setJump(NO_JUMP)
    void handle.current?.goTo(back.cfi)
  }

  // Where the reader's other devices are in this book.
  useDevicePositions({
    fingerprint,
    shown: location !== null,
    target,
    current: () => ({ fraction: locationRef.current?.fraction ?? 0, movedAt: movedAt.current }),
    goTo: (cfi) => {
      markJump()
      void handle.current?.goTo(cfi)
    },
  })

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

  // A phone may stop the app once it's in the background: save the position and the session so
  // far now. (The session carries on if the reader comes back.)
  const checkpointSession = session.checkpoint
  useOnHide(
    useCallback(() => {
      saveProgressSoon.cancel()
      void saveProgress()
      checkpointSession()
    }, [saveProgress, saveProgressSoon, checkpointSession]),
  )

  // -- Chrome visibility ------------------------------------------------------------------------

  // The toolbar shows while anything needs it, and otherwise fades 2 s after the last movement.
  const overlayOpen = !!(
    sheet ||
    selection ||
    activeHighlight ||
    noteFor ||
    namingBookmark ||
    definition ||
    footnote
  )
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
  // On a phone the system bars go with the toolbar, so the page has the whole screen.
  const immersive = toolbarHidden && !readingAloud
  useEffect(() => useApp.getState().setImmersive(immersive), [immersive])
  useEffect(() => () => useApp.getState().setImmersive(false), [])

  // -- Screen and volume keys (Android) --------------------------------------------------------

  const { poke: keepScreenOn } = useReaderControls({
    screenOnMinutes: readerPrefs.screenOnMinutes,
    // While reading aloud, the volume keys set the volume.
    volumeKeys: readerPrefs.volumeKeys && !readingAloud,
    onPageKey: (direction) => {
      // Not behind a dialog that's being typed in.
      if (noteFor || namingBookmark) return
      keepScreenOn()
      if (direction === 'next') handle.current?.next()
      else handle.current?.prev()
    },
  })
  const onActivity = useCallback(() => {
    session.activity()
    keepScreenOn()
  }, [session, keepScreenOn])

  const lastPointer = useRef({ x: -1, y: -1 })
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.clientX === lastPointer.current.x && e.clientY === lastPointer.current.y) return
    lastPointer.current = { x: e.clientX, y: e.clientY }
    onActivity()
    // Fingers move to swipe and scroll; a tap shows the toolbar instead.
    if (e.pointerType !== 'touch') showChrome()
  }

  // -- Annotations ------------------------------------------------------------------------------

  const highlights = useMemo(() => inBookOrder(liveAnnotations(record, 'highlight')), [record])
  const bookmarks = useMemo(() => inBookOrder(liveAnnotations(record, 'bookmark')), [record])
  const highlightMarks = useMemo(
    () =>
      highlights.map((h) => ({
        cfi: h.cfi,
        color: HIGHLIGHTS[(h.color as HighlightColor) ?? 'butter']?.hex ?? HIGHLIGHTS.butter.hex,
        note: !!h.note,
      })),
    [highlights],
  )

  // Hovering a highlight with a note shows the note, after a moment (so passing over doesn't).
  const [hoveredNote, setHoveredNote] = useState<{ annotation: Annotation; rect: DOMRect } | null>(
    null,
  )
  const noteHoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onNoteHover = (hover: NoteHover | null) => {
    clearTimeout(noteHoverTimer.current)
    if (!hover) {
      setHoveredNote(null)
      return
    }
    const annotation = highlights.find((h) => h.cfi === hover.cfi)
    if (!annotation?.note) return
    noteHoverTimer.current = setTimeout(
      () => setHoveredNote({ annotation, rect: hover.rect }),
      NOTE_PREVIEW_DELAY_MS,
    )
  }
  useEffect(() => () => clearTimeout(noteHoverTimer.current), [])

  /** Saves an annotation change; false if it failed (the reader has been told). */
  const apply = useCallback(
    async (change: Promise<BookRecord>): Promise<boolean> => {
      try {
        putRecord(await change)
        return true
      } catch (e) {
        showError(toAppError(e).message)
        return false
      }
    },
    [putRecord],
  )

  /** Highlights the selection; with a note, the highlight is there for the note (`fromNote`). */
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
        fromNote: note ? true : undefined,
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

  /** Saves a highlight again, with `patch` applied (an empty note removes the note). */
  const updateHighlight = (
    annotation: Annotation,
    patch: Partial<Pick<Annotation, 'color' | 'note' | 'fromNote'>> = {},
  ) => {
    const updated = { ...annotation, ...patch }
    return apply(
      api.putAnnotation(fingerprint, {
        id: updated.id,
        kind: 'highlight',
        cfi: updated.cfi,
        text: updated.text,
        color: updated.color,
        note: updated.note,
        fromNote: updated.fromNote || undefined,
        chapter: updated.chapter,
        fraction: updated.fraction,
      }),
    )
  }

  const removeHighlight = async (annotation: Annotation, message = 'Highlight removed') => {
    if (!(await apply(api.deleteAnnotation(fingerprint, annotation.id)))) return
    useToasts.getState().show({
      message,
      action: { label: 'Undo', run: () => void updateHighlight(annotation) },
    })
  }

  /** Saves a note from the note dialog, on a new highlight or an existing one. */
  const saveNote = (target: NonNullable<typeof noteFor>, note: string) => {
    const { annotation } = target
    if (!annotation) {
      // An empty new note adds nothing, not a bare highlight.
      if (note && selection) void addHighlight(selection, 'butter', note)
      return
    }
    if (note === (annotation.note ?? '')) return
    // A highlight that was only there for its note goes with it.
    if (!note && annotation.fromNote) void removeHighlight(annotation, 'Note removed')
    else void updateHighlight(annotation, { note })
  }

  const pageBookmarks = useMemo(
    () => bookmarksOnPage(bookmarks, location?.cfi),
    [bookmarks, location],
  )

  // Which chapters hold bookmarks, for the contents list. Worked out when it's open, since finding
  // a bookmark's chapter means reading that chapter's document.
  const contentsOpen = sheet === 'contents'
  const [bookmarkedTocIds, setBookmarkedTocIds] = useState<ReadonlySet<number>>(() => new Set())
  useEffect(() => {
    if (!contentsOpen || !ready) return
    let cancelled = false
    void (async () => {
      const ids = new Set<number>()
      for (const b of bookmarks) {
        const item = await handle.current?.tocItemOf(b.cfi).catch(() => null)
        if (item?.id !== undefined) ids.add(item.id)
      }
      if (!cancelled) setBookmarkedTocIds(ids)
    })()
    return () => {
      cancelled = true
    }
  }, [bookmarks, contentsOpen, ready])
  const bookmarkFractions = useMemo(
    () => bookmarks.flatMap((b) => (b.fraction != null ? [b.fraction] : [])),
    [bookmarks],
  )

  const putBookmark = (
    b: Pick<Annotation, 'id' | 'cfi' | 'text' | 'name' | 'chapter' | 'fraction'>,
  ) =>
    apply(
      api.putAnnotation(fingerprint, {
        id: b.id,
        kind: 'bookmark',
        cfi: b.cfi,
        text: b.text,
        name: b.name || undefined,
        chapter: b.chapter,
        fraction: b.fraction,
      }),
    )

  /** Removes bookmarks; a named one can be brought back, since its name was typed in. */
  const removeBookmarks = async (list: Annotation[]) => {
    for (const b of list) await apply(api.deleteAnnotation(fingerprint, b.id))
    const named = list.filter((b) => b.name)
    if (!named.length) return
    useToasts.getState().show({
      message: named.length === 1 ? `Removed “${named[0]?.name}”` : 'Bookmarks removed',
      action: {
        label: 'Undo',
        run: () => void Promise.all(list.map((b) => putBookmark(b))),
      },
    })
  }

  const [bookmarksAdded, setBookmarksAdded] = useState(0)
  /** `from` is where it was asked for: the toolbar's button, or the page (its corner or ribbon). */
  const toggleBookmark = async (from: 'toolbar' | 'page') => {
    if (pageBookmarks.length) {
      await removeBookmarks(pageBookmarks)
      return
    }
    const cfi = handle.current?.pageStart()
    if (!location || !cfi) return
    const id = newId()
    const text = (location.range?.toString() ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
    const added = await putBookmark({
      id,
      cfi,
      text,
      chapter: chapterLabel(tocRef.current, location.tocItem),
      fraction: location.fraction,
    })
    if (!added) return
    if (from === 'toolbar') setBookmarksAdded((n) => n + 1)
    const { prefs, update } = usePreferences.getState()
    if (prefs.bookmarkHintSeen) return
    update({ bookmarkHintSeen: true })
    useToasts.getState().show({
      message: 'Bookmark added',
      action: {
        label: 'Name it',
        run: () => {
          const current = useLibrary
            .getState()
            .records[fingerprint]?.annotations.find((a) => a.id === id && !a.deleted)
          if (current) setNamingBookmark(current)
        },
      },
    })
  }

  // -- Read-aloud -------------------------------------------------------------------------------

  const readAloud = useReadAloud({
    handle,
    active: readingAloud && ready,
    language: entry?.language ?? null,
    accent,
    book: {
      fingerprint,
      title,
      chapter:
        chapterLabel(open.status === 'ready' ? (open.book.toc ?? []) : [], location?.tocItem) ??
        null,
    },
    onEnded: () => setReadingAloud(false),
  })

  /** Reads on from `from` (or the page), or with `passageOnly`, just the text in it. */
  const startReadAloud = (from?: Range, passageOnly = false) => {
    setSheet(null)
    setSelection(null)
    setReadingAloud(true)
    if (from && passageOnly) readAloud.readPassage(from)
    else readAloud.start(from)
  }

  // -- Input ------------------------------------------------------------------------------------

  const closeOverlays = useCallback((): boolean => {
    if (definition || footnote || activeHighlight || noteFor || namingBookmark) {
      setDefinition(null)
      setFootnote(null)
      setActiveHighlight(null)
      setNoteFor(null)
      setNamingBookmark(null)
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
  }, [definition, footnote, activeHighlight, noteFor, namingBookmark, selection, sheet])

  const onKey = useLatest((e: KeyboardEvent) => {
    const h = handle.current
    if (!h || e.defaultPrevented || handleWindowShortcut(e)) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      setSheet('search')
      return
    }
    // Ctrl + and Ctrl − zoom page-based books; Ctrl 0 fits the page again.
    if (mod && fixedLayout && ['=', '+', '-', '0'].includes(e.key)) {
      e.preventDefault()
      if (e.key === '0') requestZoom('fit-page')
      else requestZoom(stepZoom(zoomInfo.factor, e.key === '-' ? -1 : 1))
      return
    }
    // Alt+← goes back after a jump, as in a browser.
    if (e.altKey && !mod && e.key === 'ArrowLeft' && back) {
      e.preventDefault()
      goBack()
      return
    }
    if (mod || e.altKey) return
    // Shift with an arrow extends a selection, which stays on the page.
    if (e.shiftKey && e.key.startsWith('Arrow')) return
    switch (e.key) {
      case 'ArrowRight':
        h.goRight()
        break
      case 'ArrowLeft':
        h.goLeft()
        break
      case 'PageDown':
      case 'ArrowDown':
        // Scrolled, the arrows scroll a few lines, wherever the focus is (the page's own scrolling
        // only answers them once it's been clicked).
        if (readerPrefs.scrolled && e.key === 'ArrowDown') h.scrollBy(ARROW_SCROLL_PX)
        else h.next()
        break
      case 'PageUp':
      case 'ArrowUp':
        if (readerPrefs.scrolled && e.key === 'ArrowUp') h.scrollBy(-ARROW_SCROLL_PX)
        else h.prev()
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
          } else if (isBackGesture(e)) {
            // Like a browser's back: first to where the reader jumped from, then to the library.
            if (back) goBack()
            else navigate({ name: 'library' })
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
    if (zone === 'bookmark') {
      void toggleBookmark('page')
      return
    }
    if (zone === 'center' || readerPrefs.scrolled) {
      setChromeVisible((v) => !v)
      return
    }
    if (zone === 'left') handle.current?.goLeft()
    else handle.current?.goRight()
  }

  // The matches' outlines go with the search, however it's closed: picking a result on a phone,
  // a tap on the page, another sheet. (The result gone to keeps its own mark.)
  const searching = sheet === 'search'
  useEffect(() => {
    if (!searching) handle.current?.clearSearch()
  }, [searching])

  const seek = useDebouncedCallback((f: number) => void handle.current?.goToFraction(f), 120)

  const goTo = (target: string) => {
    markJump()
    void handle.current?.goTo(target)
    if (windowWidth < 900) setSheet(null)
  }

  /** A search result stays marked after the search closes, until the reader turns the page. */
  const goToMatch = (cfi: string) => {
    markJump()
    void handle.current?.showMatch(cfi, withAlpha(accent, 0.3))
    if (windowWidth < 900) setSheet(null)
  }

  const layout = useMemo<BookLayout>(
    () => ({
      scrolled: readerPrefs.scrolled,
      maxInlineSize: MARGIN_WIDTHS[readerPrefs.margins],
      maxColumnCount:
        readerPrefs.spread && windowWidth - (sheet ? 412 : 0) >= SPREAD_MIN_WIDTH ? 2 : 1,
      // On the desktop, room for the toolbar above the text and the footer below it. Phones hide
      // both while reading, so there the text only keeps a little clear of the screen's edges.
      margin: phone ? PHONE_MARGIN : 96,
      gap: phone ? PHONE_GAPS[readerPrefs.margins] : '6%',
      animated: readerPrefs.animatePages && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    }),
    [readerPrefs, windowWidth, sheet, phone],
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
      style={
        {
          cursor: toolbarHidden ? 'none' : undefined,
          '--page-margin': `${layout.margin}px`,
        } as CSSProperties
      }
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
              setChapterMarks(
                (handle.current?.chapterStarts() ?? []).map((c) => ({
                  fraction: c.fraction,
                  label: chapterLabel(tocRef.current, c.item) ?? '',
                  top: c.depth === 0,
                })),
              )
              setReady(true)
              endOpening()
              if (entry?.format === 'pdf') {
                useToasts.getState().show({
                  message: 'PDF support is experimental: some pages may not look right yet',
                  durationMs: 7000,
                })
              }
              // "Read aloud" in the library opens the book already speaking.
              if (startReadingAloud) readAloud.start()
            }}
            onError={(e) => {
              setOpen({
                status: 'error',
                title,
                message: `This book couldn’t be displayed. (${toAppError(e).message})`,
              })
              endOpening()
            }}
            onRelocate={onRelocate}
            onLinkJump={markJump}
            onSelection={(sel) => {
              setSelection(sel)
              if (sel) setActiveHighlight(null)
            }}
            onNoteHover={onNoteHover}
            onHighlightClick={(cfi, rect) => {
              const annotation = highlights.find((h) => h.cfi === cfi)
              if (annotation) setActiveHighlight({ annotation, rect })
            }}
            onFootnote={setFootnote}
            onExternalLink={(href) =>
              void openUrl(href).catch((e) => showError(toAppError(e).message))
            }
            onActivity={onActivity}
            onPointerMove={showChrome}
            onTap={onTap}
            onKeyDown={(e) => onKey.current(e)}
            zoom={zoom}
            viewLocked={viewLocked}
            onZoomInfo={onZoomInfo}
            onZoomRequest={requestZoom}
          />
        )}
      </div>

      {/* On phones the toolbar's button shows the bookmark while the chrome is up, and the ribbon
          would hang behind the status bar. */}
      <AnimatePresence>
        {pageBookmarks.length > 0 && ready && (immersive || !phone) && (
          <motion.button
            key="ribbon"
            type="button"
            className={styles.ribbon}
            aria-label="Remove bookmark"
            title="Remove bookmark"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            onClick={() => void toggleBookmark('page')}
          />
        )}
      </AnimatePresence>

      {/* The way back after a jump. It comes and goes with the toolbar. */}
      <AnimatePresence>
        {back && ready && !readingAloud && (
          <motion.button
            key="back"
            type="button"
            className={styles.backPill}
            title={`${backLabel(back, chapter)} (Alt+←)`}
            initial={{ opacity: 0, x: '-50%', y: phone ? -8 : 8 }}
            animate={
              toolbarHidden
                ? { opacity: 0, x: '-50%', y: phone ? -8 : 8 }
                : { opacity: 1, x: '-50%', y: 0 }
            }
            exit={{ opacity: 0, x: '-50%', y: phone ? -8 : 8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            style={{ pointerEvents: toolbarHidden ? 'none' : undefined }}
            onClick={goBack}
          >
            <Undo2 size={15} strokeWidth={2} aria-hidden="true" />
            <span>{backLabel(back, chapter)}</span>
          </motion.button>
        )}
      </AnimatePresence>

      {readingAloud ? (
        <IconButton
          glass
          label="Back to reading"
          style={{
            position: 'absolute',
            zIndex: 10,
            top: 'calc(20px + var(--safe-top))',
            left: 20,
          }}
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
          bottomBusy={overlayOpen}
          sheet={sheet}
          bookmarked={pageBookmarks.length > 0}
          bookmarksAdded={bookmarksAdded}
          readingAloud={readingAloud}
          onBack={() => navigate({ name: 'library' })}
          onSheet={(s) => setSheet((current) => (current === s ? null : s))}
          onToggleBookmark={() => void toggleBookmark('toolbar')}
          onReadAloud={() => startReadAloud()}
          onHover={setHoveringChrome}
        />
      )}

      {fixedLayout && ready && !readingAloud && (
        <ZoomBar
          zoom={zoom}
          factor={zoomInfo.factor}
          zoomed={zoomed}
          locked={viewLocked}
          hidden={toolbarHidden || (phone && overlayOpen)}
          onZoom={requestZoom}
          onLock={setViewLocked}
          onHover={setHoveringChrome}
        />
      )}

      {!readingAloud && (
        <ReaderFooter
          chromeHidden={toolbarHidden}
          fraction={location?.fraction ?? record?.progress?.fraction ?? 0}
          minutesLeft={minutesLeft}
          sectionPages={sectionPages}
          pageLabel={location?.pageItem?.label}
          bookmarks={bookmarkFractions}
          chapters={chapterMarks}
          onSeek={(f) => {
            markJump()
            seek(f)
          }}
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
            bookmarkedTocIds={bookmarkedTocIds}
            highlights={highlights}
            onGoTo={goTo}
            onRenameBookmark={setNamingBookmark}
            onDeleteBookmark={(b) => void removeBookmarks([b])}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet === 'search' && (
          <SearchSheet
            key="search"
            search={(q, onResult) => handle.current?.search(q, accent, onResult) ?? (() => {})}
            onGoTo={goToMatch}
            onClose={() => setSheet(null)}
          />
        )}
      </AnimatePresence>

      {selection && !noteFor && !definition && (
        <SelectionBar
          anchor={selection.rect}
          docked={phone}
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
          onReadSelection={() => {
            startReadAloud(selection.range, true)
            handle.current?.deselect()
          }}
          onReadFromHere={() => startReadAloud(selection.range)}
          onClose={() => setSelection(null)}
        />
      )}

      {activeHighlight && (
        <HighlightBar
          anchor={activeHighlight.rect}
          docked={phone}
          showNote={touchScreen}
          annotation={activeHighlight.annotation}
          onColor={(color) => {
            // Picking a colour makes it a highlight in its own right, kept if the note goes.
            void updateHighlight(activeHighlight.annotation, { color, fromNote: false })
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

      {hoveredNote && !overlayOpen && (
        <NotePreview
          anchor={hoveredNote.rect}
          note={hoveredNote.annotation.note ?? ''}
          onClose={() => setHoveredNote(null)}
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
            saveNote(target, note)
          }}
        />
      )}

      {namingBookmark && (
        <BookmarkNameDialog
          passage={namingBookmark.text}
          initial={namingBookmark.name ?? ''}
          suggestion={namingBookmark.chapter}
          onClose={() => setNamingBookmark(null)}
          onSave={(name) => {
            const target = namingBookmark
            setNamingBookmark(null)
            if (name !== (target.name ?? '')) void putBookmark({ ...target, name })
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
