//! The commands the UI can invoke. They validate input, then hand off to the library, index and
//! store. Anything that touches the disk runs off the main thread.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

use crate::aura::Palette;
use crate::covers;
use crate::error::{Error, Result};
use crate::fsutil::{self, now_ms};
use crate::index::{BookEntry, BookMetadata};
use crate::library::fingerprint;
use crate::state::AppState;
use crate::store::model::{
    self, Annotation, BookRecord, Profile, Progress, Resurfaced, Session, Shelf, Stamped,
    YearlyGoal,
};

/// Runs blocking work on the blocking thread pool.
async fn blocking<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce(&AppState) -> Result<T> + Send + 'static,
) -> Result<T> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<AppState>()))
        .await
        .map_err(|e| Error::invalid(format!("background task failed: {e}")))?
}

fn check_fingerprint(fp: &str) -> Result<()> {
    if fingerprint::is_valid(fp) {
        Ok(())
    } else {
        Err(Error::invalid("invalid book id"))
    }
}

/// A timestamp strictly after `previous`, so a change always wins over the value it replaces
/// even if two changes happen within the same millisecond.
fn stamp_after(previous: Option<i64>) -> i64 {
    now_ms().max(previous.map_or(i64::MIN, |p| p.saturating_add(1)))
}

// -- App ---------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    device_id: String,
    device_name: String,
    library_root: Option<String>,
    /// The configured folder when it couldn't be opened (an unplugged drive, say).
    missing_library_root: Option<String>,
    preferences: Value,
    platform: &'static str,
}

fn app_info(app: &AppHandle, state: &AppState) -> AppInfo {
    let settings = state.settings();
    let library_root = state
        .library()
        .ok()
        .map(|l| l.root.to_string_lossy().into_owned());
    let missing_library_root = match (&library_root, &settings.library_root) {
        (None, Some(configured)) => Some(configured.to_string_lossy().into_owned()),
        _ => None,
    };
    AppInfo {
        version: app.package_info().version.to_string(),
        device_id: settings.device_id.clone(),
        device_name: settings.device_name.clone(),
        library_root,
        missing_library_root,
        preferences: Value::Object(settings.preferences.clone()),
        platform: std::env::consts::OS,
    }
}

#[tauri::command]
pub async fn get_app_info(app: AppHandle, state: State<'_, AppState>) -> Result<AppInfo> {
    Ok(app_info(&app, &state))
}

#[tauri::command]
pub async fn set_preferences(state: State<'_, AppState>, preferences: Value) -> Result<()> {
    let mut settings = state.settings();
    settings.set_preferences(preferences)?;
    state.save_settings(&settings)
}

// -- Library -----------------------------------------------------------------------------------

/// Asks for a folder with Android's own picker, since the dialog plugin can't pick folders there.
/// `None` if the reader cancelled.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>> {
    #[cfg(target_os = "android")]
    {
        tauri::async_runtime::spawn_blocking(move || tauri_plugin_folders::pick_folder(&app))
            .await
            .map_err(|e| Error::invalid(format!("background task failed: {e}")))?
            .map_err(Error::invalid)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err(Error::invalid(
            "picking a folder this way is only needed on Android",
        ))
    }
}

#[tauri::command]
pub async fn choose_library(app: AppHandle, path: String) -> Result<AppInfo> {
    blocking(&app.clone(), move |state| {
        let root = PathBuf::from(&path);
        state.open_library(&app, &root)?;
        let library_root = state.library()?.root.clone();
        let mut settings = state.settings();
        settings.library_root = Some(library_root);
        state.save_settings(&settings)?;
        drop(settings);
        Ok(app_info(&app, state))
    })
    .await
}

#[tauri::command]
pub async fn rescan_library(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    state.library()?;
    state.request_scan(&app);
    Ok(())
}

#[tauri::command]
pub async fn list_books(app: AppHandle) -> Result<Vec<BookEntry>> {
    blocking(&app, |state| {
        state.library()?;
        state.index().books()
    })
    .await
}

#[tauri::command]
pub async fn books_needing_metadata(app: AppHandle) -> Result<Vec<String>> {
    blocking(&app, |state| state.index().needing_metadata()).await
}

fn book_entry(state: &AppState, fp: &str) -> Result<BookEntry> {
    state
        .index()
        .book(fp)?
        .ok_or_else(|| Error::BookNotFound(fp.to_owned()))
}

