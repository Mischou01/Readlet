//! Read-aloud through Speech Dispatcher (docs/PLAN.md D7).
//!
//! The webview turns each paragraph into SSML with a `<mark>` before every sentence (foliate-js
//! `tts.js`); Speech Dispatcher reports each mark as it's spoken, and Rust forwards those as
//! `tts:event`s so the UI can highlight the sentence and turn pages. WebKitGTK's own
//! `speechSynthesis` isn't usable on Fedora (it needs libspiel, and WebKit bug 280684).

#[cfg(unix)]
mod ssip;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::error::{Error, Result};

pub const EVENT: &str = "tts:event";

#[derive(Debug, Clone, Serialize, PartialEq)]
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
    /// begin, end, canceled, paused, resumed or mark
    pub kind: &'static str,
    pub message: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mark: Option<String>,
}

/// Maps a playback speed (0.5–2×) onto SSIP's rate scale (-100–100, 0 = the voice's default).
pub fn ssip_rate(speed: f64) -> i32 {
    let speed = if speed.is_finite() {
        speed.clamp(0.5, 2.0)
    } else {
        1.0
    };
    let rate = if speed >= 1.0 {
        (speed - 1.0) * 100.0
    } else {
        (speed - 1.0) * 200.0
    };
    rate.round() as i32
}

/// Voice and language names end up in SSIP command lines, so they must not contain line breaks.
fn safe_argument(value: &str) -> Option<&str> {
    let ok = !value.is_empty() && value.len() <= 100 && !value.chars().any(|c| c.is_control());
    ok.then_some(value)
}

#[cfg(unix)]
mod speaker {
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use super::ssip::{Connection, EventKind, SsipError};
    use super::*;

    impl From<SsipError> for Error {
        fn from(e: SsipError) -> Self {
            Error::Tts(e.to_string())
        }
    }

