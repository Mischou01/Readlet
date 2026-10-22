// Reading themes (docs/PLAN.md §5, the Reader mockups). The page is always opaque; the floating
// chrome is glass tinted with the book's aura.

import type { Palette } from '../lib/types'
import type { ColorScheme } from '../theme/aura'
import type { ReadingThemeId } from '../state/preferences'

export type ConcreteTheme = Exclude<ReadingThemeId, 'system'>

export interface ReadingTheme {
  id: ConcreteTheme
  name: string
  dark: boolean
  bg: string
  ink: string
  haze: string
  /** Glass base colour (before the aura tint), popovers and sheets. */
  glass: string
  pop: string
  sheet: string
  edge: string
  shadow: string
  blur: string
  track: string
  line: string
  hover: string
  pressed: string
  /** Footnote and link colour inside the book in dark themes. */
  solid: string
}

export const READING_THEMES: Record<ConcreteTheme, ReadingTheme> = {
  paper: {
    id: 'paper',
    name: 'Paper',
    dark: false,
    bg: '#F8F7F4',
    ink: '#2B2833',
    haze: '#6F6A78',
    glass: 'rgba(255,255,255,.78)',
    pop: 'rgba(255,255,255,.94)',
    sheet: 'rgba(255,255,255,.88)',
    edge: 'rgba(255,255,255,.85)',
    shadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 16px 40px -18px rgba(43,40,51,.34)',
    blur: 'blur(22px) saturate(160%)',
    track: 'rgba(43,40,51,.10)',
    line: 'rgba(43,40,51,.14)',
    hover: 'rgba(43,40,51,.06)',
    pressed: 'rgba(255,255,255,.95)',
    solid: '#FFFFFF',
  },
  sepia: {
    id: 'sepia',
    name: 'Sepia',
    dark: false,
    bg: '#F1E7D6',
    ink: '#4A3B2A',
    haze: '#6F5C47',
    glass: 'rgba(255,249,238,.8)',
    pop: 'rgba(255,250,242,.95)',
    sheet: 'rgba(255,250,242,.9)',
    edge: 'rgba(255,255,255,.7)',
    shadow: 'inset 0 1px 0 rgba(255,255,255,.8), 0 16px 40px -18px rgba(74,59,42,.38)',
    blur: 'blur(22px) saturate(150%)',
    track: 'rgba(74,59,42,.10)',
    line: 'rgba(74,59,42,.16)',
    hover: 'rgba(74,59,42,.07)',
    pressed: 'rgba(255,255,255,.9)',
    solid: '#FBF6EC',
  },
  dusk: {
    id: 'dusk',
    name: 'Dusk',
    dark: true,
    bg: '#2A2735',
    ink: '#E3DDEA',
    haze: '#A49EB0',
    glass: 'rgba(52,48,66,.8)',
    pop: 'rgba(58,54,74,.96)',
    sheet: 'rgba(52,48,66,.9)',
    edge: 'rgba(255,255,255,.09)',
    shadow: 'inset 0 1px 0 rgba(255,255,255,.07), 0 16px 40px -18px rgba(0,0,0,.6)',
    blur: 'blur(22px) saturate(140%)',
    track: 'rgba(227,221,234,.14)',
    line: 'rgba(227,221,234,.16)',
    hover: 'rgba(255,255,255,.08)',
    pressed: 'rgba(255,255,255,.16)',
    solid: '#353142',
  },
  night: {
    id: 'night',
    name: 'Night',
    dark: true,
    bg: '#121016',
    ink: '#C9C3D1',
    haze: '#8C8697',
    glass: 'rgba(30,27,38,.82)',
    pop: 'rgba(38,34,48,.96)',
    sheet: 'rgba(30,27,38,.92)',
    edge: 'rgba(255,255,255,.07)',
    shadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 16px 40px -18px rgba(0,0,0,.8)',
    blur: 'blur(22px) saturate(130%)',
    track: 'rgba(201,195,209,.12)',
    line: 'rgba(201,195,209,.14)',
    hover: 'rgba(255,255,255,.07)',
    pressed: 'rgba(255,255,255,.12)',
    solid: '#211E28',
  },
}

/** "Follow system" reads on Paper by day and Dusk by night. */
export function resolveReadingTheme(id: ReadingThemeId, system: ColorScheme): ReadingTheme {
  if (id === 'system') return READING_THEMES[system === 'dark' ? 'dusk' : 'paper']
  return READING_THEMES[id]
}

function hexToRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

/** The aura as a soft gradient laid over glass (toolbar, sheets, read-aloud bar). */
export function auraTint(palette: Palette, dark: boolean, angle = 100): string {
  const [a, b, c] = dark ? palette.dark : palette.light
  const strength = dark ? [0.45, 0.22, 0.42] : [0.34, 0.16, 0.32]
  return `linear-gradient(${angle}deg, ${withAlpha(a, strength[0] ?? 0)}, ${withAlpha(c, strength[1] ?? 0)} 50%, ${withAlpha(b, strength[2] ?? 0)})`
}

/**
 * CSS variables for the app chrome while reading, so every shared component (sheets, popovers,
 * buttons, toasts) takes on the reading theme.
 */
export function readerChromeVars(
  theme: ReadingTheme,
  palette: Palette,
  reduceTransparency: boolean,
): Record<string, string> {
  const accent = theme.dark ? palette.accentDark : palette.accent
  const tint = auraTint(palette, theme.dark)
  const sheetTint = auraTint(palette, theme.dark, 170)
  if (reduceTransparency) {
    return {
      ...readerChromeVars(theme, palette, false),
      '--glass': theme.solid,
      '--sheet-bg': theme.solid,
      '--pop-bg': theme.solid,
      '--blur': 'none',
    }
  }
  return {
    '--fog': theme.bg,
    '--ink': theme.ink,
    '--haze': theme.haze,
    '--line': theme.line,
    '--track': theme.track,
    '--hover': theme.hover,
    '--glass': `${tint}, ${theme.glass}`,
    '--glass-strong': theme.pressed,
    '--glass-edge': theme.edge,
    '--glass-shadow': theme.shadow,
    '--glass-shadow-sm': theme.shadow,
    '--blur': theme.blur,
    '--solid': theme.solid,
    '--sheet-bg': `${sheetTint}, ${theme.sheet}`,
    '--pop-bg': theme.pop,
    '--accent': accent,
    '--btn-bg': theme.ink,
    '--btn-ink': theme.bg,
  }
}
