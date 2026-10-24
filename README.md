# Readlet

An e-reader for Linux and Android. It opens books from a folder you choose and keeps your
progress, highlights and reading stats in that folder. Built with Tauri 2, React and
[foliate-js](https://github.com/johnfactotum/foliate-js); developed on Fedora with GNOME (Wayland).

![The library](docs/screenshots/library.webp)

## Features

- **Library:** grid or list, search, sorting (including by series, grouped under each series'
  name), reading status (reading, to read, finished) and shelves. Each book has a details sheet
  with its description, series, publisher, dates and file. Follows the folder as files are added
  or removed; files dropped on the window are copied into it. Books can be deleted, after asking:
  to the trash on Linux, for good on Android.
- **Reader:** paginated or scrolled, two-page spreads on wide windows, table of contents, search
  and footnote popovers. Four themes, with adjustable font, size, spacing and margins. Shows time
  left in the chapter, based on your reading speed in that book.
- **PDFs and comics:** zoom with the buttons, Ctrl and the scroll wheel, Ctrl +/−/0 or a pinch;
  fit the page or its width. Zoomed in, "next" scrolls down the page before turning it, and the
  view can be locked so it doesn't slide sideways or get pinched by accident, which keeps you in
  one column of a two-column PDF from page to page.
- **Annotations:** highlights in five colours, notes (shown on hover), and bookmarks you can
  name. Words can be looked up on Wiktionary, the only feature that uses the network, and only
  when you ask.
- **Highlights view:** all highlights from all books, filtered by book, shelf or colour, and
  searchable. Exports to Markdown, one file per book with YAML front matter.
- **Stats:** active reading time (idle time doesn't count), streaks, reading speed, and daily
  and yearly goals.
- **Read-aloud** through Speech Dispatcher on Linux and the system's text-to-speech on Android,
  from any point or for a selected passage only, with speed, voice and a sleep timer. On Android
  it keeps going with the screen off and has controls on the lock screen.
- **On Android**, the screen stays on while you read, until 5, 10 (the default) or 30 minutes
  after your last page turn or tap, or follows the phone's own timeout. The volume keys can turn
  pages (a setting).

Formats: EPUB, MOBI, AZW3, FB2 and CBZ; PDF support is experimental. DRM-protected books can't be
opened.

|                                                          |                                                 |
| -------------------------------------------------------- | ----------------------------------------------- |
| ![A note shown on hover](docs/screenshots/reader.webp)   | ![Read-aloud](docs/screenshots/read-aloud.webp) |
| ![The highlights view](docs/screenshots/highlights.webp) | ![Reading stats](docs/screenshots/stats.webp)   |

The books in the screenshots are public-domain editions from Project Gutenberg.

## Your data

Readlet doesn't rename, move or change book files, and deletes one only when you ask it to (to
the trash on Linux). Reading data is stored in a `.readlet/` folder inside the books folder:

```
.readlet/devices/<device-id>/
  books/<fingerprint>.json   progress, highlights, notes, bookmarks, status
  sessions/<year>.jsonl      reading sessions
  shelves.json, profile.json (goals), resurfaced.jsonl, device.json
```

Each device writes only to its own folder, and Readlet merges all of them when reading. The books
folder can therefore be synced with Syncthing, Nextcloud or similar without conflicts. On Android,
[Syncthing-Fork](https://f-droid.org/packages/com.github.catfriend1.syncthingfork/) (F-Droid)
syncs the folder with your other machines. Books are
identified by a fingerprint of their contents, so a renamed or moved file keeps its data, and so
does a deleted book that's added again. The
SQLite index in the app's data directory is a cache, rebuilt from the folder.

## Install

CI builds a `.deb`, an `.rpm`, an AppImage and an Android APK (arm64) on every push to `main`
and publishes them as the `main-build` pre-release on the Releases page. Tagging a commit
`v<version>` publishes a release of that version.

While a pull request is open, its latest Android build is the `test-build` pre-release, for trying
the change on a phone; it's removed when the pull request is merged or closed. It installs over
`main-build`, so install `main-build` again afterwards.

### Linux

Read-aloud needs Speech Dispatcher and a voice. On Fedora:

```sh
sudo dnf install speech-dispatcher espeak-ng
```

The AppImage needs no installation (`chmod +x` it and run it). It can't declare dependencies, so
install Speech Dispatcher yourself for read-aloud.

### Android

Android 11 or newer. Download the APK on the phone and open it; Android asks you to allow
installing apps from your browser or file manager first.

- **Files:** Readlet reads books straight from a folder, as on the desktop, so it asks for
  _All files access_ on first start. That's also why it isn't on the Play Store, which doesn't
  allow this permission for e-readers. Choose a folder on the phone's storage or SD card, such
  as `Books`.
- **Read-aloud** uses the phone's text-to-speech engine (Settings › Accessibility ›
  Text-to-speech): usually Speech Services by Google; RHVoice and eSpeak NG on F-Droid work too.
  Voices marked "online" send the text to the engine's servers.
- The library is rescanned whenever Readlet comes back to the foreground, which also picks up
  reading data synced from your other devices. Phones suspend apps in the background, so the
  desktop's live folder watching isn't used.

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

For Android you also need the Android SDK, the NDK and JDK 17 or newer
([Tauri's Android prerequisites](https://v2.tauri.app/start/prerequisites/#android)), with
`ANDROID_HOME` and `NDK_HOME` set. Then:

```sh
rustup target add aarch64-linux-android
bun tauri android dev                               # on a connected phone or an emulator
bun tauri android build --apk --target aarch64      # release APK
```

The Android project in `src-tauri/gen/android/` is checked in: it holds the Kotlin side of the
app (`ReadletPlugin.kt`, `Speech.kt`, `PlaybackService.kt`, `MainActivity.kt`) and the manifest.
Layouts follow the screen size, so most of the phone layout can be worked on in a desktop
browser's device mode; anything that calls the Rust core needs the app.

### Signing the APK

Android only installs signed APKs, and only updates an app with an APK signed by the same key.
Create a key once and keep it safe (if it's lost, the app has to be uninstalled before a build
signed with a new key will install):

```sh
keytool -genkeypair -v -storetype PKCS12 -keystore readlet.keystore -alias readlet \
  -keyalg RSA -keysize 4096 -validity 10000
```

For CI, add two repository secrets (Settings › Secrets and variables › Actions):
`ANDROID_KEYSTORE`, the output of `base64 -w0 readlet.keystore`, and
`ANDROID_KEYSTORE_PASSWORD`. Without them CI still builds the APK but doesn't publish it. For
local release builds, create `src-tauri/gen/android/keystore.properties` (it's ignored by git):

```properties
storeFile=/path/to/readlet.keystore
keyAlias=readlet
password=…
```

| Path                                                           | Contents                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `src-tauri/src/library/`                                       | Scanning, watching and fingerprinting the books folder   |
| `src-tauri/src/store/`                                         | Per-device data files and merging                        |
| `src-tauri/src/index.rs`                                       | SQLite index (a cache)                                   |
| `src-tauri/src/protocol.rs`                                    | `book://` and `cover://`, which serve indexed files only |
| `src-tauri/src/tts/`                                           | Read-aloud: Speech Dispatcher (SSIP) and Android TTS     |
| `src-tauri/src/android/`, `src-tauri/src/platform.rs`          | The bridge to the Kotlin side, and Android-only commands |
| `src-tauri/gen/android/`                                       | The Android project and its Kotlin code                  |
| `src/library/`, `src/reader/`, `src/highlights/`, `src/stats/` | The four views                                           |
| `src/reader/foliate.ts`, `src/reader/BookView.tsx`             | The only modules that use foliate-js                     |
| `src/lib/platform.ts`                                          | What differs on Android: insets, back gesture, lifecycle |
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
