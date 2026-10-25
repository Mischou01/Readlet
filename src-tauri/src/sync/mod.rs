//! Syncing reading data through a cloud folder the reader connects: kDrive, for now. Only
//! `.readlet/devices/` travels, never the books (`mirror`).
//!
//! A worker thread does the passes:
//! - a full pass (push this device's changes, pull the others') when the app starts or comes back
//!   to the foreground, when the reader asks, and every few minutes;
//! - a push of whatever this device changed, every minute (it costs nothing when nothing did),
//!   and when a phone app goes to the background.
//!
//! The token is kept by `secret`, the folder in this device's settings, and what each file looked
//! like when it last moved in the app's data folder (`SavedState`).

pub mod kdrive;
pub mod mirror;
pub mod secret;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{Error, Result};
use crate::fsutil;
use crate::state::{AppState, events};
use crate::store::DEVICES_DIR;
use kdrive::{KDrive, KDriveFolder};
use mirror::MirrorState;

const PUSH_EVERY: Duration = Duration::from_secs(60);
const FULL_EVERY: Duration = Duration::from_secs(3 * 60);
/// A refresh (the window regaining focus, a book being opened) is skipped if a full pass was
/// this recent.
const FRESH_ENOUGH: Duration = Duration::from_secs(30);
const MAX_BACKOFF: Duration = Duration::from_secs(30 * 60);
/// The folder Readlet makes in the reader's private kDrive folder.
const KDRIVE_FOLDER: &str = "Readlet";

/// Where reading data syncs to, as this device's settings keep it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "service", rename_all = "camelCase")]
pub enum SyncConfig {
    #[serde(rename = "kdrive", rename_all = "camelCase")]
    KDrive {
        drive_id: u64,
        /// The folder mirroring `.readlet/devices/`.
        folder_id: u64,
        /// Where that is, for showing: "Private › Readlet".
        label: String,
    },
}

/// How sync is doing, as the UI shows it.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// "kDrive" once a service is connected.
    pub service: Option<&'static str>,
    pub folder: Option<String>,
    pub syncing: bool,
    pub last_synced_at: Option<i64>,
    pub error: Option<String>,
    /// The service turned the token down: connecting again is the way out.
    pub needs_reconnect: bool,
}

/// What the mirror knew after the last pass, in the app's data folder.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedState {
    /// Which folder, library and device this is about: a change of any starts over.
    key: String,
    last_synced_at: Option<i64>,
    #[serde(flatten)]
    mirror: MirrorState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pass {
    Full,
    Push,
}

enum Trigger {
    Full,
    /// A full pass unless one happened moments ago.
    Refresh,
    /// Sent when a phone app goes to the background.
    #[cfg_attr(desktop, allow(dead_code))]
    Push,
    Stop,
}

pub struct SyncService {
    state_path: PathBuf,
    status: Mutex<SyncStatus>,
    worker: Mutex<Option<Sender<Trigger>>>,
    /// False while a phone app is in the background, where nothing runs on a timer.
    foreground: AtomicBool,
    /// The token, once read from the keyring.
    token: Mutex<Option<String>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn status_of(config: Option<&SyncConfig>) -> SyncStatus {
    match config {
        Some(SyncConfig::KDrive { label, .. }) => SyncStatus {
            service: Some("kDrive"),
            folder: Some(label.clone()),
            ..SyncStatus::default()
        },
        None => SyncStatus::default(),
    }
}

impl SyncService {
    pub fn new(state_path: PathBuf, config: Option<&SyncConfig>) -> Self {
        let mut status = status_of(config);
        status.last_synced_at = Self::read_saved(&state_path).last_synced_at;
        Self {
            state_path,
            status: Mutex::new(status),
            worker: Mutex::new(None),
            foreground: AtomicBool::new(true),
            token: Mutex::new(None),
        }
    }

    pub fn status(&self) -> SyncStatus {
        lock(&self.status).clone()
    }

    fn update_status(&self, app: &AppHandle, change: impl FnOnce(&mut SyncStatus)) {
        let status = {
            let mut status = lock(&self.status);
            let before = status.clone();
            change(&mut status);
            if *status == before {
                return;
            }
            status.clone()
        };
        let _ = app.emit(events::SYNC_STATUS, status);
    }

    /// Starts the worker if sync is set up and it isn't running, and asks for a full pass.
    pub fn start(&self, app: &AppHandle) {
        if app.state::<AppState>().settings().sync.is_none() {
            return;
        }
        let mut worker = lock(&self.worker);
        if worker.is_none() {
            let (send, receive) = mpsc::channel();
            let app = app.clone();
            let spawned = std::thread::Builder::new()
                .name("sync".into())
                .spawn(move || work(&app, &receive));
            match spawned {
                Ok(_) => *worker = Some(send),
                Err(e) => log::error!("couldn't start syncing: {e}"),
            }
        }
        if let Some(worker) = worker.as_ref() {
            let _ = worker.send(Trigger::Full);
        }
    }

    fn send(&self, trigger: Trigger) {
        if let Some(worker) = lock(&self.worker).as_ref() {
            let _ = worker.send(trigger);
        }
    }

