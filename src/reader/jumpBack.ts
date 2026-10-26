// The way back to where the reader was reading before a jump (the contents, a search result, a
// link, the progress bar). Pure, covered by jumpBack.test.ts.

import { formatPercent } from '../lib/format'
import { isOnPage } from './bookmarks'
import { collapseCFI } from './foliate'

/** Where the reader was reading: the page (a range CFI), and how to name it. */
export interface JumpOrigin {
  cfi: string
  fraction: number
  chapter?: string
}

export interface JumpBack {
  /** Where the reader jumped from, or null when there's no way back to offer. */
  origin: JumpOrigin | null
  /** The jump has taken the reader off that page (until then, there's nothing to go back to). */
  landed: boolean
  /** Pages turned since the last jump. */
  turns: number
}

export const NO_JUMP: JumpBack = { origin: null, landed: false, turns: 0 }

/** After this many page turns at the new place, the reader is reading there: the way back goes. */
export const TURNS_TO_SETTLE = 3

/**
 * The reader jumps away from `from`. Jumping again before settling (trying one search result after
 * another, say) keeps the way back to where they were reading, not to the last place jumped to.
 */
export function jumped(state: JumpBack, from: JumpOrigin | null): JumpBack {
  if (state.origin) return { ...state, turns: 0 }
  return from ? { origin: from, landed: false, turns: 0 } : state
}

/** Where to go back to, once there's somewhere to go back to. */
export function wayBack(state: JumpBack): JumpOrigin | null {
  return state.landed ? state.origin : null
}

/**
 * A new page is showing (`pageCfi`); `turned` if the reader turned (or scrolled) to it, rather than
 * jumping there or the same page being laid out again.
 */
export function relocated(state: JumpBack, pageCfi: string | undefined, turned: boolean): JumpBack {
  const { origin } = state
  if (!origin) return state
  const there = isOnPage(collapseCFI(origin.cfi), pageCfi)
  if (!state.landed) {
    // Still on the page jumped from: the jump hasn't landed yet (the page can be laid out again
    // first), or it went somewhere on the same page. Turning a page now is just reading on.
    if (turned) return NO_JUMP
    return there ? state : { ...state, landed: true }
  }
  // Back where they were, by turning pages or a jump: nothing to go back to.
  if (there) return NO_JUMP
  if (!turned) return state
  const turns = state.turns + 1
  return turns >= TURNS_TO_SETTLE ? NO_JUMP : { ...state, turns }
}

/** "Back to Chapter 3", or "Back to 12%" within the same chapter. */
export function backLabel(origin: JumpOrigin, currentChapter: string | undefined): string {
  const place =
    origin.chapter && origin.chapter !== currentChapter
      ? origin.chapter
      : formatPercent(origin.fraction)
  return `Back to ${place}`
}
