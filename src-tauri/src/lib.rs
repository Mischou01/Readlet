//! Readlet's Rust core: the library folder, the index, reading data and read-aloud.
//! See docs/PLAN.md for the architecture.

#[cfg(any(target_os = "android", test))]
mod android;
mod aura;
mod catalog;
mod commands;
mod covers;
mod error;
mod fsutil;
mod index;
mod library;
mod lookup;
mod net;
mod platform;
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
    let builder = builder.plugin(android::init());
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
        .on_window_event(|window, event| {
            // Nothing watches the folder while a phone app is in the background; catch up when
            // it comes back.
            #[cfg(mobile)]
            match event {
                tauri::WindowEvent::Resumed => {
                    window.state::<AppState>().catch_up(window.app_handle());
                }
                // The system may stop the app from here on: the UI saves what it has.
                tauri::WindowEvent::Suspended => {
                    use tauri::Emitter;
                    let _ = window.emit(state::events::APP_SUSPENDED, ());
                }
                _ => {}
            }
            #[cfg(desktop)]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::set_preferences,
            commands::choose_library,
            commands::rescan_library,
            commands::list_books,
            commands::get_books,
            commands::books_needing_metadata,
            commands::set_book_metadata,
            commands::set_book_cover,
            commands::set_book_details,
            commands::reset_book_details,
            commands::choose_book_cover,
            commands::choose_book_cover_online,
            commands::search_book_details,
            commands::fetch_book_details,
            commands::search_free_books,
            commands::download_free_book,
            commands::add_books,
            commands::delete_books,
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
            tts::tts_stop,
            tts::tts_session,
            platform::storage_access,
            platform::request_storage_access,
            platform::pick_folder,
            platform::import_books,
            platform::set_system_bars,
            platform::system_insets,
            platform::set_reader_controls,
            platform::move_to_background,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Readlet");
}