    /// A full pass, now.
    pub fn sync_now(&self) {
        self.send(Trigger::Full);
    }

    /// A full pass, unless one just happened: for moments the reader may be expecting news from
    /// their other devices (opening a book, coming back to the window).
    pub fn refresh(&self) {
        self.send(Trigger::Refresh);
    }

    /// The app is going to the background (or coming back). Going, what changed goes up while
    /// it still can; back, a full pass catches up.
    #[cfg(mobile)]
    pub fn set_foreground(&self, foreground: bool) {
        self.foreground.store(foreground, Ordering::SeqCst);
        self.send(if foreground {
            Trigger::Full
        } else {
            Trigger::Push
        });
    }

    /// Connects kDrive: checks the token on the drive, makes Readlet's folder in the reader's
    /// private folder, keeps the token and starts syncing. `drive` is the drive's address or
    /// number. An empty `token` means the one kept from before.
    pub fn connect_kdrive(&self, app: &AppHandle, token: &str, drive: &str) -> Result<SyncStatus> {
        let saved;
        let token = match token.trim() {
            "" => {
                saved = secret::get(app, secret::KDRIVE_TOKEN)?
                    .ok_or_else(|| Error::invalid("Paste your kDrive token."))?;
                saved.as_str()
            }
            token => token,
        };
        if token.len() > 4096 || token.chars().any(char::is_whitespace) {
            return Err(Error::invalid("That doesn't look like a kDrive token."));
        }
        let drive_id = kdrive::parse_drive_id(drive).ok_or_else(|| {
            Error::invalid("Paste your kDrive's address from the browser, or the drive's number.")
        })?;
        let kdrive = KDrive::new(token, drive_id);
        let private = kdrive.private_space()?;
        let folder = kdrive.find_or_make_dir(private.id, KDRIVE_FOLDER)?;
        let devices = kdrive.find_or_make_dir(folder.id, DEVICES_DIR)?;
        secret::set(app, secret::KDRIVE_TOKEN, token)?;
        *lock(&self.token) = Some(token.to_owned());

        let config = SyncConfig::KDrive {
            drive_id,
            folder_id: devices.id,
            label: format!("{} › {KDRIVE_FOLDER}", private.name),
        };
        let state = app.state::<AppState>();
        {
            let mut settings = state.settings();
            settings.sync = Some(config.clone());
            state.save_settings(&settings)?;
        }
        self.update_status(app, |status| *status = status_of(Some(&config)));
        self.start(app);
        Ok(self.status())
    }

    /// Stops syncing. The token stays, for connecting again without making a new one, and so
    /// does what's in the cloud folder and in the library.
    pub fn disconnect(&self, app: &AppHandle) -> Result<SyncStatus> {
        if let Some(worker) = lock(&self.worker).take() {
            let _ = worker.send(Trigger::Stop);
        }
        *lock(&self.token) = None;
        let state = app.state::<AppState>();
        {
            let mut settings = state.settings();
            settings.sync = None;
            state.save_settings(&settings)?;
        }
        let _ = std::fs::remove_file(&self.state_path);
        self.update_status(app, |status| *status = SyncStatus::default());
        Ok(self.status())
    }

    /// Whether this device keeps a kDrive token from before.
    pub fn has_saved_token(&self, app: &AppHandle) -> Result<bool> {
        Ok(secret::get(app, secret::KDRIVE_TOKEN)?.is_some())
    }

    /// Removes the kept token. Only while sync is off: it's in use otherwise.
    pub fn forget_token(&self, app: &AppHandle) -> Result<()> {
        if app.state::<AppState>().settings().sync.is_some() {
            return Err(Error::invalid("Turn sync off first."));
        }
        *lock(&self.token) = None;
        secret::delete(app, secret::KDRIVE_TOKEN)
    }

    fn token(&self, app: &AppHandle) -> Result<String> {
        let mut cached = lock(&self.token);
        if let Some(token) = cached.as_ref() {
            return Ok(token.clone());
        }
        let token = secret::get(app, secret::KDRIVE_TOKEN)?.ok_or_else(|| {
            Error::Unauthorized("The kDrive token is missing on this device. Connect again.".into())
        })?;
        *cached = Some(token.clone());
        Ok(token)
    }

    fn read_saved(path: &Path) -> SavedState {
        fsutil::read_json(path).ok().flatten().unwrap_or_default()
    }

