// Types for the parts of foliate-js (vendor/foliate-js, a pinned submodule) that Readlet uses.
// foliate-js's API is unstable, so only src/reader/foliate.ts and BookView.tsx may import it.

declare module 'foliate-js/view.js' {
  export type LanguageMap = string | Record<string, string>

  export type Contributor =
    string | { name?: LanguageMap; sortAs?: LanguageMap; role?: string | string[] }

  export interface Collection {
    name?: LanguageMap
    position?: number | string
  }

  export interface FoliateMetadata {
    title?: LanguageMap
    author?: Contributor | Contributor[]
    language?: string | string[]
    publisher?: Contributor | Contributor[]
    published?: string
    description?: string
    identifier?: string
    belongsTo?: { series?: Collection | Collection[] | null }
  }

  export interface TocItem {
    id?: number
    label: string
    href: string
    subitems?: TocItem[] | null
  }

  export interface Section {
    load(): string | Promise<string>
    unload?(): void
    createDocument?(): Promise<Document>
    size: number
    linear?: string
    cfi?: string
    id: unknown
  }

  export interface Book {
    sections: Section[]
    dir?: string
    toc?: TocItem[]
    pageList?: TocItem[]
    metadata?: FoliateMetadata
    rendition?: { layout?: string }
    landmarks?: { type: string[]; href: string }[]
    getCover?(): Blob | null | undefined | Promise<Blob | null | undefined>
    destroy?(): void
    isExternal?(href: string): boolean
    /**
     * Fires `load` ({ type, isScript, allow }) before a resource loads and `data`
     * ({ data, type, name }) before it's turned into a blob URL; handlers may change `allow`/`data`.
     */
    transformTarget?: EventTarget
  }

  export interface Location {
    fraction: number
    section?: { current: number; total: number }
    location?: { current: number; next: number; total: number }
    /** Minutes left, assuming 1,600 bytes of section text a minute. */
    time?: { section: number; total: number }
    tocItem?: TocItem | null
    pageItem?: TocItem | null
    cfi: string
    range?: Range
  }

  export interface SearchExcerpt {
    pre: string
    match: string
    post: string
  }

  export type SearchResult =
    | 'done'
    | { progress: number }
    | { label: string; subitems: { cfi: string; excerpt: SearchExcerpt }[] }
    | { cfi: string; excerpt: SearchExcerpt }

  export interface Renderer extends HTMLElement {
    setStyles?(styles: string | [string, string]): void
    getContents(): { index: number; doc: Document; overlayer?: unknown }[]
    scrollToAnchor?(anchor: Range | Element | number, select?: boolean): Promise<void>
    next(): Promise<void>
    prev(): Promise<void>
    readonly heads?: HTMLElement[]
    readonly feet?: HTMLElement[]
    /** Paginated text only: the screen showing, counting a blank one before the section. */
    readonly page?: number
    /** Paginated text only: screens in the section, plus a blank one at each end. */
    readonly pages?: number
  }

  export interface TTS {
    start(): string | undefined
    resume(): string | undefined
    next(paused?: boolean): string | undefined
    prev(paused?: boolean): string | undefined
    from(range: Range): string | undefined
    setMark(mark: string): void
    doc: Document
  }

  export class View extends HTMLElement {
    book: Book
    renderer: Renderer
    isFixedLayout: boolean
    lastLocation: Location | null
    tts: TTS | null
    history: EventTarget & {
      canGoBack: boolean
      canGoForward: boolean
      back(): void
      forward(): void
    }
    open(book: Book | File | Blob | string): Promise<void>
    close(): void
    init(options: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>
    goTo(target: string | number | { fraction: number }): Promise<{ index: number } | undefined>
    goToFraction(fraction: number): Promise<void>
    goToTextStart(): Promise<void>
    select(target: string): Promise<void>
    deselect(): void
    prev(distance?: number): Promise<void>
    next(distance?: number): Promise<void>
    goLeft(): Promise<void>
    goRight(): Promise<void>
    getCFI(index: number, range?: Range): string
    getSectionFractions(): number[]
    getTOCItemOf(target: string): Promise<TocItem | null | undefined>
    addAnnotation(
      annotation: { value: string; color?: string; kind?: string },
      remove?: boolean,
    ): Promise<{ index: number; label: string } | undefined>
    deleteAnnotation(annotation: { value: string }): Promise<unknown>
    showAnnotation(annotation: { value: string }): Promise<void>
    search(options: {
      query: string
      index?: number
      matchCase?: boolean
      matchDiacritics?: boolean
      matchWholeWords?: boolean
      /** Options for the overlay that outlines matches, e.g. `{ color }`. */
      drawOptions?: Record<string, unknown>
    }): AsyncGenerator<SearchResult>
    clearSearch(): void
    initTTS(granularity?: 'word' | 'sentence', highlight?: (range: Range) => void): Promise<void>
    resolveNavigation(
      target: string | number,
    ): { index: number; anchor?: (doc: Document) => Range | Element } | undefined
  }

  export class ResponseError extends Error {}
  export class NotFoundError extends Error {}
  export class UnsupportedTypeError extends Error {}
  export function makeBook(file: File | Blob | string): Promise<Book>
}

declare module 'foliate-js/overlayer.js' {
  export type Draw = (rects: DOMRectList, options?: Record<string, unknown>) => SVGElement
  export class Overlayer {
    static highlight: Draw
    static underline: Draw
    static strikethrough: Draw
    static squiggly: Draw
    static outline: Draw
  }
}

declare module 'foliate-js/epubcfi.js' {
  /** Negative if `a` comes before `b`. */
  export function compare(a: string, b: string): number
  export function collapse(cfi: string, toEnd?: boolean): string
  export function parse(cfi: string): unknown
}

declare module 'foliate-js/footnotes.js' {
  import type { Book, View } from 'foliate-js/view.js'
  export interface FootnoteRenderDetail {
    view: View
    href: string
    type: string | null
    hidden: boolean
    target: Element | null
  }
  export class FootnoteHandler extends EventTarget {
    detectFootnotes: boolean
    handle(
      book: Book,
      event: CustomEvent<{ a: HTMLAnchorElement; href: string }>,
    ): Promise<void> | undefined
  }
}
