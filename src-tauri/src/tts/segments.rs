//! Splits the SSML that foliate-js's `tts.js` produces into plain-text sentences, for speech
//! engines that can't report SSML marks (Android's text-to-speech).
//!
//! A paragraph arrives as `<speak><mark name="0"/>First sentence. <mark name="1"/>Second.</speak>`,
//! possibly with `<emphasis>`, `<lang>`, `<phoneme>` and `<break>` inside. Each mark starts a
//! segment, so the engine can be given one utterance per sentence and report each as it starts.

use quick_xml::Reader;
use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::Event;

/// Android's engines refuse longer input (`TextToSpeech.getMaxSpeechInputLength()` is 4000).
pub const MAX_SEGMENT_CHARS: usize = 3900;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Segment {
    /// The mark before this text, reported when it starts. `None` for text before the first
    /// mark, and for the continuations of a sentence too long to speak at once.
    pub mark: Option<String>,
    pub text: String,
}

/// The sentences in `ssml`, with whitespace collapsed; empty ones are left out.
pub fn segments(ssml: &str) -> Result<Vec<Segment>, quick_xml::Error> {
    let mut reader = Reader::from_str(ssml);
    let mut raw: Vec<(Option<String>, String)> = vec![(None, String::new())];
    loop {
        let event = reader.read_event()?;
        let text = &mut raw.last_mut().expect("there is always a segment").1;
        match event {
            Event::Start(e) | Event::Empty(e) => match e.local_name().as_ref() {
                "mark" => {
                    let name = e
                        .try_get_attribute("name")?
                        .map(|a| a.normalized_value(quick_xml::XmlVersion::Implicit1_0))
                        .transpose()?
                        .map(|name| name.into_owned());
                    raw.push((name, String::new()));
                }
                "break" => text.push(' '),
                _ => {}
            },
            Event::Text(e) => text.push_str(&e.xml10_content()),
            Event::CData(e) => text.push_str(&e.xml10_content()),
            Event::GeneralRef(e) => {
                if let Some(c) = e.resolve_char_ref()? {
                    text.push(c);
                } else if let Some(s) = resolve_predefined_entity(&e.xml10_content()) {
                    text.push_str(s);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(raw
        .into_iter()
        .flat_map(|(mark, text)| split_long(mark, &collapse_whitespace(&text)))
        .collect())
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Breaks text longer than `MAX_SEGMENT_CHARS` at spaces (or anywhere, for one enormous word).
/// The mark stays with the first piece.
fn split_long(mark: Option<String>, text: &str) -> Vec<Segment> {
    let mut pieces = Vec::new();
    let mut rest = text;
    while rest.chars().count() > MAX_SEGMENT_CHARS {
        let limit = rest
            .char_indices()
            .nth(MAX_SEGMENT_CHARS)
            .map_or(rest.len(), |(i, _)| i);
        let cut = rest[..limit].rfind(' ').filter(|&i| i > 0).unwrap_or(limit);
        pieces.push(rest[..cut].trim_end());
        rest = rest[cut..].trim_start();
    }
    pieces.push(rest);
    pieces
        .into_iter()
        .filter(|piece| !piece.is_empty())
        .enumerate()
        .map(|(i, piece)| Segment {
            mark: if i == 0 { mark.clone() } else { None },
            text: piece.to_owned(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(mark: Option<&str>, text: &str) -> Segment {
        Segment {
            mark: mark.map(Into::into),
            text: text.into(),
        }
    }

    #[test]
    fn splits_at_marks() {
        let ssml = r#"<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en"><mark name="0"/>Call me Ishmael. <mark name="1"/>Some years ago.</speak>"#;
        assert_eq!(
            segments(ssml).unwrap(),
            vec![
                seg(Some("0"), "Call me Ishmael."),
                seg(Some("1"), "Some years ago.")
            ]
        );
    }

    #[test]
    fn keeps_text_inside_nested_elements_and_resolves_entities() {
        let ssml = concat!(
            r#"<speak xmlns="http://www.w3.org/2001/10/synthesis">"#,
            r#"<mark name="0"/>Tom &amp; <emphasis>Jerry</emphasis>&#8217;s<break/>tale "#,
            r#"<lang xml:lang="fr"><mark name="1"/>c&apos;est   la <![CDATA[vie]]></lang>"#,
            r#"<phoneme ph="x">!</phoneme></speak>"#,
        );
        assert_eq!(
            segments(ssml).unwrap(),
            vec![
                seg(Some("0"), "Tom & Jerry\u{2019}s tale"),
                seg(Some("1"), "c'est la vie!")
            ]
        );
    }

    #[test]
    fn text_before_the_first_mark_has_no_mark_and_empty_sentences_are_dropped() {
        let ssml = r#"<speak> Chapter one <mark name="0"/> <mark name="1"/>It began.</speak>"#;
        assert_eq!(
            segments(ssml).unwrap(),
            vec![seg(None, "Chapter one"), seg(Some("1"), "It began.")]
        );
        assert!(segments("<speak/>").unwrap().is_empty());
    }

    #[test]
    fn splits_sentences_too_long_for_the_engine() {
        let long = "word ".repeat(2000);
        let ssml = format!(r#"<speak><mark name="7"/>{long}</speak>"#);
        let parts = segments(&ssml).unwrap();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].mark.as_deref(), Some("7"));
        assert!(parts[1..].iter().all(|p| p.mark.is_none()));
        assert!(
            parts
                .iter()
                .all(|p| p.text.chars().count() <= MAX_SEGMENT_CHARS)
        );
        let rejoined: Vec<&str> = parts.iter().map(|p| p.text.as_str()).collect();
        assert_eq!(rejoined.join(" "), long.trim_end());

        let word = "x".repeat(MAX_SEGMENT_CHARS + 5);
        let parts = split_long(None, &word);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1].text, "xxxxx");
    }

    #[test]
    fn rejects_malformed_ssml() {
        assert!(segments("<speak><mark name=\"0\"/>Hi</emphasis></speak>").is_err());
    }
}
