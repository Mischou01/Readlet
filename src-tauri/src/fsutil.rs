//! Small filesystem helpers. Every file Readlet writes goes through `write_atomic`, so a sync tool
//! or a crash never sees a half-written file.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// Converts a modification time to milliseconds since the epoch (0 if unknown).
pub fn system_time_ms(time: io::Result<SystemTime>) -> i64 {
    time.ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// Writes `bytes` to a hidden temporary file next to `path`, flushes it and renames it over
/// `path`. Parent directories are created as needed.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    fs::create_dir_all(parent)?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?
        .to_string_lossy();
    let tmp = parent.join(format!(".{name}.{}.tmp", std::process::id()));
    {
        let mut file = File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

/// Serialises `value` as pretty JSON and writes it atomically.
pub fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> crate::error::Result<()> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    write_atomic(path, &bytes)?;
    Ok(())
}

/// Reads and parses a JSON file. Returns `Ok(None)` when the file doesn't exist.
pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> crate::error::Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Appends one line to a file, creating it (and its parents) if needed.
pub fn append_line(path: &Path, line: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new().create(true).append(true).open(path)?;
    // One write call per line keeps lines whole even if another process appends concurrently.
    let mut buf = Vec::with_capacity(line.len() + 1);
    buf.extend_from_slice(line.as_bytes());
    buf.push(b'\n');
    file.write_all(&buf)?;
    file.sync_data()
}

/// Is this file name one of our own temporary files?
pub fn is_temp_name(name: &str) -> bool {
    name.starts_with('.') && name.ends_with(".tmp")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a/b/file.json");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"two");
        let names: Vec<_> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names, vec!["file.json"]);
    }

    #[test]
    fn append_line_adds_newlines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.jsonl");
        append_line(&path, "{}").unwrap();
        append_line(&path, "[]").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{}\n[]\n");
    }

    #[test]
    fn read_json_of_missing_file_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let value: Option<serde_json::Value> = read_json(&dir.path().join("nope.json")).unwrap();
        assert!(value.is_none());
    }

    #[test]
    fn recognises_temp_names() {
        assert!(is_temp_name(".file.json.123.tmp"));
        assert!(!is_temp_name("file.json"));
    }
}
