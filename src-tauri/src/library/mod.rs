//! The library folder: finding books in it, watching it (on desktop), and adding books to it and
//! deleting them.
//!
//! Readlet never renames or moves the reader's files, and deletes one only when the reader asks
//! (moving it to the trash where there is one). In the library folder it only writes inside
//! `.readlet/` and the books copied in by "Add books" (docs/PLAN.md §8).

pub mod fingerprint;
pub mod formats;
pub mod scan;
#[cfg(desktop)]
pub mod watch;

use std::fs;
use std::path::{Component, Path, PathBuf};
#[cfg(desktop)]
use std::sync::Mutex;

use crate::error::{Error, Result};
use crate::store::Store;
use formats::BookFormat;

pub struct Library {
    pub root: PathBuf,
    pub store: Store,
    #[cfg(desktop)]
    watcher: Mutex<Option<watch::Watcher>>,
}

impl Library {
    pub fn open(root: &Path, device_id: &str, device_name: &str) -> Result<Self> {
        if !root.is_dir() {
            return Err(Error::FolderUnavailable(root.display().to_string()));
        }
        let root = dunce_canonicalize(root)?;
        let store = Store::open(&root, device_id, device_name)?;
        Ok(Self {
            root,
            store,
            #[cfg(desktop)]
            watcher: Mutex::new(None),
        })
    }

    #[cfg(desktop)]
    pub fn set_watcher(&self, watcher: Option<watch::Watcher>) {
        *self.watcher.lock().unwrap_or_else(|e| e.into_inner()) = watcher;
    }

    /// Turns an indexed relative path into an absolute one, refusing anything that could point
    /// outside the library.
    pub fn resolve(&self, rel_path: &str) -> Result<PathBuf> {
        let rel = Path::new(rel_path);
        let safe = rel.components().all(|c| matches!(c, Component::Normal(_)));
        if !safe || rel_path.is_empty() {
            return Err(Error::invalid("invalid book path"));
        }
        Ok(self.root.join(rel))
    }

    /// Copies books into the top of the library folder. Existing files are never overwritten:
    /// a different book with the same name gets a numbered name, and a file that's already in
    /// the folder is skipped. Returns the names of the files that were added.
    pub fn add_books(&self, sources: &[PathBuf]) -> Result<Vec<String>> {
        let mut added = Vec::new();
        for source in sources {
            if BookFormat::from_path(source).is_none() || !source.is_file() {
                log::info!("not adding a file that isn't a book");
                continue;
            }
            let source = dunce_canonicalize(source)?;
            if source.starts_with(&self.root) {
                continue; // already in the library
            }
            let Some(dest) = self.free_destination(&source)? else {
                continue;
            };
            let name = dest
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            // Copy under a hidden name and rename, so the watcher never indexes a half-copied file.
            let tmp = self
                .root
                .join(format!(".{name}.{}.tmp", std::process::id()));
            fs::copy(&source, &tmp)?;
            if let Err(e) = fs::rename(&tmp, &dest) {
                let _ = fs::remove_file(&tmp);
                return Err(e.into());
            }
            added.push(name);
        }
        Ok(added)
    }

    /// Deletes a book file the reader asked to delete: on the desktop it goes to the trash, where
    /// it can be restored; Android has no trash for files, so there it's gone. Its reading data in
    /// `.readlet/` stays, so the book picks up where it was if it comes back. A file that's already
    /// gone counts as deleted.
    pub fn delete_book(&self, rel_path: &str) -> Result<()> {
        let path = self.resolve(rel_path)?;
        // Only ever book files: never a folder, nor anything the index shouldn't have held.
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_file() && BookFormat::from_path(&path).is_some() => {}
            Ok(_) => return Err(Error::invalid("that isn't a book file")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.into()),
        }
        remove_book_file(&path)
    }

    /// Picks `name.ext`, `name (2).ext`, … — or `None` if an identical copy is already there.
    fn free_destination(&self, source: &Path) -> Result<Option<PathBuf>> {
        let file_name = source
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| Error::invalid("the file name isn't valid UTF-8"))?;
        let (stem, ext) = split_extension(file_name);
        let source_fp = fingerprint::fingerprint(source)?;
        for n in 1..1000 {
            let candidate = if n == 1 {
                self.root.join(file_name)
            } else {
                self.root.join(format!("{stem} ({n}){ext}"))
            };
            if !candidate.exists() {
                return Ok(Some(candidate));
            }
            if fingerprint::fingerprint(&candidate).ok().as_deref() == Some(source_fp.as_str()) {
                return Ok(None);
            }
        }
        Err(Error::invalid("too many files with that name"))
    }
}

