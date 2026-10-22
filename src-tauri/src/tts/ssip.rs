//! A small client for SSIP, Speech Dispatcher's text protocol.
//!
//! Replies to commands and asynchronous events (index marks, begin, end) arrive interleaved on one
//! socket. A reader thread splits them: replies go to whoever sent the command, events to a
//! callback. See <https://htmlpreview.github.io/?https://github.com/brailcom/speechd/blob/master/doc/ssip.html>.

use std::io::{self, BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;

const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

/// One complete reply: `NNN-line` continuation lines followed by `NNN message`.
#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    pub code: u16,
    pub lines: Vec<String>,
    pub message: String,
}

impl Reply {
    fn is_event(&self) -> bool {
        (700..800).contains(&self.code)
    }

    fn is_ok(&self) -> bool {
        (200..400).contains(&self.code)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum EventKind {
    Begin,
    End,
    Canceled,
    Paused,
    Resumed,
    Mark(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub kind: EventKind,
    pub message: u64,
}

impl Event {
    fn from_reply(reply: &Reply) -> Option<Self> {
        let message = reply.lines.first()?.trim().parse().ok()?;
        let kind = match reply.code {
            700 => EventKind::Mark(reply.lines.get(2)?.clone()),
            701 => EventKind::Begin,
            702 => EventKind::End,
            703 => EventKind::Canceled,
            704 => EventKind::Paused,
            705 => EventKind::Resumed,
            _ => return None,
        };
        Some(Self { kind, message })
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SsipError {
    #[error("can't reach Speech Dispatcher: {0}")]
    Io(#[from] io::Error),
    #[error("Speech Dispatcher closed the connection")]
    Disconnected,
    #[error("Speech Dispatcher didn't answer in time")]
    Timeout,
    #[error("Speech Dispatcher refused `{command}`: {code} {message}")]
    Refused {
        command: String,
        code: u16,
        message: String,
    },
    #[error("unexpected answer from Speech Dispatcher: {0}")]
    Protocol(String),
}

pub type Result<T> = std::result::Result<T, SsipError>;

/// Parses one protocol line into (code, is_last, text).
fn parse_line(line: &str) -> Option<(u16, bool, &str)> {
    let line = line.trim_end_matches(['\r', '\n']);
    if line.len() < 4 {
        return None;
    }
    let code = line.get(..3)?.parse().ok()?;
    let last = match line.as_bytes()[3] {
        b' ' => true,
        b'-' => false,
        _ => return None,
    };
    Some((code, last, &line[4..]))
}

/// Reads replies from `reader` until the stream ends, sending events to `on_event` and everything
/// else to `replies`.
fn read_replies(reader: impl BufRead, replies: mpsc::Sender<Reply>, on_event: impl Fn(Event)) {
    let mut lines = Vec::new();
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let Some((code, last, text)) = parse_line(&line) else {
            log::warn!("ignoring malformed SSIP line");
            continue;
        };
        if !last {
            lines.push(text.to_owned());
            continue;
        }
        let reply = Reply {
            code,
            lines: std::mem::take(&mut lines),
            message: text.to_owned(),
        };
        if reply.is_event() {
            if let Some(event) = Event::from_reply(&reply) {
                on_event(event);
            }
        } else if replies.send(reply).is_err() {
            break;
        }
    }
}

/// Escapes a block of text for SSIP data mode: CRLF line ends, and a leading `.` doubled so it
/// can't end the data early.
fn escape_data(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 16);
    for line in text.lines() {
        if line.starts_with('.') {
            out.push('.');
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    out.push_str(".\r\n");
    out
}

pub struct Connection {
    stream: UnixStream,
    replies: Receiver<Reply>,
}

impl Connection {
    /// Connects to the socket and starts the reader thread. Events go to `on_event`.
    pub fn connect(path: &Path, on_event: impl Fn(Event) + Send + 'static) -> Result<Self> {
        let stream = UnixStream::connect(path)?;
        let reader = BufReader::new(stream.try_clone()?);
        let (tx, rx) = mpsc::channel();
        thread::Builder::new()
            .name("ssip-reader".into())
            .spawn(move || read_replies(reader, tx, on_event))?;
        Ok(Self {
            stream,
            replies: rx,
        })
    }

    fn reply(&self, command: &str) -> Result<Reply> {
        let reply = match self.replies.recv_timeout(REPLY_TIMEOUT) {
            Ok(reply) => reply,
            Err(RecvTimeoutError::Timeout) => return Err(SsipError::Timeout),
            Err(RecvTimeoutError::Disconnected) => return Err(SsipError::Disconnected),
        };
        if reply.is_ok() {
            Ok(reply)
        } else {
            Err(SsipError::Refused {
                command: command.to_owned(),
                code: reply.code,
                message: reply.message,
            })
        }
    }

    /// Sends one command line and waits for its reply.
    pub fn command(&mut self, command: &str) -> Result<Reply> {
        self.stream.write_all(format!("{command}\r\n").as_bytes())?;
        self.reply(command)
    }

    /// Queues `text` for speaking and returns its message id.
    pub fn speak(&mut self, text: &str) -> Result<u64> {
        self.command("SPEAK")?;
        self.stream.write_all(escape_data(text).as_bytes())?;
        let reply = self.reply("SPEAK data")?;
        reply
            .lines
            .first()
            .and_then(|id| id.trim().parse().ok())
            .ok_or_else(|| SsipError::Protocol(format!("no message id in {reply:?}")))
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        let _ = self.stream.write_all(b"QUIT\r\n");
        let _ = self.stream.shutdown(std::net::Shutdown::Both);
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;
    use std::sync::{Arc, Mutex};

    #[test]
    fn parses_lines() {
        assert_eq!(parse_line("225-21\r\n"), Some((225, false, "21")));
        assert_eq!(
            parse_line("225 OK MESSAGE QUEUED"),
            Some((225, true, "OK MESSAGE QUEUED"))
        );
        assert_eq!(parse_line("nonsense"), None);
        assert_eq!(parse_line("12"), None);
    }

    #[test]
    fn escapes_data() {
        assert_eq!(
            escape_data("Hello\n.hidden\nend"),
            "Hello\r\n..hidden\r\nend\r\n.\r\n"
        );
    }

    #[test]
    fn decodes_events() {
        let mark = Reply {
            code: 700,
            lines: vec!["21".into(), "3".into(), "4".into()],
            message: "INDEX MARK".into(),
        };
        assert_eq!(
            Event::from_reply(&mark),
            Some(Event {
                kind: EventKind::Mark("4".into()),
                message: 21
            })
        );
        let end = Reply {
            code: 702,
            lines: vec!["21".into(), "3".into()],
            message: "END".into(),
        };
        assert_eq!(
            Event::from_reply(&end),
            Some(Event {
                kind: EventKind::End,
                message: 21
            })
        );
    }

    /// A scripted Speech Dispatcher: answers commands and emits events for each spoken message.
    pub(crate) fn fake_server(path: &Path) -> thread::JoinHandle<Vec<String>> {
        let listener = UnixListener::bind(path).unwrap();
        thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut writer = stream.try_clone().unwrap();
            let mut reader = BufReader::new(stream);
            let mut received = Vec::new();
            let mut msg_id = 10;
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                let command = line.trim_end().to_owned();
                line.clear();
                received.push(command.clone());
                let upper = command.to_ascii_uppercase();
                if upper == "SPEAK" {
                    writer.write_all(b"230 OK RECEIVING DATA\r\n").unwrap();
                    let mut data = Vec::new();
                    loop {
                        let mut l = String::new();
                        reader.read_line(&mut l).unwrap();
                        if l.trim_end() == "." {
                            break;
                        }
                        data.push(l.trim_end().to_owned());
                    }
                    received.push(data.join("\n"));
                    msg_id += 1;
                    // Events can arrive before the reply's last line is read by the client.
                    write!(writer, "701-{msg_id}\r\n701-1\r\n701 BEGIN\r\n").unwrap();
                    write!(writer, "225-{msg_id}\r\n225 OK MESSAGE QUEUED\r\n").unwrap();
                    write!(
                        writer,
                        "700-{msg_id}\r\n700-1\r\n700-0\r\n700 INDEX MARK\r\n"
                    )
                    .unwrap();
                    write!(writer, "702-{msg_id}\r\n702-1\r\n702 END\r\n").unwrap();
                } else if upper.starts_with("LIST SYNTHESIS_VOICES") {
                    writer
                        .write_all(b"249-Alba\ten-GB\tnone\r\n249-Kit\ten-US\tnone\r\n249 OK VOICE LIST SENT\r\n")
                        .unwrap();
                } else if upper == "QUIT" {
                    // The client may already have hung up.
                    let _ = writer.write_all(b"231 HAPPY HACKING\r\n");
                    break;
                } else if upper.starts_with("SET SELF RATE 500") {
                    writer.write_all(b"410 ERR PARAMETER INVALID\r\n").unwrap();
                } else {
                    writer.write_all(b"200 OK\r\n").unwrap();
                }
            }
            received
        })
    }

    #[test]
    fn speaks_and_reports_events() {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("speechd.sock");
        let server = fake_server(&socket);
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let mut connection =
            Connection::connect(&socket, move |e| sink.lock().unwrap().push(e)).unwrap();

        connection.command("SET self SSML_MODE on").unwrap();
        let id = connection.speak("<speak>Hello\n.world</speak>").unwrap();
        assert_eq!(id, 11);
        let err = connection.command("SET self RATE 500").unwrap_err();
        assert!(matches!(err, SsipError::Refused { code: 410, .. }));
        drop(connection);

        let received = server.join().unwrap();
        assert_eq!(received[2], "<speak>Hello\n..world</speak>");
        let events = events.lock().unwrap();
        assert!(events.contains(&Event {
            kind: EventKind::Mark("0".into()),
            message: 11
        }));
        assert!(events.contains(&Event {
            kind: EventKind::End,
            message: 11
        }));
    }
}
