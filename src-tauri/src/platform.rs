//! Commands for what differs between desktop and Android: file access, picking folders and
//! books, the system bars, the screen and volume keys while reading, going to the background, and
//! the home-screen widgets. Desktop does these through Tauri's own plugins (or doesn't need them),
//! so most are Android-only and report `unsupported` elsewhere.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::error::Result;

#[cfg(target_os = "android")]
use android as imp;
#[cfg(not(target_os = "android"))]
use desktop as imp;

/// The space the system bars and display cutouts take at each edge, in CSS pixels.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct Insets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemBars {
    /// Dark content behind the bars (so their icons should be light).
    pub dark: bool,
    /// Hide the status and navigation bars (while reading); a swipe from the edge shows them.
    pub hidden: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderControls {
    /// Keep the screen from dimming and locking.
    pub keep_screen_on: bool,
    /// The volume keys turn pages instead of changing the volume.
    pub volume_keys: bool,
}

/// What Android's home-screen widgets show (src/state/widgets.ts builds it; Widgets.kt draws it).
/// Rust only adds where each book's cover is, and passes the rest along as it is.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSnapshot {
    pub current: Option<WidgetBook>,
    pub shelf: Vec<WidgetBook>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WidgetBook {
    pub fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_path: Option<String>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

impl WidgetSnapshot {
    /// Fills in each book's cover file, as `cover_of` finds it.
    // Only Android has widgets; the tests run everywhere.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub fn with_covers(mut self, cover_of: impl Fn(&str) -> Option<PathBuf>) -> Self {
        let books = self.current.iter_mut().chain(self.shelf.iter_mut());
        for book in books {
            book.cover_path = cover_of(&book.fingerprint).map(|p| p.to_string_lossy().into_owned());
        }
        self
    }
}

/// Whether the app may read and write the books folder. On Android this is the "All files
/// access" permission; elsewhere, always.
#[tauri::command]
pub async fn storage_access(app: AppHandle) -> Result<bool> {
    imp::storage_access(app).await
}

/// Opens the system setting for "All files access" and returns whether it was granted once the
/// reader comes back.
#[tauri::command]
pub async fn request_storage_access(app: AppHandle) -> Result<bool> {
    imp::request_storage_access(app).await
}

/// Asks for a folder with the system's folder picker. Returns its path, or `None` if the reader
/// cancelled. (Desktop uses the dialog plugin instead.)
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>> {
    imp::pick_folder(app).await
}

/// Asks for book files with the system's file picker and copies them into the library. Returns
/// the names of the files that were added, or `None` if the reader picked nothing. (Desktop picks
/// paths with the dialog plugin and uses `add_books`.)
#[tauri::command]
pub async fn import_books(app: AppHandle) -> Result<Option<Vec<String>>> {
    imp::import_books(app).await
}

/// Styles the status and navigation bars to match the screen behind them. Desktop has none.
#[tauri::command]
pub async fn set_system_bars(app: AppHandle, bars: SystemBars) -> Result<()> {
    imp::set_system_bars(app, bars).await
}

/// The space the system bars and cutouts take; later changes arrive as `system:insets` events
/// (`android::events`).
#[tauri::command]
pub async fn system_insets(app: AppHandle) -> Result<Insets> {
    imp::system_insets(app).await
}

/// Keeps the screen on and lets the volume keys turn pages while reading; pages turned by the
/// keys arrive as `reader:page-key` events. Desktop has neither.
#[tauri::command]
pub async fn set_reader_controls(app: AppHandle, controls: ReaderControls) -> Result<()> {
    imp::set_reader_controls(app, controls).await
}

/// Sends the app to the background, as the back gesture does on the first screen of other apps.
#[tauri::command]
pub async fn move_to_background(app: AppHandle) -> Result<()> {
    imp::move_to_background(app).await
}

/// Hands Android's home-screen widgets what they show, and redraws them. Desktop has none.
#[tauri::command]
pub async fn update_widgets(app: AppHandle, snapshot: WidgetSnapshot) -> Result<()> {
    imp::update_widgets(app, snapshot).await
}

/// What a home-screen widget asked the app to show ("book:<fingerprint>" or "stats"), if
/// anything; asking takes it. The UI asks when it starts and on `app:open-request` events.
#[tauri::command]
pub async fn take_open_request(app: AppHandle) -> Result<Option<String>> {
    imp::take_open_request(app).await
}

#[cfg(not(target_os = "android"))]
mod desktop {
    use tauri::AppHandle;

    use super::{Insets, ReaderControls, SystemBars, WidgetSnapshot};
    use crate::error::{Error, Result};

    pub async fn storage_access(_: AppHandle) -> Result<bool> {
        Ok(true)
    }

    pub async fn request_storage_access(_: AppHandle) -> Result<bool> {
        Ok(true)
    }

    pub async fn pick_folder(_: AppHandle) -> Result<Option<String>> {
        Err(Error::Unsupported("The system folder picker"))
    }

    pub async fn import_books(_: AppHandle) -> Result<Option<Vec<String>>> {
        Err(Error::Unsupported("The system file picker"))
    }

    pub async fn set_system_bars(_: AppHandle, _: SystemBars) -> Result<()> {
        Ok(())
    }

    pub async fn system_insets(_: AppHandle) -> Result<Insets> {
        Ok(Insets::default())
    }

    pub async fn set_reader_controls(_: AppHandle, _: ReaderControls) -> Result<()> {
        Ok(())
    }

    pub async fn move_to_background(_: AppHandle) -> Result<()> {
        Err(Error::Unsupported("Moving to the background"))
    }

