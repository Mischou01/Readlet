//! The requests Readlet makes to the internet, for finding book details and free books
//! (docs/ONLINE.md). Each one follows something the reader asked for. They go through Rust rather
//! than the webview, so the webview's CSP stays closed to the network, and only to the hosts in
//! `allowed_host`: redirects are followed by hand, so every hop is checked.

use std::fs::File;
use std::io;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use ureq::http::Uri;

use crate::error::{Error, Result};

/// Open Library asks apps to name themselves, with a way to reach whoever runs them.
const USER_AGENT: &str = concat!(
    "Readlet/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/Mischou01/Readlet)"
);
const MAX_REDIRECTS: usize = 5;

static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| {
    ureq::Agent::config_builder()
        .user_agent(USER_AGENT)
        .https_only(true)
        .timeout_connect(Some(Duration::from_secs(15)))
        // Long enough for a large book on a slow connection, short enough to end a stalled one.
        .timeout_global(Some(Duration::from_secs(300)))
        .max_redirects(0)
        .max_redirects_will_error(false)
        .build()
        .into()
});

/// Open Library and the Internet Archive servers its covers redirect to; Project Gutenberg.
fn allowed_host(host: &str) -> bool {
    let archive_node = host
        .strip_suffix(".us.archive.org")
        .is_some_and(|node| !node.is_empty() && node.bytes().all(|b| b.is_ascii_alphanumeric()));
    archive_node
        || matches!(
            host,
            "openlibrary.org" | "covers.openlibrary.org" | "archive.org" | "www.gutenberg.org"
        )
}

fn failed(host: &str, e: impl std::fmt::Display) -> Error {
    Error::Network(format!("Couldn't reach {host}: {e}"))
}

/// Requests `url`, following redirects to allowed hosts only, and returns the final response.
fn get(url: &str) -> Result<ureq::http::Response<ureq::Body>> {
    let mut url = url.to_owned();
    for _ in 0..=MAX_REDIRECTS {
        let uri: Uri = url
            .parse()
            .map_err(|_| Error::Network(format!("Not a valid address: {url}")))?;
        let host = uri.host().unwrap_or_default().to_owned();
        if uri.scheme_str() != Some("https") || !allowed_host(&host) {
            return Err(Error::Network(format!("Refused to follow a link to {url}")));
        }
        let response = AGENT.get(&url).call().map_err(|e| failed(&host, e))?;
        if !response.status().is_redirection() {
            return Ok(response);
        }
        let location = response
            .headers()
            .get(ureq::http::header::LOCATION)
            .and_then(|l| l.to_str().ok())
            .ok_or_else(|| failed(&host, "a redirect without a location"))?;
        url = match location.strip_prefix('/') {
            Some(path) => format!("https://{host}/{path}"),
            None => location.to_owned(),
        };
    }
    Err(Error::Network("Too many redirects".into()))
}

/// Fetches `url` into memory, refusing anything larger than `max_bytes`.
pub fn fetch(url: &str, max_bytes: u64) -> Result<Vec<u8>> {
    let mut response = get(url)?;
    response
        .body_mut()
        .with_config()
        .limit(max_bytes)
        .read_to_vec()
        .map_err(|e| failed(url, e))
}

/// Streams `url` into the file at `dest`, refusing anything larger than `max_bytes`. A partial
/// file is removed.
pub fn download(url: &str, max_bytes: u64, dest: &Path) -> Result<()> {
    let mut response = get(url)?;
    let mut body = response.body_mut().with_config().limit(max_bytes).reader();
    let copied = File::create(dest).and_then(|mut file| io::copy(&mut body, &mut file));
    copied.map(|_| ()).map_err(|e| {
        let _ = std::fs::remove_file(dest);
        failed(url, e)
    })
}

/// Percent-encodes a query parameter's value.
pub fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                char::from(b).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_hosts_are_allowed() {
        assert!(allowed_host("openlibrary.org"));
        assert!(allowed_host("covers.openlibrary.org"));
        assert!(allowed_host("ia802809.us.archive.org"));
        assert!(allowed_host("www.gutenberg.org"));
        assert!(!allowed_host("evil.org"));
        assert!(!allowed_host("openlibrary.org.evil.org"));
        assert!(!allowed_host("x.y.us.archive.org"));
    }

    #[test]
    fn encodes_query_values() {
        assert_eq!(
            encode("iron gold & co/é"),
            "iron%20gold%20%26%20co%2F%C3%A9"
        );
    }
}