#[cfg(desktop)]
fn remove_book_file(path: &Path) -> Result<()> {
    trash::delete(path).map_err(|e| Error::Trash(e.to_string()))
}

#[cfg(mobile)]
fn remove_book_file(path: &Path) -> Result<()> {
    Ok(fs::remove_file(path)?)
}

/// Splits `book.fb2.zip` into (`book`, `.fb2.zip`) and `Emma.epub` into (`Emma`, `.epub`).
fn split_extension(name: &str) -> (&str, &str) {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".fb2.zip") {
        return name.split_at(name.len() - ".fb2.zip".len());
    }
    match name.rfind('.') {
        Some(i) if i > 0 => name.split_at(i),
        _ => (name, ""),
    }
}

/// `fs::canonicalize`, minus the `\\?\` prefix it adds on Windows.
fn dunce_canonicalize(path: &Path) -> Result<PathBuf> {
    let path = fs::canonicalize(path)?;
    #[cfg(windows)]
    {
        if let Some(s) = path.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
            if !s.starts_with("UNC\\") {
                return Ok(PathBuf::from(s));
            }
        }
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEVICE: &str = "aaaaaaaaaaaaaaaa";

    #[test]
    fn splits_extensions() {
        assert_eq!(split_extension("Emma.epub"), ("Emma", ".epub"));
        assert_eq!(split_extension("tale.FB2.zip"), ("tale", ".FB2.zip"));
        assert_eq!(split_extension(".hidden"), (".hidden", ""));
    }

    #[test]
    fn resolve_refuses_escapes() {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path(), DEVICE, "Test").unwrap();
        assert!(library.resolve("Austen/Emma.epub").is_ok());
        assert!(library.resolve("../etc/passwd").is_err());
        assert!(library.resolve("/etc/passwd").is_err());
        assert!(library.resolve("").is_err());
    }

    #[test]
    fn adding_books_never_overwrites() {
        let library_dir = tempfile::tempdir().unwrap();
        let downloads = tempfile::tempdir().unwrap();
        let library = Library::open(library_dir.path(), DEVICE, "Test").unwrap();

        let a = downloads.path().join("Emma.epub");
        fs::write(&a, b"first edition").unwrap();
        assert_eq!(
            library.add_books(std::slice::from_ref(&a)).unwrap(),
            ["Emma.epub"]
        );
        // The same file again is skipped.
        assert!(
            library
                .add_books(std::slice::from_ref(&a))
                .unwrap()
                .is_empty()
        );
        // A different book with the same name gets a new name.
        fs::write(&a, b"second edition").unwrap();
        assert_eq!(library.add_books(&[a]).unwrap(), ["Emma (2).epub"]);
        assert_eq!(
            fs::read(library_dir.path().join("Emma.epub")).unwrap(),
            b"first edition"
        );

        // Non-books are ignored.
        let txt = downloads.path().join("notes.txt");
        fs::write(&txt, b"x").unwrap();
        assert!(library.add_books(&[txt]).unwrap().is_empty());
    }

    #[test]
    fn deletes_only_book_files() {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path(), DEVICE, "Test").unwrap();
        fs::create_dir(dir.path().join("Austen.epub")).unwrap();
        fs::write(dir.path().join("notes.txt"), b"x").unwrap();
        assert!(library.delete_book("Austen.epub").is_err());
        assert!(library.delete_book("notes.txt").is_err());
        assert!(library.delete_book("../outside.epub").is_err());
        assert!(dir.path().join("notes.txt").exists());
        // Already gone: nothing to do.
        assert!(library.delete_book("Missing.epub").is_ok());
    }

    #[test]
    fn opening_a_missing_folder_fails_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope");
        assert!(matches!(
            Library::open(&missing, DEVICE, "Test"),
            Err(Error::FolderUnavailable(_))
        ));
    }
}
