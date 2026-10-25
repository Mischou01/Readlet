//! Merging what every device wrote (docs/PLAN.md §4):
//!
//! - progress and status: the newest `updatedAt` wins
//! - edited details: the newest edit of each field wins, and a reset drops the edits before it
//! - annotations and shelves: the union by id; the newest version of each wins; deletions are
//!   tombstones, so they win over older versions too
//! - sessions: concatenated, deduplicated by id
//!
//! Ties are broken by comparing content, so every device converges on the same result no matter
//! in which order the files are read.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};

use serde_json::Value;

use super::model::{Annotation, BookRecord, Profile, Session, Shelf, Stamped};

pub fn merge_books(fingerprint: &str, records: impl IntoIterator<Item = BookRecord>) -> BookRecord {
    let mut merged = BookRecord::new(fingerprint);
    let mut annotations: HashMap<String, Annotation> = HashMap::new();
    let mut details: BTreeMap<String, Stamped<Value>> = BTreeMap::new();
    for record in records {
        merged.progress = newest(
            merged.progress,
            record.progress,
            |p| p.updated_at,
            |a, b| {
                a.fraction
                    .total_cmp(&b.fraction)
                    .then_with(|| a.cfi.cmp(&b.cfi))
            },
        );
        merged.status = newest_stamped(merged.status, record.status, |a, b| a.cmp(b));
        merged.details_reset_at = merged.details_reset_at.max(record.details_reset_at);
        for (field, edit) in record.details {
            let current = details.remove(&field);
            if let Some(newest) = newest_stamped(current, Some(edit), content_cmp) {
                details.insert(field, newest);
            }
        }
        for annotation in record.annotations {
            match annotations.get(&annotation.id) {
                Some(existing) if !annotation_is_newer(&annotation, existing) => {}
                _ => {
                    annotations.insert(annotation.id.clone(), annotation);
                }
            }
        }
    }
    let mut annotations: Vec<Annotation> = annotations.into_values().collect();
    annotations.sort_by(|a, b| {
        a.created_at
            .cmp(&b.created_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    merged.annotations = annotations;
    let reset_at = merged.details_reset_at.unwrap_or(i64::MIN);
    details.retain(|_, edit| edit.updated_at > reset_at);
    merged.details = details;
    merged
}

fn annotation_is_newer(candidate: &Annotation, existing: &Annotation) -> bool {
    candidate
        .updated_at
        .cmp(&existing.updated_at)
        .then_with(|| candidate.deleted.cmp(&existing.deleted))
        .then_with(|| content_cmp(candidate, existing))
        == Ordering::Greater
}

pub fn merge_profiles(profiles: impl IntoIterator<Item = Profile>) -> Profile {
    let mut merged = Profile::default();
    for profile in profiles {
        merged.daily_minutes =
            newest_stamped(merged.daily_minutes, profile.daily_minutes, Ord::cmp);
        merged.yearly_goal = newest_stamped(merged.yearly_goal, profile.yearly_goal, |a, b| {
            a.unit.cmp(&b.unit).then(a.target.cmp(&b.target))
        });
    }
    merged
}

pub fn merge_shelves(lists: impl IntoIterator<Item = Vec<Shelf>>) -> Vec<Shelf> {
    let mut shelves: HashMap<String, Shelf> = HashMap::new();
    for shelf in lists.into_iter().flatten() {
        let newer = match shelves.get(&shelf.id) {
            None => true,
            Some(existing) => {
                shelf
                    .updated_at
                    .cmp(&existing.updated_at)
                    .then_with(|| shelf.deleted.cmp(&existing.deleted))
                    .then_with(|| content_cmp(&shelf, existing))
                    == Ordering::Greater
            }
        };
        if newer {
            shelves.insert(shelf.id.clone(), shelf);
        }
    }
    let mut shelves: Vec<Shelf> = shelves.into_values().collect();
    shelves.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.id.cmp(&b.id))
    });
    shelves
}

/// Sessions are rewritten while they're open, so the same id can appear more than once; the
/// longest version is the most complete one.
pub fn dedupe_sessions(sessions: impl IntoIterator<Item = Session>) -> Vec<Session> {
    let mut by_id: HashMap<String, Session> = HashMap::new();
    for session in sessions {
        match by_id.get(&session.id) {
            Some(existing)
                if (existing.active_ms, existing.end) >= (session.active_ms, session.end) => {}
            _ => {
                by_id.insert(session.id.clone(), session);
            }
        }
    }
    let mut sessions: Vec<Session> = by_id.into_values().collect();
    sessions.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| a.id.cmp(&b.id)));
    sessions
}