#[tauri::command]
pub async fn set_book_metadata(
    app: AppHandle,
    fingerprint: String,
    metadata: BookMetadata,
    error: Option<String>,
) -> Result<BookEntry> {
    check_fingerprint(&fingerprint)?;
    blocking(&app, move |state| {
        let metadata = metadata.sanitized();
        let error = error.map(|e| model::limit_text(&e, 500));
        let index = state.index();
        if !index.set_metadata(&fingerprint, &metadata, error.as_deref())? {
            return Err(Error::BookNotFound(fingerprint));
        }
        drop(index);
        book_entry(state, &fingerprint)
    })
    .await
}

/// Receives a cover as the request body (an empty body means the book has no cover) with the
/// book's fingerprint in the `x-fingerprint` header.
#[tauri::command]
pub async fn set_book_cover(app: AppHandle, request: Request<'_>) -> Result<BookEntry> {
    let fingerprint = request
        .headers()
        .get("x-fingerprint")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| Error::invalid("missing book id"))?;
    check_fingerprint(&fingerprint)?;
    let bytes = body_bytes(request.body())?;
    if bytes.len() > covers::MAX_COVER_BYTES {
        return Err(Error::invalid("the cover is too large"));
    }
    blocking(&app, move |state| {
        if !state.index().contains(&fingerprint)? {
            return Err(Error::BookNotFound(fingerprint));
        }
        let dest = covers::cover_path(&state.paths.covers, &fingerprint);
        let (has_cover, palette) = if bytes.is_empty() {
            (false, Palette::from_seed(&fingerprint))
        } else {
            match covers::store_cover(&bytes, &dest) {
                Ok(palette) => (true, palette),
                Err(e) => {
                    log::info!("unusable cover for {fingerprint}: {e}");
                    (false, Palette::from_seed(&fingerprint))
                }
            }
        };
        if !has_cover {
            let _ = std::fs::remove_file(&dest);
        }
        state.index().set_cover(&fingerprint, has_cover, &palette)?;
        book_entry(state, &fingerprint)
    })
    .await
}

/// A request body sent as bytes. Desktop webviews deliver them raw; Android has no way to read a
/// request body, so Tauri sends the call through `postMessage` there and the bytes arrive as a
/// JSON array of numbers.
fn body_bytes(body: &InvokeBody) -> Result<Vec<u8>> {
    match body {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(json) => {
            Vec::<u8>::deserialize(json).map_err(|_| Error::invalid("expected the cover as bytes"))
        }
    }
}

#[tauri::command]
pub async fn add_books(app: AppHandle, paths: Vec<String>) -> Result<Vec<String>> {
    let handle = app.clone();
    blocking(&app, move |state| {
        let sources: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
        let added = state.library()?.add_books(&sources)?;
        if !added.is_empty() {
            state.request_scan(&handle);
        }
        Ok(added)
    })
    .await
}

#[tauri::command]
pub async fn reveal_book(app: AppHandle, fingerprint: String) -> Result<()> {
    check_fingerprint(&fingerprint)?;
    blocking(&app, move |state| {
        let (path, _) = state.book_path(&fingerprint)?;
        tauri_plugin_opener::reveal_item_in_dir(path)
            .map_err(|e| Error::invalid(format!("couldn't open the file manager: {e}")))
    })
    .await
}

// -- Reading data ------------------------------------------------------------------------------

#[tauri::command]
pub async fn list_records(app: AppHandle) -> Result<Vec<BookRecord>> {
    blocking(&app, |state| Ok(state.library()?.store.books())).await
}

