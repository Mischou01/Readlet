//! Application state and the background jobs that keep the index in step with the folder: a
//! watcher on desktop, and a catch-up whenever the app returns to the foreground on mobile.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};

use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::error::{Error, Result};
use crate::fsutil;
use crate::index::Index;
#[cfg(desktop)]
use crate::library::watch;
use crate::library::{Library, scan};
use crate::settings::Settings;

/// Events sent to the UI.
pub mod events {
    /// A scan finished; payload: `ScanReport`.
    pub const LIBRARY_CHANGED: &str = "library:changed";
    /// A scan failed; payload: the error.
    pub const LIBRARY_SCAN_FAILED: &str = "library:scan-failed";
    /// Another device's reading data arrived; payload: `StoreChanges`.
    pub const STORE_CHANGED: &str = "store:changed";
    /// The app went to the background (mobile only).
    #[cfg(mobile)]
    pub const APP_SUSPENDED: &str = "app:suspended";
}

pub struct AppPaths {
    pub settings: PathBuf,
    pub index: PathBuf,
    pub covers: PathBuf,
}

impl AppPaths {
    pub fn resolve<R: Runtime>(app: &AppHandle<R>) -> Result<Self> {
        let config = app.path().app_config_dir()?;
        let data = app.path().app_data_dir()?;
        let cache = app.path().app_cache_dir()?;
        for dir in [&config, &data, &cache] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(Self {
            settings: config.join("settings.json"),
            index: data.join("index.sqlite3"),
            covers: cache.join("covers"),
        })
    }
}

pub struct AppState {
    pub paths: AppPaths,
    settings: Mutex<Settings>,
    index: Mutex<Index>,
    library: RwLock<Option<Arc<Library>>>,
    scan_requested: AtomicBool,
    scan_running: AtomicBool,
    /// Other devices' reading data as of the last check (see `catch_up`).
    #[cfg(mobile)]
    store_snapshot: Mutex<crate::store::Snapshot>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic while holding the lock leaves plain data behind, so recover instead of poisoning
    // every later command.
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn new(paths: AppPaths) -> Result<Self> {
        let settings = Settings::load(&paths.settings)?;
        let index = match Index::open(&paths.index) {
            Ok(index) => index,
            Err(e) => {
                // It's only a cache: throw it away and start again.
                log::warn!("index unreadable ({e}); rebuilding it");
                let _ = std::fs::remove_file(&paths.index);
                Index::open(&paths.index)?
            }
        };
        std::fs::create_dir_all(&paths.covers)?;
        Ok(Self {
            paths,
            settings: Mutex::new(settings),
            index: Mutex::new(index),
            library: RwLock::new(None),
            scan_requested: AtomicBool::new(false),
            scan_running: AtomicBool::new(false),
            #[cfg(mobile)]
            store_snapshot: Mutex::new(Default::default()),
        })
    }

