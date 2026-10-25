//! Finding a book's details on Open Library (docs/ONLINE.md), through `net`.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::covers::MAX_COVER_BYTES;
use crate::error::{Error, Result};
use crate::net::{self, encode};

const API: &str = "https://openlibrary.org";
const MAX_JSON_BYTES: u64 = 2 * 1024 * 1024;
const RESULTS: usize = 8;
/// Asks for the best-matching edition of each work along with the work.
const SEARCH_FIELDS: &str = "key,title,author_name,first_publish_year,cover_i,editions,\
    editions.key,editions.title,editions.publisher,editions.cover_i";

/// Lookups are kept for the session: Open Library asks apps not to repeat requests.
static CACHE: LazyLock<Mutex<HashMap<String, Value>>> = LazyLock::new(Default::default);

fn unreadable(e: impl std::fmt::Display) -> Error {
    Error::Network(format!("Open Library sent something unexpected: {e}"))
}

fn fetch_json(url: String) -> Result<Value> {
    if let Some(hit) = CACHE.lock().unwrap_or_else(|e| e.into_inner()).get(&url) {
        return Ok(hit.clone());
    }
    let json: Value =
        serde_json::from_slice(&net::fetch(&url, MAX_JSON_BYTES)?).map_err(unreadable)?;
    CACHE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(url, json.clone());
    Ok(json)
}

// -- Searching ---------------------------------------------------------------------------------

/// A book Open Library knows, as listed in the search results.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// Open Library's id for the work (`OL…W`) and its best-matching edition (`OL…M`).
    pub work: String,
    pub edition: Option<String>,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<i32>,
    pub publisher: Option<String>,
    /// A cover id, for `https://covers.openlibrary.org/b/id/<id>-M.jpg`.
    pub cover: Option<u64>,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    docs: Vec<SearchDoc>,
}

#[derive(Deserialize)]
struct SearchDoc {
    key: String,
    title: Option<String>,
    #[serde(default)]
    author_name: Vec<String>,
    first_publish_year: Option<i32>,
    cover_i: Option<i64>,
    editions: Option<SearchEditions>,
}

#[derive(Deserialize)]
struct SearchEditions {
    #[serde(default)]
    docs: Vec<SearchEdition>,
}

#[derive(Deserialize)]
struct SearchEdition {
    key: String,
    title: Option<String>,
    #[serde(default)]
    publisher: Vec<String>,
    cover_i: Option<i64>,
}

/// The ISBN in `text`, if that's all it is (hyphens and spaces allowed).
fn isbn_of(text: &str) -> Option<String> {
    let text = text.trim();
    let text = text
        .strip_prefix("urn:isbn:")
        .or_else(|| text.strip_prefix("isbn:"))
        .or_else(|| text.strip_prefix("ISBN"))
        .unwrap_or(text);
    let isbn: String = text.chars().filter(|c| !matches!(c, '-' | ' ')).collect();
    let digits = isbn.bytes().filter(u8::is_ascii_digit).count();
    let valid = match isbn.len() {
        13 => digits == 13,
        10 => digits == 10 || (digits == 9 && isbn.ends_with(['X', 'x'])),
        _ => false,
    };
    valid.then(|| isbn.to_uppercase())
}

fn known(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && !value.eq_ignore_ascii_case("publisher not identified"))
        .then(|| value.to_owned())
}

fn cover_id(id: Option<i64>) -> Option<u64> {
    id.and_then(|id| u64::try_from(id).ok())
        .filter(|id| *id > 0)
}

fn parse_search(json: Value) -> Result<Vec<Candidate>> {
    let response: SearchResponse = serde_json::from_value(json).map_err(unreadable)?;
    Ok(response
        .docs
        .into_iter()
        .filter_map(|doc| {
            let work = doc.key.strip_prefix("/works/")?.to_owned();
            let edition = doc.editions.and_then(|e| e.docs.into_iter().next());
            let title = edition
                .as_ref()
                .and_then(|e| e.title.clone())
                .or(doc.title)?;
            Some(Candidate {
                work,
                edition: edition
                    .as_ref()
                    .and_then(|e| e.key.strip_prefix("/books/"))
                    .map(str::to_owned),
                title,
                authors: doc.author_name,
                year: doc.first_publish_year,
                publisher: edition
                    .as_ref()
                    .and_then(|e| e.publisher.iter().find_map(|p| known(p))),
                cover: edition
                    .as_ref()
                    .and_then(|e| cover_id(e.cover_i))
                    .or(cover_id(doc.cover_i)),
            })
        })
        .collect())
}

