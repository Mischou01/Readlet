// Where a tap on a touch screen lands on the page. Pure, covered by tapZones.test.ts.

/** What a tap on the page does: turn it, show the chrome, or bookmark it (touch only). */
export type TapZone = 'left' | 'center' | 'right' | 'bookmark'

/**
 * On a touch screen the text fills the page, so taps in the outer 30% on each side turn it,
 * whatever is under the finger; the middle shows the toolbar.
 */
const TOUCH_TAP_FRACTION = 0.3
/**
 * The top-right corner, under the bookmark ribbon, adds or removes a bookmark instead: the right
 * 15% of the page's width and the top 10% of its height.
 */
const BOOKMARK_CORNER_WIDTH = 0.15
const BOOKMARK_CORNER_HEIGHT = 0.1

type Box = Pick<DOMRect, 'left' | 'right' | 'top' | 'width' | 'height'>

/** The zone of a tap at (`x`, `y`), in window coordinates, on a page filling `box`. */
export function touchZoneAt(x: number, y: number, box: Box): TapZone {
  if (
    x > box.right - box.width * BOOKMARK_CORNER_WIDTH &&
    y < box.top + box.height * BOOKMARK_CORNER_HEIGHT
  ) {
    return 'bookmark'
  }
  const edge = box.width * TOUCH_TAP_FRACTION
  return x < box.left + edge ? 'left' : x > box.right - edge ? 'right' : 'center'
}
