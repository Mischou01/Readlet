//! Infomaniak kDrive, over its REST API (as Penultimate syncs with it).
//!
//! WebDAV is kept for paid plans; the API answers on every plan, to a personal token the reader
//! makes in Infomaniak's Manager (Profile → Developer → API tokens, scope "drive"). The API
//! addresses files by id; `KDriveFolder` turns those into paths for the mirror.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::thread;
use std::time::Duration;

use serde_json::Value;

use super::mirror::{Remote, RemoteFile};
use crate::error::{Error, Result};
use crate::net::{self, Method, encode};

const API: &str = "https://api.infomaniak.com";
/// Where readers make the token.
pub const TOKEN_PAGE: &str = "https://manager.infomaniak.com/v3/ng/accounts/token/list";
/// The drive's top folder.
const ROOT_DIR: u64 = 1;
const MAX_ANSWER_BYTES: u64 = 16 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES: u64 = 64 * 1024 * 1024;
/// How often a request that hit a busy server or a dropped connection is tried again.
const RETRIES: u32 = 4;

/// A file or folder on the drive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub id: u64,
    pub parent: u64,
    pub name: String,
    pub dir: bool,
    pub size: u64,
    pub rev: String,
    /// "is_private_space" for the reader's own folder at the top of the drive.
    pub visibility: Option<String>,
}

