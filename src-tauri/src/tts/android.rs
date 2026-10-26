//! Read-aloud through Android's text-to-speech (`ReadletPlugin.kt` does the speaking).
//!
//! Android's engines can't report SSML marks, so each sentence is queued as an utterance of its
//! own, tagged with its mark; the plugin reports each one as it starts (see `segments`). It also
//! runs a foreground service while reading, so speech carries on with the screen off, and shows
//! the lock-screen controls.

use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use super::segments::segments;
use super::{PlaybackSession, Voice};
use crate::android::Native;
use crate::error::{Error, Result};
use crate::protocol::cover_file;
use crate::state::AppState;

pub struct Speaker {
    /// Message ids, so the UI can tell current events from stale ones (as with Speech
    /// Dispatcher's own ids).
    next_message: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Utterance {
    mark: Option<String>,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeakArgs<'a> {
    message: u64,
    utterances: Vec<Utterance>,
    rate: f64,
    voice: Option<&'a str>,
    language: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionArgs<'a> {
    title: &'a str,
    chapter: Option<&'a str>,
    /// The cached cover thumbnail, for the notification and the lock screen.
    cover_path: Option<String>,
    playing: bool,
}

#[derive(Deserialize)]
struct Voices {
    voices: Vec<Voice>,
}

impl Speaker {
    pub fn new() -> Self {
        Self {
            next_message: AtomicU64::new(1),
        }
    }

    pub fn voices<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Vec<Voice>> {
        Ok(native(app)?.call::<Voices>("voices", ())?.voices)
    }

    pub fn speak<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        ssml: &str,
        speed: f64,
        voice: Option<&str>,
        language: Option<&str>,
    ) -> Result<u64> {
        let utterances = segments(ssml)
            .map_err(|e| Error::Tts(format!("couldn't read the passage: {e}")))?
            .into_iter()
            .map(|s| Utterance {
                mark: s.mark,
                text: s.text,
            })
            .collect();
        let message = self.next_message.fetch_add(1, Ordering::Relaxed);
        let rate = if speed.is_finite() {
            speed.clamp(0.5, 2.0)
        } else {
            1.0
        };
        native(app)?.call_unit(
            "speak",
            SpeakArgs {
                message,
                utterances,
                rate,
                voice,
                language,
            },
        )?;
        Ok(message)
    }

    pub fn stop<R: Runtime>(&self, app: &AppHandle<R>) -> Result<()> {
        native(app)?.call_unit("stopSpeaking", ())
    }

    pub fn set_session<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        session: Option<&PlaybackSession>,
    ) -> Result<()> {
        let native = native(app)?;
        let Some(session) = session else {
            return native.call_unit("endPlaybackSession", ());
        };
        // The cover the library shows, including one the reader chose.
        let cover_path = session
            .fingerprint
            .as_deref()
            .and_then(|fp| cover_file(&app.state::<AppState>(), fp))
            .map(|path| path.to_string_lossy().into_owned());
        native.call_unit(
            "setPlaybackSession",
            SessionArgs {
                title: &session.title,
                chapter: session.chapter.as_deref(),
                cover_path,
                playing: session.playing,
            },
        )
    }
}

fn native<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::State<'_, Native<R>>> {
    app.try_state::<Native<R>>()
        .ok_or_else(|| Error::Tts("the speech service isn't ready".into()))
}
