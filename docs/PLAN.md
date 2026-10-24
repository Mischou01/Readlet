# Readlet — plan

An e-reader for people who read a lot: a calm, modern library and reader, plus reading stats, a
highlights hub and read-aloud.
Primary target: Fedora 44, GNOME on Wayland; Android 11+ from the same code (§12). Windows and
macOS later from the same Tauri build.

This is the living plan. Update **Status** and the **Decisions log** whenever either changes.

## Status

| Milestone | State |
| --- | --- |
| Planning | **done** (2026-10-22) |
| M0 Scaffold | **done** |
| M1 Library | **done** |
| M2 Reader | **done** |
| M3 Annotations | **done** (Wiktionary only; offline StarDict dictionaries not started) |
| M4 Highlights hub | **done** |
| M5 Stats & goals | **done** |
| M6 Read-aloud | **speech-dispatcher done**; Piper voices and the download manager not started |
| M7 Polish & ship | **mostly done**: open-book transition, reduce transparency, onboarding and empty states, PDF (experimental), app icon, RPM, DEB and AppImage (CI). Windows builds not started |
| M8 Android | **built, not yet tried on a phone**: phone layout, touch, back gesture, All files access, read-aloud with lock-screen controls, catch-up on resume, keeping the screen on, volume-key page turns, signed APK in CI (§12) |
| Library and reading extras (2026-10-24) | **done**: book details, deleting books, series grouping, zoom and view lock for PDFs and comics (§6, D23–D26). Checked in Chromium at desktop and phone sizes with a mocked core; not yet on a phone or in WebKitGTK |

Checked in the running app (headless X11 on Linux, WebKitGTK 2.52):

- Library: indexing, the aura and the hero, the DRM notice, and drag and drop
- Reader: page turns, the toolbar, contents, search, text settings, themes and the open-book
  transition
- Annotations: highlights, notes and bookmarks, written to disk
- The highlights hub, including going back to a passage
- Stats, and saving goals
- Read-aloud with sentence sync through to the next chapter
- Book security, with an adversarial EPUB: scripts, inline handlers, forms, frames and remote
  images are all blocked

Automated: 96 Rust tests (fingerprints, scanning and watching, deleting, the index, the store and
its merge rules, `book://`, the SSIP client, the Android events, the aura, covers, settings and
command validation) and 92 Vitest tests (library model and series, highlights and Markdown export,
stats, resurfacing, TOC labels, CSP, zoom, formatting).
CI runs both on every push.

Not yet measured against the milestone criteria:

- M1: a 500-book folder indexing in under 2 minutes. Only an 11-book folder has been tried.
- M2/M3: reading on a second machine through a synced folder. The merge rules are unit-tested.
- M5: minutes shown against a stopwatch-timed session.
- M6: a full chapter with real audio output. It was tested against a null audio device.

## Next session (start here)

1. Install the APK on a phone and go through §12's checklist; nothing Android-specific has run on a
   device yet (the build environment had no emulator).
2. Try a real install on Fedora (`bun tauri build`, then install the RPM) and run through the
   unchecked criteria above.
3. Piper voices (open question 3), then offline dictionaries.
4. Windows builds; re-anchoring highlights when a book is replaced by a new edition.
5. Optional in-app sync over WebDAV (open question 6).
6. Finding books online and filling in book details: research, recommendations and open
   decisions are in [ONLINE.md](ONLINE.md).

Known issue: when the reader closes, foliate-js's paginator can run a queued `requestAnimationFrame`
or `fonts.ready` callback after the view is destroyed. This logs a harmless `doc.documentElement`
TypeError. It's in the pinned vendor code, so it's left there rather than patched locally.

## 1. Goals and non-goals

Goals:
- Open the books you already have, from a folder you already have, without importing them anywhere.
- A reading view that gets out of the way, with typography and themes that are comfortable for hours.
- Show readers how much they have read and keep them coming back: stats and goals, a highlights hub, read-aloud.
- Everything stays local. Reading data syncs whenever the folder syncs (Syncthing, Nextcloud, …).