fn newest<T>(
    current: Option<T>,
    candidate: Option<T>,
    stamp: impl Fn(&T) -> i64,
    tie: impl Fn(&T, &T) -> Ordering,
) -> Option<T> {
    match (current, candidate) {
        (None, c) => c,
        (c, None) => c,
        (Some(a), Some(b)) => {
            if stamp(&b).cmp(&stamp(&a)).then_with(|| tie(&b, &a)) == Ordering::Greater {
                Some(b)
            } else {
                Some(a)
            }
        }
    }
}

fn newest_stamped<T>(
    current: Option<Stamped<T>>,
    candidate: Option<Stamped<T>>,
    tie: impl Fn(&T, &T) -> Ordering,
) -> Option<Stamped<T>> {
    newest(
        current,
        candidate,
        |s| s.updated_at,
        |a, b| tie(&a.value, &b.value),
    )
}

/// A total order on content, used only to break timestamp ties deterministically.
fn content_cmp<T: serde::Serialize>(a: &T, b: &T) -> Ordering {
    let a = serde_json::to_string(a).unwrap_or_default();
    let b = serde_json::to_string(b).unwrap_or_default();
    a.cmp(&b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::model::{Progress, YearlyGoal};

    fn annotation(id: &str, updated_at: i64, note: &str) -> Annotation {
        Annotation {
            id: id.into(),
            kind: "highlight".into(),
            cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)".into(),
            text: "Hello".into(),
            color: Some("butter".into()),
            note: (!note.is_empty()).then(|| note.into()),
            from_note: false,
            name: None,
            chapter: None,
            fraction: None,
            created_at: 1,
            updated_at,
            deleted: false,
        }
    }

    fn progress(fraction: f64, updated_at: i64) -> Option<Progress> {
        Some(Progress {
            cfi: "epubcfi(/6/2)".into(),
            fraction,
            label: None,
            updated_at,
        })
    }

    #[test]
    fn newest_progress_and_status_win() {
        let laptop = BookRecord {
            progress: progress(0.6, 20),
            status: Some(Stamped {
                value: "reading".into(),
                updated_at: 5,
            }),
            ..BookRecord::new("fp")
        };
        let desktop = BookRecord {
            progress: progress(0.4, 10),
            status: Some(Stamped {
                value: "finished".into(),
                updated_at: 30,
            }),
            ..BookRecord::new("fp")
        };
        let merged = merge_books("fp", [laptop, desktop]);
        assert_eq!(merged.progress.unwrap().fraction, 0.6);
        assert_eq!(merged.status.unwrap().value, "finished");
    }

    #[test]
    fn annotations_are_unioned_and_the_newest_version_wins() {
        let a = BookRecord {
            annotations: vec![annotation("1", 5, "old"), annotation("2", 5, "")],
            ..BookRecord::new("fp")
        };
        let b = BookRecord {
            annotations: vec![annotation("1", 9, "new"), annotation("3", 1, "")],
            ..BookRecord::new("fp")
        };
        let merged = merge_books("fp", [a, b]);
        let ids: Vec<_> = merged.annotations.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, ["1", "2", "3"]);
        assert_eq!(merged.annotations[0].note.as_deref(), Some("new"));
    }

    #[test]
    fn tombstones_beat_older_versions_and_ties() {
        let mut deleted = annotation("1", 7, "");
        deleted.deleted = true;
        let alive = annotation("1", 7, "edited at the same moment");
        let merged = merge_books(
            "fp",
            [
                BookRecord {
                    annotations: vec![alive.clone()],
                    ..BookRecord::new("fp")
                },
                BookRecord {
                    annotations: vec![deleted.clone()],
                    ..BookRecord::new("fp")
                },
            ],
        );
        assert!(merged.annotations[0].deleted);

        // A newer edit resurrects it (someone re-highlighted after the deletion synced).
        let newer = annotation("1", 8, "");
        let merged = merge_books(
            "fp",
            [BookRecord {
                annotations: vec![deleted, newer],
                ..BookRecord::new("fp")
            }],
        );
        assert!(!merged.annotations[0].deleted);
    }

    #[test]
    fn details_merge_field_by_field_and_a_reset_drops_older_edits() {
        let edit = |value: Value, updated_at: i64| Stamped { value, updated_at };
        let laptop = BookRecord {
            details: BTreeMap::from([
                ("title".into(), edit("Old title".into(), 5)),
                ("series".into(), edit("Expanse".into(), 6)),
            ]),
            ..BookRecord::new("fp")
        };
        let phone = BookRecord {
            details: BTreeMap::from([("title".into(), edit("New title".into(), 9))]),
            ..BookRecord::new("fp")
        };
        let merged = merge_books("fp", [laptop.clone(), phone.clone()]);
        assert_eq!(merged.details["title"].value, "New title");
        assert_eq!(merged.details["series"].value, "Expanse");

        let reset = BookRecord {
            details_reset_at: Some(8),
            ..BookRecord::new("fp")
        };
        let merged = merge_books("fp", [laptop, reset, phone]);
        assert_eq!(merged.details_reset_at, Some(8));
        assert_eq!(merged.details.keys().collect::<Vec<_>>(), ["title"]);
    }

    #[test]
    fn merge_is_order_independent() {
        let a = BookRecord {
            progress: progress(0.3, 10),
            annotations: vec![annotation("1", 4, "a")],
            ..BookRecord::new("fp")
        };
        let b = BookRecord {
            progress: progress(0.7, 10),
            annotations: vec![annotation("1", 4, "b")],
            ..BookRecord::new("fp")
        };
        assert_eq!(
            merge_books("fp", [a.clone(), b.clone()]),
            merge_books("fp", [b, a])
        );
    }

    #[test]
    fn merging_is_idempotent() {
        let a = BookRecord {
            progress: progress(0.3, 10),
            annotations: vec![annotation("1", 4, "a")],
            ..BookRecord::new("fp")
        };
        let once = merge_books("fp", [a.clone()]);
        let twice = merge_books("fp", [once.clone(), a]);
        assert_eq!(once, twice);
    }

    #[test]
    fn profiles_merge_field_by_field() {
        let a = Profile {
            daily_minutes: Some(Stamped {
                value: 30,
                updated_at: 10,
            }),
            yearly_goal: Some(Stamped {
                value: YearlyGoal {
                    unit: "books".into(),
                    target: 24,
                },
                updated_at: 1,
            }),
            ..Default::default()
        };
        let b = Profile {
            daily_minutes: Some(Stamped {
                value: 20,
                updated_at: 5,
            }),
            yearly_goal: Some(Stamped {
                value: YearlyGoal {
                    unit: "minutes".into(),
                    target: 6000,
                },
                updated_at: 2,
            }),
            ..Default::default()
        };
        let merged = merge_profiles([a, b]);
        assert_eq!(merged.daily_minutes.unwrap().value, 30);
        assert_eq!(merged.yearly_goal.unwrap().value.unit, "minutes");
    }

    #[test]
    fn shelves_merge_by_id() {
        let shelf = |id: &str, name: &str, updated_at: i64, deleted: bool| Shelf {
            id: id.into(),
            name: name.into(),
            books: vec![],
            updated_at,
            deleted,
        };
        let merged = merge_shelves([
            vec![
                shelf("1", "Poetry", 1, false),
                shelf("2", "Essays", 1, false),
            ],
            vec![shelf("1", "Verse", 2, false), shelf("2", "Essays", 3, true)],
        ]);
        assert_eq!(merged.len(), 2);
        assert_eq!(merged.iter().find(|s| s.id == "1").unwrap().name, "Verse");
        assert!(merged.iter().find(|s| s.id == "2").unwrap().deleted);
    }

    #[test]
    fn sessions_keep_the_longest_version() {
        let session = |id: &str, start: i64, active_ms: i64| Session {
            id: id.into(),
            book: "fp".into(),
            start,
            end: start + active_ms,
            active_ms,
            start_fraction: 0.0,
            end_fraction: 0.1,
            words: 0,
        };
        let sessions = dedupe_sessions([
            session("b", 50, 10),
            session("a", 10, 60),
            session("a", 10, 120),
        ]);
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].id, "a");
        assert_eq!(sessions[0].active_ms, 120);
    }
}
