//! Every book has an aura (docs/PLAN.md §5): three soft colours taken from its cover, plus an
//! accent for progress bars, focus rings and toggles.
//!
//! Colours are picked in OKLab with k-means, then pinned to a fixed lightness and a capped chroma
//! in OKLCH, so no cover can make the interface loud. Accents are checked against the app
//! background for at least 3:1 contrast (WCAG non-text contrast).

use image::{DynamicImage, GenericImageView};
use serde::{Deserialize, Serialize};

/// The app background ("fog") in light and dark mode; accents must stand out against it.
const FOG_LIGHT: Rgb = Rgb(0xED, 0xE9, 0xEC);
const FOG_DARK: Rgb = Rgb(0x1D, 0x1A, 0x24);
const MIN_ACCENT_CONTRAST: f64 = 3.0;

const AURA_LIGHT_L: f64 = 0.86;
const AURA_LIGHT_MAX_C: f64 = 0.07;
/// Cover colours keep this share of their chroma (before the cap).
const COVER_CHROMA_SCALE: f64 = 0.6;
const AURA_DARK_L: f64 = 0.44;
const AURA_DARK_MAX_C: f64 = 0.055;
const ACCENT_LIGHT_L: f64 = 0.55;
const ACCENT_LIGHT_MAX_C: f64 = 0.105;
const ACCENT_DARK_L: f64 = 0.78;
const ACCENT_DARK_MAX_C: f64 = 0.08;

const CLUSTERS: usize = 6;
const KMEANS_ROUNDS: usize = 12;
const SAMPLE_SIZE: u32 = 64;

/// The aura and accent of one book, as `#rrggbb` strings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Palette {
    pub light: [String; 3],
    pub dark: [String; 3],
    pub accent: String,
    pub accent_dark: String,
}

impl Palette {
    /// The aura used when no book is open (peach, periwinkle, sage).
    pub fn fallback() -> Self {
        // Already soft, so taken as they are.
        Self::from_colors(
            &[
                Swatch {
                    lch: Lch(0.855, 0.061, 47.0),
                    share: 0.4,
                },
                Swatch {
                    lch: Lch(0.818, 0.059, 275.0),
                    share: 0.35,
                },
                Swatch {
                    lch: Lch(0.864, 0.032, 154.0),
                    share: 0.25,
                },
            ],
            1.0,
        )
    }

    /// A stable aura for a book without a cover, derived from its fingerprint.
    pub fn from_seed(seed: &str) -> Self {
        let hash = blake3::hash(seed.as_bytes());
        let bytes = hash.as_bytes();
        let hue = f64::from(u16::from_le_bytes([bytes[0], bytes[1]]) % 360);
        let spread = 35.0 + f64::from(bytes[2] % 40);
        Self::from_colors(
            &[
                Swatch {
                    lch: Lch(0.7, 0.09, hue),
                    share: 0.45,
                },
                Swatch {
                    lch: Lch(0.7, 0.06, (hue + spread) % 360.0),
                    share: 0.3,
                },
                Swatch {
                    lch: Lch(0.7, 0.05, (hue + 150.0) % 360.0),
                    share: 0.25,
                },
            ],
            COVER_CHROMA_SCALE,
        )
    }

    pub fn from_image(image: &DynamicImage) -> Self {
        let samples = sample_pixels(image);
        if samples.is_empty() {
            return Self::fallback();
        }
        let clusters = kmeans(&samples, CLUSTERS);
        Self::from_colors(&pick_three(&clusters), COVER_CHROMA_SCALE)
    }

    /// Pins the swatches to the aura lightness. `chroma_scale` mutes colours taken from covers;
    /// chroma is capped either way.
    fn from_colors(swatches: &[Swatch], chroma_scale: f64) -> Self {
        let soften = |s: &Swatch, l: f64, max_c: f64| {
            Lch(l, (s.lch.1 * chroma_scale).min(max_c), s.lch.2)
                .to_rgb()
                .hex()
        };
        let light = std::array::from_fn(|i| {
            soften(
                &swatches[i % swatches.len()],
                AURA_LIGHT_L,
                AURA_LIGHT_MAX_C,
            )
        });
        let dark = std::array::from_fn(|i| {
            soften(&swatches[i % swatches.len()], AURA_DARK_L, AURA_DARK_MAX_C)
        });

        // The accent comes from the most vivid colour that covers a fair part of the cover.
        let source = swatches
            .iter()
            .max_by(|a, b| a.accent_weight().total_cmp(&b.accent_weight()))
            .unwrap_or(&swatches[0]);
        let accent = accent_with_contrast(
            Lch(
                ACCENT_LIGHT_L,
                (source.lch.1 * 0.8).min(ACCENT_LIGHT_MAX_C),
                source.lch.2,
            ),
            FOG_LIGHT,
            -0.02,
        );
        let accent_dark = accent_with_contrast(
            Lch(
                ACCENT_DARK_L,
                (source.lch.1 * 0.7).min(ACCENT_DARK_MAX_C),
                source.lch.2,
            ),
            FOG_DARK,
            0.02,
        );
        Self {
            light,
            dark,
            accent: accent.hex(),
            accent_dark: accent_dark.hex(),
        }
    }
}

