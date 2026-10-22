// Keeps book content inert: every (X)HTML page of a book gets a strict Content Security Policy.

/**
 * The policy for a book page. Books can contain scripts, forms, frames and links to remote
 * images or fonts; Readlet never runs or loads any of them (foliate-js requires the first; see
 * its README, and docs/PLAN.md allows network access only on an explicit action). Book
 * resources reach the page as `blob:` or `data:` URLs; `appOrigin` serves Readlet's own
 * reading fonts. The app's CSP already blocks scripts in production; this also covers
 * development builds and everything that isn't a script.
 */
export function bookCsp(appOrigin: string): string {
  const local = `blob: data: ${appOrigin}`.trim()
  return [
    "default-src 'none'",
    `img-src ${local}`,
    `style-src ${local} 'unsafe-inline'`,
    `font-src ${local}`,
    `media-src ${local}`,
    "script-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

/** Inserts the CSP `<meta>` at the start of an (X)HTML document's head. */
export function injectCsp(markup: string, appOrigin: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${bookCsp(appOrigin)}"/>`
  if (/<head\b[^>]*>/i.test(markup)) return markup.replace(/<head\b[^>]*>/i, (head) => head + meta)
  if (/<html\b[^>]*>/i.test(markup)) {
    return markup.replace(/<html\b[^>]*>/i, (html) => `${html}<head>${meta}</head>`)
  }
  return meta + markup
}
