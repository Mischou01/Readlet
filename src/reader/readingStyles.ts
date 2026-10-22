// The stylesheet injected into each book page (an iframe rendered by foliate-js).

import atkinson from '@fontsource-variable/atkinson-hyperlegible-next/wght.css?inline'
import atkinsonItalic from '@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css?inline'
import literata from '@fontsource-variable/literata/opsz.css?inline'
import literataItalic from '@fontsource-variable/literata/opsz-italic.css?inline'
import newsreader from '@fontsource-variable/newsreader/opsz.css?inline'
import newsreaderItalic from '@fontsource-variable/newsreader/opsz-italic.css?inline'
import type { LineSpacing, ReaderPreferences, ReadingFont } from '../state/preferences'
import { withAlpha, type ReadingTheme } from './themes'

export const FONT_STACKS: Record<Exclude<ReadingFont, 'publisher'>, string> = {
  literata: "'Literata Variable', Georgia, serif",
  newsreader: "'Newsreader Variable', Georgia, serif",
  atkinson: "'Atkinson Hyperlegible Next Variable', system-ui, sans-serif",
}

export const LINE_HEIGHTS: Record<LineSpacing, number> = {
  compact: 1.45,
  comfortable: 1.62,
  airy: 1.8,
}

/**
 * Book pages are blob: documents, so the bundled fonts need absolute URLs. Vite emits root-relative
 * URLs (`/assets/…`, or `/node_modules/…` in development).
 */
export function absolutizeFontUrls(css: string, origin: string): string {
  return css.replace(
    /url\((['"]?)(\/[^'")]+)\1\)/g,
    (_, quote: string, path: string) => `url(${quote}${origin}${path}${quote})`,
  )
}

let fontFaces: string | null = null

function bundledFontFaces(): string {
  fontFaces ??= absolutizeFontUrls(
    [literata, literataItalic, newsreader, newsreaderItalic, atkinson, atkinsonItalic].join('\n'),
    location.origin,
  )
  return fontFaces
}

export interface ReadingStyleOptions {
  theme: ReadingTheme
  prefs: ReaderPreferences
  /** The book's accent in this theme, for links and the text selection. */
  accent: string
  /** `@font-face` rules for the bundled fonts (injectable for tests). */
  fontFaces?: string
}

export function readingCss({
  theme,
  prefs,
  accent,
  fontFaces = bundledFontFaces(),
}: ReadingStyleOptions): string {
  const lineHeight = LINE_HEIGHTS[prefs.spacing]
  const font = prefs.font === 'publisher' ? null : FONT_STACKS[prefs.font]
  const hyphens = prefs.justify ? 'auto' : 'manual'
  return `
${fontFaces}
@namespace epub "http://www.idpf.org/2007/ops";
html {
  color-scheme: ${theme.dark ? 'dark' : 'light'};
  font-size: ${prefs.fontSize}px !important;
  background-color: ${theme.bg} !important;
  color: ${theme.ink} !important;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
body {
  background: transparent !important;
  color: inherit !important;
}
${
  font
    ? `html, body { font-family: ${font} !important; }
body *:not(code):not(pre):not(kbd):not(samp):not(tt):not(math):not(math *) { font-family: inherit !important; }
code, pre, kbd, samp, tt { font-family: ui-monospace, 'DejaVu Sans Mono', monospace !important; }`
    : ''
}
${
  theme.dark
    ? `body *:not(img):not(svg):not(svg *):not(video) {
  color: inherit !important;
  background-color: transparent !important;
  border-color: ${theme.line} !important;
}
img, svg, video { opacity: 0.92; }`
    : ''
}
a:any-link { color: ${accent} !important; text-decoration-color: ${accent}; text-underline-offset: 0.15em; }
p, li, blockquote, dd {
  line-height: ${lineHeight} !important;
  text-align: ${prefs.justify ? 'justify' : 'start'};
  -webkit-hyphens: ${hyphens};
  hyphens: ${hyphens};
  -webkit-hyphenate-limit-before: 3;
  -webkit-hyphenate-limit-after: 2;
  -webkit-hyphenate-limit-lines: 2;
  hanging-punctuation: allow-end last;
  widows: 2;
  orphans: 2;
}
[align="left"] { text-align: left; }
[align="right"] { text-align: right; }
[align="center"] { text-align: center; }
[align="justify"] { text-align: justify; }
pre { white-space: pre-wrap !important; }
::selection { background: ${withAlpha(accent, theme.dark ? 0.32 : 0.22)}; }
aside[epub|type~="endnote"],
aside[epub|type~="footnote"],
aside[epub|type~="note"],
aside[epub|type~="rearnote"] { display: none; }
`
}
