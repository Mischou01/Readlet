// Reading just a selected passage aloud. foliate-js's tts.js speaks whole paragraphs and starts at
// a sentence boundary, so a selection gets its own SSML: exactly the selected text, split into
// sentences with a mark before each (like tts.js), and the range of each sentence for highlighting.

const SSML_NS = 'http://www.w3.org/2001/10/synthesis'
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'td',
  'th',
  'tr',
  'ul',
])

export interface Passage {
  ssml: string
  /** Each sentence's range in the book, by mark name. */
  sentences: Map<string, Range>
}

/** A run of selected text: `node.data[start, end)`, found at `at` in the joined text. */
interface Piece {
  node: Text
  start: number
  end: number
  at: number
}

function blockOf(node: Node): Element | null {
  let el = node.parentElement
  while (el && !BLOCK_TAGS.has(el.localName.toLowerCase())) el = el.parentElement
  return el
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  )
}

function segmenter(language: string | null): Intl.Segmenter {
  try {
    return new Intl.Segmenter(language ?? undefined, { granularity: 'sentence' })
  } catch {
    return new Intl.Segmenter(undefined, { granularity: 'sentence' })
  }
}

/** The selected text in `range`, piece by piece; paragraphs are joined with a line break. */
function collectText(range: Range): { text: string; pieces: Piece[] } {
  const root = range.commonAncestorContainer
  const doc = root.ownerDocument ?? (root as Document)
  const nodes: Text[] = []
  if (root.nodeType === Node.TEXT_NODE) nodes.push(root as Text)
  else {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (range.intersectsNode(n)) nodes.push(n as Text)
    }
  }
  let text = ''
  let lastBlock: Element | null | undefined
  const pieces: Piece[] = []
  for (const node of nodes) {
    if (node.parentElement?.closest('script, style, rt')) continue
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.data.length
    if (end <= start) continue
    const block = blockOf(node)
    if (pieces.length && block !== lastBlock) text += '\n'
    lastBlock = block
    pieces.push({ node, start, end, at: text.length })
    text += node.data.slice(start, end)
  }
  return { text, pieces }
}

/** The DOM position of offset `at` in the joined text; `end` prefers the end of a piece. */
function positionOf(pieces: Piece[], at: number, end: boolean): [Text, number] | null {
  for (const p of pieces) {
    const length = p.end - p.start
    if (at < p.at) break
    if (at < p.at + length || (end && at === p.at + length)) return [p.node, p.start + at - p.at]
  }
  return null
}

/** SSML for exactly the text in `range`, or null if there's nothing to say. */
export function passageFromRange(range: Range, language: string | null): Passage | null {
  const { text, pieces } = collectText(range)
  const doc = pieces[0]?.node.ownerDocument
  if (!doc) return null
  const sentences = new Map<string, Range>()
  let body = ''
  for (const { segment, index } of segmenter(language).segment(text)) {
    const said = segment.trim()
    if (!said) continue
    const from = index + segment.length - segment.trimStart().length
    const start = positionOf(pieces, from, false)
    const end = positionOf(pieces, from + said.length, true)
    if (!start || !end) continue
    const sentence = doc.createRange()
    sentence.setStart(...start)
    sentence.setEnd(...end)
    const name = String(sentences.size)
    sentences.set(name, sentence)
    body += `<mark name="${name}"/>${escapeXml(said.replace(/\s+/g, ' '))} `
  }
  if (!sentences.size) return null
  const lang = language ? ` xml:lang="${escapeXml(language)}"` : ''
  return { ssml: `<speak xmlns="${SSML_NS}"${lang}>${body.trimEnd()}</speak>`, sentences }
}