/// Steps the lightness until the accent reaches the minimum contrast against `background`.
fn accent_with_contrast(mut lch: Lch, background: Rgb, step: f64) -> Rgb {
    for _ in 0..30 {
        let rgb = lch.to_rgb();
        if contrast(rgb, background) >= MIN_ACCENT_CONTRAST {
            return rgb;
        }
        lch.0 = (lch.0 + step).clamp(0.0, 1.0);
    }
    lch.to_rgb()
}

#[derive(Debug, Clone, Copy)]
struct Swatch {
    lch: Lch,
    /// Fraction of the sampled pixels in this cluster.
    share: f64,
}

impl Swatch {
    fn accent_weight(&self) -> f64 {
        self.lch.1 * self.share.sqrt()
    }
}

fn sample_pixels(image: &DynamicImage) -> Vec<Lab> {
    let small = image.thumbnail(SAMPLE_SIZE, SAMPLE_SIZE);
    small
        .pixels()
        .filter(|(_, _, p)| p.0[3] >= 128)
        .map(|(_, _, p)| Rgb(p.0[0], p.0[1], p.0[2]).to_lab())
        .collect()
}

/// Deterministic k-means in OKLab, seeded with k-means++ from a fixed-seed generator.
fn kmeans(samples: &[Lab], k: usize) -> Vec<Swatch> {
    let mut rng = XorShift(0x9E37_79B9_7F4A_7C15);
    let mut centers: Vec<Lab> = vec![samples[rng.below(samples.len())]];
    while centers.len() < k.min(samples.len()) {
        let distances: Vec<f64> = samples
            .iter()
            .map(|s| {
                centers
                    .iter()
                    .map(|c| s.distance2(c))
                    .fold(f64::MAX, f64::min)
            })
            .collect();
        let total: f64 = distances.iter().sum();
        if total <= f64::EPSILON {
            break; // every pixel is the same colour
        }
        let mut target = rng.unit() * total;
        let mut chosen = samples.len() - 1;
        for (i, d) in distances.iter().enumerate() {
            target -= d;
            if target <= 0.0 {
                chosen = i;
                break;
            }
        }
        centers.push(samples[chosen]);
    }

    let mut assignment = vec![0usize; samples.len()];
    for _ in 0..KMEANS_ROUNDS {
        for (i, s) in samples.iter().enumerate() {
            assignment[i] = nearest(s, &centers);
        }
        let mut sums = vec![(Lab(0.0, 0.0, 0.0), 0usize); centers.len()];
        for (s, &c) in samples.iter().zip(&assignment) {
            let (sum, n) = &mut sums[c];
            *sum = Lab(sum.0 + s.0, sum.1 + s.1, sum.2 + s.2);
            *n += 1;
        }
        for (center, (sum, n)) in centers.iter_mut().zip(&sums) {
            if *n > 0 {
                let n = *n as f64;
                *center = Lab(sum.0 / n, sum.1 / n, sum.2 / n);
            }
        }
    }

    let mut counts = vec![0usize; centers.len()];
    for &c in &assignment {
        counts[c] += 1;
    }
    let total = samples.len() as f64;
    centers
        .iter()
        .zip(counts)
        .filter(|(_, n)| *n > 0)
        .map(|(c, n)| Swatch {
            lch: c.to_lch(),
            share: n as f64 / total,
        })
        .collect()
}

fn nearest(sample: &Lab, centers: &[Lab]) -> usize {
    centers
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| sample.distance2(a).total_cmp(&sample.distance2(b)))
        .map_or(0, |(i, _)| i)
}

/// Picks three clusters that are both prominent and different in hue. Near-greys count as
/// prominent but have little say in hue; a cover with fewer than three distinct colours gets
/// neighbouring hues of its main colour.
fn pick_three(clusters: &[Swatch]) -> Vec<Swatch> {
    let weight = |s: &Swatch| s.share * (0.3 + s.lch.1.min(0.15) / 0.15);
    let mut remaining: Vec<Swatch> = clusters.to_vec();
    let mut chosen: Vec<Swatch> = Vec::with_capacity(3);
    while chosen.len() < 3 && !remaining.is_empty() {
        let score = |s: &Swatch| {
            let spread = chosen
                .iter()
                .map(|c| hue_distance(c.lch, s.lch))
                .fold(180.0, f64::min);
            weight(s) * (0.25 + 0.75 * spread / 180.0)
        };
        let best = (0..remaining.len())
            .max_by(|&a, &b| score(&remaining[a]).total_cmp(&score(&remaining[b])))
            .unwrap_or(0);
        chosen.push(remaining.swap_remove(best));
    }
    let base = chosen[0];
    let mut offset = 40.0;
    while chosen.len() < 3 {
        chosen.push(Swatch {
            lch: Lch(
                base.lch.0,
                base.lch.1 * 0.8,
                (base.lch.2 + offset).rem_euclid(360.0),
            ),
            share: base.share / 2.0,
        });
        offset = -offset;
    }
    chosen
}

