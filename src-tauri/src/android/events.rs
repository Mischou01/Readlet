//! Events from the Kotlin side, and where they go in the UI.

// Only the Android build forwards events; tests on other platforms check the parsing.
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};

use crate::platform::Insets;
use crate::tts::{self, TtsEvent};

/// A media control outside the app was used (the lock screen, the notification, a headset
/// button); payload: `RemoteAction`.
pub const REMOTE_EVENT: &str = "tts:remote";
/// The system bars or cutouts changed size (rotation, say); payload: `Insets`.
pub const INSETS_EVENT: &str = "system:insets";
/// A volume key turned the page (when that setting is on); payload: `PageDirection`.
pub const PAGE_KEY_EVENT: &str = "reader:page-key";

/// A read-aloud control used outside the app.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RemoteAction {
    Play,
    Pause,
    Toggle,
    Next,
    Previous,
    Stop,
}

/// Which way a key turns the page.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PageDirection {
    Next,
    Previous,
}

/// What Kotlin reports through the event channel.
#[derive(Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NativeEvent {
    Tts {
        kind: TtsKind,
        message: u64,
        mark: Option<String>,
        error: Option<String>,
    },
    Remote {
        action: RemoteAction,
    },
    Insets(Insets),
    PageKey {
        direction: PageDirection,
    },
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TtsKind {
    Begin,
    Mark,
    End,
    Canceled,
    Error,
}

impl TtsKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Begin => "begin",
            Self::Mark => "mark",
            Self::End => "end",
            Self::Canceled => "canceled",
            Self::Error => "error",
        }
    }
}

pub fn forward<R: Runtime>(app: &AppHandle<R>, event: NativeEvent) {
    let result = match event {
        NativeEvent::Tts {
            kind,
            message,
            mark,
            error,
        } => app.emit(
            tts::EVENT,
            TtsEvent {
                kind: kind.as_str(),
                message,
                mark,
                error,
            },
        ),
        NativeEvent::Remote { action } => app.emit(REMOTE_EVENT, action),
        NativeEvent::Insets(insets) => app.emit(INSETS_EVENT, insets),
        NativeEvent::PageKey { direction } => app.emit(PAGE_KEY_EVENT, direction),
    };
    if let Err(e) = result {
        log::warn!("couldn't forward an event to the UI: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_events_from_kotlin() {
        let tts: NativeEvent =
            serde_json::from_str(r#"{"type":"tts","kind":"mark","message":3,"mark":"2"}"#).unwrap();
        assert_eq!(
            tts,
            NativeEvent::Tts {
                kind: TtsKind::Mark,
                message: 3,
                mark: Some("2".into()),
                error: None
            }
        );
        let remote: NativeEvent =
            serde_json::from_str(r#"{"type":"remote","action":"toggle"}"#).unwrap();
        assert_eq!(
            remote,
            NativeEvent::Remote {
                action: RemoteAction::Toggle
            }
        );
        let insets: NativeEvent =
            serde_json::from_str(r#"{"type":"insets","top":24.5,"right":0,"bottom":16,"left":0}"#)
                .unwrap();
        assert!(matches!(insets, NativeEvent::Insets(Insets { top, .. }) if top == 24.5));
        let key: NativeEvent =
            serde_json::from_str(r#"{"type":"pageKey","direction":"previous"}"#).unwrap();
        assert_eq!(
            key,
            NativeEvent::PageKey {
                direction: PageDirection::Previous
            }
        );
    }
}
