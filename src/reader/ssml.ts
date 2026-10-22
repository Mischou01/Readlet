// Helpers for the SSML that foliate-js's tts.js produces: one paragraph per document, with a
// `<mark name="n"/>` before each sentence.

const SSML_NS = 'http://www.w3.org/2001/10/synthesis'

/** The mark names in a paragraph, in order. */
export function markNames(ssml: string): string[] {
  return Array.from(ssml.matchAll(/<mark\b[^>]*\bname="([^"]*)"/g), (m) => m[1] ?? '')
}

/**
 * The same paragraph starting at mark `name` (everything spoken before it removed), or `null` if
 * the mark isn't there. Mirrors what tts.js does when resuming from a mark.
 */
export function ssmlFromMark(ssml: string, name: string): string | null {
  const doc = new DOMParser().parseFromString(ssml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return null
  const mark = Array.from(doc.getElementsByTagNameNS(SSML_NS, 'mark')).find(
    (m) => m.getAttribute('name') === name,
  )
  if (!mark) return null
  // Remove everything before the mark, climbing out of nested elements (<emphasis>, <lang>).
  let current: Node | null = mark
  while (current && current !== doc.documentElement) {
    let sibling: ChildNode | null = current.previousSibling
    while (sibling) {
      const previous: ChildNode | null = sibling.previousSibling
      sibling.parentNode?.removeChild(sibling)
      sibling = previous
    }
    current = current.parentNode
  }
  return new XMLSerializer().serializeToString(doc)
}
