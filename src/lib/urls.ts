// URLs for the custom schemes the Rust core registers (src-tauri/src/protocol.rs). WebView2 on
// Windows can't load custom schemes directly, so Tauri maps them to `http://<scheme>.localhost`.

const useHttpStyle = typeof navigator !== 'undefined' && /Windows|Android/.test(navigator.userAgent)

function schemeUrl(scheme: string, path: string): string {
  return useHttpStyle ? `http://${scheme}.localhost/${path}` : `${scheme}://localhost/${path}`
}

export function bookUrl(fingerprint: string): string {
  return schemeUrl('book', fingerprint)
}

/** A Project Gutenberg book's small cover. Most books have one. */
export function gutenbergCover(id: number): string {
  return `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.small.jpg`
}

/** An Open Library cover: `M` is about 180px wide, `L` about 500px. */
export function openLibraryCover(id: number, size: 'M' | 'L' = 'M'): string {
  return `https://covers.openlibrary.org/b/id/${id}-${size}.jpg`
}

/** The version busts the image cache when a cover changes. */
export function coverUrl(fingerprint: string, version: number): string {
  return `${schemeUrl('cover', fingerprint)}?v=${version}`
}
