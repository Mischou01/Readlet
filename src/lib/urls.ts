// URLs for the custom schemes the Rust core registers (src-tauri/src/protocol.rs). WebView2 on
// Windows can't load custom schemes directly, so Tauri maps them to `http://<scheme>.localhost`.

const useHttpStyle = typeof navigator !== 'undefined' && /Windows|Android/.test(navigator.userAgent)

function schemeUrl(scheme: string, path: string): string {
  return useHttpStyle ? `http://${scheme}.localhost/${path}` : `${scheme}://localhost/${path}`
}

export function bookUrl(fingerprint: string): string {
  return schemeUrl('book', fingerprint)
}

/** The version busts the image cache when a cover changes. */
export function coverUrl(fingerprint: string, version: number): string {
  return `${schemeUrl('cover', fingerprint)}?v=${version}`
}
