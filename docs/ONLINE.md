# Finding books and filling in details — research and plan

Two features that go online, both still to be built:

1. **Find books** that aren't in the library: free public-domain editions downloaded straight
   into the books folder, and pointers to stores that sell DRM-free copies of the rest.
2. **Fill in details** (title, authors, series, description, cover…), by hand or looked up
   online.

This is the research done on 2026-10-24 and the plan that came out of it. **Nothing here was
tried against the live services**: the build environment's network policy blocked them, so
anything marked _unverified_ must be checked first (see "Check first" at the end). Sources are
listed at the bottom.

## Constraints from Readlet itself

- **Network only on an explicit action** (PLAN §8). Today the README says Wiktionary is the only
  feature that goes online. Both features must reach out only when the reader asks, and the
  README and the Settings hint ("Nothing else leaves this phone/computer") must be updated.
- **Book files are never changed** (PLAN §1 non-goals: editing books is Calibre's job). Details
  the reader fills in are not written into the EPUB.
- **The index is a cache** (`src-tauri/src/index.rs`), rebuilt from the folder. Anything the
  reader edits must live in `.readlet/` or it's lost on a rebuild and never syncs.
- **The webview's CSP** (`src-tauri/tauri.conf.json`) allows `connect-src` only to the app's own
  schemes and `https://en.wiktionary.org`.

## Sources: what was found

### Free (public-domain) books

| Source                              | What it offers                                                               | Findings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project Gutenberg**               | ~70,000+ books, EPUB downloads                                               | The site is for human users: automated bulk downloading gets an IP blocked, and bulk users are told to set up a mirror. One download per tap by the reader is what Foliate and KOReader already do. Official OPDS feed starts at `https://www.gutenberg.org/ebooks/search.opds/`; Gutenberg says it expects to retire the XML OPDS feeds in 2027, and a JSON OPDS 2 feed is "available for testing" on request. The search URL template was not confirmed (_unverified_).                                      |
| **Gutendex** (`gutendex.com`)       | JSON API over Gutenberg's catalogue; `formats` maps MIME type → download URL | Unofficial. Its maintainer says to run your own server and use gutendex.com for testing; a client library says the public instance isn't meant for more than a few concurrent users. **Don't ship an app that hits the public instance.**                                                                                                                                                                                                                                                                      |
| **Standard Ebooks**                 | Carefully re-edited, well-typeset public-domain EPUBs; free downloads        | Only the "new releases" RSS/Atom feeds are public. The full OPDS catalogue is a Patrons Circle benefit (paid, individuals only), also given to ebook producers and corporate sponsors. Whether an open-source app can get access is open: a third-party developer asked in standardebooks/tools issue #1016, with no answer found. OPDS 2 is served with `Accept: application/opds+json`. Recommended file for most readers: the "compatible epub". The download URL pattern was not confirmed (_unverified_). |
| **Open Library / Internet Archive** | Search across editions, metadata, covers                                     | Public-domain books can be downloaded by anyone; in-copyright ones are lent through controlled digital lending, which means DRM, so **exclude borrowable books**. The exact `ebook_access` values were not confirmed (_unverified_). An Open Library blog post said Gutenberg integration was live and Standard Ebooks "in progress"; whether search results carry Gutenberg / Standard Ebooks ids is _unverified_ but worth checking, since it would let one Open Library search find both.                   |

Prior art: GNOME's **Foliate** (whose renderer Readlet uses) ships OPDS catalogues for Project
Gutenberg, Standard Ebooks and Feedbooks, and can download from them.

### Paid books and DRM

**No catalogue or store API was found that says whether a commercial ebook is DRM-free.** So
Readlet can't truthfully say "no DRM-free edition exists". What is known:

- **Kobo** shows each book's DRM status near the bottom of its store page ("DRM-Free"), and
  DRM-free purchases download from the account's library page (user reports, not official docs).
- **Amazon**: since 20 January 2026, verified buyers of DRM-free Kindle Direct Publishing books
  can download EPUB/PDF from _Manage Your Content and Devices_. Older titles need the publisher
  to opt in. No product-page label was found.
- **Stores that only sell DRM-free books**: Smashwords (now part of Draft2Digital, mostly
  independent authors), Baen (its own titles, all DRM-free), Humble Bundle (bundles), Weightless
  Books. **Libreture** keeps a directory of DRM-free bookshops.
- **Google Play Books**: its API has `accessInfo.epub.isAvailable`, `downloadLink` and
  `acsTokenLink` (a link for an ACS token for the EPUB download; whether its presence reliably
  means Adobe DRM is _unverified_). Its "is this DRM-free" status can't be relied on from what
  was found.

### Metadata

| Source           | Findings                                                                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open Library** | No key needed. Limits: 1 request/s anonymous, 3 requests/s with a `User-Agent` naming the app and a contact email. Asks apps to cache, to use `search.json` rather than many single lookups, and not to use it as the backend of a high-traffic service. Covers come from `covers.openlibrary.org`. |
| **Google Books** | Better descriptions for recent books. Without an API key the daily quota is small and unpredictable (developers report 429s). A key committed to a GPL repository is public, so this could only be an option where readers paste their own key.                                                     |

## Recommendations

### 1. Find books

**Status (2026-10-25):** built (`src-tauri/src/catalog.rs`, `src/library/FindBooksSheet.tsx`),
with Project Gutenberg only. Its OPDS search lists a book's id, title and author; the download is
`/ebooks/<id>.epub3.images`, which redirects within www.gutenberg.org. Results show the first page
(25). Store links: Kobo, Baen and Weightless Books searches, Smashwords' home page (its search
now asks to log in) and Libreture's directory; Humble Bundle has no search to link to.

