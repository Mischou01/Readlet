//! Cover thumbnails. The webview extracts a book's cover with foliate-js and hands over the raw
//! image; Rust decodes it once, stores a small JPEG in the cache dir and computes the aura.

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::{DynamicImage, ImageReader, Limits, Rgb, RgbImage};

use crate::aura::Palette;
use crate::error::Result;
use crate::fsutil;

/// Big enough for the 210×315 hero cover on a 2× display.
const THUMB_WIDTH: u32 = 480;
const THUMB_HEIGHT: u32 = 720;
const JPEG_QUALITY: u8 = 85;
/// Refuse absurd images before decoding them (decompression bombs).
const MAX_DIMENSION: u32 = 12_000;
const MAX_ALLOC: u64 = 512 * 1024 * 1024;
pub const MAX_COVER_BYTES: usize = 40 * 1024 * 1024;

pub fn cover_path(covers_dir: &Path, fingerprint: &str) -> PathBuf {
    covers_dir.join(format!("{fingerprint}.jpg"))
}

/// Decodes `bytes`, writes the thumbnail to `dest` and returns the cover's aura.
pub fn store_cover(bytes: &[u8], dest: &Path) -> Result<Palette> {
    let image = decode(bytes)?;
    let palette = Palette::from_image(&image);
    let fits = image.width() <= THUMB_WIDTH && image.height() <= THUMB_HEIGHT;
    let thumb = if fits {
        flatten(&image)
    } else {
        flatten(&image.resize(THUMB_WIDTH, THUMB_HEIGHT, FilterType::CatmullRom))
    };
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .encode_image(&thumb)?;
    fsutil::write_atomic(dest, &jpeg)?;
    Ok(palette)
}

fn decode(bytes: &[u8]) -> Result<DynamicImage> {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(MAX_ALLOC);
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    reader.limits(limits);
    Ok(reader.decode()?)
}

/// JPEG has no alpha channel: composite transparent covers onto white, like paper.
fn flatten(image: &DynamicImage) -> RgbImage {
    let rgba = image.to_rgba8();
    RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let [r, g, b, a] = rgba.get_pixel(x, y).0;
        let blend = |c: u8| {
            let a = u16::from(a);
            ((u16::from(c) * a + 255 * (255 - a)) / 255) as u8
        };
        Rgb([blend(r), blend(g), blend(b)])
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgba, RgbaImage};

    fn png(width: u32, height: u32, pixel: [u8; 4]) -> Vec<u8> {
        let img = DynamicImage::ImageRgba8(RgbaImage::from_pixel(width, height, Rgba(pixel)));
        let mut bytes = Vec::new();
        img.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn writes_a_bounded_jpeg_thumbnail() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("covers/x.jpg");
        store_cover(&png(1600, 2400, [30, 60, 200, 255]), &dest).unwrap();
        let thumb = image::open(&dest).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (THUMB_WIDTH, THUMB_HEIGHT));
    }

    #[test]
    fn small_covers_keep_their_size() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("x.jpg");
        store_cover(&png(100, 150, [200, 100, 50, 255]), &dest).unwrap();
        let thumb = image::open(&dest).unwrap();
        assert_eq!(thumb.width(), 100);
    }

    #[test]
    fn transparency_becomes_white() {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([0, 0, 0, 0])));
        assert_eq!(flatten(&image).get_pixel(0, 0).0, [255, 255, 255]);
    }

    #[test]
    fn rejects_garbage() {
        let dir = tempfile::tempdir().unwrap();
        assert!(store_cover(b"<svg>not supported</svg>", &dir.path().join("x.jpg")).is_err());
    }
}