fn item_of(value: &Value) -> Option<Item> {
    let rev = value
        .get("hash")
        .and_then(Value::as_str)
        .filter(|h| !h.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            let revised = value
                .get("revised_at")
                .or_else(|| value.get("last_modified_at"));
            format!("{}:{}", value["size"], revised.unwrap_or(&Value::Null))
        });
    Some(Item {
        id: value.get("id")?.as_u64()?,
        parent: value.get("parent_id").and_then(Value::as_u64).unwrap_or(0),
        name: value.get("name")?.as_str()?.to_owned(),
        dir: value.get("type").and_then(Value::as_str) == Some("dir"),
        size: value.get("size").and_then(Value::as_u64).unwrap_or(0),
        rev,
        visibility: value
            .get("visibility")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

/// The drive's number from a pasted kDrive address (`…/app/drive/123456/…`) or the bare number.
pub fn parse_drive_id(text: &str) -> Option<u64> {
    let text = text.trim();
    if let Ok(id) = text.parse() {
        return Some(id);
    }
    let after = text.split("/drive/").nth(1)?;
    let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// What kDrive's error answer says, or a plain description of the status.
fn api_error(status: u16, body: &[u8]) -> Error {
    if status == 401 {
        return Error::Unauthorized(
            "kDrive didn't accept the token. It may have expired or been deleted.".into(),
        );
    }
    let payload: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let error = &payload["error"];
    let description = error["description"]
        .as_str()
        .or_else(|| error["code"].as_str());
    match (status, description) {
        (403, _) => Error::Unauthorized(
            "The token can't reach this drive. Check the drive's address, and that the token has \
             the “drive” scope."
                .into(),
        ),
        (404, _) => Error::Network("kDrive couldn't find the drive or folder.".into()),
        (_, Some(text)) => Error::Network(format!("kDrive said: {text}")),
        _ => Error::Network(format!("kDrive answered {status}.")),
    }
}

pub struct KDrive {
    token: String,
    pub drive_id: u64,
}

impl KDrive {
    pub fn new(token: &str, drive_id: u64) -> Self {
        Self {
            token: token.to_owned(),
            drive_id,
        }
    }

    /// Sends a request, trying again after busy servers (429, 5xx) and dropped connections.
    fn send(&self, method: Method, url: &str, body: Option<(&[u8], &str)>) -> Result<net::Answer> {
        let mut attempt = 0;
        loop {
            let wait = match net::call_api(method, url, &self.token, body) {
                Ok(answer) if matches!(answer.status, 429 | 500 | 502 | 503 | 504) => {
                    if attempt == RETRIES {
                        return Ok(answer);
                    }
                    answer.retry_after.map(|s| Duration::from_secs(s.min(60)))
                }
                Ok(answer) => return Ok(answer),
                Err(Error::Network(_)) if attempt < RETRIES => None,
                Err(e) => return Err(e),
            };
            thread::sleep(wait.unwrap_or(Duration::from_secs(1 << attempt)));
            attempt += 1;
        }
    }

    /// Calls the API and returns the answer's `data`.
    fn call(&self, method: Method, path: &str, body: Option<(&[u8], &str)>) -> Result<Value> {
        let answer = self.send(method, &format!("{API}{path}"), body)?;
        let status = answer.status;
        let bytes = answer.bytes(MAX_ANSWER_BYTES)?;
        if !(200..300).contains(&status) {
            return Err(api_error(status, &bytes));
        }
        let payload: Value = serde_json::from_slice(&bytes)
            .map_err(|_| Error::Network("kDrive sent something unexpected.".into()))?;
        if payload["result"] != "success" {
            return Err(api_error(status, &bytes));
        }
        Ok(payload["data"].clone())
    }

    fn listing(&self, dir: u64, depth: &str) -> Result<Vec<Item>> {
        let mut items = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut path = format!(
                "/3/drive/{}/files/{dir}/files?depth={depth}&limit=1000&with=hash",
                self.drive_id
            );
            if let Some(cursor) = &cursor {
                path.push_str(&format!("&cursor={}", encode(cursor)));
            }
            let answer = self.send(Method::Get, &format!("{API}{path}"), None)?;
            let status = answer.status;
            let bytes = answer.bytes(MAX_ANSWER_BYTES)?;
            let page: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            if !(200..300).contains(&status) || page["result"] != "success" {
                return Err(api_error(status, &bytes));
            }
            items.extend(
                page["data"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(item_of),
            );
            match page["cursor"].as_str() {
                Some(next) if page["has_more"] == true => cursor = Some(next.to_owned()),
                _ => return Ok(items),
            }
        }
    }

    pub fn children(&self, dir: u64) -> Result<Vec<Item>> {
        self.listing(dir, "child")
    }

    pub fn tree(&self, dir: u64) -> Result<Vec<Item>> {
        self.listing(dir, "unlimited")
    }

    pub fn make_dir(&self, parent: u64, name: &str) -> Result<Item> {
        let body = serde_json::to_vec(&serde_json::json!({ "name": name }))?;
        let data = self.call(
            Method::Post,
            &format!("/3/drive/{}/files/{parent}/directory", self.drive_id),
            Some((&body, "application/json")),
        )?;
        item_of(&data).ok_or_else(|| Error::Network("kDrive sent something unexpected.".into()))
    }

    /// Writes `bytes` as `name` in `dir`, as a new version of the file if it's there already.
    pub fn upload(&self, dir: u64, name: &str, bytes: &[u8]) -> Result<Item> {
        let path = format!(
            "/3/drive/{}/upload?directory_id={dir}&file_name={}&total_size={}&conflict=version&with=hash",
            self.drive_id,
            encode(name),
            bytes.len()
        );
        let data = self.call(
            Method::Post,
            &path,
            Some((bytes, "application/octet-stream")),
        )?;
        item_of(&data).ok_or_else(|| Error::Network("kDrive sent something unexpected.".into()))
    }

    pub fn download(&self, file: u64, dest: &Path) -> Result<()> {
        let url = format!("{API}/2/drive/{}/files/{file}/download", self.drive_id);
        let answer = self.send(Method::Get, &url, None)?;
        if !(200..300).contains(&answer.status) {
            let status = answer.status;
            return Err(api_error(
                status,
                &answer.bytes(MAX_ANSWER_BYTES).unwrap_or_default(),
            ));
        }
        answer.save(MAX_DOWNLOAD_BYTES, dest)
    }

    /// Moves a file to kDrive's trash, where it can still be restored for a while.
    pub fn trash(&self, file: u64) -> Result<()> {
        let url = format!("{API}/2/drive/{}/files/{file}", self.drive_id);
        let answer = self.send(Method::Delete, &url, None)?;
        let status = answer.status;
        // Already gone is what was wanted.
        if (200..300).contains(&status) || status == 404 {
            return Ok(());
        }
        Err(api_error(
            status,
            &answer.bytes(MAX_ANSWER_BYTES).unwrap_or_default(),
        ))
    }

    /// The reader's own folder at the top of the drive ("Private"), where Readlet's folder goes.
    pub fn private_space(&self) -> Result<Item> {
        self.children(ROOT_DIR)?
            .into_iter()
            .find(|item| item.dir && item.visibility.as_deref() == Some("is_private_space"))
            .ok_or_else(|| {
                Error::Network("This drive has no private folder for Readlet to use.".into())
            })
    }

    pub fn find_or_make_dir(&self, parent: u64, name: &str) -> Result<Item> {
        let found = self
            .children(parent)?
            .into_iter()
            .find(|item| item.dir && item.name == name);
        match found {
            Some(dir) => Ok(dir),
            None => self.make_dir(parent, name),
        }
    }
}

/// The paths of the files under `folder` in a tree listing, relative to it. Items whose chain of
/// parents doesn't lead to `folder` aren't in it and are left out. Also returns the folders' ids.
fn paths_in(folder: u64, items: &[Item]) -> (BTreeMap<String, RemoteFile>, HashMap<String, u64>) {
    let by_id: HashMap<u64, &Item> = items.iter().map(|item| (item.id, item)).collect();
    let rel_of = |item: &Item| -> Option<String> {
        let mut parts = vec![item.name.as_str()];
        let mut parent = item.parent;
        while parent != folder {
            let above = by_id.get(&parent)?;
            parts.push(&above.name);
            parent = above.parent;
            // A cycle would be a broken listing; give up on the item rather than loop.
            if parts.len() > 32 {
                return None;
            }
        }
        parts.reverse();
        Some(parts.join("/"))
    };
    let mut files = BTreeMap::new();
    let mut dirs = HashMap::from([(String::new(), folder)]);
    for item in items {
        let Some(rel) = rel_of(item) else { continue };
        if item.dir {
            dirs.insert(rel, item.id);
        } else {
            let file = RemoteFile {
                id: item.id,
                size: item.size,
                rev: item.rev.clone(),
            };
            files.insert(rel, file);
        }
    }
    (files, dirs)
}

/// The folder on the drive that mirrors `.readlet/devices/`.
pub struct KDriveFolder {
    drive: KDrive,
    folder: u64,
    /// Folder ids by relative path, from the last listing and the folders made since.
    dirs: HashMap<String, u64>,
}

impl KDriveFolder {
    pub fn new(drive: KDrive, folder: u64) -> Self {
        Self {
            drive,
            folder,
            dirs: HashMap::from([(String::new(), folder)]),
        }
    }

    fn dir_id(&mut self, rel_dir: &str) -> Result<u64> {
        if let Some(id) = self.dirs.get(rel_dir) {
            return Ok(*id);
        }
        let (parent, name) = rel_dir.rsplit_once('/').unwrap_or(("", rel_dir));
        let parent = self.dir_id(parent)?;
        // Another device may have made it since the listing: find_or_make looks first.
        let id = self.drive.find_or_make_dir(parent, name)?.id;
        self.dirs.insert(rel_dir.to_owned(), id);
        Ok(id)
    }
}

impl Remote for KDriveFolder {
    fn listing(&mut self) -> Result<BTreeMap<String, RemoteFile>> {
        let (files, dirs) = paths_in(self.folder, &self.drive.tree(self.folder)?);
        self.dirs = dirs;
        Ok(files)
    }

    fn fetch(&mut self, file: &RemoteFile, dest: &Path) -> Result<()> {
        self.drive.download(file.id, dest)
    }

    fn put(&mut self, rel: &str, bytes: &[u8]) -> Result<RemoteFile> {
        let (dir, name) = rel.rsplit_once('/').unwrap_or(("", rel));
        let dir = self.dir_id(dir)?;
        let item = self.drive.upload(dir, name, bytes)?;
        Ok(RemoteFile {
            id: item.id,
            size: item.size,
            rev: item.rev,
        })
    }

    fn remove(&mut self, file: &RemoteFile) -> Result<()> {
        self.drive.trash(file.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_drive_id_from_an_address() {
        assert_eq!(parse_drive_id("123456"), Some(123456));
        assert_eq!(
            parse_drive_id(" https://ksuite.infomaniak.com/kdrive/app/drive/987654/files/5 "),
            Some(987654)
        );
        assert_eq!(
            parse_drive_id("https://kdrive.infomaniak.com/app/drive/42"),
            Some(42)
        );
        assert_eq!(parse_drive_id("my drive"), None);
    }

    #[test]
    fn reads_items_and_their_revisions() {
        let file = serde_json::json!({
            "id": 7, "parent_id": 3, "name": "a.json", "type": "file", "size": 12,
            "hash": "xxh3:abc", "visibility": ""
        });
        let item = item_of(&file).unwrap();
        assert_eq!(
            (item.id, item.parent, item.dir, item.size),
            (7, 3, false, 12)
        );
        assert_eq!(item.rev, "xxh3:abc");
        let unhashed = serde_json::json!({
            "id": 8, "parent_id": 3, "name": "b", "type": "file", "size": 4, "revised_at": 99
        });
        assert_eq!(item_of(&unhashed).unwrap().rev, "4:99");
        assert!(item_of(&serde_json::json!({ "name": "no id" })).is_none());
    }

    #[test]
    fn turns_a_tree_into_paths() {
        let item = |id, parent, name: &str, dir| Item {
            id,
            parent,
            name: name.into(),
            dir,
            size: 1,
            rev: id.to_string(),
            visibility: None,
        };
        let items = [
            item(10, 1, "aaaaaaaaaaaaaaaa", true),
            item(11, 10, "books", true),
            item(12, 11, "x.json", false),
            item(13, 10, "profile.json", false),
            item(20, 999, "elsewhere.json", false),
        ];
        let (files, dirs) = paths_in(1, &items);
        let paths: Vec<_> = files.keys().cloned().collect();
        assert_eq!(
            paths,
            [
                "aaaaaaaaaaaaaaaa/books/x.json",
                "aaaaaaaaaaaaaaaa/profile.json"
            ]
        );
        assert_eq!(dirs["aaaaaaaaaaaaaaaa/books"], 11);
    }

    #[test]
    fn explains_errors() {
        assert!(matches!(api_error(401, b""), Error::Unauthorized(_)));
        let body = br#"{"result":"error","error":{"code":"x","description":"Quota exceeded"}}"#;
        assert_eq!(
            api_error(400, body).to_string(),
            "kDrive said: Quota exceeded"
        );
        assert_eq!(
            api_error(500, b"<html>").to_string(),
            "kDrive answered 500."
        );
    }
}
