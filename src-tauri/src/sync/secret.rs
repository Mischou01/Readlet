//! Keeping a sync service's token: in the system keyring on the desktop (Secret Service on
//! Linux), and encrypted with a key in Android's keystore on a phone. Never in a file Readlet
//! writes itself, and never in the synced folder.

use tauri::AppHandle;

use crate::error::Result;

/// What the kDrive token is filed under.
pub const KDRIVE_TOKEN: &str = "kdrive-token";

#[cfg(not(target_os = "android"))]
mod platform {
    use super::*;
    use crate::error::Error;

    const SERVICE: &str = "Readlet";

    fn entry(name: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, name).map_err(unavailable)
    }

    fn unavailable(e: keyring::Error) -> Error {
        Error::Secrets(format!(
            "Readlet couldn't use the system keyring to keep the token safe ({e}). On Linux, a \
             keyring such as GNOME Keyring or KWallet needs to be running."
        ))
    }

    pub fn get(_: &AppHandle, name: &str) -> Result<Option<String>> {
        match entry(name)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(unavailable(e)),
        }
    }

    pub fn set(_: &AppHandle, name: &str, secret: &str) -> Result<()> {
        entry(name)?.set_password(secret).map_err(unavailable)
    }

    pub fn delete(_: &AppHandle, name: &str) -> Result<()> {
        match entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(unavailable(e)),
        }
    }
}

#[cfg(target_os = "android")]
mod platform {
    use serde::{Deserialize, Serialize};
    use tauri::Manager;

    use super::*;
    use crate::android::Native;
    use crate::error::Error;

    #[derive(Serialize)]
    struct Named<'a> {
        name: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<&'a str>,
    }

    #[derive(Deserialize)]
    struct Secret {
        value: Option<String>,
    }

    /// Calls the Kotlin side, which blocks: never from the main thread.
    fn native(app: &AppHandle) -> Result<tauri::State<'_, Native<tauri::Wry>>> {
        app.try_state::<Native<tauri::Wry>>()
            .ok_or_else(|| Error::Native("the Android side of the app isn't ready".into()))
    }

    fn named<'a>(name: &'a str, value: Option<&'a str>) -> Named<'a> {
        Named { name, value }
    }

    pub fn get(app: &AppHandle, name: &str) -> Result<Option<String>> {
        let secret: Secret = native(app)?
            .call("getSecret", named(name, None))
            .map_err(|e| Error::Secrets(format!("Couldn't read the token: {e}")))?;
        Ok(secret.value)
    }

    pub fn set(app: &AppHandle, name: &str, secret: &str) -> Result<()> {
        native(app)?
            .call_unit("setSecret", named(name, Some(secret)))
            .map_err(|e| Error::Secrets(format!("Couldn't keep the token: {e}")))
    }

    pub fn delete(app: &AppHandle, name: &str) -> Result<()> {
        native(app)?.call_unit("deleteSecret", named(name, None))
    }
}

pub use platform::{delete, get, set};
