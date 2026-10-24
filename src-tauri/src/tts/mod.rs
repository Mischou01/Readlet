//! Read-aloud (docs/PLAN.md D7).
//!
//! The webview turns each paragraph into SSML with a `<mark>` before every sentence (foliate-js
//! `tts.js`). A platform backend speaks it and reports each mark as its sentence starts; Rust
//! forwards those as `tts:event`s so the UI can highlight the sentence and turn pages.
//!
//! - Linux: Speech Dispatcher (`speechd`). WebKitGTK's own `speechSynthesis` isn't usable on
//!   Fedora (it needs libspiel, and WebKit bug 280684).
//! - Android: the system text-to-speech, through the app's Kotlin plugin (`android`). It can't
//!   report SSML marks, so each sentence becomes an utterance of its own (`segments`).

#[cfg(target_os = "android")]
mod android;
#[cfg(any(target_os = "android", test))]
mod segments;
#[cfg(all(unix, desktop))]
mod speechd;
#[cfg(all(unix, desktop))]
mod ssip;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::error::{Error, Result};

#[cfg(target_os = "android")]
pub use android::Speaker;
#[cfg(all(unix, desktop))]
pub use speechd::Speaker;

pub const EVENT: &str = "tts:event";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    pub name: String,
    pub language: String,
    pub variant: String,
}

/// An event sent to the UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TtsEvent {
    /// begin, end, canceled, paused, resumed, mark or error
    pub kind: &'static str,
    pub message: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mark: Option<String>,
    /// Why speaking failed (`error` only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// What's being read aloud, for the system's media controls (the lock screen and notification on
/// Android). `playing` is false while paused.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSession {
    pub title: String,
    pub chapter: Option<String>,
    pub fingerprint: Option<String>,
    pub playing: bool,
}

/// Read-aloud isn't available on this platform yet.
#[cfg(not(any(target_os = "android", all(unix, desktop))))]
mod unavailable {
    use tauri::{AppHandle, Runtime};

    use super::{PlaybackSession, Voice};
    use crate::error::{Error, Result};

    pub struct Speaker;

    impl Speaker {
        pub fn new() -> Self {
            Self
        }
        pub fn voices<R: Runtime>(&self, _: &AppHandle<R>) -> Result<Vec<Voice>> {
            Err(Error::Unsupported("Read-aloud"))
        }
        pub fn speak<R: Runtime>(
            &self,
            _: &AppHandle<R>,
            _: &str,
            _: f64,
            _: Option<&str>,
            _: Option<&str>,
        ) -> Result<u64> {
            Err(Error::Unsupported("Read-aloud"))
        }
        pub fn stop<R: Runtime>(&self, _: &AppHandle<R>) -> Result<()> {
            Ok(())
        }
        pub fn set_session<R: Runtime>(
            &self,
            _: &AppHandle<R>,
            _: Option<&PlaybackSession>,
        ) -> Result<()> {
            Ok(())
        }
    }
}

#[cfg(not(any(target_os = "android", all(unix, desktop))))]
pub use unavailable::Speaker;

// -- Commands ----------------------------------------------------------------------------------

/// Speech calls block (on a socket, or on the Android side), so they run on the blocking pool.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&AppHandle, &Speaker) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || {
        let speaker: State<'_, Speaker> = app.state();
        work(&app, &speaker)
    })
    .await
    .map_err(|e| Error::Tts(format!("background task failed: {e}")))?
}

#[tauri::command]
pub async fn tts_voices(app: AppHandle) -> Result<Vec<Voice>> {
    blocking(app, |app, speaker| speaker.voices(app)).await
}

/// Starts speaking `ssml` (replacing anything being spoken) and returns its message id; events
/// for other ids are stale.
#[tauri::command]
pub async fn tts_speak(
    app: AppHandle,
    ssml: String,
    speed: f64,
    voice: Option<String>,
    language: Option<String>,
) -> Result<u64> {
    if ssml.len() > 2 * 1024 * 1024 {
        return Err(Error::invalid(
            "that passage is too long to read aloud at once",
        ));
    }
    blocking(app, move |app, speaker| {
        speaker.speak(app, &ssml, speed, voice.as_deref(), language.as_deref())
    })
    .await
}

/// Stops speaking. Pausing is a stop too: the UI resumes from the sentence it was on.
#[tauri::command]
pub async fn tts_stop(app: AppHandle) -> Result<()> {
    blocking(app, |app, speaker| speaker.stop(app)).await
}

/// Shows (or, with `null`, removes) read-aloud in the system's media controls.
#[tauri::command]
pub async fn tts_session(app: AppHandle, session: Option<PlaybackSession>) -> Result<()> {
    if let Some(fp) = session.as_ref().and_then(|s| s.fingerprint.as_deref())
        && !crate::library::fingerprint::is_valid(fp)
    {
        return Err(Error::invalid("invalid book id"));
    }
    blocking(app, move |app, speaker| {
        speaker.set_session(app, session.as_ref())
    })
    .await
}
