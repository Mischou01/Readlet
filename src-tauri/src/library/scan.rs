//! Walking the library folder and working out what changed since the last scan.
//!
//! Files whose size and modification time match the index are not read again, so rescans of a
//! large folder are cheap. Changed or new files are fingerprinted (which also catches moves and
//! renames: same fingerprint, new path).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::{DirEntry, WalkDir};

use super::formats::{self, BookFormat};
use crate::fsutil;
use crate::index::FileRecord;

#[derive(Debug, Clone, PartialEq)]
pub struct FoundFile {
    pub abs_path: PathBuf,
    pub rel_path: String,
    pub size: u64,
    pub mtime_ms: i64,
    pub format: BookFormat,
}

#[derive(Debug, Default, PartialEq)]
pub struct ScanPlan {
    pub upserts: Vec<FileRecord>,
    pub removed: Vec<String>,
    pub report: ScanReport,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub total: usize,
}

/// Hidden files and folders are skipped: that covers Readlet's own `.readlet/` folder, our
/// temporary files and sync tools' bookkeeping (`.stfolder`, `.stversions`, …).
fn is_hidden(entry: &DirEntry) -> bool {
    entry.depth() > 0
        && entry
            .file_name()
            .to_str()
            .is_some_and(|n| n.starts_with('.'))
}

/// Lists every book file under `root`. Unreadable entries are skipped.
pub fn walk(root: &Path) -> Vec<FoundFile> {
    let mut found: Vec<FoundFile> = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !is_hidden(e))
        .filter_map(|entry| {
            let entry = entry
                .inspect_err(|e| log::debug!("skipping entry: {e}"))
                .ok()?;
            if !entry.file_type().is_file() {
                return None;
            }
            let format = BookFormat::from_path(entry.path())?;
            let metadata = entry.metadata().ok()?;
            let rel = entry.path().strip_prefix(root).ok()?;
            let rel_path = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            Some(FoundFile {
                abs_path: entry.path().to_path_buf(),
                rel_path,
                size: metadata.len(),
                mtime_ms: fsutil::system_time_ms(metadata.modified()),
                format,
            })
        })
        .collect();
    found.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    found
}

/// Compares a fresh walk with the index. `identify` fingerprints a file and checks it for DRM;
/// it's only called for new or changed files.
pub fn plan(
    found: &[FoundFile],
    existing: &[FileRecord],
    mut identify: impl FnMut(&FoundFile) -> std::io::Result<(String, bool)>,
) -> ScanPlan {
    let by_path: HashMap<&str, &FileRecord> =
        existing.iter().map(|f| (f.rel_path.as_str(), f)).collect();
    let known: HashSet<&str> = existing.iter().map(|f| f.fingerprint.as_str()).collect();
    let mut present: HashSet<String> = HashSet::new();
    let mut plan = ScanPlan::default();

    for file in found {
        if let Some(record) = by_path.get(file.rel_path.as_str())
            && record.size == file.size
            && record.mtime_ms == file.mtime_ms
        {
            present.insert(record.fingerprint.clone());
            continue;
        }
        let (fingerprint, drm) = match identify(file) {
            Ok(id) => id,
            Err(e) => {
                log::warn!("couldn't read {}: {e}", file.rel_path);
                continue;
            }
        };
        // The same book twice in the folder: keep the first path (in sorted order).
        if !present.insert(fingerprint.clone()) {
            continue;
        }
        if known.contains(fingerprint.as_str()) {
            plan.report.updated += 1;
        } else {
            plan.report.added += 1;
        }
        plan.upserts.push(FileRecord {
            fingerprint,
            rel_path: file.rel_path.clone(),
            size: file.size,
            mtime_ms: file.mtime_ms,
            format: file.format,
            drm,
        });
    }

    plan.removed = existing
        .iter()
        .filter(|f| !present.contains(&f.fingerprint))
        .map(|f| f.fingerprint.clone())
        .collect();
    plan.report.removed = plan.removed.len();
    plan.report.total = present.len();
    plan
}

