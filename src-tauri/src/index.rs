//! The SQLite index: a cache of what's in the library folder and each book's metadata, cover and
//! aura. Deleting it is safe; Readlet rebuilds it from the folder (docs/PLAN.md §4).

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use crate::aura::Palette;
use crate::error::Result;
use crate::library::formats::BookFormat;

/// Bump to rebuild the cache after a schema change.
const SCHEMA_VERSION: i32 = 1;
/// Bump to re-extract metadata for every book (e.g. after improving the extractor).
pub const METADATA_VERSION: i64 = 1;

/// What the scanner knows about a file before its metadata is extracted.
#[derive(Debug, Clone, PartialEq)]
pub struct FileRecord {
    pub fingerprint: String,
    pub rel_path: String,
    pub size: u64,
    pub mtime_ms: i64,
    pub format: BookFormat,
    pub drm: bool,
}

/// Metadata extracted by foliate-js in the webview.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BookMetadata {
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub series: Option<String>,
    pub series_index: Option<f64>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub published: Option<String>,
    pub description: Option<String>,
    pub identifier: Option<String>,
}

impl BookMetadata {
    /// Trims strings, drops empty ones and caps lengths so a hostile book can't bloat the index.
    pub fn sanitized(mut self) -> Self {
        fn clean(value: Option<String>, max: usize) -> Option<String> {
            let value = value?;
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return None;
            }
            Some(trimmed.chars().take(max).collect())
        }
        self.title = clean(self.title, 500);
        self.authors = self
            .authors
            .into_iter()
            .filter_map(|a| clean(Some(a), 200))
            .take(20)
            .collect();
        self.series = clean(self.series, 300);
        self.series_index = self.series_index.filter(|i| i.is_finite() && *i >= 0.0);
        self.language = clean(self.language, 35);
        self.publisher = clean(self.publisher, 300);
        self.published = clean(self.published, 50);
        self.description = clean(self.description, 5000);
        self.identifier = clean(self.identifier, 300);
        self
    }
}

/// A book as the UI sees it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookEntry {
    pub fingerprint: String,
    pub path: String,
    pub format: BookFormat,
    pub size: u64,
    pub drm: bool,
    pub added_at: i64,
    pub modified_at: i64,
    pub metadata_ready: bool,
    pub metadata_error: Option<String>,
    #[serde(flatten)]
    pub metadata: BookMetadata,
    /// Increments whenever the cover changes, so the UI can bust its image cache.
    pub cover_version: Option<i64>,
    pub palette: Option<Palette>,
}

pub struct Index {
    conn: Connection,
}

