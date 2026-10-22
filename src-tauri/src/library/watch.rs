//! Live watching of the library folder. Book files that appear, change or disappear trigger a
//! rescan; reading data written by other devices (arriving through a sync tool) is reported so
//! the UI can reload it.

use std::path::{Path, PathBuf};
use std::time::Duration;

use notify::RecursiveMode;
use notify::event::{EventKind, ModifyKind};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};

use super::formats::BookFormat;
use crate::fsutil;
use crate::store::{STORE_DIR, StoreChange, StoreChanges};

pub type Watcher = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

/// Sync tools write files in bursts; one second groups a burst into one rescan.
const DEBOUNCE: Duration = Duration::from_secs(1);

/// What a batch of file events means for the app.
#[derive(Debug, Default, PartialEq)]
pub struct Interpretation {
    pub rescan: bool,
    pub store: StoreChanges,
}

/// Sorts changed paths into "the books changed" and "another device's reading data changed".
pub fn interpret(
    root: &Path,
    paths: impl IntoIterator<Item = PathBuf>,
    classify: impl Fn(&Path) -> Option<StoreChange>,
) -> Interpretation {
    let store_dir = root.join(STORE_DIR);
    let mut result = Interpretation::default();
    for path in paths {
        if path.starts_with(&store_dir) {
            if let Some(change) = classify(&path) {
                result.store.add(change);
            }
            continue;
        }
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let hidden = rel
            .components()
            .any(|c| c.as_os_str().to_str().is_some_and(|s| s.starts_with('.')));
        let temp = path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(fsutil::is_temp_name);
        if hidden || temp {
            continue;
        }
        // A book file, or something without a book extension that might be a folder of books
        // (a removed folder can't be stat'ed any more, so don't try).
        if BookFormat::from_path(&path).is_some() || path.extension().is_none() {
            result.rescan = true;
        }
    }
    result
}

/// Only changes to content and names matter. Reads (including our own scans and the webview
/// loading a book) and metadata-only changes like access times would otherwise trigger endless
/// rescans.
fn is_relevant(kind: &EventKind) -> bool {
    !matches!(
        kind,
        EventKind::Access(_) | EventKind::Modify(ModifyKind::Metadata(_))
    )
}

/// Starts watching `root` recursively. The watcher stops when the returned value is dropped.
pub fn start(
    root: &Path,
    on_events: impl Fn(Vec<PathBuf>) + Send + 'static,
) -> notify::Result<Watcher> {
    let mut debouncer =
        new_debouncer(
            DEBOUNCE,
            None,
            move |result: DebounceEventResult| match result {
                Ok(events) => {
                    let paths: Vec<PathBuf> = events
                        .into_iter()
                        .filter(|e| is_relevant(&e.event.kind))
                        .flat_map(|e| e.event.paths)
                        .collect();
                    if !paths.is_empty() {
                        on_events(paths);
                    }
                }
                Err(errors) => {
                    for error in errors {
                        log::warn!("file watcher error: {error}");
                    }
                }
            },
        )?;
    debouncer.watch(root, RecursiveMode::Recursive)?;
    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(paths: &[&str]) -> Interpretation {
        let root = Path::new("/books");
        interpret(root, paths.iter().map(PathBuf::from), |p| {
            p.to_str()
                .unwrap()
                .contains("/books/.readlet/devices/other/profile.json")
                .then_some(StoreChange::Profile)
        })
    }

    #[test]
    fn book_changes_trigger_a_rescan() {
        assert!(run(&["/books/Austen/Emma.epub"]).rescan);
        assert!(run(&["/books/New folder"]).rescan);
        assert!(!run(&["/books/cover.jpg"]).rescan);
        assert!(!run(&["/books/.stversions/Emma.epub"]).rescan);
        assert!(!run(&["/books/.Emma.epub.123.tmp"]).rescan);
    }

    #[test]
    fn store_changes_are_classified_not_rescanned() {
        let result = run(&["/books/.readlet/devices/other/profile.json"]);
        assert!(!result.rescan);
        assert!(result.store.profile);
        assert!(
            run(&["/books/.readlet/devices/mine/profile.json"])
                .store
                .is_empty()
        );
    }

    #[test]
    fn ignores_reads_and_metadata_changes() {
        use notify::event::{AccessKind, CreateKind, DataChange, MetadataKind};
        assert!(!is_relevant(&EventKind::Access(AccessKind::Any)));
        assert!(!is_relevant(&EventKind::Modify(ModifyKind::Metadata(
            MetadataKind::AccessTime
        ))));
        assert!(is_relevant(&EventKind::Modify(ModifyKind::Data(
            DataChange::Any
        ))));
        assert!(is_relevant(&EventKind::Create(CreateKind::File)));
    }

    #[test]
    fn reading_files_does_not_count_as_a_change() {
        let dir = tempfile::tempdir().unwrap();
        let book = dir.path().join("Walden.epub");
        std::fs::write(&book, b"x").unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let _watcher = start(dir.path(), move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();
        let _ = std::fs::read(&book).unwrap();
        let _ = std::fs::read_dir(dir.path()).unwrap().count();
        assert!(rx.recv_timeout(Duration::from_secs(3)).is_err());
    }

    #[test]
    fn notices_new_files_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let _watcher = start(dir.path(), move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();
        std::fs::write(dir.path().join("Walden.epub"), b"x").unwrap();
        let paths = rx.recv_timeout(Duration::from_secs(10)).expect("an event");
        assert!(paths.iter().any(|p| p.ends_with("Walden.epub")));
    }
}
