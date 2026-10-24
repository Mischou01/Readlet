//! The bridge to the app's Kotlin side (`ReadletPlugin.kt` in `gen/android`), which does what
//! only Android can: text-to-speech, the media notification, the "All files access" permission,
//! the system pickers and the system bars.
//!
//! Calls go from Rust to Kotlin through `Native::call`. Kotlin reports back through one channel,
//! and its events are forwarded to the UI as ordinary Tauri events.

use serde::Serialize;
use serde::de::{DeserializeOwned, IgnoredAny};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

use super::events::{NativeEvent, forward};
use crate::error::Result;

/// Where the Kotlin plugin lives: `io.github.mischou01.readlet.ReadletPlugin`.
const PLUGIN_PACKAGE: &str = "io.github.mischou01.readlet";
const PLUGIN_CLASS: &str = "ReadletPlugin";

pub struct Native<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Native<R> {
    /// Runs a Kotlin command and returns its result. Blocks until Kotlin answers, so it must not
    /// run on the main thread.
    pub fn call<T: DeserializeOwned>(&self, command: &str, payload: impl Serialize) -> Result<T> {
        Ok(self.0.run_mobile_plugin(command, payload)?)
    }

    /// Runs a Kotlin command that returns nothing.
    pub fn call_unit(&self, command: &str, payload: impl Serialize) -> Result<()> {
        self.call::<IgnoredAny>(command, payload).map(|_| ())
    }
}

#[derive(Serialize)]
struct EventHandlerArgs {
    handler: Channel<serde_json::Value>,
}

/// Registers the Kotlin plugin and starts forwarding its events.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("readlet-android")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_PACKAGE, PLUGIN_CLASS)?;
            let native = Native(handle);
            let events = app.clone();
            let handler = Channel::new(move |body: InvokeResponseBody| {
                match body.deserialize::<NativeEvent>() {
                    Ok(event) => forward(&events, event),
                    Err(e) => log::warn!("unexpected event from the Android side: {e}"),
                }
                Ok(())
            });
            native.call_unit("setEventHandler", EventHandlerArgs { handler })?;
            app.manage(native);
            Ok(())
        })
        .build()
}