/// The real `identify`: fingerprint plus DRM check.
pub fn identify(file: &FoundFile) -> std::io::Result<(String, bool)> {
    let fingerprint = super::fingerprint::fingerprint(&file.abs_path)?;
    let drm = formats::is_drm_protected(&file.abs_path, file.format);
    Ok((fingerprint, drm))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn found(rel: &str, size: u64, mtime_ms: i64) -> FoundFile {
        FoundFile {
            abs_path: PathBuf::from(rel),
            rel_path: rel.into(),
            size,
            mtime_ms,
            format: BookFormat::Epub,
        }
    }

    fn record(fp: &str, rel: &str, size: u64, mtime_ms: i64) -> FileRecord {
        FileRecord {
            fingerprint: fp.into(),
            rel_path: rel.into(),
            size,
            mtime_ms,
            format: BookFormat::Epub,
            drm: false,
        }
    }

    /// Fingerprints are derived from the file name's first letter so tests can model content.
    fn fake_identify(file: &FoundFile) -> std::io::Result<(String, bool)> {
        Ok((
            format!("fp-{}", &file.rel_path.rsplit('/').next().unwrap()[..1]),
            false,
        ))
    }

    #[test]
    fn unchanged_files_are_not_read_again() {
        let existing = [record("fp-a", "a.epub", 10, 1)];
        let plan = plan(&[found("a.epub", 10, 1)], &existing, |_| {
            panic!("should not be read")
        });
        assert!(plan.upserts.is_empty());
        assert!(plan.removed.is_empty());
        assert_eq!(
            plan.report,
            ScanReport {
                added: 0,
                updated: 0,
                removed: 0,
                total: 1
            }
        );
    }

    #[test]
    fn detects_new_changed_and_removed_files() {
        let existing = [
            record("fp-a", "a.epub", 10, 1),
            record("fp-b", "b.epub", 10, 1),
        ];
        let walk = [found("a.epub", 11, 2), found("c.epub", 5, 1)];
        let plan = plan(&walk, &existing, fake_identify);
        assert_eq!(plan.upserts.len(), 2);
        assert_eq!(plan.removed, vec!["fp-b".to_owned()]);
        assert_eq!(
            plan.report,
            ScanReport {
                added: 1,
                updated: 1,
                removed: 1,
                total: 2
            }
        );
    }

    #[test]
    fn a_moved_file_keeps_its_identity() {
        let existing = [record("fp-a", "a.epub", 10, 1)];
        let plan = plan(&[found("sub/a.epub", 10, 1)], &existing, fake_identify);
        assert_eq!(plan.upserts[0].rel_path, "sub/a.epub");
        assert!(plan.removed.is_empty());
        assert_eq!(plan.report.updated, 1);
    }

    #[test]
    fn duplicates_collapse_to_the_first_path() {
        let plan = plan(
            &[found("a.epub", 1, 1), found("x/a.epub", 1, 1)],
            &[],
            fake_identify,
        );
        assert_eq!(plan.upserts.len(), 1);
        assert_eq!(plan.upserts[0].rel_path, "a.epub");
    }

    #[test]
    fn unreadable_files_are_skipped() {
        let existing = [record("fp-a", "a.epub", 10, 1)];
        let plan = plan(&[found("a.epub", 12, 1)], &existing, |_| {
            Err(std::io::Error::other("permission denied"))
        });
        assert!(plan.upserts.is_empty());
        assert_eq!(plan.removed, vec!["fp-a".to_owned()]);
    }

    #[test]
    fn walk_finds_books_and_skips_hidden_folders() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("Fiction/Austen")).unwrap();
        fs::create_dir_all(root.join(".readlet/devices")).unwrap();
        fs::create_dir_all(root.join(".stversions")).unwrap();
        fs::write(root.join("Fiction/Austen/Emma.epub"), b"x").unwrap();
        fs::write(root.join("Walden.PDF"), b"x").unwrap();
        fs::write(root.join("notes.txt"), b"x").unwrap();
        fs::write(root.join(".hidden.epub"), b"x").unwrap();
        fs::write(root.join(".stversions/old.epub"), b"x").unwrap();
        let paths: Vec<_> = walk(root).into_iter().map(|f| f.rel_path).collect();
        assert_eq!(paths, ["Fiction/Austen/Emma.epub", "Walden.PDF"]);
    }

    #[test]
    fn identify_reads_real_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.epub");
        fs::write(&path, b"not really a zip").unwrap();
        let file = walk(dir.path()).remove(0);
        let (fp, drm) = identify(&file).unwrap();
        assert!(super::super::fingerprint::is_valid(&fp));
        assert!(!drm);
    }
}
