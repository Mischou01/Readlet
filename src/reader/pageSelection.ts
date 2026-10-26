// Paginated text shows a page (or a spread) at a time, and a selection stays on it. Covered by
// pageSelection.test.ts.

/**
 * Trims a selection to the text on the page showing (`page`), keeping its direction. Returns
 * whether it had to.
 */
export function trimToPage(selection: Selection | null, page: Range | null): boolean {
  if (!selection || !page || selection.rangeCount === 0 || selection.isCollapsed) return false
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
  if (!anchorNode || !focusNode) return false
  const clamp = (node: Node, offset: number): [Node, number] => {
    let where = 0
    try {
      where = page.comparePoint(node, offset)
    } catch {
      // The page's range is from a section that's since been replaced.
    }
    if (where < 0) return [page.startContainer, page.startOffset]
    if (where > 0) return [page.endContainer, page.endOffset]
    return [node, offset]
  }
  const [anchor, anchorAt] = clamp(anchorNode, anchorOffset)
  const [focus, focusAt] = clamp(focusNode, focusOffset)
  const unchanged =
    anchor === anchorNode &&
    anchorAt === anchorOffset &&
    focus === focusNode &&
    focusAt === focusOffset
  if (unchanged) return false
  if (anchor === focus && anchorAt === focusAt) selection.collapse(anchor, anchorAt)
  else selection.setBaseAndExtent(anchor, anchorAt, focus, focusAt)
  return true
}
