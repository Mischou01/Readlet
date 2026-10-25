//! The requests Readlet makes to the internet: finding book details and free books
//! (docs/ONLINE.md), and syncing reading data with kDrive once the reader has connected it
//! (`sync`). They go through Rust rather than the webview, so the webview's CSP stays closed to
//! the network, and only to the hosts in `allowed_host`: redirects are followed by hand, so every
//! hop is checked.

use std::fs::File;
use std::io;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use ureq::Body;
use ureq::http::{Response, Uri};

use crate::error::{Error, Result};

/// Open Library asks apps to name themselves, with a way to reach whoever runs them.
const USER_AGENT: &str = concat!(
    "Readlet/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/Mischou01/Readlet)"
);
const MAX_REDIRECTS: usize = 5;

static AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| agent(true));

/// For APIs, whose error responses say what went wrong: those are read rather than turned into
/// a bare status code.
static API_AGENT: LazyLock<ureq::Agent> = LazyLock::new(|| agent(false));

fn agent(status_as_error: bool) -> ureq::Agent {
    ureq::Agent::config_builder()
        .user_agent(USER_AGENT)
        .https_only(true)
        .http_status_as_error(status_as_error)
        .timeout_connect(Some(Duration::from_secs(15)))
        // Long enough for a large book on a slow connection, short enough to end a stalled one.
        .timeout_global(Some(Duration::from_secs(300)))
        .max_redirects(0)
        .max_redirects_will_error(false)
        .build()
        .into()
}

/// The host that gets the kDrive token. No other host ever sees it.
pub const KDRIVE_API_HOST: &str = "api.infomaniak.com";

/// Open Library and the Internet Archive servers its covers redirect to; Project Gutenberg;
/// Infomaniak, whose kDrive downloads may come from its storage servers.
fn allowed_host(host: &str) -> bool {
    let node_of = |domain: &str| {
        host.strip_suffix(domain).is_some_and(|node| {
            !node.is_empty() && node.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
    };
    node_of(".us.archive.org")
        || node_of(".infomaniak.com")
        || matches!(
            host,
            "openlibrary.org" | "covers.openlibrary.org" | "archive.org" | "www.gutenberg.org"
        )
}

fn failed(host: &str, e: impl std::fmt::Display) -> Error {
    Error::Network(format!("Couldn't reach {host}: {e}"))
}

/// The host of `url`, if it's an https address on an allowed host.
fn checked_host(url: &str) -> Result<String> {
    let uri: Uri = url
        .parse()
        .map_err(|_| Error::Network(format!("Not a valid address: {url}")))?;
    let host = uri.host().unwrap_or_default().to_owned();
    if uri.scheme_str() != Some("https") || !allowed_host(&host) {
        return Err(Error::Network(format!("Refused to follow a link to {url}")));
    }
    Ok(host)
}

/// Where a redirect from `host` leads.
fn redirect_target(response: &Response<Body>, host: &str) -> Result<String> {
    let location = response
        .headers()
        .get(ureq::http::header::LOCATION)
        .and_then(|l| l.to_str().ok())
        .ok_or_else(|| failed(host, "a redirect without a location"))?;
    Ok(match location.strip_prefix('/') {
        Some(path) => format!("https://{host}/{path}"),
        None => location.to_owned(),
    })
}

/// Requests `url`, following redirects to allowed hosts only, and returns the final response.
fn get(url: &str) -> Result<Response<Body>> {
    let mut url = url.to_owned();
    for _ in 0..=MAX_REDIRECTS {
        let host = checked_host(&url)?;
        let response = AGENT.get(&url).call().map_err(|e| failed(&host, e))?;
        if !response.status().is_redirection() {
            return Ok(response);
        }
        url = redirect_target(&response, &host)?;
    }
    Err(Error::Network("Too many redirects".into()))
}

#[derive(Clone, Copy)]
pub enum Method {
    Get,
    Post,
    Delete,
}

/// An API's answer, whatever its status.
pub struct Answer {
    pub status: u16,
    /// What a 429 or 503 asked for, in seconds.
    pub retry_after: Option<u64>,
    response: Response<Body>,
}

impl Answer {
    /// The body, refusing anything larger than `max_bytes`.
    pub fn bytes(mut self, max_bytes: u64) -> Result<Vec<u8>> {
        self.response
            .body_mut()
            .with_config()
            .limit(max_bytes)
            .read_to_vec()
            .map_err(|e| Error::Network(format!("The answer was cut short: {e}")))
    }

    /// Streams the body into `dest`, refusing anything larger than `max_bytes`. A partial file
    /// is removed.
    pub fn save(mut self, max_bytes: u64, dest: &Path) -> Result<()> {
        let mut body = self
            .response
            .body_mut()
            .with_config()
            .limit(max_bytes)
            .reader();
        let copied = File::create(dest).and_then(|mut file| io::copy(&mut body, &mut file));
        copied.map(|_| ()).map_err(|e| {
            let _ = std::fs::remove_file(dest);
            Error::Network(format!("The download was cut short: {e}"))
        })
    }
}

/// Calls an API that takes a bearer `token`, returning its answer whatever the status. The token
/// goes to `KDRIVE_API_HOST` only: a redirect to another host (a download's storage server) is
/// followed without it. `body` is the bytes to send and their content type.
pub fn call_api(
    method: Method,
    url: &str,
    token: &str,
    body: Option<(&[u8], &str)>,
) -> Result<Answer> {
    let mut url = url.to_owned();
    let bearer = format!("Bearer {token}");
    for _ in 0..=MAX_REDIRECTS {
        let host = checked_host(&url)?;
        let auth = (host == KDRIVE_API_HOST).then_some(bearer.as_str());
        let sent = match method {
            Method::Get => with_auth(API_AGENT.get(&url), auth).call(),
            Method::Delete => with_auth(API_AGENT.delete(&url), auth).call(),
            Method::Post => {
                let (bytes, kind) = body.unwrap_or((&[], "application/octet-stream"));
                with_auth(API_AGENT.post(&url), auth)
                    .header("Content-Type", kind)
                    .send(bytes)
            }
        };
        let response = sent.map_err(|e| failed(&host, e))?;
        if response.status().is_redirection() && matches!(method, Method::Get) {
            url = redirect_target(&response, &host)?;
            continue;
        }
        let retry_after = response
            .headers()
            .get(ureq::http::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.trim().parse().ok());
        return Ok(Answer {
            status: response.status().as_u16(),
            retry_after,
            response,
        });
    }
    Err(Error::Network("Too many redirects".into()))
}

fn with_auth<B>(request: ureq::RequestBuilder<B>, auth: Option<&str>) -> ureq::RequestBuilder<B> {
    match auth {
        Some(auth) => request.header("Authorization", auth),
        None => request,
    }
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
        assert!(allowed_host("api.infomaniak.com"));
        assert!(allowed_host("kdrive-storage-1.infomaniak.com"));
        assert!(!allowed_host("infomaniak.com.evil.org"));
        assert!(!allowed_host("a.b.infomaniak.com"));
    }

    #[test]
    fn encodes_query_values() {
        assert_eq!(
            encode("iron gold & co/é"),
            "iron%20gold%20%26%20co%2F%C3%A9"
        );
    }
}