    /// One pass. What moved is remembered even when the pass stops part way.
    fn pass(&self, app: &AppHandle, pass: Pass) -> Result<()> {
        let state = app.state::<AppState>();
        let Some(SyncConfig::KDrive {
            drive_id,
            folder_id,
            ..
        }) = state.settings().sync.clone()
        else {
            return Ok(());
        };
        // Nothing to sync until there's a library; it'll be along.
        let Ok(library) = state.library() else {
            return Ok(());
        };
        let token = self.token(app)?;
        state.refresh_cards();

        let store = &library.store;
        let key = format!(
            "kdrive:{drive_id}:{folder_id}:{}:{}",
            store.device_id(),
            library.root.display()
        );
        let mut saved = Self::read_saved(&self.state_path);
        if saved.key != key {
            saved = SavedState {
                key,
                ..SavedState::default()
            };
        }
        let before = saved.mirror.clone();
        let mut remote = KDriveFolder::new(KDrive::new(&token, drive_id), folder_id);
        let (dir, own) = (store.devices_dir(), store.device_id());
        let result = match pass {
            Pass::Full => mirror::sync(dir, own, &mut saved.mirror, &mut remote).map(|m| m.pulled),
            Pass::Push => {
                mirror::push(dir, own, &mut saved.mirror, &mut remote, None).map(|_| Vec::new())
            }
        };
        let moved = saved.mirror != before;
        if result.is_ok() && (pass == Pass::Full || moved) {
            saved.last_synced_at = Some(fsutil::now_ms());
        }
        if moved || (result.is_ok() && pass == Pass::Full) {
            fsutil::write_json(&self.state_path, &saved)
                .unwrap_or_else(|e| log::warn!("couldn't save the sync state: {e}"));
        }
        let pulled = result?;
        if !pulled.is_empty() {
            state.synced_files(app, &pulled);
        }
        let last = saved.last_synced_at;
        self.update_status(app, |status| {
            status.last_synced_at = last;
            status.error = None;
            status.needs_reconnect = false;
        });
        Ok(())
    }
}

/// How long to wait after `failures` failed passes in a row.
fn backoff(failures: u32) -> Duration {
    FULL_EVERY
        .saturating_mul(1 << failures.min(8))
        .min(MAX_BACKOFF)
}

/// The worker: waits for triggers and timers, and does the passes.
fn work(app: &AppHandle, triggers: &Receiver<Trigger>) {
    let state = app.state::<AppState>();
    let service = &state.sync;
    let mut next_full = Instant::now();
    let mut last_full: Option<Instant> = None;
    let mut failures = 0;
    // A rejected token waits for the reader to connect again, or to press "Sync now".
    let mut blocked = false;
    loop {
        let wait = next_full
            .saturating_duration_since(Instant::now())
            .min(PUSH_EVERY);
        let mut pass = match triggers.recv_timeout(wait) {
            Ok(Trigger::Stop) | Err(RecvTimeoutError::Disconnected) => return,
            Ok(Trigger::Full) => Some(Pass::Full),
            Ok(Trigger::Refresh) => {
                let fresh = last_full.is_some_and(|at| at.elapsed() < FRESH_ENOUGH);
                // While failing, the backoff decides: "Sync now" still goes ahead.
                (!fresh && !blocked && failures == 0).then_some(Pass::Full)
            }
            Ok(Trigger::Push) => Some(Pass::Push),
            Err(RecvTimeoutError::Timeout) => {
                let due = Instant::now() >= next_full;
                let idle = blocked || !service.foreground.load(Ordering::SeqCst);
                match (idle, due, failures) {
                    (true, _, _) => None,
                    (false, true, _) => Some(Pass::Full),
                    // While failing, wait for the backoff rather than pushing every minute.
                    (false, false, 0) => Some(Pass::Push),
                    (false, false, _) => None,
                }
            }
        };
        // Triggers that queued up meanwhile are covered by this pass.
        while let Ok(trigger) = triggers.try_recv() {
            match trigger {
                Trigger::Stop => return,
                Trigger::Full | Trigger::Refresh => pass = Some(Pass::Full),
                Trigger::Push => pass = pass.or(Some(Pass::Push)),
            }
        }
        let Some(pass) = pass else { continue };

        if pass == Pass::Full {
            service.update_status(app, |status| status.syncing = true);
        }
        let result = service.pass(app, pass);
        service.update_status(app, |status| status.syncing = false);
        match result {
            Ok(()) => {
                failures = 0;
                blocked = false;
                if pass == Pass::Full {
                    last_full = Some(Instant::now());
                    next_full = Instant::now() + FULL_EVERY;
                }
            }
            Err(e) => {
                log::warn!("sync failed: {e}");
                let reconnect = matches!(e, Error::Unauthorized(_) | Error::Secrets(_));
                blocked = reconnect;
                failures += 1;
                next_full = Instant::now() + backoff(failures);
                let message = e.to_string();
                service.update_status(app, |status| {
                    status.error = Some(message);
                    status.needs_reconnect = reconnect;
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_off_up_to_half_an_hour() {
        assert_eq!(backoff(1), Duration::from_secs(6 * 60));
        assert_eq!(backoff(2), Duration::from_secs(12 * 60));
        assert_eq!(backoff(9), MAX_BACKOFF);
    }

    #[test]
    fn settings_keep_the_service_by_name() {
        let config = SyncConfig::KDrive {
            drive_id: 42,
            folder_id: 7,
            label: "Private › Readlet".into(),
        };
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["service"], "kdrive");
        assert_eq!(json["driveId"], 42);
        assert_eq!(serde_json::from_value::<SyncConfig>(json).unwrap(), config);
    }
}