    /// Where Speech Dispatcher listens: `SPEECHD_ADDRESS`, else its default socket in the
    /// user's runtime directory. Like GLib's `g_get_user_runtime_dir()`, which the server uses,
    /// this falls back to the cache directory when `XDG_RUNTIME_DIR` isn't set.
    fn socket_path() -> Option<PathBuf> {
        if let Ok(address) = std::env::var("SPEECHD_ADDRESS") {
            return address.strip_prefix("unix_socket:").map(PathBuf::from);
        }
        let non_empty = |name: &str| std::env::var_os(name).filter(|v| !v.is_empty());
        let runtime = non_empty("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .or_else(|| non_empty("XDG_CACHE_HOME").map(PathBuf::from))
            .or_else(|| non_empty("HOME").map(|home| PathBuf::from(home).join(".cache")))?;
        Some(runtime.join("speech-dispatcher/speechd.sock"))
    }

    /// Starts Speech Dispatcher in autospawn mode (a no-op if it's already running).
    fn spawn_server() -> Result<()> {
        match Command::new("speech-dispatcher").arg("--spawn").status() {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(Error::Tts(
                "Speech Dispatcher isn't installed. On Fedora, install it with: sudo dnf install speech-dispatcher espeak-ng".into(),
            )),
            Err(e) => Err(Error::Tts(format!("couldn't start Speech Dispatcher: {e}"))),
        }
    }

    pub struct Speaker {
        connection: Mutex<Option<Connection>>,
    }

    impl Speaker {
        pub fn new() -> Self {
            Self {
                connection: Mutex::new(None),
            }
        }

        fn connect<R: Runtime>(app: &AppHandle<R>) -> Result<Connection> {
            let path = socket_path()
                .ok_or_else(|| Error::Tts("couldn’t find the Speech Dispatcher socket".into()))?;
            let handle = app.clone();
            let on_event = move |event: super::ssip::Event| {
                let (kind, mark) = match event.kind {
                    EventKind::Begin => ("begin", None),
                    EventKind::End => ("end", None),
                    EventKind::Canceled => ("canceled", None),
                    EventKind::Paused => ("paused", None),
                    EventKind::Resumed => ("resumed", None),
                    EventKind::Mark(name) => ("mark", Some(name)),
                };
                let _ = handle.emit(
                    EVENT,
                    TtsEvent {
                        kind,
                        message: event.message,
                        mark,
                    },
                );
            };
            let connection = match Connection::connect(&path, on_event.clone()) {
                Ok(c) => c,
                Err(_) => {
                    spawn_server()?;
                    let deadline = Instant::now() + Duration::from_secs(4);
                    loop {
                        match Connection::connect(&path, on_event.clone()) {
                            Ok(c) => break c,
                            Err(e) if Instant::now() >= deadline => return Err(e.into()),
                            Err(_) => std::thread::sleep(Duration::from_millis(150)),
                        }
                    }
                }
            };
            let mut connection = connection;
            connection.command(&format!("SET self CLIENT_NAME {}:readlet:main", whoami()))?;
            connection.command("SET self NOTIFICATION all on")?;
            connection.command("SET self SSML_MODE on")?;
            connection.command("SET self PRIORITY text")?;
            Ok(connection)
        }

        /// Runs `f` on a live connection, reconnecting once if the server went away.
        fn with<R: Runtime, T>(
            &self,
            app: &AppHandle<R>,
            f: impl Fn(&mut Connection) -> Result<T>,
        ) -> Result<T> {
            let mut guard = self.connection.lock().unwrap_or_else(|e| e.into_inner());
            for attempt in 0..2 {
                if guard.is_none() {
                    *guard = Some(Self::connect(app)?);
                }
                let Some(connection) = guard.as_mut() else {
                    continue;
                };
                match f(connection) {
                    Err(Error::Tts(message)) if attempt == 0 && is_connection_error(&message) => {
                        *guard = None;
                    }
                    result => return result,
                }
            }
            Err(Error::Tts("Speech Dispatcher stopped responding".into()))
        }

        pub fn voices<R: Runtime>(&self, app: &AppHandle<R>) -> Result<Vec<Voice>> {
            self.with(app, |c| {
                let reply = c.command("LIST SYNTHESIS_VOICES")?;
                Ok(reply
                    .lines
                    .iter()
                    .filter_map(|line| {
                        let mut parts = line.split('\t');
                        let name = parts.next()?.trim();
                        (!name.is_empty()).then(|| Voice {
                            name: name.to_owned(),
                            language: parts.next().unwrap_or("").trim().to_owned(),
                            variant: parts.next().unwrap_or("").trim().to_owned(),
                        })
                    })
                    .collect())
            })
        }

        pub fn speak<R: Runtime>(
            &self,
            app: &AppHandle<R>,
            ssml: &str,
            speed: f64,
            voice: Option<&str>,
            language: Option<&str>,
        ) -> Result<u64> {
            self.with(app, |c| {
                c.command("CANCEL self")?;
                c.command(&format!("SET self RATE {}", ssip_rate(speed)))?;
                if let Some(language) = language.and_then(safe_argument) {
                    // Unknown languages are refused; the default voice is better than nothing.
                    let _ = c.command(&format!("SET self LANGUAGE {language}"));
                }
                if let Some(voice) = voice.and_then(safe_argument) {
                    let _ = c.command(&format!("SET self SYNTHESIS_VOICE {voice}"));
                }
                Ok(c.speak(ssml)?)
            })
        }

        pub fn control<R: Runtime>(&self, app: &AppHandle<R>, command: &str) -> Result<()> {
            self.with(app, |c| c.command(command).map(|_| ()).map_err(Into::into))
        }
    }

    fn is_connection_error(message: &str) -> bool {
        message.contains("closed the connection")
            || message.contains("can't reach")
            || message.contains("Broken pipe")
    }

    fn whoami() -> String {
        std::env::var("USER")
            .ok()
            .filter(|u| safe_argument(u).is_some() && !u.contains(':') && !u.contains(' '))
            .unwrap_or_else(|| "user".into())
    }
}

#[cfg(unix)]
pub use speaker::Speaker;

/// Read-aloud isn't available on this platform yet.
#[cfg(not(unix))]
pub struct Speaker;

#[cfg(not(unix))]
impl Speaker {
    pub fn new() -> Self {
        Self
    }
    fn unavailable<T>() -> Result<T> {
        Err(Error::Tts(
            "read-aloud needs Speech Dispatcher, which this system doesn't have".into(),
        ))
    }
    pub fn voices<R: Runtime>(&self, _: &AppHandle<R>) -> Result<Vec<Voice>> {
        Self::unavailable()
    }
    pub fn speak<R: Runtime>(
        &self,
        _: &AppHandle<R>,
        _: &str,
        _: f64,
        _: Option<&str>,
        _: Option<&str>,
    ) -> Result<u64> {
        Self::unavailable()
    }
    pub fn control<R: Runtime>(&self, _: &AppHandle<R>, _: &str) -> Result<()> {
        Self::unavailable()
    }
}

// -- Commands ----------------------------------------------------------------------------------

use tauri::{Manager, State};

/// Speech Dispatcher calls block on the socket, so they run on the blocking pool.
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

#[tauri::command]
pub async fn tts_pause(app: AppHandle) -> Result<()> {
    blocking(app, |app, speaker| speaker.control(app, "PAUSE self")).await
}

#[tauri::command]
pub async fn tts_resume(app: AppHandle) -> Result<()> {
    blocking(app, |app, speaker| speaker.control(app, "RESUME self")).await
}

#[tauri::command]
pub async fn tts_stop(app: AppHandle) -> Result<()> {
    blocking(app, |app, speaker| speaker.control(app, "CANCEL self")).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_speed_to_ssip_rate() {
        assert_eq!(ssip_rate(1.0), 0);
        assert_eq!(ssip_rate(1.5), 50);
        assert_eq!(ssip_rate(2.0), 100);
        assert_eq!(ssip_rate(0.8), -40);
        assert_eq!(ssip_rate(0.5), -100);
        assert_eq!(ssip_rate(9.0), 100);
        assert_eq!(ssip_rate(f64::NAN), 0);
    }

    #[test]
    fn rejects_unsafe_arguments() {
        assert_eq!(safe_argument("en-GB"), Some("en-GB"));
        assert_eq!(safe_argument("Alba\r\nQUIT"), None);
        assert_eq!(safe_argument(""), None);
    }
}
