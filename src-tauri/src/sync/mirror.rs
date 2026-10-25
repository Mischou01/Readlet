//! Mirroring the devices folder (`.readlet/devices/`) with a folder in the cloud.
//!
//! Each device writes only its own folder, so there's nothing to reconcile: this device's folder
//! is pushed (it's the only copy that changes) and the others' are pulled (theirs are the copies
//! that change). The store merges what arrives exactly as it merges what a sync app delivers.
//!
//! `MirrorState` remembers what each file looked like when it last went up or came down, so a
//! pass only moves what changed since. The service behind the folder is a `Remote`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::fsutil;
use crate::store::is_synced_file;

/// Larger files aren't fetched: reading data is small, so one this size isn't ours.
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;

/// A file in the cloud folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteFile {
    pub id: u64,
    pub size: u64,
    /// Changes exactly when the content does (a hash, or a size and revision time).
    pub rev: String,
}

/// A cloud folder, read and written by `/`-separated paths relative to it.
pub trait Remote {
    /// Every file in the folder, at any depth.
    fn listing(&mut self) -> Result<BTreeMap<String, RemoteFile>>;
    fn fetch(&mut self, file: &RemoteFile, dest: &Path) -> Result<()>;
    /// Writes `bytes` at `rel`, replacing what's there, and returns the new file.
    fn put(&mut self, rel: &str, bytes: &[u8]) -> Result<RemoteFile>;
    fn remove(&mut self, file: &RemoteFile) -> Result<()>;
}

/// A local file's size and modification time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalStamp {
    pub len: u64,
    pub modified: i64,
}

impl LocalStamp {
    fn of(path: &Path) -> Option<Self> {
        let meta = fs::metadata(path).ok().filter(|m| m.is_file())?;
        Some(Self {
            len: meta.len(),
            modified: fsutil::system_time_ms(meta.modified()),
        })
    }
}

/// A file as it was when it last went up or came down.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Known {
    pub local: LocalStamp,
    pub remote: RemoteFile,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MirrorState {
    pub files: BTreeMap<String, Known>,
}

/// What a pass moved.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Moved {
    pub uploaded: usize,
    /// Local files written or deleted because another device changed them.
    pub pulled: Vec<PathBuf>,
}

/// The synced files in this device's folder, by path relative to the devices folder.
fn own_files(devices_dir: &Path, own: &str) -> BTreeMap<String, PathBuf> {
    walkdir::WalkDir::new(devices_dir.join(own))
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let rel = e.path().strip_prefix(devices_dir).ok()?;
            let rel = rel
                .components()
                .map(|c| c.as_os_str().to_str())
                .collect::<Option<Vec<_>>>()?
                .join("/");
            is_synced_file(&rel).then(|| (rel, e.into_path()))
        })
        .collect()
}

