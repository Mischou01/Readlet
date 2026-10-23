//! Android only, in two parts:
//!
//! - Choosing a folder with the system picker and getting back its filesystem path, asking for the
//!   storage access that reading it by path needs. The dialog plugin can't pick folders on
//!   Android, and what it can pick are `content://` URIs that `std::fs` can't open.
//! - The screen: Readlet runs full screen with the system bars hidden, tells the UI how much of
//!   the edges the camera cutout covers, and keeps Android's own text selection menu out of the
//!   way of Readlet's.

use serde::{Deserialize, Serialize, de::IgnoredAny};
use tauri::{
    AppHandle, Manager, Runtime,
    plugin::{Builder, PluginHandle, TauriPlugin, mobile::PluginInvokeError},
};

const PACKAGE: &str = "io.github.mischou01.readlet.android";

struct Folders<R: Runtime>(PluginHandle<R>);
struct Screen<R: Runtime>(PluginHandle<R>);

// Tauri keeps one Android class per plugin name (registering a second replaces the first), so
// each class gets a plugin of its own.

/// The folder picker.
pub fn folders<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("readlet-folders")
        .setup(|app, api| {
            app.manage(Folders(api.register_android_plugin(PACKAGE, "FoldersPlugin")?));
            Ok(())
        })
        .build()
}

/// Full screen, the insets and the text menu.
pub fn screen<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("readlet-screen")
        .setup(|app, api| {
            app.manage(Screen(api.register_android_plugin(PACKAGE, "ScreenPlugin")?));
            Ok(())
        })
        .build()
}

fn error_message(e: PluginInvokeError, fallback: &str) -> String {
    match e {
        PluginInvokeError::InvokeRejected(r) => r.message.unwrap_or_else(|| fallback.into()),
        e => e.to_string(),
    }
}

#[derive(Deserialize)]
struct Picked {
    path: Option<String>,
}

/// Asks for a folder. `Ok(None)` if the reader cancelled. Blocks until they're done, so call it
/// off the main thread.
pub fn pick_folder<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>, String> {
    app.state::<Folders<R>>()
        .0
        .run_mobile_plugin::<Picked>("pickFolder", ())
        .map(|picked| picked.path)
        .map_err(|e| error_message(e, "couldn't choose a folder"))
}

/// How far in from each edge the UI should keep its controls, in CSS pixels: the camera cutout,
/// and any system bars that are showing.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct Insets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

/// The screen's current insets.
pub async fn insets<R: Runtime>(app: &AppHandle<R>) -> Result<Insets, String> {
    app.state::<Screen<R>>()
        .0
        .run_mobile_plugin_async::<Insets>("insets", ())
        .await
        .map_err(|e| error_message(e, "couldn't read the screen insets"))
}

#[derive(Serialize)]
struct TextMenu {
    enabled: bool,
}

/// Lets Android show its own menu (cut, copy, paste) over selected text, or keeps it hidden so
/// Readlet's selection bar is the only one. It's wanted in text fields, not in books.
pub async fn set_native_text_menu<R: Runtime>(
    app: &AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    app.state::<Screen<R>>()
        .0
        .run_mobile_plugin_async::<IgnoredAny>("setNativeTextMenu", TextMenu { enabled })
        .await
        .map(|_| ())
        .map_err(|e| error_message(e, "couldn't change the text menu"))
}
