//! Reading data, stored next to the books so it syncs with them (docs/PLAN.md §4):
//!
//! ```text
//! <library>/.readlet/devices/<device-id>/
//!   device.json                  { name } so people can tell the folders apart
//!   books/<fingerprint>.json     progress, status, highlights, notes, bookmarks
//!   profile.json                 reading goals
//!   shelves.json
//!   sessions/<year>.jsonl        append-only reading sessions
//!   sessions/open.json           the session in progress, appended when it ends
//!   resurfaced.jsonl             which highlights were shown, and when
//! ```
//!
//! This device only ever writes inside its own folder, so a sync tool never sees two machines
//! editing the same file. Reads merge every device's folder (see `merge`).

pub mod merge;
pub mod model;

use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::error::Result;
use crate::fsutil;
use crate::library::fingerprint;
use crate::settings::is_valid_device_id;
use model::{BookRecord, Profile, Resurfaced, Session, Shelf, ShelvesDoc};

pub const STORE_DIR: &str = ".readlet";
const DEVICES_DIR: &str = "devices";
const BOOKS_DIR: &str = "books";
const SESSIONS_DIR: &str = "sessions";
const OPEN_SESSION: &str = "open.json";

/// What kind of reading data a changed file holds; used to tell the UI what to reload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreChange {
    Book(String),
    Sessions,
    Profile,
    Shelves,
    Resurfaced,
}

/// A batch of changes made by other devices, as sent to the UI.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreChanges {
    pub books: Vec<String>,
    pub sessions: bool,
    pub profile: bool,
    pub shelves: bool,
    pub resurfaced: bool,
}

impl StoreChanges {
    pub fn add(&mut self, change: StoreChange) {
        match change {
            StoreChange::Book(fp) => {
                if !self.books.contains(&fp) {
                    self.books.push(fp);
                }
            }
            StoreChange::Sessions => self.sessions = true,
            StoreChange::Profile => self.profile = true,
            StoreChange::Shelves => self.shelves = true,
            StoreChange::Resurfaced => self.resurfaced = true,
        }
    }

    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

pub struct Store {
    devices_dir: PathBuf,
    device_id: String,
    /// Merged book records, loaded lazily and kept up to date on writes and sync events.
    books: Mutex<Option<HashMap<String, BookRecord>>>,
}

impl Store {
    /// Opens (and creates) this device's folder in the library and recovers a session that was
    /// still open when the app last quit.
    pub fn open(library_root: &Path, device_id: &str, device_name: &str) -> Result<Self> {
        let store = Self {
            devices_dir: library_root.join(STORE_DIR).join(DEVICES_DIR),
            device_id: device_id.to_owned(),
            books: Mutex::new(None),
        };
        let own = store.own_dir();
        fs::create_dir_all(own.join(BOOKS_DIR))?;
        let device_file = own.join("device.json");
        let device = serde_json::json!({ "name": device_name });
        if fsutil::read_json::<serde_json::Value>(&device_file)
            .ok()
            .flatten()
            .as_ref()
            != Some(&device)
        {
            fsutil::write_json(&device_file, &device)?;
        }
        store.recover_open_session()?;
        Ok(store)
    }

    fn own_dir(&self) -> PathBuf {
        self.devices_dir.join(&self.device_id)
    }

    /// Every device folder, this one included.
    fn device_dirs(&self) -> Vec<PathBuf> {
        let Ok(entries) = fs::read_dir(&self.devices_dir) else {
            return vec![];
        };
        let mut dirs: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .filter(|e| e.file_name().to_str().is_some_and(is_valid_device_id))
            .map(|e| e.path())
            .collect();
        dirs.sort();
        dirs
    }

    /// Reads a JSON document, treating a corrupt file (for example one a sync tool is still
    /// writing) as missing rather than failing the whole read.
    fn read_doc<T: serde::de::DeserializeOwned>(path: &Path) -> Option<T> {
        match fsutil::read_json(path) {
            Ok(doc) => doc,
            Err(e) => {
                log::warn!("skipping unreadable store file {}: {e}", path.display());
                None
            }
        }
    }

    // -- Books ---------------------------------------------------------------------------------

