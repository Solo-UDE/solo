//! Solo Desktop Library
//!
//! This module provides the library interface for the Solo desktop application.

mod commands;
mod fs_commands;
mod agent_commands;
mod parse_commands;
mod auth_commands;

use fs_commands::FsState;
use agent_commands::AgentState;
use auth_commands::AuthState;
use tauri::Emitter;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "solo_desktop=debug,tauri=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Solo IDE...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Handle deep link from single instance
            tracing::debug!("Single instance activated with args: {:?}", args);
            if let Some(url) = args.get(1) {
                if url.starts_with("soloide://") {
                    if let Err(e) = app.emit("auth-callback", url) {
                        tracing::error!("Failed to emit auth-callback: {}", e);
                    }
                }
            }
        }))
        .setup(|app| {
            // Register deep link handler
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register("soloide").ok();
            }

            // Listen for deep link events
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let app_handle = app.handle().clone();
                tracing::info!("Setting up deep link handler...");
                app.deep_link().on_open_url(move |event| {
                    tracing::info!("Deep link event received!");
                    for url in event.urls() {
                        tracing::info!("Processing deep link URL: {}", url);
                        if let Err(e) = app_handle.emit("auth-callback", url.to_string()) {
                            tracing::error!("Failed to emit auth-callback: {}", e);
                        } else {
                            tracing::info!("Successfully emitted auth-callback event");
                        }
                    }
                });
                tracing::info!("Deep link handler registered");
            }

            Ok(())
        })
        .manage(FsState::new())
        .manage(AgentState::new())
        .manage(AuthState::new())
        .invoke_handler(tauri::generate_handler![
            // Core commands
            commands::ping,
            commands::get_config,
            // File system commands
            fs_commands::open_folder_dialog,
            fs_commands::set_workspace_root,
            fs_commands::read_directory,
            fs_commands::read_file,
            fs_commands::write_file,
            fs_commands::create_file,
            fs_commands::rename_file,
            fs_commands::delete_file,
            fs_commands::start_watching,
            fs_commands::stop_watching,
            fs_commands::reveal_in_finder,
            // Agent commands
            agent_commands::get_providers,
            agent_commands::get_active_provider,
            agent_commands::set_active_provider,
            agent_commands::get_provider_status,
            agent_commands::set_credentials,
            agent_commands::has_credentials,
            agent_commands::get_models,
            agent_commands::get_models_for_provider_cmd,
            agent_commands::agent_create_session,
            agent_commands::agent_send_message,
            agent_commands::agent_get_history,
            agent_commands::agent_clear_history,
            // OAuth commands
            agent_commands::start_oauth_flow,
            agent_commands::complete_oauth_flow,
            agent_commands::wait_for_oauth_callback,
            agent_commands::get_auth_method,
            agent_commands::disconnect_oauth,
            // Claude Code CLI commands
            agent_commands::check_claude_cli_installed,
            agent_commands::install_claude_cli,
            agent_commands::start_claude_login,
            agent_commands::check_claude_auth_status,
            // Parse commands
            parse_commands::parse_file,
            parse_commands::parse_content,
            parse_commands::is_parseable,
            // Auth commands
            auth_commands::auth_start_oauth,
            auth_commands::auth_start_magic_link,
            auth_commands::auth_exchange_code,
            auth_commands::auth_get_session,
            auth_commands::auth_refresh_session,
            auth_commands::auth_sign_out,
            auth_commands::auth_get_access_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
