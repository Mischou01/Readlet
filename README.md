# Readlet

A calm desktop e-reader for people who read a lot. Readlet opens the books you already have,
from a folder you already have, and keeps your progress, highlights and reading stats next to
them, so they travel with the folder.

Built with Tauri 2 (Rust) and React, with [foliate-js](https://github.com/johnfactotum/foliate-js)
doing the book layout. The first target is Fedora with GNOME on Wayland.

## Features

- **Library:** point Readlet at a folder and it keeps up with it as files come and go. Grid and
  list views, a "continue reading" hero, search, sorting, statuses (reading, to read, finished)
  and shelves. Drop files on the window to copy them into the folder.
- **Reader:** paginated or scrolled, with two-page spreads on wide windows. It has a table of
  contents, in-book search, footnote popovers and four reading themes (Paper, Sepia, Dusk and
  Night). You can set the font, size, spacing and margins, and the footer shows the time left in
  the chapter.
- **Highlights and notes** in five colours, plus bookmarks. Words can be looked up on Wiktionary;
  this is the only feature that goes online, and only when you ask.
- **Highlights hub:** every highlight from every book, filtered by book, shelf or colour, and
  searchable. Any highlight takes you back to its passage, or exports as Markdown for Obsidian:
  one file per book, with YAML front matter. The library also resurfaces an older highlight each
  day.
- **Stats and goals:** active reading time (idle time and an unfocused window don't count) and
  your streak, pace and minutes per reading day. There's a yearly goal in books or hours, a
  pebble calendar of the year and a daily goal.
- **Read-aloud** through Speech Dispatcher. It highlights the sentence being spoken, turns pages
  as it goes, and has speed, voice and a sleep timer.
- **Every book has an aura:** three soft colours from its cover tint the interface while you read
  it.

Formats: EPUB, MOBI, AZW3, FB2, CBZ, and PDF (experimental). Books with DRM can't be opened, and
Readlet says so instead of failing silently.

## Your data

Readlet never renames, moves or edits your books. Reading data lives in a `.readlet/` folder
inside your books folder:

```
.readlet/devices/<device-id>/
  books/<fingerprint>.json   progress, highlights, notes, bookmarks, status
  sessions/<year>.jsonl      reading sessions
  shelves.json, profile.json (goals), resurfaced.jsonl, device.json
```

Each device writes only to its own folder, and Readlet merges every device's files when it reads
them. That means you can sync the books folder with Syncthing, Nextcloud or similar without
creating conflicts. Books are recognised by a fingerprint of their contents, so renaming or
moving a file keeps its data. The SQLite index in the app's data directory is only a cache;
Readlet rebuilds it from the folder.

Nothing is sent anywhere. There are no accounts and no telemetry.

## Install

Linux packages (`.rpm`, `.deb`) are built by CI on every push to `main` and published as the
`main-build` pre-release on the repository's Releases page, replacing the previous build.

For read-aloud, install Speech Dispatcher and a voice, for example on Fedora:

```sh
sudo dnf install speech-dispatcher espeak-ng
```

## Development

You need Rust (1.88 or newer), [bun](https://bun.sh), and Tauri's system libraries. On Fedora:

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
bun tauri dev          # run the app with hot reload
bun run check          # types, lint, formatting and unit tests for the UI
cargo test --manifest-path src-tauri/Cargo.toml
bun tauri build        # release build and packages
```

Where things are:

| Path                                                           | What                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `src-tauri/src/library/`                                       | Scanning, watching and fingerprinting the books folder   |
| `src-tauri/src/store/`                                         | The per-device data files and how they merge             |
| `src-tauri/src/index.rs`                                       | The SQLite index (a cache)                               |
| `src-tauri/src/protocol.rs`                                    | `book://` and `cover://`, which serve indexed files only |
| `src-tauri/src/tts/`                                           | A small Speech Dispatcher (SSIP) client                  |
| `src/library/`, `src/reader/`, `src/highlights/`, `src/stats/` | The four views                                           |
| `src/reader/foliate.ts`, `src/reader/BookView.tsx`             | The only modules that touch foliate-js                   |
| `vendor/foliate-js/`                                           | foliate-js, pinned as a git submodule                    |
| `docs/PLAN.md`                                                 | Goals, design, architecture, decisions and status        |

### Security

Book pages run in iframes with a strict Content Security Policy (`src/reader/csp.ts`). Scripts,
forms, frames and remote resources in a book are blocked, and the app's own CSP blocks scripts
too. The webview reaches books only through `book://`, which serves files that are in the
index; it has no general filesystem access.

## License

Readlet is free software: you can redistribute it and/or modify it under the terms of the GNU
General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. See [LICENSE](LICENSE).

Readlet includes or uses:

- foliate-js (MIT), which includes pdf.js (Apache-2.0)
- Figtree, Literata, Newsreader and Atkinson Hyperlegible Next (SIL Open Font License)
- Lucide icons (ISC)