fn is_own(rel: &str, own: &str) -> bool {
    rel.strip_prefix(own)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// Uploads what changed in this device's folder since the last pass, and removes from the cloud
/// what was deleted here. With the cloud's `listing`, files missing from it go up again too
/// (someone tidied the cloud folder); without one, only local changes are looked at, which costs
/// no request when nothing changed.
pub fn push(
    devices_dir: &Path,
    own: &str,
    state: &mut MirrorState,
    remote: &mut dyn Remote,
    listing: Option<&BTreeMap<String, RemoteFile>>,
) -> Result<usize> {
    let files = own_files(devices_dir, own);
    let mut uploaded = 0;
    for (rel, path) in &files {
        // Taken before reading: if the file changes in between, the next pass sends it again.
        let Some(stamp) = LocalStamp::of(path) else {
            continue;
        };
        let known = state.files.get(rel);
        let missing = listing.is_some_and(|l| !l.contains_key(rel));
        if known.is_some_and(|k| k.local == stamp) && !missing {
            continue;
        }
        let bytes = fs::read(path)?;
        let file = remote.put(rel, &bytes)?;
        state.files.insert(
            rel.clone(),
            Known {
                local: stamp,
                remote: file,
            },
        );
        uploaded += 1;
    }
    let deleted: Vec<String> = state
        .files
        .keys()
        .filter(|rel| is_own(rel, own) && !files.contains_key(*rel))
        .cloned()
        .collect();
    for rel in deleted {
        let file = listing
            .and_then(|l| l.get(&rel))
            .cloned()
            .or_else(|| state.files.get(&rel).map(|k| k.remote.clone()));
        if let Some(file) = file {
            remote.remove(&file)?;
        }
        state.files.remove(&rel);
    }
    Ok(uploaded)
}

/// Brings the other devices' changes down: files they added or changed, and deletions of files
/// this device fetched before. Files it never fetched (ones a sync app delivered, say) are left
/// alone.
pub fn pull(
    devices_dir: &Path,
    own: &str,
    state: &mut MirrorState,
    remote: &mut dyn Remote,
    listing: &BTreeMap<String, RemoteFile>,
) -> Result<Vec<PathBuf>> {
    let mut pulled = Vec::new();
    for (rel, file) in listing {
        if is_own(rel, own) || !is_synced_file(rel) {
            continue;
        }
        if file.size > MAX_FILE_BYTES {
            log::warn!("not syncing {rel}: it's too large to be reading data");
            continue;
        }
        let path = devices_dir.join(rel);
        let current = state.files.get(rel).is_some_and(|known| {
            known.remote.rev == file.rev && LocalStamp::of(&path) == Some(known.local)
        });
        if current {
            continue;
        }
        let Some(parent) = path.parent() else {
            continue;
        };
        fs::create_dir_all(parent)?;
        // Into a hidden temporary file first, like every write in the store: nothing ever reads
        // a half-downloaded file.
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        let tmp = parent.join(format!(".{name}.sync.tmp"));
        if let Err(e) = remote.fetch(file, &tmp) {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
        fs::rename(&tmp, &path).inspect_err(|_| {
            let _ = fs::remove_file(&tmp);
        })?;
        if let Some(local) = LocalStamp::of(&path) {
            let remote = file.clone();
            state.files.insert(rel.clone(), Known { local, remote });
        }
        pulled.push(path);
    }
    let gone: Vec<String> = state
        .files
        .keys()
        .filter(|rel| !is_own(rel, own) && !listing.contains_key(*rel))
        .cloned()
        .collect();
    for rel in gone {
        let path = devices_dir.join(&rel);
        let known = state.files.remove(&rel);
        // Only a file as this device fetched it: one changed since belongs to whoever changed it.
        if known.is_some_and(|k| LocalStamp::of(&path) == Some(k.local))
            && fs::remove_file(&path).is_ok()
        {
            pulled.push(path);
        }
    }
    Ok(pulled)
}

/// A full pass: pushes this device's changes, then pulls the others'.
pub fn sync(
    devices_dir: &Path,
    own: &str,
    state: &mut MirrorState,
    remote: &mut dyn Remote,
) -> Result<Moved> {
    let listing = remote.listing()?;
    let uploaded = push(devices_dir, own, state, remote, Some(&listing))?;
    let pulled = pull(devices_dir, own, state, remote, &listing)?;
    Ok(Moved { uploaded, pulled })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;

    const FP: &str = "0123456789abcdef0123456789abcdef";
    const LAPTOP: &str = "aaaaaaaaaaaaaaaa";
    const PHONE: &str = "bbbbbbbbbbbbbbbb";

    /// A cloud folder in memory.
    #[derive(Default)]
    struct Cloud {
        files: BTreeMap<String, (RemoteFile, Vec<u8>)>,
        next_id: u64,
        requests: usize,
        offline: bool,
    }

    impl Cloud {
        fn check(&mut self) -> Result<()> {
            self.requests += 1;
            if self.offline {
                return Err(Error::Network("offline".into()));
            }
            Ok(())
        }

        fn text(&self, rel: &str) -> Option<String> {
            self.files
                .get(rel)
                .map(|(_, b)| String::from_utf8(b.clone()).unwrap())
        }
    }

    impl Remote for Cloud {
        fn listing(&mut self) -> Result<BTreeMap<String, RemoteFile>> {
            self.check()?;
            Ok(self
                .files
                .iter()
                .map(|(rel, (file, _))| (rel.clone(), file.clone()))
                .collect())
        }

        fn fetch(&mut self, file: &RemoteFile, dest: &Path) -> Result<()> {
            self.check()?;
            let (_, bytes) = self.files.values().find(|(f, _)| f.id == file.id).unwrap();
            fs::write(dest, bytes)?;
            Ok(())
        }

        fn put(&mut self, rel: &str, bytes: &[u8]) -> Result<RemoteFile> {
            self.check()?;
            self.next_id += 1;
            let id = self.files.get(rel).map_or(self.next_id, |(f, _)| f.id);
            let file = RemoteFile {
                id,
                size: bytes.len() as u64,
                rev: format!("{}", self.next_id),
            };
            self.files
                .insert(rel.to_owned(), (file.clone(), bytes.to_vec()));
            Ok(file)
        }

        fn remove(&mut self, file: &RemoteFile) -> Result<()> {
            self.check()?;
            self.files.retain(|_, (f, _)| f.id != file.id);
            Ok(())
        }
    }

    fn write(dir: &Path, rel: &str, text: &str) {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    /// Makes the next write to a file look changed even within the same millisecond.
    fn touch_later(dir: &Path, rel: &str, text: &str) {
        std::thread::sleep(std::time::Duration::from_millis(5));
        write(dir, rel, text);
    }

    #[test]
    fn two_devices_meet_in_the_cloud() {
        let laptop = tempfile::tempdir().unwrap();
        let phone = tempfile::tempdir().unwrap();
        let mut cloud = Cloud::default();
        let (mut laptop_state, mut phone_state) = (MirrorState::default(), MirrorState::default());
        let book = format!("books/{FP}.json");

        write(phone.path(), &format!("{PHONE}/{book}"), "phone: 40%");
        write(
            phone.path(),
            &format!("{PHONE}/sessions/open.json"),
            "in progress",
        );
        let moved = sync(phone.path(), PHONE, &mut phone_state, &mut cloud).unwrap();
        assert_eq!(moved.uploaded, 1, "the open session stays on the phone");

        write(laptop.path(), &format!("{LAPTOP}/{book}"), "laptop: 10%");
        let moved = sync(laptop.path(), LAPTOP, &mut laptop_state, &mut cloud).unwrap();
        assert_eq!(moved.uploaded, 1);
        assert_eq!(moved.pulled, [laptop.path().join(PHONE).join(&book)]);
        assert_eq!(
            fs::read_to_string(laptop.path().join(PHONE).join(&book)).unwrap(),
            "phone: 40%"
        );

        // Nothing changed: nothing moves.
        let moved = sync(laptop.path(), LAPTOP, &mut laptop_state, &mut cloud).unwrap();
        assert_eq!(moved, Moved::default());

        // The phone reads on; the laptop gets just that.
        touch_later(phone.path(), &format!("{PHONE}/{book}"), "phone: 55%");
        sync(phone.path(), PHONE, &mut phone_state, &mut cloud).unwrap();
        let moved = sync(laptop.path(), LAPTOP, &mut laptop_state, &mut cloud).unwrap();
        assert_eq!(moved.pulled.len(), 1);
        assert_eq!(
            cloud.text(&format!("{PHONE}/{book}")).unwrap(),
            "phone: 55%"
        );
        assert_eq!(
            fs::read_to_string(laptop.path().join(PHONE).join(&book)).unwrap(),
            "phone: 55%"
        );
    }

    #[test]
    fn a_push_without_changes_makes_no_request() {
        let dir = tempfile::tempdir().unwrap();
        let mut cloud = Cloud::default();
        let mut state = MirrorState::default();
        write(dir.path(), &format!("{LAPTOP}/profile.json"), "{}");
        assert_eq!(
            push(dir.path(), LAPTOP, &mut state, &mut cloud, None).unwrap(),
            1
        );
        let requests = cloud.requests;
        assert_eq!(
            push(dir.path(), LAPTOP, &mut state, &mut cloud, None).unwrap(),
            0
        );
        assert_eq!(cloud.requests, requests);
    }

    #[test]
    fn deletions_travel_both_ways() {
        let laptop = tempfile::tempdir().unwrap();
        let phone = tempfile::tempdir().unwrap();
        let mut cloud = Cloud::default();
        let (mut laptop_state, mut phone_state) = (MirrorState::default(), MirrorState::default());
        let cover = format!("{PHONE}/covers/{FP}-7.jpg");
        write(phone.path(), &cover, "jpeg");
        sync(phone.path(), PHONE, &mut phone_state, &mut cloud).unwrap();
        sync(laptop.path(), LAPTOP, &mut laptop_state, &mut cloud).unwrap();
        assert!(laptop.path().join(&cover).exists());

        // The phone replaces its chosen cover: the old file goes from the cloud, then the laptop.
        fs::remove_file(phone.path().join(&cover)).unwrap();
        sync(phone.path(), PHONE, &mut phone_state, &mut cloud).unwrap();
        assert!(cloud.files.is_empty());
        let moved = sync(laptop.path(), LAPTOP, &mut laptop_state, &mut cloud).unwrap();
        assert_eq!(moved.pulled, [laptop.path().join(&cover)]);
        assert!(!laptop.path().join(&cover).exists());
        assert!(laptop_state.files.is_empty());
    }

    #[test]
    fn files_it_never_fetched_are_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let mut cloud = Cloud::default();
        let mut state = MirrorState::default();
        // Delivered by a sync app, before kDrive was connected.
        write(dir.path(), &format!("{PHONE}/profile.json"), "{}");
        sync(dir.path(), LAPTOP, &mut state, &mut cloud).unwrap();
        assert!(dir.path().join(PHONE).join("profile.json").exists());
    }

    #[test]
    fn a_failed_pass_keeps_what_it_managed() {
        let dir = tempfile::tempdir().unwrap();
        let mut cloud = Cloud::default();
        let mut state = MirrorState::default();
        write(dir.path(), &format!("{LAPTOP}/profile.json"), "{}");
        cloud.offline = true;
        assert!(sync(dir.path(), LAPTOP, &mut state, &mut cloud).is_err());
        assert!(state.files.is_empty());
        cloud.offline = false;
        assert_eq!(
            sync(dir.path(), LAPTOP, &mut state, &mut cloud)
                .unwrap()
                .uploaded,
            1
        );
    }

    #[test]
    fn nothing_lands_outside_the_devices_folder() {
        let dir = tempfile::tempdir().unwrap();
        let mut cloud = Cloud::default();
        let mut state = MirrorState::default();
        for rel in [
            "../evil.json",
            "bbbbbbbbbbbbbbbb/../../evil.json",
            "bbbbbbbbbbbbbbbb/x.sh",
        ] {
            cloud.put(rel, b"!").unwrap();
        }
        let moved = sync(dir.path(), LAPTOP, &mut state, &mut cloud).unwrap();
        assert!(moved.pulled.is_empty());
        assert!(!dir.path().parent().unwrap().join("evil.json").exists());
    }
}