    fn book_file(dir: &Path, fingerprint: &str) -> PathBuf {
        dir.join(BOOKS_DIR).join(format!("{fingerprint}.json"))
    }

    fn load_merged_book(&self, fingerprint: &str) -> BookRecord {
        let records = self
            .device_dirs()
            .into_iter()
            .filter_map(|dir| Self::read_doc::<BookRecord>(&Self::book_file(&dir, fingerprint)));
        merge::merge_books(fingerprint, records)
    }

    fn load_all_books(&self) -> HashMap<String, BookRecord> {
        let mut per_book: HashMap<String, Vec<BookRecord>> = HashMap::new();
        for dir in self.device_dirs() {
            let Ok(entries) = fs::read_dir(dir.join(BOOKS_DIR)) else {
                continue;
            };
            for entry in entries.filter_map(|e| e.ok()) {
                let name = entry.file_name();
                let Some(fp) = name.to_str().and_then(|n| n.strip_suffix(".json")) else {
                    continue;
                };
                if !fingerprint::is_valid(fp) {
                    continue;
                }
                if let Some(record) = Self::read_doc::<BookRecord>(&entry.path()) {
                    per_book.entry(fp.to_owned()).or_default().push(record);
                }
            }
        }
        per_book
            .into_iter()
            .map(|(fp, records)| {
                let merged = merge::merge_books(&fp, records);
                (fp, merged)
            })
            .collect()
    }

    /// All books that have reading data, merged across devices.
    pub fn books(&self) -> Vec<BookRecord> {
        let mut cache = self.books.lock().unwrap_or_else(|e| e.into_inner());
        cache
            .get_or_insert_with(|| self.load_all_books())
            .values()
            .cloned()
            .collect()
    }

    /// One book's reading data, merged across devices.
    pub fn book(&self, fingerprint: &str) -> BookRecord {
        let mut cache = self.books.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(record) = cache.as_ref().and_then(|c| c.get(fingerprint)) {
            return record.clone();
        }
        let record = self.load_merged_book(fingerprint);
        if let Some(cache) = cache.as_mut() {
            cache.insert(fingerprint.to_owned(), record.clone());
        }
        record
    }

    /// Changes this device's copy of a book's record and returns the new merged record.
    pub fn update_book(
        &self,
        fingerprint: &str,
        change: impl FnOnce(&mut BookRecord) -> Result<()>,
    ) -> Result<BookRecord> {
        let mut cache = self.books.lock().unwrap_or_else(|e| e.into_inner());
        let path = Self::book_file(&self.own_dir(), fingerprint);
        let mut own = fsutil::read_json::<BookRecord>(&path)
            .ok()
            .flatten()
            .unwrap_or_else(|| BookRecord::new(fingerprint));
        own.fingerprint = fingerprint.to_owned();
        change(&mut own)?;
        fsutil::write_json(&path, &own)?;
        let merged = self.load_merged_book(fingerprint);
        if let Some(cache) = cache.as_mut() {
            cache.insert(fingerprint.to_owned(), merged.clone());
        }
        Ok(merged)
    }

    /// Drops cached records after another device's files changed.
    pub fn invalidate_books(&self, fingerprints: &[String]) {
        let mut cache = self.books.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(cache) = cache.as_mut() {
            for fp in fingerprints {
                let merged = self.load_merged_book(fp);
                cache.insert(fp.clone(), merged);
            }
        }
    }

    // -- Profile and shelves -------------------------------------------------------------------

    pub fn profile(&self) -> Profile {
        merge::merge_profiles(
            self.device_dirs()
                .iter()
                .filter_map(|dir| Self::read_doc::<Profile>(&dir.join("profile.json"))),
        )
    }

    pub fn update_profile(&self, change: impl FnOnce(&mut Profile)) -> Result<Profile> {
        let path = self.own_dir().join("profile.json");
        let mut own = fsutil::read_json::<Profile>(&path)
            .ok()
            .flatten()
            .unwrap_or_default();
        change(&mut own);
        fsutil::write_json(&path, &own)?;
        Ok(self.profile())
    }

    pub fn shelves(&self) -> Vec<Shelf> {
        merge::merge_shelves(
            self.device_dirs()
                .iter()
                .filter_map(|dir| Self::read_doc::<ShelvesDoc>(&dir.join("shelves.json")))
                .map(|doc| doc.shelves),
        )
    }

