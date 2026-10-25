//! Per-device settings in the app config dir: this device's id and name, the library folder and
//! the UI preferences (theme, reading font, …). None of this lives in the book folder, so it never
//! syncs between machines (docs/PLAN.md §4).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::fsutil;
use crate::sync::SyncConfig;

/// The UI stores its preferences as one JSON object; Rust only persists it.
const MAX_PREFERENCES_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub device_id: String,
    pub device_name: String,
    #[serde(default)]
    pub library_root: Option<PathBuf>,
    #[serde(default)]
    pub preferences: Map<String, Value>,
    /// Where reading data syncs to; the token itself is in the keyring (`sync::secret`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync: Option<SyncConfig>,
}

impl Settings {
    fn new() -> Self {
        Self {
            device_id: uuid::Uuid::new_v4().simple().to_string(),
            device_name: device_name(),
            library_root: None,
            preferences: Map::new(),
            sync: None,
        }
    }

    /// Loads the settings, creating them on first run. A corrupt file is kept as
    /// `settings.json.corrupt` and replaced, so the app always starts.
    pub fn load(path: &Path) -> Result<Self> {
        match fsutil::read_json::<Settings>(path) {
            Ok(Some(settings)) if is_valid_device_id(&settings.device_id) => Ok(settings),
            Ok(Some(_)) | Err(Error::Json(_)) => {
                log::warn!("settings file is invalid; starting with fresh settings");
                let _ = fs::rename(path, path.with_extension("json.corrupt"));
                let settings = Self::new();
                settings.save(path)?;
                Ok(settings)
            }
            Ok(None) => {
                let settings = Self::new();
                settings.save(path)?;
                Ok(settings)
            }
            Err(e) => Err(e),
        }
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        fsutil::write_json(path, self)
    }

    pub fn set_preferences(&mut self, value: Value) -> Result<()> {
        let Value::Object(map) = value else {
            return Err(Error::invalid("preferences must be an object"));
        };
        if serde_json::to_vec(&map)?.len() > MAX_PREFERENCES_BYTES {
            return Err(Error::invalid("preferences are too large"));
        }
        self.preferences = map;
        Ok(())
    }
}

/// A name for this device as the reader typed it: trimmed, and short enough to show.
pub fn clean_device_name(name: &str) -> Result<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.chars().count() > 60 {
        return Err(Error::invalid("A device name needs 1 to 60 characters."));
    }
    Ok(name)
}

/// Device ids name folders inside the synced book folder, so they must be plain hex.
pub fn is_valid_device_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A human-readable name for this machine, written next to its data so people can tell the
/// device folders apart.
#[cfg(not(target_os = "android"))]
fn device_name() -> String {
    let from_env = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME"));
    let from_file = || fs::read_to_string("/etc/hostname").map(|s| s.trim().to_owned());
    from_env
        .or_else(|_| from_file())
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "This device".to_owned())
}

/// Phones have no host name worth showing; their model ("Pixel 8") is what people recognise.
#[cfg(target_os = "android")]
fn device_name() -> String {
    fn property(name: &std::ffi::CStr) -> Option<String> {
        let mut value = [0 as libc::c_char; libc::PROP_VALUE_MAX as usize];
        // SAFETY: `name` is NUL-terminated and `value` has the PROP_VALUE_MAX bytes the call
        // may write, including the terminating NUL.
        let len = unsafe { libc::__system_property_get(name.as_ptr(), value.as_mut_ptr()) };
        if len <= 0 {
            return None;
        }
        // SAFETY: on success the value is NUL-terminated within the buffer.
        let value = unsafe { std::ffi::CStr::from_ptr(value.as_ptr()) };
        Some(value.to_string_lossy().trim().to_owned()).filter(|s| !s.is_empty())
    }
    property(c"ro.product.model").unwrap_or_else(|| "Android phone".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_settings_on_first_run_and_reloads_them() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let first = Settings::load(&path).unwrap();
        assert!(is_valid_device_id(&first.device_id));
        let second = Settings::load(&path).unwrap();
        assert_eq!(first.device_id, second.device_id);
    }

    #[test]
    fn replaces_a_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "{ not json").unwrap();
        let settings = Settings::load(&path).unwrap();
        assert!(is_valid_device_id(&settings.device_id));
        assert!(dir.path().join("settings.json.corrupt").exists());
    }

    #[test]
    fn rejects_non_object_preferences() {
        let mut settings = Settings::new();
        assert!(settings.set_preferences(Value::from(3)).is_err());
        settings
            .set_preferences(serde_json::json!({ "theme": "dark" }))
            .unwrap();
        assert_eq!(settings.preferences["theme"], "dark");
    }

    #[test]
    fn cleans_device_names() {
        assert_eq!(
            clean_device_name("  Work   laptop ").unwrap(),
            "Work laptop"
        );
        assert!(clean_device_name("   ").is_err());
        assert!(clean_device_name(&"x".repeat(61)).is_err());
    }

    #[test]
    fn validates_device_ids() {
        assert!(is_valid_device_id("0123456789abcdef"));
        assert!(!is_valid_device_id("../../etc"));
        assert!(!is_valid_device_id("abc"));
    }
}
