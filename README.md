# Readlet

E-reader for Linux and Android. Books are read from a folder, and progress, highlights and
reading stats are stored in that folder. Built with Tauri 2, React and
[foliate-js](https://github.com/johnfactotum/foliate-js).

![Library](docs/screenshots/library.webp)

## Features

- Library with search, sorting, series, reading status, shelves and book details
- Paginated or scrolled reader, two-page spreads, table of contents, in-book search, four
  themes, adjustable fonts and spacing
- Highlights in five colours, notes, bookmarks, Wiktionary lookup, Markdown export
- Reading stats: time, streaks, speed, goals
- Read-aloud through Speech Dispatcher (Linux) or the system text-to-speech engine (Android)
- PDF and comic zoom with a view lock
- Android: keep-awake while reading, volume keys for page turns, playback controls on the lock
  screen

Formats: EPUB, MOBI, AZW3, FB2, CBZ and PDF (experimental). DRM-protected books are not supported.

|                                                 |                                                 |
| ----------------------------------------------- | ----------------------------------------------- |
| ![Reader](docs/screenshots/reader.webp)         | ![Read-aloud](docs/screenshots/read-aloud.webp) |
| ![Highlights](docs/screenshots/highlights.webp) | ![Stats](docs/screenshots/stats.webp)           |

## Data

Book files are never modified. Reading data is stored in `.readlet/` inside the books folder:

```
.readlet/devices/<device-id>/
  books/<fingerprint>.json   progress, highlights, notes, bookmarks, status
  sessions/<year>.jsonl      reading sessions
  shelves.json, profile.json, resurfaced.jsonl, device.json
```

Each device writes only to its own directory and all of them are merged on read, so the folder
can be synced with Syncthing, Nextcloud or similar without conflicts. Books are identified by a
content fingerprint, so renaming or moving a file keeps its data. The SQLite index in the app
data directory is a cache and can be rebuilt from the folder.

## Install

CI builds a `.deb`, an `.rpm`, an AppImage and an Android APK (arm64) on every push to `main` and
publishes them as the `main-build` pre-release. Tags named `v<version>` publish a release.

**Linux:** read-aloud needs Speech Dispatcher and a voice (`sudo dnf install speech-dispatcher
espeak-ng` on Fedora). The AppImage does not install them.

**Android:** requires Android 11 or newer. Readlet reads books straight from a folder, so it
asks for _All files access_ on first start. Read-aloud uses the text-to-speech engine configured
in the system settings. The library is rescanned when the app returns to the foreground.

## Development

Requires Rust 1.88+, [bun](https://bun.sh) and Tauri's system libraries. On Fedora:

```sh
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel \
  librsvg2-devel libxdo-devel
sudo dnf group install c-development
```

```sh
git clone --recurse-submodules https://github.com/Mischou01/Readlet
cd Readlet
bun install
bun tauri dev                                   # run with hot reload
bun run check                                   # types, lint, formatting, UI tests
cargo test --manifest-path src-tauri/Cargo.toml
bun tauri build                                 # release build and packages
```

Android also needs the SDK, NDK and JDK 17+ ([prerequisites](https://v2.tauri.app/start/prerequisites/#android)),
with `ANDROID_HOME` and `NDK_HOME` set:

```sh
rustup target add aarch64-linux-android
bun tauri android dev                           # device or emulator
bun tauri android build --apk --target aarch64  # release APK
```

The Android project is checked in at `src-tauri/gen/android/`.

### Signing the APK

Android only updates an app with an APK signed by the same key. Create a key once:

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore readlet.keystore -alias readlet \
  -keyalg RSA -keysize 4096 -validity 10000
```

For CI, set the repository secrets `ANDROID_KEYSTORE` (`base64 -w0 readlet.keystore`) and
`ANDROID_KEYSTORE_PASSWORD`; without them the APK is built but not published. For local release
builds, create `src-tauri/gen/android/keystore.properties` (git-ignored):

```properties
storeFile=/path/to/readlet.keystore
keyAlias=readlet
password=YOUR_PASSWORD_HERE
```

### Layout

| Path                     | Contents                                       |
| ------------------------ | ---------------------------------------------- |
| `src-tauri/src/`         | Rust core: library, store, index, TTS, Android |
| `src-tauri/gen/android/` | Android project and Kotlin code                |
| `src/`                   | UI: library, reader, highlights, stats         |
| `vendor/foliate-js/`     | foliate-js (git submodule)                     |
| `docs/PLAN.md`           | Design, architecture and decisions             |

Book content is rendered in sandboxed iframes under a strict CSP (`src/reader/csp.ts`) that
blocks scripts, forms, frames and remote resources. The webview reads books only through the
`book://` protocol, which serves indexed files.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

Includes foliate-js (MIT) and pdf.js (Apache-2.0); Figtree, Literata, Newsreader and Atkinson
Hyperlegible Next (SIL OFL); Lucide icons (ISC).
