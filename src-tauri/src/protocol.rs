//! Custom URL schemes for the webview (docs/PLAN.md §3, D9):
//!
//! - `book://localhost/<fingerprint>` serves an indexed book's bytes to foliate-js.
//! - `cover://localhost/<fingerprint>` serves its cached cover thumbnail.
//!
//! Only fingerprints that are in the index resolve, so the webview gets no general filesystem
//! access. (On Windows the URLs are `http://book.localhost/…` and `http://cover.localhost/…`.)

use std::borrow::Cow;

use tauri::http::{Request, Response, StatusCode, header};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::covers::cover_path;
use crate::library::fingerprint;
use crate::state::AppState;

pub const BOOK_SCHEME: &str = "book";
pub const COVER_SCHEME: &str = "cover";

type Body = Cow<'static, [u8]>;

pub fn handle_book<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    // Reading a book can take a moment; keep it off the UI thread.
    tauri::async_runtime::spawn_blocking(move || responder.respond(serve_book(&app, &request)));
}

pub fn handle_cover<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || responder.respond(serve_cover(&app, &request)));
}

/// The fingerprint is the whole path: `/<fingerprint>`.
fn requested_fingerprint(request: &Request<Vec<u8>>) -> Option<&str> {
    let fp = request.uri().path().trim_start_matches('/');
    fingerprint::is_valid(fp).then_some(fp)
}

fn serve_book<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Body> {
    let Some(fp) = requested_fingerprint(request) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let state = app.state::<AppState>();
    let (path, format) = match state.book_path(fp) {
        Ok(found) => found,
        Err(_) => return status(StatusCode::NOT_FOUND),
    };
    match std::fs::read(&path) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, format.mime_type())
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::CACHE_CONTROL, "no-store")
            .body(Cow::Owned(bytes))
            .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR)),
        Err(e) => {
            log::warn!("can't read book {fp}: {e}");
            status(StatusCode::NOT_FOUND)
        }
    }
}

fn serve_cover<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Body> {
    let Some(fp) = requested_fingerprint(request) else {
        return status(StatusCode::BAD_REQUEST);
    };
    let state = app.state::<AppState>();
    match std::fs::read(cover_path(&state.paths.covers, fp)) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "image/jpeg")
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            // URLs carry the cover version, so a cached response never goes stale.
            .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
            .body(Cow::Owned(bytes))
            .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR)),
        Err(_) => status(StatusCode::NOT_FOUND),
    }
}

fn status(code: StatusCode) -> Response<Body> {
    let mut response = Response::new(Cow::Borrowed(&[][..]));
    *response.status_mut() = code;
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(uri: &str) -> Request<Vec<u8>> {
        Request::builder().uri(uri).body(Vec::new()).unwrap()
    }

    #[test]
    fn parses_fingerprints_from_both_url_styles() {
        let fp = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            requested_fingerprint(&request(&format!("book://localhost/{fp}"))),
            Some(fp)
        );
        assert_eq!(
            requested_fingerprint(&request(&format!("http://book.localhost/{fp}?v=2"))),
            Some(fp)
        );
        assert_eq!(
            requested_fingerprint(&request("book://localhost/../../etc/passwd")),
            None
        );
        assert_eq!(requested_fingerprint(&request("book://localhost/")), None);
    }
}