Non-goals:
- DRM-protected books (Kindle, Adobe ADEPT). They won't open, and the UI says why.
- A custom renderer: foliate-js does the layout.
- Accounts, a cloud service or a store.
- Editing books or converting formats (Calibre does that).
- AI features (not chosen for now).

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Shell | Tauri 2 (Rust) | Small binaries, real filesystem access, one UI for Linux/Windows/macOS, Android possible later |
| UI | React 19 + TypeScript + Vite, bun | Familiar from agentic-browser |
| State | Zustand | Small, no boilerplate |
| Styling | Plain CSS with custom properties + CSS Modules | Glass layers and per-book colour tokens are simplest as CSS variables |
| Motion | Motion (motion.dev) | The shared-element "open book" transition |
| Icons | Lucide | |
| Renderer | [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT), git submodule pinned to a commit | EPUB, MOBI, AZW3, FB2, CBZ; PDF experimental via pdf.js. Plain ES modules, no build step. Its README says to expect the API to change, so we pin a commit and keep it behind one wrapper |
| Index | SQLite (rusqlite, bundled) in the app data dir | A cache that can be rebuilt from the folder |
| Watching | notify + notify-debouncer-full | |
| Book identity | BLAKE3 over sampled chunks + file size | Survives renames and moves; fast on large files |
| Read-aloud | Rust: speech-dispatcher first, Piper neural voices next | WebKitGTK's `speechSynthesis` needs libspiel, which isn't installed here and has an open sandbox bug ([WebKit #280684](https://bugs.webkit.org/show_bug.cgi?id=280684)) |
| Audio | Speech Dispatcher's output for now; rodio when Piper arrives (D16) | |

## 3. Architecture

```
┌─────────── WebView (React) ───────────┐          ┌────────────── Rust core ──────────────┐
│ Library   Reader   Highlights   Stats │  invoke  │ library   scan, watch, fingerprint    │
│                                       │ ───────► │ index     SQLite cache                │
│ <BookView> wraps foliate-js           │ ◄─────── │ store     per-device JSON / JSONL     │
│   fetch("book://<id>") → File         │  events  │ tts       synth queue + playback      │
└───────────────────────────────────────┘          │ book://   serves indexed books only   │
                                                   └───────────────────────────────────────┘
```

- Book bytes reach the webview only through a `book://<fingerprint>` protocol that serves files
  in the index. The webview gets no general filesystem access.
- Metadata (title, author, series, language, cover) is parsed in the webview by foliate-js, which
  is one parser for every format. Rust caches the result in SQLite, writes a cover thumbnail to the
  cache dir and stores the cover's aura palette (§5).
- Rust is the only process that writes reading data.

## 4. Data model (sync-safe by construction)

```
~/Books/                           your folder; Readlet never renames or moves your files
  Ursula K. Le Guin - The Dispossessed.epub
  …
  .readlet/
    devices/<device-id>/
      books/<fingerprint>.json     progress, bookmarks, highlights, notes, status
      shelves.json
      sessions/2026.jsonl          append-only reading sessions
      resurfaced.jsonl             which highlights were shown, and when
```

- Each device writes only its own `devices/<id>/` folder, so a sync tool never sees two machines
  editing the same file. Readlet merges everything on load:
  - progress: the newest `updatedAt` wins
  - highlights, notes, bookmarks and shelves: the union by id; the newest version of each wins; deletions are kept as tombstones
  - sessions: concatenated
- A highlight is stored as an EPUB CFI (from foliate-js) plus its text. If a book is replaced by a
  new edition, the text lets Readlet try to re-anchor it (best effort).
- Per-device UI settings (theme, fonts) live in the app config dir, not in the book folder.
- Deleting the SQLite index is safe: Readlet rebuilds it from the folder.

## 5. Design direction

Brief: modern, glassy, rounded and a little abstract. Colours should be soft and never aggressive:
warm-ish, but with an identity of its own (not Penultimate's).

**Every book has an aura.** When a book is indexed, Readlet takes three colours from its cover and
softens them. In OKLCH it fixes their lightness and caps their chroma, so no cover can make the UI
garish. It then blurs them into a slowly drifting colour field. The aura is the only colour in the
chrome. It blooms behind the book you're reading, tints the glass, colours progress bars and focus
rings, and dissolves when the page opens. The neutral base stays quiet, so the aura is the one bold
element.

### Palette

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| fog | `#EDE9EC` | `#1D1A24` | App background: rose-tinted grey, not cream |
| ink | `#2E2A3B` | `#ECE7F1` | Text, primary buttons |
| haze | `#7C7689` | `#9C96A8` | Secondary text |
| glass | `rgba(255,255,255,.58)`, 24px blur | `rgba(42,38,54,.55)` | Floating surfaces |
| aura 1–3 | per book, OKLCH L≈0.80, C≤0.07 | L≈0.45, C≤0.07 | Glows and tints |
| accent | per book, OKLCH L≈0.55, C≤0.11 | L≈0.75 | Progress, focus, toggles (≥ 3:1 on fog) |

- Fallback aura (books with no cover): peach `#F2C4AE`, periwinkle `#B8C1EA`, sage `#C3D9C9`.
- Highlight colours: butter `#F3E2A0`, peach `#F5C9B4`, mint `#BEE3D0`, sky `#C3D7F3`, lilac `#D8CDF0`.
- Reading themes. The page is always opaque, never glass:
  - Paper `#F8F7F4` / `#2B2833`
  - Sepia `#F1E7D6` / `#4A3B2A`
  - Dusk `#2A2735` / `#E3DDEA`
  - Night `#121016` / `#C9C3D1`
  - Follow system

### Type

- UI: Figtree (OFL, variable), in sentence case throughout with no all-caps labels.
- Reading: Literata (the default), Source Serif 4, Atkinson Hyperlegible Next, the publisher's
  fonts or any system font. All are bundled with the app, with no font CDN.
- Reading defaults: 19px, line height 1.6, at most about 66 characters per line, hyphenation on
  when text is justified.

### Shape and material

- Radii scale with size: the dock and chips are fully round, sheets 28px, popovers 18px and covers
  8px (covers should still look like books).
- Glass is used only for things that float: the dock, the reader toolbar and side sheets. It is
  never used for the page or for a grid of cards. Menus, popovers and toasts are nearly opaque
  without blur, and glass is kept fairly opaque, because heavy transparency hurt legibility.
- Shadows are tinted with ink, large and soft, with one elevation per layer. Glass gets a 1px
  highlight along its top inner edge.
- A "Reduce transparency" setting swaps glass for solid tinted surfaces. Readlet also falls back to
  it automatically if blur turns out slow in WebKitGTK.

### Motion

- One signature moment: opening a book. The cover grows from the grid into the page while the
  aura dissolves.
- All other motion responds to the reader's input: sheets slide in, the toolbar slides away after
  2 s of stillness, and page turns slide (or are instant). With `prefers-reduced-motion`,
  everything becomes a crossfade.
- Nothing that carries a backdrop blur fades its own opacity. Fading glass (or its ancestors) is
  the likely cause of a flicker seen at the end of transitions, as the blur pops back in. Views
  cross-fade with a curtain laid over them instead, and sheets only slide.
- Nothing animates forever. The aura is a still colour field with soft edges (masks, not
  `filter: blur`), because the drifting blurred blobs kept the CPU busy (over 200% in testing).

### Layout

Library:
```
╭────────────────────────────────────────────────────────────────────╮
│ ░░▒▒▓ aura of the book you're reading ▓▒▒░░                ⌕   ⚙   │
│  ╭───────╮                                                         │
│  │       │  The Dispossessed                                       │
│  │ cover │  Ursula K. Le Guin                                      │
│  │       │  Chapter 4, 18 min left              ( Resume )         │
│  ╰───────╯  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━──────────────            │
│                                                                    │
│  Reading   To read   Finished   Shelves ▾                Recent ▾  │
│  ▯  ▯  ▯  ▯  ▯  ▯  ▯  ▯                                            │
│  ▯  ▯  ▯  ▯  ▯  ▯  ▯  ▯       covers sit on the fog, no cards      │
│                                                                    │
│              ╭─( Library   Highlights   Stats )─╮   glass dock     │
╰────────────────────────────────────────────────────────────────────╯
```

Reader (chrome stays hidden until the pointer moves, the reader taps, or presses Esc):
```
╭────────────────────────────────────────────────────────────────────╮
│  ╭─ ←   The Dispossessed ─────────────── ☰   ⌕   Aa   ◐   🔊 ─╮    │
│  ╰─────────────────────────────────────────────────────────────╯   │
│                                                                    │
│                 text column, ≤ 66 characters wide       ╭───────╮  │
│                                                         │ glass │  │
│                                                         │ sheet │  │
│                                                         ╰───────╯  │
│  18 min left in chapter                                      62%   │
╰────────────────────────────────────────────────────────────────────╯
```

Stats: the year is a field of rounded pebbles, one per day. Each pebble is sized by minutes read and
tinted with the aura of that day's main book. The streak and the goal ring sit above it.

### Review against the brief

- I dropped a fixed lilac accent. Glass plus purple is the stock glassmorphism look; taking colour
  from each book's aura makes the UI change with what you read.
- I dropped cream and terracotta. That's Penultimate, and it's also the most common generated look.
- Covers sit directly on the fog rather than inside glass cards, which avoids the rounded-card-grid
  template.

## 6. Features

**Library:**
- Folder picker and live watching
- Grid and list views
- A "continue reading" hero
- Search by title or author, and sorting
- Statuses: reading, to read, finished
- Shelves and series grouping: sorting by series puts each series under its name, in reading
  order, and the books in none under "Not in a series"
- Drag and drop to add a book (it is copied into the folder)
- A details sheet per book: cover, series, status and progress, description, publisher, dates,
  identifier and file
- Deleting books, after asking: to the trash on the desktop, for good on Android (D23)

**Reader:**
- Paginated or scrolled, with a two-page spread on wide windows
- Table of contents and bookmarks
- Highlights in five colours, with notes
- In-book search. foliate-js search is slow, so results stream in.
- Footnote popovers
- Dictionary lookup: Wiktionary online, which sends the word to Wikimedia; offline StarDict
  dictionaries via foliate-js `dict.js`
- Keyboard, mouse wheel and touchpad
- Typography and themes
- Time left in the chapter and the book, based on your measured reading speed
- Page-based books (PDF, CBZ, fixed-layout EPUB) zoom: fit page, fit width, or 125–400% of the
  fit-page size, by buttons, Ctrl+wheel, Ctrl +/−/0 or a pinch. Zoomed in, "next" scrolls a
  screen before it turns the page, and a page turned to keeps the horizontal position. A view
  lock (offered only while zoomed) stops sideways panning and pinching (D24, D25). Reflowable
  books have text size instead

**Stats and goals (extra):**
- Active-time sessions: a session pauses after 2 minutes idle or when the window loses focus
- Daily minutes, streak, words per minute and time per book
- A yearly goal, in books or minutes
- The pebble calendar

**Highlights hub (extra):**
- Every highlight from every book in one place
- Filter by book, colour or shelf, plus full-text search
- Jump back to the passage in the book
- Markdown export: one Obsidian-friendly file per book, with front matter
- Resurface: each day the library shows three older highlights, favouring ones not shown recently

**Read-aloud (extra):**
- Synthesis goes sentence by sentence; the current sentence is highlighted and pages turn automatically
- Speed, voice and a sleep timer
- foliate-js `tts.js` provides SSML with sentence marks. Rust synthesises one sentence ahead to
  avoid gaps and emits "now speaking k".

## 7. Milestones

Each milestone is checked in the running app. Rust unit tests cover fingerprinting, the merge
rules and session accounting; Vitest covers the UI logic. Test books come from Standard Ebooks
(clean EPUB 3) and Project Gutenberg (messier files).

| | Scope | Done when |
| --- | --- | --- |
| M0 Scaffold | Tauri 2 + React + TS + Vite via bun; foliate-js submodule; design tokens; open an EPUB from a file dialog | `bun tauri dev` opens a book and the arrow keys turn pages |
| M1 Library | Folder picker, scan and watch, fingerprints, metadata/cover/aura extraction, SQLite index, `book://`, library grid with the hero | A 500-book folder indexes in under 2 min the first time and opens instantly after that; adding or removing a file updates the grid live |
| M2 Reader | Auto-hiding toolbar, table of contents, progress save/restore with per-device files and merge, typography, themes, spreads, input, search, footnotes, time left | Reopening a book returns to the exact spot, including on a second machine through a synced folder |
| M3 Annotations | Selection menu, highlights, notes, bookmarks, dictionary | Highlights survive a restart and appear on the second machine after sync |
| M4 Highlights hub | List, filters, search, jump back, Markdown export, resurfacing | The exported Markdown opens cleanly in Obsidian |
| M5 Stats & goals | Session tracking, stats page, pebbles, goal | Minutes shown match a timed reading session to within 1 min |
| M6 Read-aloud | speech-dispatcher pipeline with sentence sync, then Piper voices and a download manager | A chapter plays through with no audible gaps and the highlight stays in sync |
| M7 Polish & ship | Open-book transition, reduce transparency, onboarding and empty states, PDF (if question 4 says yes), RPM and AppImage, Windows build | A fresh install guides you from choosing a folder to reading in under 30 s |

## 8. Engineering rules

- foliate-js is imported only by `src/reader/foliate.ts` and `src/reader/BookView.tsx`. Bump the
  pinned commit deliberately and re-test M2/M3 when you do.
- In the library folder, Rust writes only inside `.readlet/` and the books copied in by drag and drop,
  and deletes only book files the reader chose to delete (D23).
- Network access happens only on an explicit action (a dictionary lookup, a voice download). No telemetry.
- Tauri capabilities give each window the minimum it needs.
- Never log book text, highlight text or notes.

## 9. Decisions log

| # | Decision | Source |
| --- | --- | --- |
| D1 | Tauri 2 desktop app | User, 2026-10-22 |
| D2 | Watched-folder library; books stay where they are | User, 2026-10-22 |
| D3 | Extras: stats and goals, highlights hub, read-aloud. No AI companion for now | User, 2026-10-22 |
| D4 | Look: modern, glassy, rounded, a little abstract, soft colours; not modelled on Penultimate | User, 2026-10-22 |
| D5 | foliate-js as the renderer, vendored as a pinned submodule (no npm release; unstable API) | 2026-10-22 |
| D6 | Per-device data folders so sync never produces conflicts | 2026-10-22 |
| D7 | Read-aloud in Rust, not the Web Speech API (libspiel not installed; WebKit sandbox bug) | 2026-10-22 |
| D8 | Metadata parsed by foliate-js in the webview and cached by Rust | 2026-10-22 |
| D9 | `book://` protocol serving indexed files, instead of an asset-protocol folder scope | 2026-10-22 |
| D10 | A per-book aura is the only colour source in the chrome (§5) | 2026-10-22 |
| D11 | Reading data lives in the book folder (`.readlet/`), so it syncs with the books | User, 2026-10-22 |
| D12 | License: GPL-3.0-or-later | User, 2026-10-22 |
| D13 | PDF is supported and labelled experimental | User, 2026-10-22 |
| D14 | Read-aloud talks to Speech Dispatcher with a small SSIP client of our own, rather than a crate, to get index-mark events for sentence sync | 2026-10-22 |
| D15 | Every book page gets a strict CSP (no scripts, forms, frames or remote resources) in addition to the app's own CSP | 2026-10-22 |
| D16 | Audio goes through Speech Dispatcher's own output, so rodio isn't needed until Piper | 2026-10-22 |
| D17 | Android through Tauri 2's mobile support, from the same Rust core and UI. Distributed as an APK (one arm64 build per release), not on the Play Store | User, 2026-10-23 |
| D18 | On Android, "All files access" (MANAGE_EXTERNAL_STORAGE) so the core reads the folder by path like on desktop; hence minSdk 30. The Storage Access Framework would mean rewriting scanning and the store around content URIs | 2026-10-23 |
| D19 | No folder watching on Android: the core rescans and diffs other devices' files when the app returns to the foreground | 2026-10-23 |
| D20 | Android read-aloud uses the system TextToSpeech, one utterance per sentence (it can't report SSML marks); the Rust core splits the SSML, so the UI's read-aloud logic is shared | 2026-10-23 |
| D21 | A media-playback foreground service runs while read-aloud is open (playing or paused): it keeps the process and WebView alive with the screen off and carries the lock-screen controls | 2026-10-23 |
| D22 | Layout follows the screen width (≤ 640px is a phone), not the platform; platform checks are only for what the system provides (back gesture, insets, permissions) | 2026-10-23 |
| D23 | Deleting a book moves the file to the trash on the desktop (the `trash` crate) and deletes it on Android, which has no trash for files; reading data stays, so the book picks up where it was if it comes back. The index forgets it at once so the scan that follows has nothing to announce | User, 2026-10-24 |
| D24 | Zoom only for page-based books; reflowable books have text size. Zoom is a factor of the fit-page size, applied through foliate's `zoom` attribute on `<foliate-fxl>`, and kept per open book (not saved) | User, 2026-10-24 |
| D25 | The view lock is offered only while zoomed in: it stops sideways panning and pinching, and keeps the column across page turns | User, 2026-10-24 |
| D26 | Android keeps the screen on while reading (`FLAG_KEEP_SCREEN_ON`) until a set time after the last page turn or tap: System, 5, 10 (default) or 30 minutes. Volume keys turn pages when the setting is on, except while reading aloud, when they set the volume | User, 2026-10-24 |

## 10. Open questions

1. ~~Where should reading data live?~~ In the book folder (D11).
2. ~~License?~~ GPL-3.0-or-later (D12).
3. How to integrate Piper (an M6 spike): libpiper via FFI, a bundled `piper` binary, or piper-rs.
   Piper moved to [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) (GPL-3.0) after
   rhasspy/piper was archived in October 2025. In the meantime, Readlet uses whatever Speech
   Dispatcher's output module provides, so a Piper module configured there should work as is
   (not yet tried).
4. ~~PDF?~~ Yes, labelled experimental (D13).
5. ~~Android?~~ Yes, via Tauri 2 (D17–D22, §12).
6. In-app sync over WebDAV (Nextcloud, a home server, kDrive), so phones don't need a sync app.
   Each device writes only its own folder, so it would be "upload mine, download the others".
   Until then: Syncthing-Fork on Android, or FolderSync for Google Drive.

## 11. References

- foliate-js: https://github.com/johnfactotum/foliate-js
- Tauri 2 prerequisites: https://v2.tauri.app/start/prerequisites/
- WebKitGTK speech synthesis via libspiel: https://bugs.webkit.org/show_bug.cgi?id=270742
- WebKitGTK sandbox hides speech providers: https://bugs.webkit.org/show_bug.cgi?id=280684
- Piper (GPL fork): https://github.com/OHF-Voice/piper1-gpl
- Standard Ebooks: https://standardebooks.org

## 12. Android

The same Rust core and UI, in Tauri's Android shell (`src-tauri/gen/android`, checked in).

What's different:

- **Files.** "All files access" (D18). The first run asks for it; it's checked again whenever the
  app returns, since it can be revoked in Settings. The folder picker is the system's tree picker,
  converted back to a path (primary storage and SD cards only). "Add books" copies picked
  documents through the app's cache.
- **Keeping up with the folder.** No watcher (D19). On resume the core rescans and compares
  snapshots of other devices' files in `.readlet/` (`Store::snapshot`, `changes_between`).
- **Read-aloud** (D20, D21). `Speech.kt` queues one utterance per sentence and reports each start
  as a mark; `PlaybackService.kt` holds audio focus and a wake lock, pauses for calls and unplugged
  headphones, and turns the notification, lock screen and headset buttons into `tts:remote`
  events. Pausing still stops and restarts the sentence, as on desktop.
- **Lifecycle.** Android may stop a backgrounded app without warning, so the reader saves progress
  and checkpoints the session when the page is hidden (`app:suspended` and `visibilitychange`).
- **Phone layout** (D22). Bottom navigation dock; bottom sheets that can be pulled down; the
  reader's tools at the bottom; selection and highlight bars docked at the bottom; taps on the
  outer 30% of the page turn it; a highlight's note shows on tap. The status and navigation bars
  hide while reading and the page keeps clear of them (stable insets, so hiding them never
  reflows the text).
- **Screen and volume keys** (D26). While the reader is open, `MainActivity` turns the volume
  keys into `reader:page-key` events (if the setting is on), and the window keeps the screen on
  until the chosen time after the last page turn or tap.
- **Back gesture.** Acts as Escape (closing whatever is on top), then goes back to the library,
  then sends the app to the background.
- **Selection menu.** The system's floating Copy/Share menu is emptied for book text, where
  Readlet's own bar covers it; text fields keep cut and paste (`MainActivity.kt`).

Checked so far: the Rust core builds and passes clippy for `aarch64-linux-android`; the APK builds
(debug and signed release); the UI was checked in Chromium (Android's WebView engine) at phone size
with an Android user agent and a mocked core, for every view, sheet and bar.

Not yet checked on a device (do these first):

1. First run: the access prompt, picking `Books`, scanning, covers.
2. Reading: swipes and taps, selection by long press (no system menu over Readlet's bar), notes on
   tap, the back gesture everywhere, system bars hiding and coming back, the keyboard over the note
   dialog.
3. Read-aloud with the screen off through a chapter change, the lock-screen controls, a phone call
   and unplugging headphones.
4. The screen staying on while reading and turning off after the chosen time; the volume keys
   turning pages (and setting the volume while reading aloud); pinching a PDF and a comic;
   deleting a book.
5. Progress after the app is swiped away; data from another device after Syncthing syncs while
   Readlet is in the background.
6. Memory, battery and cold start on a mid-range phone.
