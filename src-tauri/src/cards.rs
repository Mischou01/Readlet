//! Book cards: what each device tells the others about the books it has. Reading data syncs
//! without the book files, so a book read on the phone has no file on the laptop; its card lets
//! the laptop still show it, in the library, stats and highlights.
//!
//! Each device writes its own catalog (`Store::write_catalog`) from its index, with a small cover
//! for the books that have reading data. Other devices' catalogs are read back as `BookEntry`s
//! without a file, and the reading data's edits apply to them as to any book.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::aura::Palette;
use crate::covers;
use crate::error::Result;
use crate::index::{BookEntry, BookMetadata};
use crate::library::fingerprint;
use crate::library::formats::BookFormat;
use crate::store::Store;
use crate::store::model::BookRecord;

/// One book, as a device describes it to the others.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookCard {
    pub format: BookFormat,
    /// The book's own details. Descriptions stay out: they're long, and only the device with
    /// the book shows them.
    #[serde(flatten)]
    pub metadata: BookMetadata,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub palette: Option<Palette>,
    /// The version of the small cover in `cards/<fingerprint>.jpg`, when the device shares one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<i64>,
    pub added_at: i64,
}

/// A device's `catalog.json`. Read back with `T = Value`, so one card a newer Readlet wrote
/// (with a format this one doesn't know, say) is skipped instead of the whole catalog.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog<T> {
    #[serde(default = "BTreeMap::new")]
    pub books: BTreeMap<String, T>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl<T> Default for Catalog<T> {
    fn default() -> Self {
        Self {
            books: BTreeMap::new(),
            extra: Map::new(),
        }
    }
}

/// A book only other devices have.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElsewhereBook {
    #[serde(flatten)]
    pub entry: BookEntry,
    /// The names of the devices that have it.
    pub devices: Vec<String>,
}

/// Whether a book has reading data worth showing on the other devices: those get a cover.
fn has_reading_data(record: &BookRecord) -> bool {
    record.progress.is_some()
        || record.status.is_some()
        || record.annotations.iter().any(|a| !a.deleted)
}

fn card_of(entry: &BookEntry, cover: Option<i64>) -> BookCard {
    BookCard {
        format: entry.format,
        metadata: BookMetadata {
            description: None,
            ..entry.metadata.clone()
        },
        palette: entry.palette.clone(),
        cover,
        added_at: entry.added_at,
    }
}

/// Rewrites this device's catalog from its books (`books`, as the index has them, without
/// edits) and the covers it shares. Returns whether anything changed.
pub fn refresh_own(
    store: &Store,
    books: &[BookEntry],
    records: &HashMap<String, BookRecord>,
    covers_dir: &Path,
) -> Result<bool> {
    let previous: Catalog<BookCard> = store.own_catalog().unwrap_or_default();
    let mut changed = false;
    let mut shared = HashSet::new();
    let mut catalog = Catalog {
        books: BTreeMap::new(),
        extra: previous.extra.clone(),
    };
    // DRM-locked books can't be read anywhere, so there's nothing to show of them elsewhere.
    for entry in books.iter().filter(|b| !b.drm) {
        let fp = &entry.fingerprint;
        let wanted = entry
            .cover_version
            .filter(|_| records.get(fp).is_some_and(has_reading_data));
        let cover = wanted.and_then(|version| {
            let card = store.own_card_path(fp);
            let current = previous.books.get(fp).and_then(|c| c.cover) == Some(version);
            if current && card.is_file() {
                return Some(version);
            }
            match covers::store_card(&covers::cover_path(covers_dir, fp), &card) {
                Ok(()) => {
                    changed = true;
                    Some(version)
                }
                Err(e) => {
                    log::warn!("couldn't share the cover of {fp}: {e}");
                    None
                }
            }
        });
        if cover.is_some() {
            shared.insert(fp.clone());
        }
        catalog.books.insert(fp.clone(), card_of(entry, cover));
    }
    for fp in store.own_card_fingerprints() {
        if !shared.contains(&fp) {
            let _ = std::fs::remove_file(store.own_card_path(&fp));
            changed = true;
        }
    }
    Ok(store.write_catalog(&catalog)? || changed)
}

/// The books other devices have and this one doesn't (`local`), with the reader's edits applied.
pub fn elsewhere(
    store: &Store,
    local: &HashSet<String>,
    records: &HashMap<String, BookRecord>,
) -> Vec<ElsewhereBook> {
    let mut found: BTreeMap<String, ElsewhereBook> = BTreeMap::new();
    for (device, catalog) in store.other_catalogs::<Catalog<Value>>() {
        for (fp, card) in catalog.books {
            if !fingerprint::is_valid(&fp) || local.contains(&fp) {
                continue;
            }
            let Ok(card) = serde_json::from_value::<BookCard>(card) else {
                continue;
            };
            match found.get_mut(&fp) {
                // Several devices have it: any one's card will do, but one with a cover is nicer.
                Some(book) => {
                    book.devices.push(device.name.clone());
                    if book.entry.cover_version.is_none() && card.cover.is_some() {
                        book.entry = entry_of(&fp, card);
                    }
                }
                None => {
                    let book = ElsewhereBook {
                        entry: entry_of(&fp, card),
                        devices: vec![device.name.clone()],
                    };
                    found.insert(fp, book);
                }
            }
        }
    }
    found
        .into_values()
        .map(|mut book| {
            if let Some(record) = records.get(&book.entry.fingerprint) {
                book.entry = book.entry.with_edits(record);
            }
            book
        })
        .collect()
}