**Where:** under the library search results, a row **"Search online for ‘…’"**. It searches only
when tapped (keeps PLAN §8). Results open in a sheet: a bottom sheet on phones, a side sheet on
the desktop, like the other sheets.

**Results:**

- Each result shows the cover, title, author, year, language and source (Gutenberg / Standard
  Ebooks), with a **Download** button. Downloading adds the book to the folder, and "Added …"
  appears as for "Add books".
- Books already in the library are marked as such (match on title + author, since the
  fingerprint isn't known before download).
- When no free edition is found, say so honestly and offer store searches, for example:

  > No free edition found. Readlet can't tell whether a store's copy is DRM-free.
  > These stores sell only DRM-free books: [Smashwords] [Baen]…
  > Kobo shows "DRM-Free" on a book's page: [Search Kobo]

  Use plain links with no affiliate codes, opened in the browser through the opener plugin.

**Sources, in order:**

1. **Project Gutenberg** through its official OPDS search (check the query format first; move to
   OPDS 2 when Gutenberg makes it public, before the 2027 retirement).
2. **Standard Ebooks**: ask the project for catalogue access for Readlet (an open-source app).
   Until then, consider listing their edition when Open Library links to it (_unverified_).
3. **Open Library** search as a fallback for finding the work and its Gutenberg id
   (_unverified_ field names).

**Downloads in Rust, not the webview:**

- A host allowlist (gutenberg.org, standardebooks.org, plus whatever hosts they redirect to;
  check the redirects).
- A size cap, and the file must turn out to be a real book (`BookFormat::from_path` plus a ZIP /
  EPUB `mimetype` check).
- Written under a hidden temporary name and renamed when complete, like `Library::add_books`
  already does. Then `request_scan`, with `expectAddedFiles` in the UI so the toast isn't
  repeated.

### 2. Fill in details

**Where:** the **About this book** sheet (`src/library/BookDetailsSheet.tsx`) gets two buttons:

- **Edit details**: a form with title, authors, series and number, description, publisher,
  published date, language and identifier/ISBN, plus "Choose a cover…".
- **Find details online**: looks up Open Library, by ISBN when the book has one (see
  `formatIdentifier` in `src/lib/format.ts`), otherwise by title + author. The reader picks the
  right edition, then sees each field side by side (current vs. found) with a tick to apply it.
  Nothing is overwritten without being ticked. The cover is offered the same way.

Also a **Reset to the book's own details** action, since the extracted values stay in the index.

**Status (2026-10-25):** built: "Edit details", choosing a cover, "Find details online"
(`src-tauri/src/lookup.rs`, `src/library/EditDetailsForm.tsx`, `FindDetails.tsx`) and the reset.
The search asks for each work's best-matching edition; picking one fetches the edition (series,
publisher, date, language, ISBN, cover) and the work (description). Found values fill the form,
only those ticked, and nothing is saved until Save. A chosen cover's thumbnail is stored in this
device's `.readlet/devices/<id>/covers/`, and the record's `cover` detail points at it.

**Storage:**

- **Per-field values with a timestamp each** in the book's record in `.readlet/`:
  `details: { title: Stamped<Value>, … }` in `BookRecord` (`src-tauri/src/store/model.rs`), where
  a null value leaves the field blank. Two devices editing different fields then both keep their
  edits; the same field: the newest wins, as with status. A reset stores `detailsResetAt`, and
  edits from before it no longer apply.
- `merge_books` (`src-tauri/src/store/merge.rs`) builds the merged record field by field, so the
  new field has to be merged there explicitly. It doesn't come along on its own.
