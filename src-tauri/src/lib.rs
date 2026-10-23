//! Readlet's Rust core: the library folder, the index, reading data and read-aloud.
//! See docs/PLAN.md for the architecture.

mod aura;
mod commands;
mod covers;
mod error;
mod fsutil;
mod index;
mod library;
mod protocol;
mod settings;
mod state;
mod store;
mod tts;

use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

use state::{AppPaths, AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(tauri_plugin_readlet_android::folders())
        .plugin(tauri_plugin_readlet_android::screen());
    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol(protocol::BOOK_SCHEME, protocol::handle_book)
        .register_asynchronous_uri_scheme_protocol(protocol::COVER_SCHEME, protocol::handle_cover)
        .setup(|app| {
            let handle = app.handle();
            let state = AppState::new(AppPaths::resolve(handle)?)?;
            let root = state.settings().library_root.clone();
            app.manage(state);
            app.manage(tts::Speaker::new());
            if let Some(root) = root {
                // A missing folder (an unmounted drive, say) isn't fatal: the UI asks again.
                if let Err(e) = app.state::<AppState>().open_library(handle, &root) {
                    log::warn!("couldn't open the library folder: {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::set_preferences,
            commands::pick_folder,
            commands::screen_insets,
            commands::set_native_text_menu,
            commands::choose_library,
            commands::rescan_library,
            commands::list_books,
            commands::books_needing_metadata,
            commands::set_book_metadata,
            commands::set_book_cover,
            commands::add_books,
            commands::reveal_book,
            commands::list_records,
            commands::get_record,
            commands::set_progress,
            commands::set_status,
            commands::put_annotation,
            commands::delete_annotation,
            commands::list_sessions,
            commands::checkpoint_session,
            commands::finish_session,
            commands::get_profile,
            commands::set_daily_goal,
            commands::set_yearly_goal,
            commands::list_shelves,
            commands::put_shelf,
            commands::delete_shelf,
            commands::list_resurfaced,
            commands::log_resurfaced,
            commands::export_markdown,
            tts::tts_voices,
            tts::tts_speak,
            tts::tts_pause,
            tts::tts_resume,
            tts::tts_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Readlet");
}
