import type { HighlightColor } from './types'

/** Highlight colours (docs/PLAN.md §5): solid on light pages, translucent on dark ones. */
export const HIGHLIGHTS: Record<HighlightColor, { label: string; hex: string; dark: string }> = {
  butter: { label: 'Butter', hex: '#F3E2A0', dark: 'rgba(243, 226, 160, 0.28)' },
  peach: { label: 'Peach', hex: '#F5C9B4', dark: 'rgba(245, 201, 180, 0.28)' },
  mint: { label: 'Mint', hex: '#BEE3D0', dark: 'rgba(190, 227, 208, 0.26)' },
  sky: { label: 'Sky', hex: '#C3D7F3', dark: 'rgba(195, 215, 243, 0.26)' },
  lilac: { label: 'Lilac', hex: '#D8CDF0', dark: 'rgba(216, 205, 240, 0.28)' },
}

export function highlightColor(color: string | undefined): HighlightColor {
  return color && color in HIGHLIGHTS ? (color as HighlightColor) : 'butter'
}

/** A marker-pen underlay for quoted highlights in the library and the highlights hub. */
export function markerBackground(color: string | undefined, dark: boolean): string {
  const c = HIGHLIGHTS[highlightColor(color)]
  const fill = dark ? c.dark : c.hex
  return `linear-gradient(180deg, transparent 55%, ${fill} 55%, ${fill} 92%, transparent 92%)`
}
