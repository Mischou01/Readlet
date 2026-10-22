//! Which files count as books, and whether they're DRM-protected.
//!
//! DRM books stay in the library (they're the reader's files), but the UI explains why they won't
//! open instead of showing garbled text (docs/PLAN.md §1).

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BookFormat {
    Epub,
    Mobi,
    Azw3,
    Fb2,
    Fbz,
    Cbz,
    Pdf,
}

impl BookFormat {
    /// Detects the format from the file name. Returns `None` for files that aren't books.
    pub fn from_path(path: &Path) -> Option<Self> {
        let name = path.file_name()?.to_str()?.to_ascii_lowercase();
        if name.ends_with(".fb2.zip") {
            return Some(Self::Fbz);
        }
        let ext = name.rsplit_once('.')?.1;
        Some(match ext {
            "epub" => Self::Epub,
            "mobi" | "prc" => Self::Mobi,
            "azw3" | "azw" => Self::Azw3,
            "fb2" => Self::Fb2,
            "fbz" => Self::Fbz,
            "cbz" => Self::Cbz,
            "pdf" => Self::Pdf,
            _ => return None,
        })
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Epub => "epub",
            Self::Mobi => "mobi",
            Self::Azw3 => "azw3",
            Self::Fb2 => "fb2",
            Self::Fbz => "fbz",
            Self::Cbz => "cbz",
            Self::Pdf => "pdf",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "epub" => Self::Epub,
            "mobi" => Self::Mobi,
            "azw3" => Self::Azw3,
            "fb2" => Self::Fb2,
            "fbz" => Self::Fbz,
            "cbz" => Self::Cbz,
            "pdf" => Self::Pdf,
            _ => return None,
        })
    }

    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Epub => "application/epub+zip",
            Self::Mobi => "application/x-mobipocket-ebook",
            Self::Azw3 => "application/vnd.amazon.ebook",
            Self::Fb2 => "application/x-fictionbook+xml",
            Self::Fbz => "application/x-zip-compressed-fb2",
            Self::Cbz => "application/vnd.comicbook+zip",
            Self::Pdf => "application/pdf",
        }
    }
}

/// Font obfuscation isn't DRM: the text is readable and foliate-js de-obfuscates the fonts.
const FONT_OBFUSCATION: [&str; 2] = [
    "http://www.idpf.org/2008/embedding",
    "http://ns.adobe.com/pdf/enc#RC",
];

/// Best-effort DRM check. Errors (unreadable or malformed files) count as "not protected"; the
/// renderer reports those problems itself when the book is opened.
pub fn is_drm_protected(path: &Path, format: BookFormat) -> bool {
    let result = match format {
        BookFormat::Epub => epub_is_protected(path),
        BookFormat::Mobi | BookFormat::Azw3 => mobi_is_protected(path),
        _ => Ok(false),
    };
    result.unwrap_or(false)
}

fn epub_is_protected(path: &Path) -> io::Result<bool> {
    let mut archive = zip::ZipArchive::new(File::open(path)?).map_err(io::Error::other)?;
    if archive.by_name("META-INF/rights.xml").is_ok() {
        return Ok(true);
    }
    let Ok(mut entry) = archive.by_name("META-INF/encryption.xml") else {
        return Ok(false);
    };
    let mut xml = String::new();
    // encryption.xml is small; cap the read in case of a hostile archive.
    entry
        .by_ref()
        .take(4 * 1024 * 1024)
        .read_to_string(&mut xml)?;
    Ok(encryption_xml_has_drm(&xml))
}

/// True if any `EncryptionMethod` uses an algorithm other than font obfuscation.
fn encryption_xml_has_drm(xml: &str) -> bool {
    let mut rest = xml;
    while let Some(start) = rest.find("EncryptionMethod") {
        rest = &rest[start + "EncryptionMethod".len()..];
        let tag_end = rest.find('>').unwrap_or(rest.len());
        let tag = &rest[..tag_end];
        if let Some(algorithm) = attribute(tag, "Algorithm")
            && !FONT_OBFUSCATION.contains(&algorithm)
        {
            return true;
        }
    }
    false
}