/// Searches Open Library by ISBN when `query` is one, otherwise by title and author.
pub fn search(query: &str) -> Result<Vec<Candidate>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let q = isbn_of(query).map_or_else(|| query.to_owned(), |isbn| format!("isbn:{isbn}"));
    parse_search(fetch_json(format!(
        "{API}/search.json?q={}&limit={RESULTS}&fields={SEARCH_FIELDS}",
        encode(&q)
    ))?)
}

// -- A book's details --------------------------------------------------------------------------

/// What Open Library knows about one edition beyond the search results, in the shape of
/// `BookMetadata` (the title and authors come from the search result).
#[derive(Debug, Default, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundDetails {
    pub series: Option<String>,
    pub series_index: Option<f64>,
    pub publisher: Option<String>,
    /// `YYYY-MM-DD`, `YYYY-MM` or `YYYY` when the date could be read, as given otherwise.
    pub published: Option<String>,
    pub language: Option<String>,
    pub identifier: Option<String>,
    /// Plain text, paragraphs separated by blank lines.
    pub description: Option<String>,
    pub cover: Option<u64>,
}

fn valid_key(key: &str, kind: char) -> bool {
    key.strip_prefix("OL")
        .and_then(|k| k.strip_suffix(kind))
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// Fetches the work (for its description) and the edition (for everything else).
pub fn details(work: &str, edition: Option<&str>) -> Result<FoundDetails> {
    if !valid_key(work, 'W') || edition.is_some_and(|e| !valid_key(e, 'M')) {
        return Err(Error::invalid("invalid Open Library id"));
    }
    let work = fetch_json(format!("{API}/works/{work}.json"))?;
    let edition = edition
        .map(|e| fetch_json(format!("{API}/books/{e}.json")))
        .transpose()?;
    Ok(parse_details(
        &work,
        edition.as_ref().unwrap_or(&Value::Null),
    ))
}

/// Downloads a cover, large enough for the cover thumbnail.
pub fn cover(id: u64) -> Result<Vec<u8>> {
    // `default=false` answers 404 for a missing cover, rather than a blank image.
    net::fetch(
        &format!("https://covers.openlibrary.org/b/id/{id}-L.jpg?default=false"),
        MAX_COVER_BYTES as u64,
    )
}

fn strings(value: &Value) -> impl Iterator<Item = &str> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}

fn parse_details(work: &Value, edition: &Value) -> FoundDetails {
    let (series, series_index) = match strings(&edition["series"]).next() {
        Some(series) => split_series(series),
        // Works sometimes name the series among their subjects ("series:Red_Rising_Saga").
        None => (
            strings(&work["subjects"])
                .find_map(|s| s.strip_prefix("series:"))
                .map(|s| s.replace('_', " ")),
            None,
        ),
    };
    let covers = |v: &Value| {
        v["covers"]
            .as_array()
            .into_iter()
            .flatten()
            .find_map(|c| cover_id(c.as_i64()))
    };
    FoundDetails {
        series,
        series_index,
        publisher: strings(&edition["publishers"]).find_map(known),
        published: edition["publish_date"].as_str().map(iso_date),
        language: edition["languages"]
            .as_array()
            .into_iter()
            .flatten()
            .find_map(|l| l["key"].as_str()?.strip_prefix("/languages/"))
            .map(language_code),
        identifier: strings(&edition["isbn_13"])
            .chain(strings(&edition["isbn_10"]))
            .find_map(isbn_of),
        description: match &work["description"] {
            Value::String(text) => clean_description(text),
            Value::Object(text) => text
                .get("value")
                .and_then(Value::as_str)
                .and_then(clean_description),
            _ => None,
        },
        cover: covers(edition).or_else(|| covers(work)),
    }
}

