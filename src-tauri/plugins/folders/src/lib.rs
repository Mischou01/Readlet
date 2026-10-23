//! Android only: choosing a folder with the system picker and getting back its filesystem path,
//! asking for the storage access that reading it by path needs. The dialog plugin can't pick
//! folders on Android, and what it can pick are `content://` URIs that `std::fs` can't open.

use serde::Deserialize;
use tauri::{
    AppHandle, Manager, Runtime,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

struct Folders<R: Runtime>(PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("folders")
        .setup(|app, api| {
            let handle = api
                .register_android_plugin("io.github.mischou01.readlet.folders", "FoldersPlugin")?;
            app.manage(Folders(handle));
            Ok(())
        })
        .build()
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
        .map_err(|e| match e {
            tauri::plugin::mobile::PluginInvokeError::InvokeRejected(r) => r
                .message
                .unwrap_or_else(|| "couldn't choose a folder".into()),
            e => e.to_string(),
        })
}
