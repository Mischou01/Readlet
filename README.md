# Readlet

A desktop e-reader for Linux. It opens books from a folder you choose and keeps your progress,
highlights and reading stats in that folder. Built with Tauri 2, React and
[foliate-js](https://github.com/johnfactotum/foliate-js); developed on Fedora with GNOME (Wayland).

![The library](docs/screenshots/library.webp)

## Features

- **Library:** grid or list, search, sorting, reading status (reading, to read, finished) and
  shelves. Follows the folder as files are added or removed; files dropped on the window are
  copied into it.
- **Reader:** paginated or scrolled, two-page spreads on wide windows, table of contents, search
  and footnote popovers. Four themes, with adjustable font, size, spacing and margins. Shows time
  left in the chapter, based on your reading speed in that book.
- **Annotations:** highlights in five colours, notes (shown on hover), and bookmarks you can
  name. Words can be looked up on Wiktionary, the only feature that uses the network, and only
  when you ask.
- **Highlights view:** all highlights from all books, filtered by book, shelf or colour, and
  searchable. Exports to Markdown, one file per book with YAML front matter.
- **Stats:** active reading time (idle time doesn't count), streaks, reading speed, and daily
  and yearly goals.
- **Read-aloud** through Speech Dispatcher, from any point or for a selected passage only, with
  speed, voice and a sleep timer.

Formats: EPUB, MOBI, AZW3, FB2 and CBZ; PDF support is experimental. DRM-protected books can't be
opened.

|                                                          |                                                 |
| -------------------------------------------------------- | ----------------------------------------------- |
| ![A note shown on hover](docs/screenshots/reader.webp)   | ![Read-aloud](docs/screenshots/read-aloud.webp) |
| ![The highlights view](docs/screenshots/highlights.webp) | ![Reading stats](docs/screenshots/stats.webp)   |

The books in the screenshots are public-domain editions from Project Gutenberg.

## Your data

Readlet doesn't rename, move or change book files. Reading data is stored in a `.readlet/`
folder inside the books folder:

```
.readlet/devices/<device-id>/
  books/<fingerprint>.json   progress, highlights, notes, bookmarks, status
  sessions/<year>.jsonl      reading sessions
  shelves.json, profile.json (goals), resurfaced.jsonl, device.json
```

Each device writes only to its own folder, and Readlet merges all of them when reading. The books
folder can therefore be synced with Syncthing, Nextcloud or similar without conflicts. Books are
identified by a fingerprint of their contents, so a renamed or moved file keeps its data. The
SQLite index in the app's data directory is a cache, rebuilt from the folder.

## Install

CI builds `.rpm` and `.deb` packages on every push to `main` and publishes them as the
`main-build` pre-release on the Releases page.

Read-aloud needs Speech Dispatcher and a voice. On Fedora:

```sh
sudo dnf install speech-dispatcher espeak-ng
```

## Development

Requirements: Rust 1.88 or newer, [bun](https://bun.sh), and Tauri's system libraries. On Fedora:

```sh
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel \
  librsvg2-devel libxdo-devel
sudo dnf group install c-development
```

Then:

```sh
git clone --recurse-submodules https://github.com/Mischou01/Readlet
cd Readlet
bun install
bun tauri dev          # run with hot reload
bun run check          # types, lint, formatting and unit tests (UI)
cargo test --manifest-path src-tauri/Cargo.toml
bun tauri build        # release build and packages
```

| Path                                                           | Contents                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `src-tauri/src/library/`                                       | Scanning, watching and fingerprinting the books folder   |
| `src-tauri/src/store/`                                         | Per-device data files and merging                        |
| `src-tauri/src/index.rs`                                       | SQLite index (a cache)                                   |
| `src-tauri/src/protocol.rs`                                    | `book://` and `cover://`, which serve indexed files only |
| `src-tauri/src/tts/`                                           | Speech Dispatcher (SSIP) client                          |
| `src/library/`, `src/reader/`, `src/highlights/`, `src/stats/` | The four views                                           |
| `src/reader/foliate.ts`, `src/reader/BookView.tsx`             | The only modules that use foliate-js                     |
| `vendor/foliate-js/`                                           | foliate-js, pinned as a git submodule                    |
| `docs/PLAN.md`                                                 | Design, architecture and decisions                       |

### Security

Book content runs in iframes with a strict Content Security Policy (`src/reader/csp.ts`): scripts,
forms, frames and remote resources in books are blocked, and the app's own CSP blocks scripts as
well. The webview reaches books only through `book://`, which serves files that are in the index;
it has no general filesystem access.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

Readlet includes or uses:

- foliate-js (MIT), which includes pdf.js (Apache-2.0)
- Figtree, Literata, Newsreader and Atkinson Hyperlegible Next (SIL Open Font License)
- Lucide icons (ISC)
