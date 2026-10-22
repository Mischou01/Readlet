//! Book identity: a BLAKE3 hash over the file size and a few sampled chunks.
//!
//! The fingerprint survives renames and moves, and it's fast on large files because at most
//! `SAMPLES * SAMPLE_LEN` bytes are read. Two different files only collide if they have the same
//! size and identical bytes in every sample. That is very unlikely for real books: EPUB, CBZ and
//! FBZ end with a zip central directory that holds a CRC of every entry, and MOBI and PDF files
//! change their tail (indexes, cross-reference tables) when any content changes.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

/// Bump this when the algorithm changes; it's part of the hash, so old and new fingerprints
/// never collide.
const DOMAIN: &[u8] = b"readlet-fingerprint-v1";
const SAMPLE_LEN: u64 = 64 * 1024;
const SAMPLES: u64 = 4;
/// Files up to this size are hashed whole.
const WHOLE_FILE_LIMIT: u64 = SAMPLE_LEN * SAMPLES;
/// 128 bits, hex-encoded.
pub const FINGERPRINT_LEN: usize = 32;

pub fn fingerprint(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let size = file.metadata()?.len();
    fingerprint_reader(&mut file, size)
}

fn fingerprint_reader<R: Read + Seek>(reader: &mut R, size: u64) -> io::Result<String> {
    let mut hasher = blake3::Hasher::new();
    hasher.update(DOMAIN);
    hasher.update(&size.to_le_bytes());
    if size <= WHOLE_FILE_LIMIT {
        io::copy(&mut reader.by_ref().take(size), &mut hasher)?;
    } else {
        // Evenly spaced samples, the last one ending exactly at the end of the file.
        let mut buf = vec![0u8; SAMPLE_LEN as usize];
        for i in 0..SAMPLES {
            let offset = (size - SAMPLE_LEN) * i / (SAMPLES - 1);
            reader.seek(SeekFrom::Start(offset))?;
            reader.read_exact(&mut buf)?;
            hasher.update(&buf);
        }
    }
    let hex = hasher.finalize().to_hex();
    Ok(hex[..FINGERPRINT_LEN].to_owned())
}

/// Fingerprints name files and appear in URLs, so anything else is rejected at the boundary.
pub fn is_valid(fingerprint: &str) -> bool {
    fingerprint.len() == FINGERPRINT_LEN
        && fingerprint
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn fp(bytes: &[u8]) -> String {
        fingerprint_reader(&mut Cursor::new(bytes), bytes.len() as u64).unwrap()
    }

    #[test]
    fn is_stable_and_well_formed() {
        let a = fp(b"hello");
        assert_eq!(a, fp(b"hello"));
        assert!(is_valid(&a));
    }

    #[test]
    fn differs_for_different_small_files() {
        assert_ne!(fp(b"hello"), fp(b"hellp"));
        assert_ne!(fp(b""), fp(b"\0"));
    }

    #[test]
    fn large_files_change_when_a_sampled_region_changes() {
        let mut bytes = vec![7u8; 3 * 1024 * 1024];
        let original = fp(&bytes);
        let last = bytes.len() - 1;
        bytes[last] = 8;
        assert_ne!(original, fp(&bytes), "the tail is always sampled");
        bytes[last] = 7;
        bytes[0] = 1;
        assert_ne!(original, fp(&bytes), "the head is always sampled");
    }

    #[test]
    fn size_is_part_of_the_identity() {
        let a = vec![0u8; 2 * 1024 * 1024];
        let b = vec![0u8; 2 * 1024 * 1024 + 1];
        assert_ne!(fp(&a), fp(&b));
    }

    #[test]
    fn same_content_at_another_path_has_the_same_fingerprint() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.epub");
        let b = dir.path().join("renamed.epub");
        std::fs::write(&a, vec![42u8; 500_000]).unwrap();
        std::fs::copy(&a, &b).unwrap();
        assert_eq!(fingerprint(&a).unwrap(), fingerprint(&b).unwrap());
    }

    #[test]
    fn validates_input() {
        assert!(is_valid("0123456789abcdef0123456789abcdef"));
        assert!(!is_valid("0123456789ABCDEF0123456789ABCDEF"));
        assert!(!is_valid("../../../../etc/passwd"));
        assert!(!is_valid("abc"));
    }
}
