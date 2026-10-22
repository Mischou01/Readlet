// Applies the colour scheme and the current book's aura to the document (docs/PLAN.md §5).

import { useEffect, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import type { Palette } from '../lib/types'
import { usePreferences } from '../state/preferences'

/** Peach, periwinkle and sage: the aura when no book is in focus (from the Rust core). */
export const FALLBACK_PALETTE: Palette = {
  light: ['#f4c6af', '#c5cff8', '#c2d8c8'],
  dark: ['#6c4938', '#495071', '#45584b'],
  accent: '#8a6959',
  accentDark: '#cfb0a1',
}

export type ColorScheme = 'light' | 'dark'

const darkQuery =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

function subscribeToSystemScheme(onChange: () => void) {
  darkQuery?.addEventListener('change', onChange)
  return () => darkQuery?.removeEventListener('change', onChange)
}

export function useSystemColorScheme(): ColorScheme {
  return useSyncExternalStore(
    subscribeToSystemScheme,
    () => (darkQuery?.matches ? 'dark' : 'light'),
    () => 'light',
  )
}

/** The scheme of the app chrome, after applying the "Appearance" preference. */
export function useColorScheme(): ColorScheme {
  const appearance = usePreferences((s) => s.prefs.appearance)
  const system = useSystemColorScheme()
  return appearance === 'system' ? system : appearance
}

interface AuraState {
  palette: Palette
  setPalette: (palette: Palette | null) => void
}

export const useAura = create<AuraState>((set) => ({
  palette: FALLBACK_PALETTE,
  setPalette: (palette) => set({ palette: palette ?? FALLBACK_PALETTE }),
}))

/** Makes `palette` the aura while the calling view is shown. */
export function useAuraFor(palette: Palette | null | undefined) {
  const setPalette = useAura((s) => s.setPalette)
  const key = palette ? JSON.stringify(palette) : ''
  useEffect(() => {
    setPalette(key ? (JSON.parse(key) as Palette) : null)
  }, [key, setPalette])
}

export function auraColors(palette: Palette, scheme: ColorScheme): [string, string, string] {
  return scheme === 'dark' ? palette.dark : palette.light
}

export function accentColor(palette: Palette, scheme: ColorScheme): string {
  return scheme === 'dark' ? palette.accentDark : palette.accent
}

/**
 * A view can take over the chrome's colours (the reader does, so sheets and popovers match the
 * reading theme) by setting CSS variables on `<html>` while it's shown.
 */
export interface ThemeOverride {
  scheme: ColorScheme
  vars: Record<string, string>
}

export const useThemeOverride = create<{ override: ThemeOverride | null }>(() => ({
  override: null,
}))

let overriddenVars: string[] = []

/** Keeps `<html>`'s theme attributes and colour variables in sync with the state. */
export function useDocumentTheme() {
  const scheme = useColorScheme()
  const reduceTransparency = usePreferences((s) => s.prefs.reduceTransparency)
  const palette = useAura((s) => s.palette)
  const override = useThemeOverride((s) => s.override)

  useEffect(() => {
    const root = document.documentElement
    for (const name of overriddenVars) root.style.removeProperty(name)
    overriddenVars = []
    root.dataset.theme = scheme
    root.dataset.transparency = reduceTransparency ? 'reduced' : 'full'
    const [a, b, c] = auraColors(palette, scheme)
    root.style.setProperty('--aura-1', a)
    root.style.setProperty('--aura-2', b)
    root.style.setProperty('--aura-3', c)
    root.style.setProperty('--accent', accentColor(palette, scheme))
    if (override) {
      root.dataset.theme = override.scheme
      for (const [name, value] of Object.entries(override.vars)) {
        root.style.setProperty(name, value)
        overriddenVars.push(name)
      }
    }
  }, [scheme, reduceTransparency, palette, override])
}
