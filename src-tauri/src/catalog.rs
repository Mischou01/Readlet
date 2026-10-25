//! Finding free books in Project Gutenberg's catalogue (docs/ONLINE.md), through `net`. One
//! search or one download per tap by the reader: Gutenberg blocks bulk downloading.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use quick_xml::Reader;
use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::Event;
use serde::Serialize;

use crate::error::{Error, Result};
use crate::net::{self, encode};

const SEARCH: &str = "https://www.gutenberg.org/ebooks/search.opds/";
const MAX_FEED_BYTES: u64 = 2 * 1024 * 1024;
/// Gutenberg's largest illustrated EPUBs are well under this.
const MAX_BOOK_BYTES: u64 = 200 * 1024 * 1024;

/// A book in Gutenberg's catalogue, as its search results list it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreeBook {
    /// Gutenberg's number for the book, as in `gutenberg.org/ebooks/<id>`.
    pub id: u64,
    pub title: String,
    pub author: Option<String>,
}

fn unreadable(e: impl std::fmt::Display) -> Error {
    Error::Network(format!("Project Gutenberg sent something unexpected: {e}"))
}

/// Searches the catalogue by title, author or subject. Gives its first page of results (25).
pub fn search(query: &str) -> Result<Vec<FreeBook>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let feed = net::fetch(&format!("{SEARCH}?query={}", encode(query)), MAX_FEED_BYTES)?;
    parse_feed(std::str::from_utf8(&feed).map_err(unreadable)?)
}

