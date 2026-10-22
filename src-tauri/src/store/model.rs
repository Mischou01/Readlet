//! Reading data as it's stored in `.readlet/devices/<device>/` (docs/PLAN.md §4).
//!
//! Enum-like fields (status, colour, kind) are plain strings in the files, so a file written by a
//! newer Readlet with a value this version doesn't know still loads. Inputs from the UI are
//! validated before anything is written. Unknown fields are kept in `extra` and written back.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{Error, Result};

pub const STATUSES: [&str; 3] = ["reading", "toRead", "finished"];
pub const HIGHLIGHT_COLORS: [&str; 5] = ["butter", "peach", "mint", "sky", "lilac"];
pub const ANNOTATION_KINDS: [&str; 2] = ["highlight", "bookmark"];
pub const GOAL_UNITS: [&str; 2] = ["books", "minutes"];

/// A value with the time it was last changed, for last-writer-wins merging.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stamped<T> {
    pub value: T,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub cfi: String,
    pub fraction: f64,
    /// The chapter at this position, for showing "Chapter 4" without opening the book.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    pub id: String,
    pub kind: String,
    pub cfi: String,
    /// The highlighted text, kept so highlights can be listed without opening the book and
    /// re-anchored if the book is replaced by a new edition.
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fraction: Option<f64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Deleted annotations are kept as tombstones so the deletion syncs.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deleted: bool,
}

/// Everything one device knows about one book.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BookRecord {
    pub fingerprint: String,
    pub progress: Option<Progress>,
    pub status: Option<Stamped<String>>,
    pub annotations: Vec<Annotation>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl BookRecord {
    pub fn new(fingerprint: &str) -> Self {
        Self {
            fingerprint: fingerprint.to_owned(),
            ..Default::default()
        }
    }
}

/// One stretch of active reading. Sessions are append-only and never merged, only deduplicated.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub book: String,
    pub start: i64,
    pub end: i64,
    /// Time actually spent reading; idle stretches and time in other windows don't count.
    pub active_ms: i64,
    #[serde(default)]
    pub start_fraction: f64,
    #[serde(default)]
    pub end_fraction: f64,
    /// Words on the pages turned during the session, for words-per-minute.
    #[serde(default)]
    pub words: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearlyGoal {
    pub unit: String,
    pub target: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub daily_minutes: Option<Stamped<u32>>,
    pub yearly_goal: Option<Stamped<YearlyGoal>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub books: Vec<String>,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deleted: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShelvesDoc {
    pub shelves: Vec<Shelf>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A highlight shown in "From your highlights" on a given day.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resurfaced {
    pub highlight: String,
    /// Local calendar day, `YYYY-MM-DD`.
    pub day: String,
}

// ---------------------------------------------------------------------------------------------
// Input validation

pub fn validate_id(id: &str) -> Result<()> {
    let ok = (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok {
        Ok(())
    } else {
        Err(Error::invalid("invalid id"))
    }
}

pub fn validate_status(status: &str) -> Result<()> {
    if STATUSES.contains(&status) {
        Ok(())
    } else {
        Err(Error::invalid(format!("unknown status: {status}")))
    }
}

pub fn validate_cfi(cfi: &str) -> Result<()> {
    if cfi.starts_with("epubcfi(") && cfi.ends_with(')') && cfi.len() <= 4096 {
        Ok(())
    } else {
        Err(Error::invalid("invalid location"))
    }
}

pub fn validate_fraction(fraction: f64) -> Result<()> {
    if fraction.is_finite() && (0.0..=1.0).contains(&fraction) {
        Ok(())
    } else {
        Err(Error::invalid("progress must be between 0 and 1"))
    }
}

pub fn validate_day(day: &str) -> Result<()> {
    let b = day.as_bytes();
    let ok = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit());
    if ok {
        Ok(())
    } else {
        Err(Error::invalid("invalid day"))
    }
}

/// Caps free text so a runaway selection can't bloat the synced files.
pub fn limit_text(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_fields_and_values_survive_a_round_trip() {
        let json = r#"{
            "fingerprint": "abc",
            "status": { "value": "abandoned", "updatedAt": 3 },
            "annotations": [{
                "id": "x", "kind": "underline", "cfi": "epubcfi(/6/2)", "color": "rose",
                "createdAt": 1, "updatedAt": 2, "future": true
            }],
            "rating": 5
        }"#;
        let record: BookRecord = serde_json::from_str(json).unwrap();
        assert_eq!(record.status.as_ref().unwrap().value, "abandoned");
        assert_eq!(record.annotations[0].color.as_deref(), Some("rose"));
        assert_eq!(record.extra["rating"], 5);
        let back = serde_json::to_value(&record).unwrap();
        assert_eq!(back["rating"], 5);
    }

    #[test]
    fn validates_inputs() {
        assert!(validate_id("3f2a-b_c").is_ok());
        assert!(validate_id("../x").is_err());
        assert!(validate_id("").is_err());
        assert!(validate_status("toRead").is_ok());
        assert!(validate_status("lost").is_err());
        assert!(validate_cfi("epubcfi(/6/4!/4/2,/1:0,/1:20)").is_ok());
        assert!(validate_cfi("javascript:alert(1)").is_err());
        assert!(validate_fraction(0.5).is_ok());
        assert!(validate_fraction(f64::NAN).is_err());
        assert!(validate_fraction(1.5).is_err());
        assert!(validate_day("2026-10-22").is_ok());
        assert!(validate_day("2026-1-22").is_err());
    }

    #[test]
    fn limits_text_by_characters() {
        assert_eq!(limit_text("héllo", 2), "hé");
    }
}
