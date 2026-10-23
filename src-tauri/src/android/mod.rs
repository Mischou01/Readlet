//! The Android side of the app. `bridge` talks to the Kotlin plugin; `events` parses what it
//! reports (and is tested on every platform).

#[cfg(target_os = "android")]
mod bridge;
mod events;

#[cfg(target_os = "android")]
pub use bridge::{Native, init};