/// Hue distance in degrees, scaled down for near-greys whose hue is barely visible.
fn hue_distance(a: Lch, b: Lch) -> f64 {
    let d = (a.2 - b.2).rem_euclid(360.0);
    let d = d.min(360.0 - d);
    let visible = (a.1.min(b.1) / 0.04).min(1.0);
    d * visible + 60.0 * (1.0 - visible)
}

// ---------------------------------------------------------------------------------------------
// Colour spaces

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

#[derive(Debug, Clone, Copy)]
struct Lab(f64, f64, f64);

/// OKLCH: lightness 0–1, chroma, hue in degrees.
#[derive(Debug, Clone, Copy)]
struct Lch(f64, f64, f64);

fn to_linear(c: u8) -> f64 {
    let c = f64::from(c) / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn from_linear(c: f64) -> f64 {
    if c <= 0.003_130_8 {
        12.92 * c
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

impl Rgb {
    pub fn hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.0, self.1, self.2)
    }

    fn luminance(self) -> f64 {
        0.2126 * to_linear(self.0) + 0.7152 * to_linear(self.1) + 0.0722 * to_linear(self.2)
    }

    fn to_lab(self) -> Lab {
        let (r, g, b) = (to_linear(self.0), to_linear(self.1), to_linear(self.2));
        let l = (0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b).cbrt();
        let m = (0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b).cbrt();
        let s = (0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b).cbrt();
        Lab(
            0.210_454_255_3 * l + 0.793_617_785_0 * m - 0.004_072_046_8 * s,
            1.977_998_495_1 * l - 2.428_592_205_0 * m + 0.450_593_709_9 * s,
            0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766_0 * s,
        )
    }
}

impl Lab {
    fn distance2(&self, other: &Lab) -> f64 {
        (self.0 - other.0).powi(2) + (self.1 - other.1).powi(2) + (self.2 - other.2).powi(2)
    }

    fn to_lch(self) -> Lch {
        Lch(
            self.0,
            self.1.hypot(self.2),
            self.2.atan2(self.1).to_degrees().rem_euclid(360.0),
        )
    }

    /// Linear sRGB; may be out of gamut.
    fn to_linear_rgb(self) -> [f64; 3] {
        let l = (self.0 + 0.396_337_777_4 * self.1 + 0.215_803_757_3 * self.2).powi(3);
        let m = (self.0 - 0.105_561_345_8 * self.1 - 0.063_854_172_8 * self.2).powi(3);
        let s = (self.0 - 0.089_484_177_5 * self.1 - 1.291_485_548_0 * self.2).powi(3);
        [
            4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
            -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
            -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701_0 * s,
        ]
    }
}

impl Lch {
    fn to_lab(self) -> Lab {
        let h = self.2.to_radians();
        Lab(self.0, self.1 * h.cos(), self.1 * h.sin())
    }

    /// Converts to sRGB, reducing chroma until the colour fits in the gamut.
    fn to_rgb(self) -> Rgb {
        let in_gamut = |c: f64| {
            Lch(self.0, c, self.2)
                .to_lab()
                .to_linear_rgb()
                .iter()
                .all(|v| (-1e-4..=1.0 + 1e-4).contains(v))
        };
        let mut chroma = self.1;
        if !in_gamut(chroma) {
            let (mut lo, mut hi) = (0.0, chroma);
            for _ in 0..20 {
                let mid = (lo + hi) / 2.0;
                if in_gamut(mid) { lo = mid } else { hi = mid }
            }
            chroma = lo;
        }
        let [r, g, b] = Lch(self.0, chroma, self.2).to_lab().to_linear_rgb();
        let channel = |v: f64| (from_linear(v.clamp(0.0, 1.0)) * 255.0).round() as u8;
        Rgb(channel(r), channel(g), channel(b))
    }
}

pub fn contrast(a: Rgb, b: Rgb) -> f64 {
    let (la, lb) = (a.luminance(), b.luminance());
    (la.max(lb) + 0.05) / (la.min(lb) + 0.05)
}

/// A tiny deterministic PRNG so the same cover always gives the same aura.
struct XorShift(u64);

impl XorShift {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn parse(hex: &str) -> Rgb {
        let v = u32::from_str_radix(&hex[1..], 16).unwrap();
        Rgb((v >> 16) as u8, (v >> 8) as u8, v as u8)
    }

    fn lch(hex: &str) -> Lch {
        parse(hex).to_lab().to_lch()
    }

    fn assert_valid(palette: &Palette) {
        for hex in palette.light.iter().chain(&palette.dark) {
            assert_eq!(hex.len(), 7);
        }
        for hex in &palette.light {
            let c = lch(hex);
            assert!(
                (c.0 - AURA_LIGHT_L).abs() < 0.02,
                "light aura {hex} has L {}",
                c.0
            );
            assert!(
                c.1 <= AURA_LIGHT_MAX_C + 0.005,
                "light aura {hex} has C {}",
                c.1
            );
        }
        for hex in &palette.dark {
            let c = lch(hex);
            assert!(
                (c.0 - AURA_DARK_L).abs() < 0.02,
                "dark aura {hex} has L {}",
                c.0
            );
            assert!(
                c.1 <= AURA_DARK_MAX_C + 0.005,
                "dark aura {hex} has C {}",
                c.1
            );
        }
        assert!(contrast(parse(&palette.accent), FOG_LIGHT) >= MIN_ACCENT_CONTRAST);
        assert!(contrast(parse(&palette.accent_dark), FOG_DARK) >= MIN_ACCENT_CONTRAST);
    }

    #[test]
    fn colour_conversion_round_trips() {
        for hex in [
            "#a0566a", "#4f7290", "#ede9ec", "#000000", "#ffffff", "#ff0000",
        ] {
            let rgb = parse(hex);
            let lch = rgb.to_lab().to_lch();
            assert_eq!(lch.to_rgb(), rgb, "{hex}");
        }
    }

    #[test]
    fn matches_the_design_reference() {
        // #A0566A, the Pride and Prejudice accent from the mockups, is L 0.546 C 0.100 h 4.
        let c = lch("#A0566A");
        assert!((c.0 - 0.546).abs() < 0.002 && (c.1 - 0.100).abs() < 0.002);
        assert!((c.2 - 4.0).abs() < 1.0);
    }

    #[test]
    fn out_of_gamut_colours_are_clamped() {
        let rgb = Lch(0.86, 0.4, 140.0).to_rgb();
        let back = rgb.to_lab().to_lch();
        assert!((back.0 - 0.86).abs() < 0.01);
        assert!(back.1 < 0.4);
    }

    #[test]
    fn fallback_and_seeded_palettes_are_soft() {
        assert_valid(&Palette::fallback());
        for seed in ["a", "b", "0123456789abcdef0123456789abcdef"] {
            assert_valid(&Palette::from_seed(seed));
        }
        assert_eq!(Palette::from_seed("x"), Palette::from_seed("x"));
    }

    fn two_tone(a: [u8; 3], b: [u8; 3]) -> DynamicImage {
        let img = RgbaImage::from_fn(60, 90, |x, _| {
            let c = if x < 40 { a } else { b };
            Rgba([c[0], c[1], c[2], 255])
        });
        DynamicImage::ImageRgba8(img)
    }

    #[test]
    fn takes_hues_from_the_cover() {
        // Mostly saturated blue with a red stripe.
        let palette = Palette::from_image(&two_tone([20, 60, 220], [230, 30, 30]));
        assert_valid(&palette);
        let hues: Vec<f64> = palette.light.iter().map(|h| lch(h).2).collect();
        assert!(hues.iter().any(|h| (240.0..290.0).contains(h)), "{hues:?}");
        assert!(hues.iter().any(|h| *h < 40.0 || *h > 340.0), "{hues:?}");
        // The accent follows the dominant blue.
        assert!((230.0..290.0).contains(&lch(&palette.accent).2));
    }

    #[test]
    fn grey_covers_give_grey_auras() {
        let palette = Palette::from_image(&two_tone([200, 200, 200], [40, 40, 40]));
        assert_valid(&palette);
        for hex in &palette.light {
            assert!(lch(hex).1 < 0.01, "{hex}");
        }
    }

    #[test]
    fn neon_covers_are_tamed() {
        let palette = Palette::from_image(&two_tone([0, 255, 0], [255, 0, 255]));
        assert_valid(&palette);
    }

    #[test]
    fn transparent_images_use_the_fallback() {
        let img = DynamicImage::ImageRgba8(RgbaImage::from_pixel(10, 10, Rgba([0, 0, 0, 0])));
        assert_eq!(Palette::from_image(&img), Palette::fallback());
    }

    #[test]
    fn is_deterministic() {
        let img = two_tone([120, 80, 40], [30, 90, 140]);
        assert_eq!(Palette::from_image(&img), Palette::from_image(&img));
    }
}