    pub fn settings(&self) -> MutexGuard<'_, Settings> {
        lock(&self.settings)
    }

    pub fn index(&self) -> MutexGuard<'_, Index> {
        lock(&self.index)
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        settings.save(&self.paths.settings)
    }

    pub fn library(&self) -> Result<Arc<Library>> {
        self.library
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or(Error::NoLibrary)
    }

    /// Opens the library at `root`: creates this device's data folder, starts watching and
    /// schedules a scan. Replaces any library that was open.
    pub fn open_library<R: Runtime>(&self, app: &AppHandle<R>, root: &Path) -> Result<()> {
        let (device_id, device_name) = {
            let settings = self.settings();
            (settings.device_id.clone(), settings.device_name.clone())
        };
        let library = Arc::new(Library::open(root, &device_id, &device_name)?);
        self.index().set_root(&library.root.to_string_lossy())?;

        #[cfg(desktop)]
        self.watch(app, &library);
        #[cfg(mobile)]
        {
            *lock(&self.store_snapshot) = library.store.snapshot();
        }

        *self.library.write().unwrap_or_else(|e| e.into_inner()) = Some(library);
        self.request_scan(app);
        Ok(())
    }

    /// Follows the folder: book files that change trigger a rescan, and reading data from other
    /// devices is reloaded as it arrives.
    #[cfg(desktop)]
    fn watch<R: Runtime>(&self, app: &AppHandle<R>, library: &Arc<Library>) {
        let handle = app.clone();
        let root = library.root.clone();
        let watched = Arc::downgrade(library);
        match watch::start(&library.root, move |paths| {
            let Some(library) = watched.upgrade() else {
                return;
            };
            let result = watch::interpret(&root, paths, |p| library.store.classify(p));
            if !result.store.is_empty() {
                library.store.invalidate_books(&result.store.books);
                let _ = handle.emit(events::STORE_CHANGED, &result.store);
            }
            if result.rescan {
                handle.state::<AppState>().request_scan(&handle);
            }
        }) {
            Ok(watcher) => library.set_watcher(Some(watcher)),
            // Watching is a convenience (inotify limits can be hit on huge folders); scanning on
            // start and on request still works.
            Err(e) => log::warn!("can't watch the library folder: {e}"),
        }
    }

    /// Catches up with the folder after the app was in the background, where nothing watches it
    /// (mobile): rescans the books and reloads reading data that other devices synced meanwhile.
    #[cfg(mobile)]
    pub fn catch_up<R: Runtime>(&self, app: &AppHandle<R>) {
        let Ok(library) = self.library() else {
            return;
        };
        self.request_scan(app);
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<AppState>();
            let after = library.store.snapshot();
            let before = std::mem::replace(&mut *lock(&state.store_snapshot), after.clone());
            let changes = library.store.changes_between(&before, &after);
            if !changes.is_empty() {
                let _ = app.emit(events::STORE_CHANGED, &changes);
            }
        });
    }

    /// Schedules a scan. Requests that arrive while one is running are coalesced into a single
    /// follow-up scan.
    pub fn request_scan<R: Runtime>(&self, app: &AppHandle<R>) {
        self.scan_requested.store(true, Ordering::SeqCst);
        if self.scan_running.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<AppState>();
            loop {
                if !state.scan_requested.swap(false, Ordering::SeqCst) {
                    state.scan_running.store(false, Ordering::SeqCst);
                    // A request may have slipped in between the swap and the store.
                    if state.scan_requested.load(Ordering::SeqCst)
                        && !state.scan_running.swap(true, Ordering::SeqCst)
                    {
                        continue;
                    }
                    break;
                }
                match state.scan_once() {
                    Ok(report) => {
                        let _ = app.emit(events::LIBRARY_CHANGED, report);
                    }
                    Err(e) => {
                        log::error!("library scan failed: {e}");
                        let _ = app.emit(events::LIBRARY_SCAN_FAILED, &e);
                    }
                }
            }
        });
    }

    fn scan_once(&self) -> Result<scan::ScanReport> {
        let library = self.library()?;
        let found = scan::walk(&library.root);
        let existing = self.index().files()?;
        // Fingerprinting reads files, so it happens without holding the index lock.
        let plan = scan::plan(&found, &existing, scan::identify);
        if !plan.upserts.is_empty() || !plan.removed.is_empty() {
            self.index()
                .apply_scan(&plan.upserts, &plan.removed, fsutil::now_ms())?;
            self.remove_covers(&plan.removed);
        }
        log::info!(
            "scan: {} books ({} added, {} updated, {} removed)",
            plan.report.total,
            plan.report.added,
            plan.report.updated,
            plan.report.removed
        );
        Ok(plan.report)
    }

    /// Drops books whose files were deleted from the index (it's only a cache; their reading data
    /// stays in the folder).
    pub fn forget_books(&self, fingerprints: &[String]) -> Result<()> {
        self.index()
            .apply_scan(&[], fingerprints, fsutil::now_ms())?;
        self.remove_covers(fingerprints);
        Ok(())
    }

    fn remove_covers(&self, fingerprints: &[String]) {
        for fingerprint in fingerprints {
            let _ =
                std::fs::remove_file(crate::covers::cover_path(&self.paths.covers, fingerprint));
        }
    }

    /// Resolves an indexed book to its file on disk.
    pub fn book_path(
        &self,
        fingerprint: &str,
    ) -> Result<(PathBuf, crate::library::formats::BookFormat)> {
        let (rel_path, format) = self
            .index()
            .rel_path(fingerprint)?
            .ok_or_else(|| Error::BookNotFound(fingerprint.to_owned()))?;
        Ok((self.library()?.resolve(&rel_path)?, format))
    }
}
