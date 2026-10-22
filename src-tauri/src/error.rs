//! The error type shared by every command. It serialises as `{ kind, message }` so the UI can
//! branch on `kind` and show `message` to the reader.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("No library folder has been chosen yet")]
    NoLibrary,
    #[error("This book isn't in the library: {0}")]
    BookNotFound(String),
    #[error("{0}")]
    InvalidInput(String),
    #[error("The folder doesn't exist or can't be read: {0}")]
    FolderUnavailable(String),
    #[error("Couldn't read the image: {0}")]
    Image(#[from] image::ImageError),
    #[error("Read-aloud isn't available: {0}")]
    Tts(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Watch(#[from] notify::Error),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

impl Error {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::InvalidInput(message.into())
    }

    fn kind(&self) -> &'static str {
        match self {
            Self::NoLibrary => "noLibrary",
            Self::BookNotFound(_) => "bookNotFound",
            Self::InvalidInput(_) => "invalidInput",
            Self::FolderUnavailable(_) => "folderUnavailable",
            Self::Image(_) => "image",
            Self::Tts(_) => "tts",
            Self::Io(_) => "io",
            Self::Json(_) => "json",
            Self::Sql(_) => "index",
            Self::Watch(_) => "watch",
            Self::Tauri(_) => "internal",
        }
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("Error", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serialises_kind_and_message() {
        let json = serde_json::to_value(Error::BookNotFound("abc".into())).unwrap();
        assert_eq!(json["kind"], "bookNotFound");
        assert_eq!(json["message"], "This book isn't in the library: abc");
    }
}