#[tauri::command]
pub async fn get_record(app: AppHandle, fingerprint: String) -> Result<BookRecord> {
    check_fingerprint(&fingerprint)?;
    blocking(&app, move |state| {
        Ok(state.library()?.store.book(&fingerprint))
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressInput {
    cfi: String,
    fraction: f64,
    label: Option<String>,
}

#[tauri::command]
pub async fn set_progress(
    app: AppHandle,
    fingerprint: String,
    progress: ProgressInput,
) -> Result<BookRecord> {
    check_fingerprint(&fingerprint)?;
    model::validate_cfi(&progress.cfi)?;
    model::validate_fraction(progress.fraction)?;
    blocking(&app, move |state| {
        let store = &state.library()?.store;
        let previous = store.book(&fingerprint).progress.map(|p| p.updated_at);
        store.update_book(&fingerprint, |record| {
            record.progress = Some(Progress {
                cfi: progress.cfi,
                fraction: progress.fraction,
                label: progress.label.map(|l| model::limit_text(&l, 300)),
                updated_at: stamp_after(previous),
            });
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn set_status(app: AppHandle, fingerprint: String, status: String) -> Result<BookRecord> {
    check_fingerprint(&fingerprint)?;
    model::validate_status(&status)?;
    blocking(&app, move |state| {
        let store = &state.library()?.store;
        let previous = store.book(&fingerprint).status.map(|s| s.updated_at);
        store.update_book(&fingerprint, |record| {
            record.status = Some(Stamped {
                value: status,
                updated_at: stamp_after(previous),
            });
            Ok(())
        })
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationInput {
    id: String,
    kind: String,
    cfi: String,
    #[serde(default)]
    text: String,
    color: Option<String>,
    note: Option<String>,
    #[serde(default)]
    from_note: bool,
    name: Option<String>,
    chapter: Option<String>,
    fraction: Option<f64>,
}

impl AnnotationInput {
    fn validate(&self) -> Result<()> {
        model::validate_id(&self.id)?;
        model::validate_cfi(&self.cfi)?;
        if !model::ANNOTATION_KINDS.contains(&self.kind.as_str()) {
            return Err(Error::invalid("unknown annotation kind"));
        }
        match (&self.kind[..], self.color.as_deref()) {
            ("highlight", Some(color)) if model::HIGHLIGHT_COLORS.contains(&color) => {}
            ("highlight", _) => return Err(Error::invalid("unknown highlight colour")),
            (_, Some(_)) => return Err(Error::invalid("only highlights have a colour")),
            _ => {}
        }
        if self.from_note && self.kind != "highlight" {
            return Err(Error::invalid("only highlights are made from notes"));
        }
        if self.name.is_some() && self.kind != "bookmark" {
            return Err(Error::invalid("only bookmarks have a name"));
        }
        if let Some(fraction) = self.fraction {
            model::validate_fraction(fraction)?;
        }
        Ok(())
    }
}

/// Creates or updates a highlight or bookmark.
#[tauri::command]
pub async fn put_annotation(
    app: AppHandle,
    fingerprint: String,
    annotation: AnnotationInput,
) -> Result<BookRecord> {
    check_fingerprint(&fingerprint)?;
    annotation.validate()?;
    blocking(&app, move |state| {
        let store = &state.library()?.store;
        let existing = store
            .book(&fingerprint)
            .annotations
            .into_iter()
            .find(|a| a.id == annotation.id);
        store.update_book(&fingerprint, |record| {
            let updated_at = stamp_after(existing.as_ref().map(|a| a.updated_at));
            let created_at = existing.as_ref().map_or(updated_at, |a| a.created_at);
            let note = annotation
                .note
                .map(|n| model::limit_text(&n, 20_000))
                .filter(|n| !n.trim().is_empty());
            let name = annotation
                .name
                .map(|n| model::limit_text(n.trim(), 200))
                .filter(|n| !n.is_empty());
            let new = Annotation {
                id: annotation.id,
                kind: annotation.kind,
                cfi: annotation.cfi,
                text: model::limit_text(&annotation.text, 10_000),
                color: annotation.color,
                note,
                from_note: annotation.from_note,
                name,
                chapter: annotation.chapter.map(|c| model::limit_text(&c, 300)),
                fraction: annotation.fraction,
                created_at,
                updated_at,
                deleted: false,
            };
            record.annotations.retain(|a| a.id != new.id);
            record.annotations.push(new);
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn delete_annotation(
    app: AppHandle,
    fingerprint: String,
    id: String,
) -> Result<BookRecord> {
    check_fingerprint(&fingerprint)?;
    model::validate_id(&id)?;
    blocking(&app, move |state| {
        let store = &state.library()?.store;
        let Some(mut tombstone) = store
            .book(&fingerprint)
            .annotations
            .into_iter()
            .find(|a| a.id == id)
        else {
            return Err(Error::invalid("that highlight doesn't exist"));
        };
        tombstone.updated_at = stamp_after(Some(tombstone.updated_at));
        tombstone.deleted = true;
        store.update_book(&fingerprint, |record| {
            record.annotations.retain(|a| a.id != id);
            record.annotations.push(tombstone);
            Ok(())
        })
    })
    .await
}

// -- Sessions, goals, shelves ------------------------------------------------------------------

fn validate_session(session: &Session) -> Result<()> {
    model::validate_id(&session.id)?;
    check_fingerprint(&session.book)?;
    model::validate_fraction(session.start_fraction)?;
    model::validate_fraction(session.end_fraction)?;
    let span = session.end - session.start;
    if span < 0 || session.active_ms < 0 || session.active_ms > span + 1_000 {
        return Err(Error::invalid("invalid session times"));
    }
    // Nobody reads 3,000 words a minute; anything above is a counting bug.
    if i64::from(session.words) > session.active_ms / 20 + 100 {
        return Err(Error::invalid("implausible word count"));
    }
    Ok(())
}

#[tauri::command]
pub async fn list_sessions(app: AppHandle, since: i64) -> Result<Vec<Session>> {
    blocking(&app, move |state| {
        Ok(state.library()?.store.sessions(since))
    })
    .await
}

#[tauri::command]
pub async fn checkpoint_session(app: AppHandle, session: Session) -> Result<()> {
    validate_session(&session)?;
    blocking(&app, move |state| {
        state.library()?.store.checkpoint_session(&session)
    })
    .await
}

#[tauri::command]
pub async fn finish_session(app: AppHandle, session: Session) -> Result<()> {
    validate_session(&session)?;
    blocking(&app, move |state| {
        state.library()?.store.finish_session(&session)
    })
    .await
}

#[tauri::command]
pub async fn get_profile(app: AppHandle) -> Result<Profile> {
    blocking(&app, |state| Ok(state.library()?.store.profile())).await
}

#[tauri::command]
pub async fn set_daily_goal(app: AppHandle, minutes: u32) -> Result<Profile> {
    if !(1..=24 * 60).contains(&minutes) {
        return Err(Error::invalid(
            "the daily goal must be between 1 minute and 24 hours",
        ));
    }
    blocking(&app, move |state| {
        let store = &state.library()?.store;
        let previous = store.profile().daily_minutes.map(|d| d.updated_at);
        store.update_profile(|p| {
            p.daily_minutes = Some(Stamped {
                value: minutes,
                updated_at: stamp_after(previous),
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn set_yearly_goal(app: AppHandle, goal: YearlyGoal) -> Result<Profile> {
    if !model::GOAL_UNITS.contains(&goal.unit.as_str()) || !(1..=1_000_000).contains(&goal.target) {
        return Err(Error::invalid("invalid yearly goal"));
    }
    blocking(&app, move |state| {
        let store = &state.library()?.store;
        let previous = store.profile().yearly_goal.map(|g| g.updated_at);
        store.update_profile(|p| {
            p.yearly_goal = Some(Stamped {
                value: goal,
                updated_at: stamp_after(previous),
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn list_shelves(app: AppHandle) -> Result<Vec<Shelf>> {
    blocking(&app, |state| Ok(state.library()?.store.shelves())).await
}

#[derive(Deserialize)]
pub struct ShelfInput {
    id: String,
    name: String,
    books: Vec<String>,
}

#[tauri::command]
pub async fn put_shelf(app: AppHandle, shelf: ShelfInput) -> Result<Vec<Shelf>> {
    model::validate_id(&shelf.id)?;
    let name = shelf.name.trim().to_owned();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(Error::invalid("shelf names must be 1–100 characters"));
    }
    for book in &shelf.books {
        check_fingerprint(book)?;
    }
    blocking(&app, move |state| {
        let store = &state.library()?.store;
        let previous = store
            .shelves()
            .into_iter()
            .find(|s| s.id == shelf.id)
            .map(|s| s.updated_at);
        let mut books = shelf.books;
        books.dedup();
        store.put_shelf(Shelf {
            id: shelf.id,
            name,
            books,
            updated_at: stamp_after(previous),
            deleted: false,
        })
    })
    .await
}

#[tauri::command]
pub async fn delete_shelf(app: AppHandle, id: String) -> Result<Vec<Shelf>> {
    model::validate_id(&id)?;
    blocking(&app, move |state| {
        let store = &state.library()?.store;
        let Some(mut shelf) = store.shelves().into_iter().find(|s| s.id == id) else {
            return Ok(store.shelves());
        };
        shelf.updated_at = stamp_after(Some(shelf.updated_at));
        shelf.deleted = true;
        store.put_shelf(shelf)
    })
    .await
}

#[tauri::command]
pub async fn list_resurfaced(app: AppHandle) -> Result<Vec<Resurfaced>> {
    blocking(&app, |state| Ok(state.library()?.store.resurfaced())).await
}

#[tauri::command]
pub async fn log_resurfaced(app: AppHandle, entries: Vec<Resurfaced>) -> Result<()> {
    for entry in &entries {
        model::validate_id(&entry.highlight)?;
        model::validate_day(&entry.day)?;
    }
    blocking(&app, move |state| {
        state.library()?.store.log_resurfaced(&entries)
    })
    .await
}

// -- Export ------------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ExportFile {
    name: String,
    content: String,
}

fn valid_export_name(name: &str) -> bool {
    name.ends_with(".md")
        && !name.starts_with('.')
        && name.chars().count() <= 200
        && !name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '\0'))
}

/// Writes Markdown files into a folder the reader picked. Existing files with the same names
/// are replaced (re-exporting updates them).
#[tauri::command]
pub async fn export_markdown(app: AppHandle, dir: String, files: Vec<ExportFile>) -> Result<usize> {
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        return Err(Error::FolderUnavailable(dir.display().to_string()));
    }
    if let Some(bad) = files.iter().find(|f| !valid_export_name(&f.name)) {
        return Err(Error::invalid(format!("invalid file name: {}", bad.name)));
    }
    blocking(&app, move |_| {
        for file in &files {
            fsutil::write_atomic(&dir.join(&file.name), file.content.as_bytes())?;
        }
        Ok(files.len())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(kind: &str, color: Option<&str>) -> AnnotationInput {
        AnnotationInput {
            id: "a1".into(),
            kind: kind.into(),
            cfi: "epubcfi(/6/2!/4,/1:0,/1:3)".into(),
            text: "Hi".into(),
            color: color.map(Into::into),
            note: None,
            from_note: false,
            name: None,
            chapter: None,
            fraction: Some(0.5),
        }
    }

    #[test]
    fn reads_bytes_sent_raw_or_as_json() {
        let raw = InvokeBody::Raw(vec![1, 2, 255]);
        assert_eq!(body_bytes(&raw).unwrap(), vec![1, 2, 255]);
        let json = InvokeBody::Json(serde_json::json!([1, 2, 255]));
        assert_eq!(body_bytes(&json).unwrap(), vec![1, 2, 255]);
        assert!(body_bytes(&InvokeBody::Json(serde_json::json!([256]))).is_err());
        assert!(body_bytes(&InvokeBody::Json(serde_json::json!({ "a": 1 }))).is_err());
    }

    #[test]
    fn validates_annotations() {
        assert!(input("highlight", Some("mint")).validate().is_ok());
        assert!(input("highlight", None).validate().is_err());
        assert!(input("highlight", Some("neon")).validate().is_err());
        assert!(input("bookmark", None).validate().is_ok());
        assert!(input("bookmark", Some("mint")).validate().is_err());
        assert!(input("scribble", None).validate().is_err());

        let named = |kind: &str, color: Option<&str>| AnnotationInput {
            name: Some("The storm".into()),
            ..input(kind, color)
        };
        assert!(named("bookmark", None).validate().is_ok());
        assert!(named("highlight", Some("mint")).validate().is_err());

        let from_note = |kind: &str, color: Option<&str>| AnnotationInput {
            from_note: true,
            ..input(kind, color)
        };
        assert!(from_note("highlight", Some("butter")).validate().is_ok());
        assert!(from_note("bookmark", None).validate().is_err());
    }

    #[test]
    fn validates_sessions() {
        let mut session = Session {
            id: "s1".into(),
            book: "0123456789abcdef0123456789abcdef".into(),
            start: 1_000,
            end: 61_000,
            active_ms: 60_000,
            start_fraction: 0.1,
            end_fraction: 0.2,
            words: 0,
        };
        assert!(validate_session(&session).is_ok());
        session.active_ms = 120_000;
        assert!(validate_session(&session).is_err());
        session.active_ms = 0;
        session.end = 0;
        assert!(validate_session(&session).is_err());
    }

    #[test]
    fn validates_export_names() {
        assert!(valid_export_name("Pride and Prejudice.md"));
        assert!(!valid_export_name("../x.md"));
        assert!(!valid_export_name(".hidden.md"));
        assert!(!valid_export_name("notes.txt"));
    }

    #[test]
    fn stamps_are_strictly_increasing() {
        let far_future = now_ms() + 1_000_000;
        assert_eq!(stamp_after(Some(far_future)), far_future + 1);
        assert!(stamp_after(None) > 0);
    }
}