fn entry_of(fingerprint: &str, card: BookCard) -> BookEntry {
    BookEntry {
        fingerprint: fingerprint.to_owned(),
        path: String::new(),
        format: card.format,
        size: 0,
        drm: false,
        added_at: card.added_at,
        modified_at: card.added_at,
        metadata_ready: true,
        metadata_error: None,
        metadata: card.metadata,
        edited: Vec::new(),
        cover_version: card.cover,
        palette: card.palette,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::{Progress, Stamped};

    const DUNE: &str = "0123456789abcdef0123456789abcdef";
    const EMMA: &str = "fedcba9876543210fedcba9876543210";
    const LAPTOP: &str = "aaaaaaaaaaaaaaaa";
    const PHONE: &str = "bbbbbbbbbbbbbbbb";

    fn book(fp: &str, title: &str) -> BookEntry {
        entry_of(
            fp,
            BookCard {
                format: BookFormat::Epub,
                metadata: BookMetadata {
                    title: Some(title.into()),
                    description: Some("<p>Long.</p>".into()),
                    ..Default::default()
                },
                palette: None,
                cover: None,
                added_at: 1,
            },
        )
    }

    fn reading(fp: &str) -> BookRecord {
        BookRecord {
            progress: Some(Progress {
                cfi: "epubcfi(/6/2)".into(),
                fraction: 0.3,
                label: None,
                updated_at: 5,
            }),
            ..BookRecord::new(fp)
        }
    }

    #[test]
    fn books_on_another_device_show_with_their_edits() {
        let dir = tempfile::tempdir().unwrap();
        let laptop = Store::open(dir.path(), LAPTOP, "Laptop").unwrap();
        let phone = Store::open(dir.path(), PHONE, "Pixel 8").unwrap();
        let covers = dir.path().join("cache");
        let phone_books = [book(DUNE, "Dune"), book(EMMA, "Emma")];
        assert!(refresh_own(&phone, &phone_books, &HashMap::new(), &covers).unwrap());
        assert!(!refresh_own(&phone, &phone_books, &HashMap::new(), &covers).unwrap());

        let mut edited = reading(DUNE);
        edited.details.insert(
            "title".into(),
            Stamped {
                value: Value::from("Dune (1965)"),
                updated_at: 9,
            },
        );
        let records = HashMap::from([(DUNE.to_owned(), edited)]);
        let local = HashSet::from([EMMA.to_owned()]);
        let books = elsewhere(&laptop, &local, &records);
        assert_eq!(books.len(), 1, "Emma is on the laptop too");
        assert_eq!(
            books[0].entry.metadata.title.as_deref(),
            Some("Dune (1965)")
        );
        assert_eq!(books[0].entry.metadata.description, None);
        assert_eq!(books[0].devices, ["Pixel 8"]);
        assert!(books[0].entry.path.is_empty());
    }

    #[test]
    fn shares_covers_of_books_being_read_only() {
        let dir = tempfile::tempdir().unwrap();
        let phone = Store::open(dir.path(), PHONE, "Pixel 8").unwrap();
        let covers_dir = dir.path().join("cache");
        let mut dune = book(DUNE, "Dune");
        let mut emma = book(EMMA, "Emma");
        dune.cover_version = Some(2);
        emma.cover_version = Some(1);
        let image = image::RgbImage::from_pixel(60, 90, image::Rgb([200, 120, 40]));
        for fp in [DUNE, EMMA] {
            std::fs::create_dir_all(&covers_dir).unwrap();
            image.save(covers::cover_path(&covers_dir, fp)).unwrap();
        }
        let records = HashMap::from([(DUNE.to_owned(), reading(DUNE))]);
        refresh_own(&phone, &[dune.clone(), emma], &records, &covers_dir).unwrap();
        assert_eq!(phone.own_card_fingerprints(), [DUNE]);
        let catalog: Catalog<BookCard> = phone.own_catalog().unwrap();
        assert_eq!(catalog.books[DUNE].cover, Some(2));
        assert_eq!(catalog.books[EMMA].cover, None);

        // Not read any more (its reading data was removed): its cover goes too.
        refresh_own(&phone, &[dune], &HashMap::new(), &covers_dir).unwrap();
        assert!(phone.own_card_fingerprints().is_empty());
    }

    #[test]
    fn a_card_this_version_cant_read_is_skipped_alone() {
        let dir = tempfile::tempdir().unwrap();
        let laptop = Store::open(dir.path(), LAPTOP, "Laptop").unwrap();
        let phone = Store::open(dir.path(), PHONE, "Pixel 8").unwrap();
        let catalog = serde_json::json!({ "books": {
            DUNE: { "format": "epub", "title": "Dune", "addedAt": 1 },
            EMMA: { "format": "djvu", "title": "Emma", "addedAt": 1 },
        }});
        phone.write_catalog(&catalog).unwrap();
        let books = elsewhere(&laptop, &HashSet::new(), &HashMap::new());
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].entry.fingerprint, DUNE);
    }
}