    /// Writes one shelf (new, changed or deleted) and returns the merged shelves.
    pub fn put_shelf(&self, shelf: Shelf) -> Result<Vec<Shelf>> {
        let path = self.own_dir().join("shelves.json");
        let mut own = fsutil::read_json::<ShelvesDoc>(&path)
            .ok()
            .flatten()
            .unwrap_or_default();
        own.shelves.retain(|s| s.id != shelf.id);
        own.shelves.push(shelf);
        fsutil::write_json(&path, &own)?;
        Ok(self.shelves())
    }

    // -- Sessions ------------------------------------------------------------------------------

    fn sessions_dir(&self) -> PathBuf {
        self.own_dir().join(SESSIONS_DIR)
    }

    /// Saves the session in progress so a crash loses at most one checkpoint interval.
    pub fn checkpoint_session(&self, session: &Session) -> Result<()> {
        fsutil::write_json(&self.sessions_dir().join(OPEN_SESSION), session)
    }

    /// Appends a finished session to this year's log and clears the checkpoint.
    pub fn finish_session(&self, session: &Session) -> Result<()> {
        let path = self
            .sessions_dir()
            .join(format!("{}.jsonl", year_of(session.start)));
        fsutil::append_line(&path, &serde_json::to_string(session)?)?;
        match fs::remove_file(self.sessions_dir().join(OPEN_SESSION)) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    fn recover_open_session(&self) -> Result<()> {
        let path = self.sessions_dir().join(OPEN_SESSION);
        match Self::read_doc::<Session>(&path) {
            Some(session) => self.finish_session(&session),
            None => {
                let _ = fs::remove_file(path);
                Ok(())
            }
        }
    }

    /// Every device's sessions that ended at or after `since` (ms since the epoch).
    pub fn sessions(&self, since: i64) -> Vec<Session> {
        let first_year = year_of(since);
        let mut all = Vec::new();
        for dir in self.device_dirs() {
            let Ok(entries) = fs::read_dir(dir.join(SESSIONS_DIR)) else {
                continue;
            };
            for entry in entries.filter_map(|e| e.ok()) {
                let name = entry.file_name();
                let Some(year) = name
                    .to_str()
                    .and_then(|n| n.strip_suffix(".jsonl"))
                    .and_then(|y| y.parse::<i32>().ok())
                else {
                    continue;
                };
                if year >= first_year {
                    all.extend(
                        read_jsonl::<Session>(&entry.path())
                            .into_iter()
                            .filter(|s| s.end >= since),
                    );
                }
            }
        }
        merge::dedupe_sessions(all)
    }

    // -- Resurfaced highlights -----------------------------------------------------------------

    pub fn log_resurfaced(&self, entries: &[Resurfaced]) -> Result<()> {
        let path = self.own_dir().join("resurfaced.jsonl");
        for entry in entries {
            fsutil::append_line(&path, &serde_json::to_string(entry)?)?;
        }
        Ok(())
    }

    pub fn resurfaced(&self) -> Vec<Resurfaced> {
        self.device_dirs()
            .iter()
            .flat_map(|dir| read_jsonl::<Resurfaced>(&dir.join("resurfaced.jsonl")))
            .collect()
    }

    // -- Change detection ----------------------------------------------------------------------

    /// Classifies a changed path inside the store. Returns `None` for this device's own files
    /// (we already know about those) and for anything that isn't reading data.
    pub fn classify(&self, path: &Path) -> Option<StoreChange> {
        let rel = path.strip_prefix(&self.devices_dir).ok()?;
        let parts: Vec<&str> = rel
            .components()
            .map(|c| match c {
                Component::Normal(s) => s.to_str(),
                _ => None,
            })
            .collect::<Option<_>>()?;
        let (device, rest) = parts.split_first()?;
        if *device == self.device_id || !is_valid_device_id(device) {
            return None;
        }
        match rest {
            [BOOKS_DIR, file] => {
                let fp = file.strip_suffix(".json")?;
                fingerprint::is_valid(fp).then(|| StoreChange::Book(fp.to_owned()))
            }
            [SESSIONS_DIR, file] if file.ends_with(".jsonl") => Some(StoreChange::Sessions),
            ["profile.json"] => Some(StoreChange::Profile),
            ["shelves.json"] => Some(StoreChange::Shelves),
            ["resurfaced.jsonl"] => Some(StoreChange::Resurfaced),
            _ => None,
        }
    }
}

/// Reads a JSON Lines file, skipping lines that don't parse (a sync tool may deliver a file
/// whose last line is still incomplete).
fn read_jsonl<T: serde::de::DeserializeOwned>(path: &Path) -> Vec<T> {
    let Ok(file) = fs::File::open(path) else {
        return vec![];
    };
    BufReader::new(file)
        .lines()
        .map_while(|line| line.ok())
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str(&line).ok())
        .collect()
}

/// The (proleptic Gregorian, UTC) year of a timestamp in ms since the epoch.
pub fn year_of(ms: i64) -> i32 {
    // Howard Hinnant's civil-from-days algorithm.
    let z = ms.div_euclid(86_400_000) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    i32::try_from(year).unwrap_or(i32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::{Annotation, Stamped, YearlyGoal};

    const FP: &str = "0123456789abcdef0123456789abcdef";
    const LAPTOP: &str = "aaaaaaaaaaaaaaaa";
    const DESKTOP: &str = "bbbbbbbbbbbbbbbb";

    fn session(id: &str, start: i64) -> Session {
        Session {
            id: id.into(),
            book: FP.into(),
            start,
            end: start + 60_000,
            active_ms: 60_000,
            start_fraction: 0.1,
            end_fraction: 0.2,
            words: 0,
        }
    }

    fn highlight(id: &str, at: i64) -> Annotation {
        Annotation {
            id: id.into(),
            kind: "highlight".into(),
            cfi: "epubcfi(/6/2!/4,/1:0,/1:4)".into(),
            text: "Call".into(),
            color: Some("sky".into()),
            note: None,
            chapter: None,
            fraction: Some(0.1),
            created_at: at,
            updated_at: at,
            deleted: false,
        }
    }

    #[test]
    fn computes_years() {
        assert_eq!(year_of(0), 1970);
        assert_eq!(year_of(1_767_225_599_000), 2025); // 2025-12-31T23:59:59Z
        assert_eq!(year_of(1_767_225_600_000), 2026); // 2026-01-01T00:00:00Z
        assert_eq!(year_of(951_782_400_000), 2000); // 2000-02-29
        assert_eq!(year_of(-1), 1969);
    }

    #[test]
    fn each_device_writes_only_its_own_folder_and_reads_merge_both() {
        let dir = tempfile::tempdir().unwrap();
        let laptop = Store::open(dir.path(), LAPTOP, "Laptop").unwrap();
        let desktop = Store::open(dir.path(), DESKTOP, "Desktop").unwrap();

        laptop
            .update_book(FP, |r| {
                r.annotations.push(highlight("h1", 1));
                Ok(())
            })
            .unwrap();
        desktop
            .update_book(FP, |r| {
                r.status = Some(Stamped {
                    value: "reading".into(),
                    updated_at: 5,
                });
                r.annotations.push(highlight("h2", 2));
                Ok(())
            })
            .unwrap();

        let laptop_file = dir
            .path()
            .join(".readlet/devices")
            .join(LAPTOP)
            .join("books")
            .join(format!("{FP}.json"));
        let on_disk: BookRecord = serde_json::from_slice(&fs::read(laptop_file).unwrap()).unwrap();
        assert_eq!(
            on_disk.annotations.len(),
            1,
            "the laptop file holds only the laptop's data"
        );

        laptop.invalidate_books(&[FP.to_owned()]);
        let merged = laptop.book(FP);
        assert_eq!(merged.annotations.len(), 2);
        assert_eq!(merged.status.unwrap().value, "reading");
        assert_eq!(laptop.books().len(), 1);
    }

    #[test]
    fn open_sessions_are_recovered_on_the_next_start() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path(), LAPTOP, "Laptop").unwrap();
        let start = 1_767_225_600_000;
        store.checkpoint_session(&session("s1", start)).unwrap();
        assert!(store.sessions(0).is_empty());

        // The app quit without finishing the session.
        drop(store);
        let store = Store::open(dir.path(), LAPTOP, "Laptop").unwrap();
        let sessions = store.sessions(0);
        assert_eq!(sessions.len(), 1);
        assert!(
            dir.path()
                .join(".readlet/devices")
                .join(LAPTOP)
                .join("sessions/2026.jsonl")
                .exists()
        );
        assert!(
            !dir.path()
                .join(".readlet/devices")
                .join(LAPTOP)
                .join("sessions/open.json")
                .exists()
        );
    }