    pub async fn update_widgets(_: AppHandle, _: WidgetSnapshot) -> Result<()> {
        Ok(())
    }

    pub async fn take_open_request(_: AppHandle) -> Result<Option<String>> {
        Ok(None)
    }
}

#[cfg(target_os = "android")]
mod android {
    use std::path::PathBuf;

    use serde::de::{DeserializeOwned, IgnoredAny};
    use serde::{Deserialize, Serialize};
    use tauri::{AppHandle, Manager};

    use super::{Insets, ReaderControls, SystemBars, WidgetSnapshot};
    use crate::android::Native;
    use crate::error::{Error, Result};
    use crate::protocol::cover_file;
    use crate::state::AppState;

    /// Runs `work` on the blocking pool: calls into Kotlin block until it answers.
    async fn blocking<T: Send + 'static>(
        app: AppHandle,
        work: impl FnOnce(&AppHandle) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        tauri::async_runtime::spawn_blocking(move || work(&app))
            .await
            .map_err(|e| Error::Native(format!("background task failed: {e}")))?
    }

    async fn call<T, P>(app: AppHandle, command: &'static str, payload: P) -> Result<T>
    where
        T: DeserializeOwned + Send + 'static,
        P: Serialize + Send + 'static,
    {
        blocking(app, move |app| {
            app.try_state::<Native<tauri::Wry>>()
                .ok_or_else(|| Error::Native("the Android side of the app isn't ready".into()))?
                .call(command, payload)
        })
        .await
    }

    #[derive(Deserialize)]
    struct Granted {
        granted: bool,
    }

    #[derive(Deserialize)]
    struct PickedFolder {
        path: Option<String>,
    }

    #[derive(Deserialize)]
    struct PickedFiles {
        paths: Vec<String>,
    }

    #[derive(Deserialize)]
    struct OpenRequest {
        target: Option<String>,
    }

    pub async fn storage_access(app: AppHandle) -> Result<bool> {
        Ok(call::<Granted, _>(app, "storageAccess", ()).await?.granted)
    }

    pub async fn request_storage_access(app: AppHandle) -> Result<bool> {
        Ok(call::<Granted, _>(app, "requestStorageAccess", ())
            .await?
            .granted)
    }

    pub async fn pick_folder(app: AppHandle) -> Result<Option<String>> {
        Ok(call::<PickedFolder, _>(app, "pickFolder", ()).await?.path)
    }

    /// Kotlin copies the picked books out of their content provider into the app's cache; they
    /// are copied into the library from there, and the cached copies removed.
    pub async fn import_books(app: AppHandle) -> Result<Option<Vec<String>>> {
        let picked = call::<PickedFiles, _>(app.clone(), "pickBooks", ()).await?;
        if picked.paths.is_empty() {
            return Ok(None);
        }
        blocking(app, move |app| {
            let paths: Vec<PathBuf> = picked.paths.into_iter().map(PathBuf::from).collect();
            let state = app.state::<AppState>();
            let result = state.library().and_then(|l| l.add_books(&paths));
            for path in &paths {
                let _ = std::fs::remove_file(path);
            }
            let added = result?;
            if !added.is_empty() {
                state.request_scan(app);
            }
            Ok(Some(added))
        })
        .await
    }

    pub async fn set_system_bars(app: AppHandle, bars: SystemBars) -> Result<()> {
        call::<IgnoredAny, _>(app, "setSystemBars", bars)
            .await
            .map(|_| ())
    }

    pub async fn system_insets(app: AppHandle) -> Result<Insets> {
        call(app, "insets", ()).await
    }

    pub async fn set_reader_controls(app: AppHandle, controls: ReaderControls) -> Result<()> {
        call::<IgnoredAny, _>(app, "setReaderControls", controls)
            .await
            .map(|_| ())
    }

    pub async fn move_to_background(app: AppHandle) -> Result<()> {
        call::<IgnoredAny, _>(app, "moveToBackground", ())
            .await
            .map(|_| ())
    }

    pub async fn update_widgets(app: AppHandle, snapshot: WidgetSnapshot) -> Result<()> {
        let snapshot = {
            let state = app.state::<AppState>();
            snapshot.with_covers(|fp| cover_file(&state, fp))
        };
        call::<IgnoredAny, _>(app, "updateWidgets", snapshot)
            .await
            .map(|_| ())
    }

    pub async fn take_open_request(app: AppHandle) -> Result<Option<String>> {
        Ok(call::<OpenRequest, _>(app, "takeOpenRequest", ())
            .await?
            .target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widget_snapshots_gain_covers_and_keep_the_rest() {
        let snapshot: WidgetSnapshot = serde_json::from_str(
            r##"{"day":"2026-10-26","goal":{"minutes":5},
                "current":{"fingerprint":"a","title":"A","palette":{"accent":"#123456"}},
                "shelf":[{"fingerprint":"a","title":"A"},{"fingerprint":"b","title":"B"}]}"##,
        )
        .unwrap();
        let with = snapshot.with_covers(|fp| (fp == "a").then(|| PathBuf::from("/covers/a.jpg")));
        let json = serde_json::to_value(&with).unwrap();
        assert_eq!(json["current"]["coverPath"], "/covers/a.jpg");
        assert_eq!(json["current"]["palette"]["accent"], "#123456");
        assert_eq!(json["shelf"][0]["coverPath"], "/covers/a.jpg");
        assert!(json["shelf"][1].get("coverPath").is_none());
        assert_eq!(json["shelf"][1]["title"], "B");
        assert_eq!(json["day"], "2026-10-26");
        assert_eq!(json["goal"]["minutes"], 5);
    }
}