impl Index {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
        if version != SCHEMA_VERSION {
            // It's a cache: start over rather than migrate.
            conn.execute_batch(
                "DROP TABLE IF EXISTS books;
                 DROP TABLE IF EXISTS meta;",
            )?;
            conn.execute_batch(
                "CREATE TABLE meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                 );
                 CREATE TABLE books (
                    fingerprint TEXT PRIMARY KEY,
                    rel_path TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    mtime_ms INTEGER NOT NULL,
                    format TEXT NOT NULL,
                    drm INTEGER NOT NULL DEFAULT 0,
                    added_ms INTEGER NOT NULL,
                    meta_version INTEGER NOT NULL DEFAULT 0,
                    meta_error TEXT,
                    metadata TEXT,
                    cover_version INTEGER,
                    palette TEXT
                 );
                 CREATE INDEX books_rel_path ON books (rel_path);",
            )?;
            conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        }
        Ok(Self { conn })
    }

    /// The library root the index was built for. A different root means a different library.
    pub fn root(&self) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM meta WHERE key = 'root'", [], |r| {
                r.get(0)
            })
            .optional()?)
    }

    /// Points the index at a library root, clearing it if the root changed.
    pub fn set_root(&mut self, root: &str) -> Result<()> {
        if self.root()?.as_deref() == Some(root) {
            return Ok(());
        }
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM books", [])?;
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('root', ?1)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            [root],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Every indexed file, for diffing against a fresh scan.
    pub fn files(&self) -> Result<Vec<FileRecord>> {
        let mut stmt = self
            .conn
            .prepare("SELECT fingerprint, rel_path, size, mtime_ms, format, drm FROM books")?;
        let rows = stmt.query_map([], |r| {
            let format: String = r.get(4)?;
            Ok(FileRecord {
                fingerprint: r.get(0)?,
                rel_path: r.get(1)?,
                size: r.get::<_, i64>(2)?.max(0) as u64,
                mtime_ms: r.get(3)?,
                format: BookFormat::parse(&format).unwrap_or(BookFormat::Epub),
                drm: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Applies a scan: upserts found files and removes the ones that are gone.
    pub fn apply_scan(
        &mut self,
        upserts: &[FileRecord],
        removed: &[String],
        now: i64,
    ) -> Result<()> {
        let tx = self.conn.transaction()?;
        for file in upserts {
            upsert_file(&tx, file, now)?;
        }
        for fingerprint in removed {
            tx.execute("DELETE FROM books WHERE fingerprint = ?1", [fingerprint])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn rel_path(&self, fingerprint: &str) -> Result<Option<(String, BookFormat)>> {
        Ok(self
            .conn
            .query_row(
                "SELECT rel_path, format FROM books WHERE fingerprint = ?1",
                [fingerprint],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .optional()?
            .map(|(path, format)| (path, BookFormat::parse(&format).unwrap_or(BookFormat::Epub))))
    }

    pub fn contains(&self, fingerprint: &str) -> Result<bool> {
        Ok(self.rel_path(fingerprint)?.is_some())
    }

    pub fn books(&self) -> Result<Vec<BookEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT fingerprint, rel_path, format, size, drm, added_ms, mtime_ms,
                    meta_version, meta_error, metadata, cover_version, palette
             FROM books ORDER BY added_ms DESC, rel_path",
        )?;
        let rows = stmt.query_map([], book_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn book(&self, fingerprint: &str) -> Result<Option<BookEntry>> {
        Ok(self
            .conn
            .query_row(
                "SELECT fingerprint, rel_path, format, size, drm, added_ms, mtime_ms,
                        meta_version, meta_error, metadata, cover_version, palette
                 FROM books WHERE fingerprint = ?1",
                [fingerprint],
                book_from_row,
            )
            .optional()?)
    }

    /// Books whose metadata hasn't been extracted with the current extractor yet.
    pub fn needing_metadata(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT fingerprint FROM books
             WHERE meta_version < ?1
             ORDER BY added_ms DESC",
        )?;
        let rows = stmt.query_map([METADATA_VERSION], |r| r.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn set_metadata(
        &self,
        fingerprint: &str,
        metadata: &BookMetadata,
        error: Option<&str>,
    ) -> Result<bool> {
        let changed = self.conn.execute(
            "UPDATE books SET metadata = ?2, meta_error = ?3, meta_version = ?4
             WHERE fingerprint = ?1",
            params![
                fingerprint,
                serde_json::to_string(metadata)?,
                error,
                METADATA_VERSION
            ],
        )?;
        Ok(changed > 0)
    }

    /// Records a new cover (or `None` when the book has none) and its aura.
    pub fn set_cover(&self, fingerprint: &str, has_cover: bool, palette: &Palette) -> Result<bool> {
        let changed = self.conn.execute(
            "UPDATE books SET
                cover_version = CASE WHEN ?2 THEN COALESCE(cover_version, 0) + 1 ELSE NULL END,
                palette = ?3
             WHERE fingerprint = ?1",
            params![fingerprint, has_cover, serde_json::to_string(palette)?],
        )?;
        Ok(changed > 0)
    }
}

fn upsert_file(tx: &Transaction<'_>, file: &FileRecord, now: i64) -> Result<()> {
    tx.execute(
        "INSERT INTO books (fingerprint, rel_path, size, mtime_ms, format, drm, added_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT (fingerprint) DO UPDATE SET
            rel_path = excluded.rel_path,
            size = excluded.size,
            mtime_ms = excluded.mtime_ms,
            format = excluded.format,
            drm = excluded.drm",
        params![
            file.fingerprint,
            file.rel_path,
            i64::try_from(file.size).unwrap_or(i64::MAX),
            file.mtime_ms,
            file.format.as_str(),
            file.drm,
            now
        ],
    )?;
    Ok(())
}

fn book_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<BookEntry> {
    let format: String = r.get(2)?;
    let metadata: Option<String> = r.get(9)?;
    let palette: Option<String> = r.get(11)?;
    let meta_version: i64 = r.get(7)?;
    Ok(BookEntry {
        fingerprint: r.get(0)?,
        path: r.get(1)?,
        format: BookFormat::parse(&format).unwrap_or(BookFormat::Epub),
        size: r.get::<_, i64>(3)?.max(0) as u64,
        drm: r.get(4)?,
        added_at: r.get(5)?,
        modified_at: r.get(6)?,
        metadata_ready: meta_version >= METADATA_VERSION,
        metadata_error: r.get(8)?,
        metadata: metadata
            .and_then(|m| serde_json::from_str(&m).ok())
            .unwrap_or_default(),
        cover_version: r.get(10)?,
        palette: palette.and_then(|p| serde_json::from_str(&p).ok()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(fp: &str, path: &str) -> FileRecord {
        FileRecord {
            fingerprint: fp.into(),
            rel_path: path.into(),
            size: 10,
            mtime_ms: 5,
            format: BookFormat::Epub,
            drm: false,
        }
    }

    #[test]
    fn upserts_and_removes_files() {
        let mut index = Index::open_in_memory().unwrap();
        index.set_root("/books").unwrap();
        index
            .apply_scan(&[file("a", "a.epub"), file("b", "b.epub")], &[], 1)
            .unwrap();
        assert_eq!(index.files().unwrap().len(), 2);

        // b was moved: same fingerprint, new path, original added time kept.
        index
            .apply_scan(&[file("b", "sub/b.epub")], &["a".into()], 2)
            .unwrap();
        let books = index.books().unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].path, "sub/b.epub");
        assert_eq!(books[0].added_at, 1);
    }

    #[test]
    fn changing_the_root_clears_the_index() {
        let mut index = Index::open_in_memory().unwrap();
        index.set_root("/one").unwrap();
        index.apply_scan(&[file("a", "a.epub")], &[], 1).unwrap();
        index.set_root("/one").unwrap();
        assert_eq!(index.books().unwrap().len(), 1);
        index.set_root("/two").unwrap();
        assert!(index.books().unwrap().is_empty());
    }

    #[test]
    fn tracks_metadata_extraction() {
        let mut index = Index::open_in_memory().unwrap();
        index.set_root("/books").unwrap();
        index.apply_scan(&[file("a", "a.epub")], &[], 1).unwrap();
        assert_eq!(index.needing_metadata().unwrap(), vec!["a".to_owned()]);

        let metadata = BookMetadata {
            title: Some("  Middlemarch ".into()),
            authors: vec!["George Eliot".into(), " ".into()],
            ..Default::default()
        }
        .sanitized();
        assert!(index.set_metadata("a", &metadata, None).unwrap());
        assert!(index.needing_metadata().unwrap().is_empty());

        let book = index.book("a").unwrap().unwrap();
        assert!(book.metadata_ready);
        assert_eq!(book.metadata.title.as_deref(), Some("Middlemarch"));
        assert_eq!(book.metadata.authors, vec!["George Eliot".to_owned()]);
    }

    #[test]
    fn cover_version_increments_and_resets() {
        let mut index = Index::open_in_memory().unwrap();
        index.set_root("/books").unwrap();
        index.apply_scan(&[file("a", "a.epub")], &[], 1).unwrap();
        let palette = Palette::fallback();
        index.set_cover("a", true, &palette).unwrap();
        index.set_cover("a", true, &palette).unwrap();
        assert_eq!(index.book("a").unwrap().unwrap().cover_version, Some(2));
        index.set_cover("a", false, &palette).unwrap();
        let book = index.book("a").unwrap().unwrap();
        assert_eq!(book.cover_version, None);
        assert!(book.palette.is_some());
    }

    #[test]
    fn keeps_the_drm_flag() {
        let mut index = Index::open_in_memory().unwrap();
        index.set_root("/books").unwrap();
        let mut locked = file("a", "a.epub");
        locked.drm = true;
        index.apply_scan(&[locked], &[], 1).unwrap();
        // The package metadata of a protected EPUB is usually readable, so it's still queued.
        assert_eq!(index.needing_metadata().unwrap(), vec!["a".to_owned()]);
        assert!(index.book("a").unwrap().unwrap().drm);
    }
}