- **Apply the edits in Rust**, where `list_books` / `book_entry` build `BookEntry`. Several
  screens read the index entry directly (the reader's title, read-aloud's language, the Markdown
  export's front matter, the series grouping), so edits applied only in the library view would be
  missed elsewhere. Keep the extracted values available, for "Reset" and for showing what
  changed.
- A **cover** the reader picks or accepts is stored in `.readlet/` (so it syncs), and Rust makes
  the thumbnail and palette with `covers::store_cover` as it does for extracted covers. The book's
  aura then follows the new cover.

### Shared groundwork

- **One small HTTP client in Rust.** The core has none today. Use one with rustls so Android
  builds don't need OpenSSL (to check when picking the crate). It sends
  `User-Agent: Readlet/<version> (<contact>)` as Open Library asks, applies the host allowlist,
  times out, and caches lookups for the session.
- **Commands** such as `search_catalogs(query)`, `download_book(url)` and
  `lookup_metadata(query | isbn)`. The webview's CSP stays as it is. Cover thumbnails from search
  results come through Rust (or a narrowly widened `img-src`).
- **Settings and docs:** update the README's "only feature that uses the network" line, the
  Dictionary hint in Settings, and add decisions to PLAN §9.

## Decisions (open ones with my recommendation)

Taken while building (2026-10-25): 1 (only on tapping), 3 (the list in "Find books" above),
4 (only in `.readlet/`) and 6 (details first). Requests go through `src-tauri/src/net.rs`, which
follows redirects by hand and only to Open Library, the Internet Archive's cover servers and
www.gutenberg.org. The webview's `img-src` also allows those hosts, for result thumbnails.
Still open: 2 and 5.

1. **When to search online**: only on tapping "Search online" _(recommended)_, or automatically
   when a local search finds nothing, with a setting to turn that off.
2. **Standard Ebooks**: contact them about catalogue access for an open-source app
   _(recommended; a message can be drafted)_, or leave them out for now.
3. **Store links for paid books**: Kobo, Smashwords, Baen, Humble Bundle, Weightless Books, and
   Libreture's directory? Add or remove any.
4. **Where edits are stored**: only in `.readlet/` _(recommended)_, or also written into EPUB
   files (against the "never change book files" rule).
5. **Google Books** as an optional source using the reader's own key: later, if Open Library's
   descriptions turn out too thin.
6. **Order of work**: the details helper first _(recommended: it's useful offline for manual
   edits and builds the storage the lookups need)_, then finding books.

## Check first (needs network)

Before writing parsers, look at the real responses, for example:

```sh
# Gutenberg's OPDS search: confirm the query parameter and the entry/link format.
curl -sL 'https://www.gutenberg.org/ebooks/search.opds/?query=middlemarch' | head -c 3000

# Open Library search: confirm fields, ebook_access values, and any Gutenberg / Standard Ebooks ids.
curl -sA 'Readlet/0.1 (contact@example.org)' \
  'https://openlibrary.org/search.json?q=middlemarch&limit=3' | head -c 3000

# Open Library by ISBN.
curl -sA 'Readlet/0.1 (contact@example.org)' 'https://openlibrary.org/isbn/9780141439549.json'

# Standard Ebooks: a book page, to find the download link pattern, and whether OPDS 2 needs a login.
curl -sL 'https://standardebooks.org/ebooks/george-eliot/middlemarch' | grep -io 'href="[^"]*downloads[^"]*"' | head
curl -sI -H 'Accept: application/opds+json' 'https://standardebooks.org/feeds/opds'
```

Also confirm where Gutenberg's EPUB links redirect to, for the download allowlist.

## Sources

- Project Gutenberg, Offline Catalogs and Feeds: https://www.gutenberg.org/ebooks/offline_catalogs
- Project Gutenberg, access blocked page (robot rules): https://www.gutenberg.org/gutenberg/error403.html
- gutenbergr documentation (mirrors for bulk use): https://docs.ropensci.org/gutenbergr/
- Gutendex: https://github.com/garethbjohnson/gutendex
- py-gutenberg (Gutendex capacity note): https://pypi.org/project/py-gutenberg/1.0.2
- Standard Ebooks feeds: https://standardebooks.org/feeds
- Standard Ebooks, adding an OPDS feed: https://standardebooks.org/help/how-to-add-an-opds-feed-to-your-ereader
- Standard Ebooks, which file to use: https://standardebooks.org/help/how-to-use-our-ebooks
- standardebooks/tools issue #1016: https://github.com/standardebooks/tools/issues/1016
- Open Library APIs and rate limits: https://openlibrary.org/developers/api
- Open Library Search API: https://openlibrary.org/dev/docs/api/search
- Open Library FAQ: https://openlibrary.org/help/faq
- Open Library blog, integrations: https://blog.openlibrary.org/tag/open-library-features/
- Google Books API, volumes: https://developers.google.com/books/docs/v1/reference/volumes
- Google Books keyless quota reports: https://discuss.google.dev/t/where-to-start-google-books-api/162388
- Amazon DRM-free EPUB/PDF downloads: https://kindlepreneur.com/amazon-drm-epub-downloads/ and
  https://www.heise.de/en/news/Kindle-Amazon-allows-download-of-DRM-free-e-books-from-January-20-11119846.html
- Kobo DRM status on store pages (user report): https://lemmy.klein.ruhr/post/162332/705307
- DRM-free stores: https://libreture.com/bookshops/ and https://getbookshelves.app/guides/drm-free-ebook-stores/
- Foliate's OPDS catalogues: https://en.wikipedia.org/wiki/Foliate_(software)