/// The books in an OPDS search feed. Entries that aren't books ("Authors", "Subjects": links to
/// further searches) are left out.
fn parse_feed(xml: &str) -> Result<Vec<FreeBook>> {
    let mut reader = Reader::from_str(xml);
    let mut books = Vec::new();
    let mut in_entry = false;
    let mut field: Option<&'static str> = None;
    let (mut id, mut title, mut author) = (String::new(), String::new(), String::new());
    loop {
        let text = match field {
            Some("id") => Some(&mut id),
            Some("title") => Some(&mut title),
            Some("content") => Some(&mut author),
            _ => None,
        };
        match reader.read_event().map_err(unreadable)? {
            Event::Start(e) => match e.local_name().as_ref() {
                "entry" => {
                    in_entry = true;
                    (id, title, author) = (String::new(), String::new(), String::new());
                }
                "id" if in_entry => field = Some("id"),
                "title" if in_entry => field = Some("title"),
                "content" if in_entry => field = Some("content"),
                _ => {}
            },
            Event::End(e) => match e.local_name().as_ref() {
                "entry" => {
                    in_entry = false;
                    if let Some(book) = book_from_entry(&id, &title, &author) {
                        books.push(book);
                    }
                }
                "id" | "title" | "content" => field = None,
                _ => {}
            },
            Event::Text(e) => {
                if let Some(text) = text {
                    text.push_str(&e.xml10_content());
                }
            }
            Event::GeneralRef(e) => {
                if let Some(text) = text {
                    if let Some(c) = e.resolve_char_ref().map_err(unreadable)? {
                        text.push(c);
                    } else if let Some(s) = resolve_predefined_entity(&e.xml10_content()) {
                        text.push_str(s);
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(books)
}

/// A book entry's id is `https://www.gutenberg.org/ebooks/<number>.opds`.
fn book_from_entry(id: &str, title: &str, author: &str) -> Option<FreeBook> {
    let number = id
        .trim()
        .strip_prefix("https://www.gutenberg.org/ebooks/")?
        .strip_suffix(".opds")?;
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let author = author.split_whitespace().collect::<Vec<_>>().join(" ");
    Some(FreeBook {
        id: number.parse().ok()?,
        title: (!title.is_empty()).then_some(title)?,
        author: (!author.is_empty()).then_some(author),
    })
}

/// Downloads book `id` as an EPUB (with its images) into `dest`, and checks that it is one.
pub fn download(id: u64, dest: &Path) -> Result<()> {
    net::download(
        &format!("https://www.gutenberg.org/ebooks/{id}.epub3.images"),
        MAX_BOOK_BYTES,
        dest,
    )?;
    if is_epub(dest) {
        Ok(())
    } else {
        let _ = std::fs::remove_file(dest);
        Err(unreadable("the download isn't an EPUB"))
    }
}

/// An EPUB is a ZIP whose first entry is the uncompressed `mimetype` file.
fn is_epub(path: &Path) -> bool {
    let mut head = [0u8; 64];
    let read = File::open(path)
        .and_then(|mut f| f.read(&mut head))
        .unwrap_or(0);
    let head = &head[..read];
    let marker = b"mimetypeapplication/epub+zip";
    head.starts_with(b"PK\x03\x04") && head.windows(marker.len()).any(|w| w == marker)
}

/// "Author - Title.epub", like the books people usually have, without characters file systems
/// refuse.
pub fn file_name(id: u64, title: &str, author: Option<&str>) -> String {
    let clean = |s: &str| -> String {
        let s: String = s
            .chars()
            .filter(|c| {
                !c.is_control()
                    && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            })
            .collect();
        s.split_whitespace().collect::<Vec<_>>().join(" ")
    };
    let title = clean(title);
    let author = author.map(clean).filter(|a| !a.is_empty());
    let stem = match (author, title.is_empty()) {
        (_, true) => format!("Gutenberg {id}"),
        (Some(author), false) => format!("{author} - {title}"),
        (None, false) => title,
    };
    let stem: String = stem.chars().take(150).collect();
    format!("{}.epub", stem.trim_end_matches(['.', ' ']))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_books_from_a_search_feed() {
        let feed = r#"<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>http://www.gutenberg.org/ebooks/search.opds/?query=austen</id>
<title>Books: austen</title>
<entry>
<id>https://www.gutenberg.org/ebooks/authors/search.opds/?query=austen</id>
<title>Authors</title>
<content type="text">One author name matches your search.</content>
</entry>
<entry>
<id>https://www.gutenberg.org/ebooks/1342.opds</id>
<title>Pride and Prejudice</title>
<content type="text">Jane Austen</content>
</entry>
<entry>
<id>https://www.gutenberg.org/ebooks/946.opds</id>
<title>Lady Susan &amp; Other
  Stories</title>
</entry>
</feed>"#;
        assert_eq!(
            parse_feed(feed).unwrap(),
            [
                FreeBook {
                    id: 1342,
                    title: "Pride and Prejudice".into(),
                    author: Some("Jane Austen".into()),
                },
                FreeBook {
                    id: 946,
                    title: "Lady Susan & Other Stories".into(),
                    author: None,
                },
            ]
        );
    }

    #[test]
    fn names_files_safely() {
        assert_eq!(
            file_name(1342, "Pride and Prejudice", Some("Jane Austen")),
            "Jane Austen - Pride and Prejudice.epub"
        );
        assert_eq!(file_name(1, "What? A/B: \"C\"", None), "What AB C.epub");
        assert_eq!(file_name(7, "  ", Some("Anon")), "Gutenberg 7.epub");
        assert!(file_name(2, &"x".repeat(400), None).len() <= 155);
    }

    #[test]
    fn recognises_epubs() {
        let dir = tempfile::tempdir().unwrap();
        let epub = dir.path().join("a.epub");
        let mut bytes = b"PK\x03\x04".to_vec();
        bytes.extend([0; 26]);
        bytes.extend(b"mimetypeapplication/epub+zip");
        std::fs::write(&epub, &bytes).unwrap();
        assert!(is_epub(&epub));
        let html = dir.path().join("b.epub");
        std::fs::write(&html, b"<!DOCTYPE html><html>Too many requests</html>").unwrap();
        assert!(!is_epub(&html));
    }
}