    #[test]
    fn sessions_are_filtered_by_time_and_survive_a_torn_line() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path(), LAPTOP, "Laptop").unwrap();
        store.finish_session(&session("old", 1_000)).unwrap();
        store
            .finish_session(&session("new", 1_767_225_600_000))
            .unwrap();
        let log = dir
            .path()
            .join(".readlet/devices")
            .join(LAPTOP)
            .join("sessions/2026.jsonl");
        let mut text = fs::read_to_string(&log).unwrap();
        text.push_str("{\"id\":\"torn\",\"bo");
        fs::write(&log, text).unwrap();

        let ids: Vec<String> = store
            .sessions(1_700_000_000_000)
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(ids, ["new"]);
        assert_eq!(store.sessions(0).len(), 2);
    }

    #[test]
    fn profile_and_shelves_merge_across_devices() {
        let dir = tempfile::tempdir().unwrap();
        let laptop = Store::open(dir.path(), LAPTOP, "Laptop").unwrap();
        let desktop = Store::open(dir.path(), DESKTOP, "Desktop").unwrap();
        laptop
            .update_profile(|p| {
                p.daily_minutes = Some(Stamped {
                    value: 30,
                    updated_at: 1,
                })
            })
            .unwrap();
        desktop
            .update_profile(|p| {
                p.yearly_goal = Some(Stamped {
                    value: YearlyGoal {
                        unit: "books".into(),
                        target: 24,
                    },
                    updated_at: 2,
                })
            })
            .unwrap();
        let profile = laptop.profile();
        assert_eq!(profile.daily_minutes.unwrap().value, 30);
        assert_eq!(profile.yearly_goal.unwrap().value.target, 24);

        desktop
            .put_shelf(Shelf {
                id: "s".into(),
                name: "Poetry".into(),
                books: vec![FP.into()],
                updated_at: 1,
                deleted: false,
            })
            .unwrap();
        assert_eq!(laptop.shelves()[0].books, vec![FP.to_owned()]);
    }

    #[test]
    fn classifies_changes_from_other_devices_only() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path(), LAPTOP, "Laptop").unwrap();
        let devices = dir.path().join(".readlet/devices");
        let other = devices.join(DESKTOP);
        assert_eq!(
            store.classify(&other.join("books").join(format!("{FP}.json"))),
            Some(StoreChange::Book(FP.into()))
        );
        assert_eq!(
            store.classify(&other.join("sessions/2026.jsonl")),
            Some(StoreChange::Sessions)
        );
        assert_eq!(
            store.classify(&other.join("profile.json")),
            Some(StoreChange::Profile)
        );
        assert_eq!(store.classify(&other.join("sessions/open.json")), None);
        assert_eq!(store.classify(&other.join("books/.x.json.12.tmp")), None);
        assert_eq!(
            store.classify(&devices.join(LAPTOP).join("profile.json")),
            None
        );
        assert_eq!(store.classify(&dir.path().join("book.epub")), None);
    }

    #[test]
    fn writes_the_device_name() {
        let dir = tempfile::tempdir().unwrap();
        Store::open(dir.path(), LAPTOP, "Laptop").unwrap();
        let device: serde_json::Value = serde_json::from_slice(
            &fs::read(
                dir.path()
                    .join(".readlet/devices")
                    .join(LAPTOP)
                    .join("device.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(device["name"], "Laptop");
    }

    #[test]
    fn logs_resurfaced_highlights() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path(), LAPTOP, "Laptop").unwrap();
        store
            .log_resurfaced(&[Resurfaced {
                highlight: "h1".into(),
                day: "2026-10-22".into(),
            }])
            .unwrap();
        assert_eq!(store.resurfaced().len(), 1);
    }
}