/// "Red Rising, 4", "Discworld #12", "Dune (Book 2)" → the series and its number.
fn split_series(text: &str) -> (Option<String>, Option<f64>) {
    let trimmed = text.trim().trim_end_matches(')').trim_end();
    let number_at = trimmed
        .rfind(|c: char| !(c.is_ascii_digit() || c == '.'))
        .map_or(0, |i| i + 1);
    let number = trimmed[number_at..].parse::<f64>().ok();
    let name = match number {
        Some(_) => {
            let name = trimmed[..number_at]
                .trim_end_matches([' ', ',', '#', '(', ':', ';', '-', '–', '—']);
            let lower = name.to_lowercase();
            let cut = ["book", "vol.", "vol", "no.", "no", "volume", "number"]
                .iter()
                .find(|w| lower.ends_with(*w))
                .map_or(name.len(), |w| name.len() - w.len());
            name[..cut].trim_end_matches([' ', ',', '#', '(', ':', ';', '-', '–', '—'])
        }
        None => text.trim(),
    };
    let name = (!name.is_empty()).then(|| name.to_owned());
    // A bare number ("1984") is a title, not a series number.
    (
        name,
        number.filter(|_| text.chars().any(char::is_alphabetic)),
    )
}

const MONTHS: [&str; 12] = [
    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

/// Open Library's free-text dates ("Oct 23, 2018", "2018", "March 2003") as `YYYY-MM-DD`,
/// `YYYY-MM` or `YYYY`; anything else is kept as given.
fn iso_date(text: &str) -> String {
    let text = text.trim();
    if text.len() >= 4 && text.as_bytes()[..4].iter().all(u8::is_ascii_digit) {
        return text.to_owned();
    }
    let words: Vec<String> = text
        .split(|c: char| c.is_whitespace() || c == ',' || c == '.')
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect();
    let year = words
        .iter()
        .find(|w| w.len() == 4 && w.bytes().all(|b| b.is_ascii_digit()));
    let month = words
        .iter()
        .find_map(|w| MONTHS.iter().position(|m| w.starts_with(m)));
    let day = words
        .iter()
        .filter_map(|w| w.parse::<u32>().ok())
        .find(|d| (1..=31).contains(d));
    match (year, month, day) {
        (Some(y), Some(m), Some(d)) => format!("{y}-{:02}-{d:02}", m + 1),
        (Some(y), Some(m), None) => format!("{y}-{:02}", m + 1),
        (Some(y), None, _) if words.len() == 1 => y.clone(),
        _ => text.to_owned(),
    }
}

/// Open Library's MARC language codes as the two-letter codes books use, where one exists.
fn language_code(marc: &str) -> String {
    let code = match marc {
        "eng" => "en",
        "fre" | "fra" => "fr",
        "ger" | "deu" => "de",
        "spa" => "es",
        "ita" => "it",
        "por" => "pt",
        "dut" | "nld" => "nl",
        "rus" => "ru",
        "jpn" => "ja",
        "chi" | "zho" => "zh",
        "kor" => "ko",
        "ara" => "ar",
        "pol" => "pl",
        "swe" => "sv",
        "nor" => "no",
        "dan" => "da",
        "fin" => "fi",
        "tur" => "tr",
        "heb" => "he",
        "hun" => "hu",
        "ukr" => "uk",
        "cze" | "ces" => "cs",
        "gre" | "ell" => "el",
        "lat" => "la",
        "cat" => "ca",
        "rum" | "ron" => "ro",
        other => other,
    };
    code.to_owned()
}

/// Drops what Open Library appends to descriptions: "----------" sections listing other
/// editions, and Markdown source links ("([source][1])" with "[1]: https://…").
fn clean_description(text: &str) -> Option<String> {
    let main = text.split("----------").next().unwrap_or_default();
    let mut cleaned = String::new();
    for line in main.lines() {
        let line = line.trim();
        let is_reference = line.starts_with('[') && line.contains("]: ");
        if is_reference {
            continue;
        }
        let line = match line.find("([source]") {
            Some(at) => line[..at].trim_end(),
            None => line,
        };
        cleaned.push_str(line);
        cleaned.push('\n');
    }
    let paragraphs: Vec<&str> = cleaned
        .split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .collect();
    (!paragraphs.is_empty()).then(|| paragraphs.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_search_results() {
        let json = json!({ "docs": [
            {
                "key": "/works/OL19726995W", "title": "Iron Gold", "author_name": ["Pierce Brown"],
                "first_publish_year": 2018, "cover_i": 14511722,
                "editions": { "docs": [{
                    "key": "/books/OL26940101M", "title": "Iron Gold", "cover_i": 15093518,
                    "publisher": ["publisher not identified", "Del Rey"]
                }]}
            },
            { "key": "/works/OL1W", "title": "No edition", "cover_i": -1 },
            { "key": "/authors/OL1A", "title": "Not a work" }
        ]});
        let found = parse_search(json).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(
            found[0],
            Candidate {
                work: "OL19726995W".into(),
                edition: Some("OL26940101M".into()),
                title: "Iron Gold".into(),
                authors: vec!["Pierce Brown".into()],
                year: Some(2018),
                publisher: Some("Del Rey".into()),
                cover: Some(15093518),
            }
        );
        assert_eq!(found[1].edition, None);
        assert_eq!(found[1].cover, None);
    }

    #[test]
    fn reads_an_editions_details() {
        let work = json!({
            "description": {
                "type": "/type/text",
                "value": "Ten years after Morning Star.\r\n\r\nThe war goes on. ([source][1])\r\n\r\n----------\r\nAlso contained in: …\r\n\r\n[1]: https://example.org"
            },
            "subjects": ["series:Red_Rising_Saga"],
            "covers": [14511722]
        });
        let edition = json!({
            "publishers": ["Del Rey"], "publish_date": "Oct 23, 2018", "covers": [8747506],
            "series": ["Red Rising, 4"], "languages": [{ "key": "/languages/eng" }],
            "isbn_10": ["0425285936"], "isbn_13": ["9780425285930"]
        });
        assert_eq!(
            parse_details(&work, &edition),
            FoundDetails {
                series: Some("Red Rising".into()),
                series_index: Some(4.0),
                publisher: Some("Del Rey".into()),
                published: Some("2018-10-23".into()),
                language: Some("en".into()),
                identifier: Some("9780425285930".into()),
                description: Some("Ten years after Morning Star.\n\nThe war goes on.".into()),
                cover: Some(8747506),
            }
        );
        let without_edition = parse_details(&work, &Value::Null);
        assert_eq!(without_edition.series.as_deref(), Some("Red Rising Saga"));
        assert_eq!(without_edition.cover, Some(14511722));
    }

    #[test]
    fn splits_series_numbers() {
        let split = |s: &str| split_series(s);
        assert_eq!(
            split("Red Rising, 4"),
            (Some("Red Rising".into()), Some(4.0))
        );
        assert_eq!(
            split("Discworld #12"),
            (Some("Discworld".into()), Some(12.0))
        );
        assert_eq!(split("Dune (Book 2)"), (Some("Dune".into()), Some(2.0)));
        assert_eq!(
            split("Expanse, vol. 2.5"),
            (Some("Expanse".into()), Some(2.5))
        );
        assert_eq!(
            split("Penguin Classics"),
            (Some("Penguin Classics".into()), None)
        );
    }

    #[test]
    fn reads_dates_isbns_and_languages() {
        assert_eq!(iso_date("Oct 23, 2018"), "2018-10-23");
        assert_eq!(iso_date("23 October 2018"), "2018-10-23");
        assert_eq!(iso_date("March 2003"), "2003-03");
        assert_eq!(iso_date("2018"), "2018");
        assert_eq!(iso_date("2018-01-16"), "2018-01-16");
        assert_eq!(iso_date("c1999"), "c1999");
        assert_eq!(
            isbn_of("978-0-425-28593-0").as_deref(),
            Some("9780425285930")
        );
        assert_eq!(
            isbn_of("urn:isbn:042528593x").as_deref(),
            Some("042528593X")
        );
        assert_eq!(isbn_of("Iron Gold"), None);
        assert_eq!(language_code("ger"), "de");
        assert_eq!(language_code("tlh"), "tlh");
    }
}