fn attribute<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let at = tag.find(&format!("{name}="))? + name.len() + 1;
    let quote = tag[at..].chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let value = &tag[at + 1..];
    Some(&value[..value.find(quote)?])
}

/// Mobipocket files are Palm databases. The first record holds the PalmDOC header, whose
/// encryption field is non-zero for DRM-protected books.
fn mobi_is_protected(path: &Path) -> io::Result<bool> {
    let mut file = File::open(path)?;
    let mut header = [0u8; 86];
    file.read_exact(&mut header)?;
    let kind = &header[60..68];
    if kind != b"BOOKMOBI" && kind != b"TEXtREAd" {
        return Ok(false);
    }
    let record0 = u32::from_be_bytes([header[78], header[79], header[80], header[81]]);
    file.seek(SeekFrom::Start(u64::from(record0) + 12))?;
    let mut encryption = [0u8; 2];
    file.read_exact(&mut encryption)?;
    Ok(u16::from_be_bytes(encryption) != 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn detects_formats_from_names() {
        let f = |name: &str| BookFormat::from_path(Path::new(name));
        assert_eq!(f("Le Guin - The Dispossessed.EPUB"), Some(BookFormat::Epub));
        assert_eq!(f("book.fb2.zip"), Some(BookFormat::Fbz));
        assert_eq!(f("book.azw3"), Some(BookFormat::Azw3));
        assert_eq!(f("comic.cbz"), Some(BookFormat::Cbz));
        assert_eq!(f("paper.pdf"), Some(BookFormat::Pdf));
        assert_eq!(f("notes.txt"), None);
        assert_eq!(f("README"), None);
    }

    #[test]
    fn format_names_round_trip() {
        for format in [
            BookFormat::Epub,
            BookFormat::Mobi,
            BookFormat::Azw3,
            BookFormat::Fb2,
            BookFormat::Fbz,
            BookFormat::Cbz,
            BookFormat::Pdf,
        ] {
            assert_eq!(BookFormat::parse(format.as_str()), Some(format));
        }
    }

    #[test]
    fn font_obfuscation_is_not_drm() {
        let xml = r#"<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData></encryption>"#;
        assert!(!encryption_xml_has_drm(xml));
    }

    #[test]
    fn content_encryption_is_drm() {
        let xml = r#"<enc:EncryptedData><enc:EncryptionMethod Algorithm='http://www.w3.org/2001/04/xmlenc#aes128-cbc'/></enc:EncryptedData>"#;
        assert!(encryption_xml_has_drm(xml));
    }

    fn write_epub(dir: &Path, files: &[(&str, &str)]) -> std::path::PathBuf {
        let path = dir.join("book.epub");
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        for (name, content) in files {
            zip.start_file(*name, options).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    #[test]
    fn epub_with_rights_file_is_protected() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_epub(
            dir.path(),
            &[
                ("mimetype", "application/epub+zip"),
                ("META-INF/rights.xml", "<rights/>"),
            ],
        );
        assert!(is_drm_protected(&path, BookFormat::Epub));
    }

    #[test]
    fn plain_epub_is_not_protected() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_epub(dir.path(), &[("mimetype", "application/epub+zip")]);
        assert!(!is_drm_protected(&path, BookFormat::Epub));
    }

    fn write_mobi(dir: &Path, encryption: u16) -> std::path::PathBuf {
        let mut bytes = vec![0u8; 200];
        bytes[60..68].copy_from_slice(b"BOOKMOBI");
        bytes[78..82].copy_from_slice(&100u32.to_be_bytes());
        bytes[112..114].copy_from_slice(&encryption.to_be_bytes());
        let path = dir.join("book.mobi");
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn reads_the_mobi_encryption_field() {
        let dir = tempfile::tempdir().unwrap();
        assert!(is_drm_protected(
            &write_mobi(dir.path(), 2),
            BookFormat::Mobi
        ));
        assert!(!is_drm_protected(
            &write_mobi(dir.path(), 0),
            BookFormat::Mobi
        ));
    }

    #[test]
    fn unreadable_files_are_not_flagged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("short.mobi");
        std::fs::write(&path, b"tiny").unwrap();
        assert!(!is_drm_protected(&path, BookFormat::Mobi));
    }
}
