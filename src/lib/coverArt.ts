// Generated covers for books without one: abstract shapes in the book's aura colours, in the
// spirit of the mockups. Deterministic per book.

import type { Palette } from './types'

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Small deterministic generator: every call returns the next number in [0, 1). */
function sequence(seed: number): () => number {
  let state = seed || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`

/** A CSS `background` for a generated cover. */
export function generatedCoverBackground(seed: string, palette: Palette): string {
  const [a, b, c] = palette.light
  const deep = palette.accent
  const rand = sequence(hash(seed))
  const style = Math.floor(rand() * 4)
  switch (style) {
    case 0: // sun over hills
      return [
        `radial-gradient(ellipse 130% 60% at 50% ${pct(1.05 + rand() * 0.1)}, ${deep} 0 50%, transparent 50.5%)`,
        `radial-gradient(circle at ${pct(0.25 + rand() * 0.5)} ${pct(0.28 + rand() * 0.1)}, ${c} 0 ${pct(0.1 + rand() * 0.04)}, transparent ${pct(0.145 + rand() * 0.04)})`,
        a,
      ].join(', ')
    case 1: // bands
      return `linear-gradient(180deg, ${a} 0 ${pct(0.5 + rand() * 0.08)}, ${b} 0 ${pct(0.68 + rand() * 0.04)}, ${c} 0 ${pct(0.82 + rand() * 0.04)}, ${deep} 0)`
    case 2: {
      // scattered pebbles
      const dots = [b, c, deep, b].map((color) => {
        const r = 0.08 + rand() * 0.1
        return `radial-gradient(circle at ${pct(0.2 + rand() * 0.6)} ${pct(0.35 + rand() * 0.5)}, ${color} 0 ${pct(r)}, transparent ${pct(r + 0.005)})`
      })
      return [...dots, a].join(', ')
    }
    default: // split with a moon
      return [
        `radial-gradient(circle at 50% ${pct(0.5 + rand() * 0.1)}, ${c} 0 ${pct(0.13 + rand() * 0.04)}, transparent ${pct(0.175 + rand() * 0.04)})`,
        `linear-gradient(90deg, ${deep} 0 50%, ${b} 50%)`,
      ].join(', ')
  }
}
