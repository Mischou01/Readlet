# Readlet

E-reader for Linux and Android. Built with Tauri 2, React and
[foliate-js](https://github.com/johnfactotum/foliate-js).

![Library](docs/screenshots/library.webp)

## Features

- Library with search, sorting, series, shelves and reading status
- Formats: EPUB, MOBI, AZW3, FB2, CBZ and PDF (experimental); no DRM support
- Highlights, notes, bookmarks, Wiktionary lookup, Markdown export
- Reading stats and goals
- Read-aloud via Speech Dispatcher (Linux) or the system TTS engine (Android)

## Data

Readlet reads books from a folder and stores progress, highlights and stats in `.readlet/` inside
it. Each device writes only to its own subdirectory and all of them are merged on read, so the
folder can be synced with Syncthing, Nextcloud or similar. Book files are never modified.

## Install

Packages (`.deb`, `.rpm`, AppImage, Android APK) are published as the `main-build` pre-release on
the Releases page.

Read-aloud on Linux needs Speech Dispatcher and a voice (`sudo dnf install speech-dispatcher
espeak-ng` on Fedora). Android 11 or newer is required; the app asks for _All files access_ to
read the books folder.

## Development

Requires Rust 1.88+, [bun](https://bun.sh) and
[Tauri's system libraries](https://v2.tauri.app/start/prerequisites/).

```sh
git clone --recurse-submodules https://github.com/Mischou01/Readlet
cd Readlet
bun install
bun tauri dev                                    # run with hot reload
bun run check                                    # types, lint, formatting, UI tests
cargo test --manifest-path src-tauri/Cargo.toml
bun tauri build                                  # release build and packages
```

For Android, install the SDK, NDK and JDK 17+ and set `ANDROID_HOME` and `NDK_HOME`:

```sh
rustup target add aarch64-linux-android
bun tauri android dev
bun tauri android build --apk --target aarch64
```

See [docs/PLAN.md](docs/PLAN.md) for the architecture and [docs/SIGNING.md](docs/SIGNING.md) for
signing release APKs.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). Third-party licenses: foliate-js (MIT), pdf.js
(Apache-2.0), Figtree, Literata, Newsreader and Atkinson Hyperlegible Next (SIL OFL), Lucide
(ISC).
