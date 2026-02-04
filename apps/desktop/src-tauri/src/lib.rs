//! Solo Desktop Library
//!
//! This module provides the library interface for the Solo desktop application.

mod commands;
mod fs_commands;
mod agent_commands;
mod parse_commands;
mod auth_commands;
mod embedding_commands;
mod terminal_commands;
mod worktree_commands;

use fs_commands::FsState;
use agent_commands::AgentState;
use auth_commands::AuthState;
use embedding_commands::EmbeddingState;
use terminal_commands::TerminalState;
use worktree_commands::WorktreeState;
use tauri::Emitter;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;
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
        .plugin(tauri_plugin_decorum::init())
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

            // macOS: position traffic lights and apply native vibrancy
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                use tauri::window::{Effect, EffectState, EffectsBuilder};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_traffic_lights_inset(13.0, 13.0);
                    let _ = window.set_effects(
                        EffectsBuilder::new()
                            .effect(Effect::Sidebar)
                            .state(EffectState::FollowsWindowActiveState)
                            .build(),
                    );
                }
            }

            Ok(())
        })
        .manage(FsState::new())
        .manage(AgentState::new())
        .manage(AuthState::new())
        .manage(EmbeddingState::new())
        .manage(TerminalState::new())
        .manage(WorktreeState::new())
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
            agent_commands::agent_update_session_model,
            agent_commands::agent_send_message,
            agent_commands::agent_abort_session,
            agent_commands::agent_get_history,
            agent_commands::agent_clear_history,
            // Tool commands
            agent_commands::get_tools,
            agent_commands::execute_tool,
            agent_commands::approve_tool_call,
            agent_commands::reject_tool_call,
            agent_commands::tool_requires_approval,
            // Auth method commands
            agent_commands::get_auth_method,
            // OAuth commands
            agent_commands::start_oauth_flow,
            agent_commands::complete_oauth_flow,
            agent_commands::wait_for_oauth_callback,
            agent_commands::disconnect_oauth,
            // Manual OAuth token command
            agent_commands::set_oauth_token_manual,
            // Claude Code CLI commands
            agent_commands::check_claude_auth_status,
            agent_commands::check_claude_cli_installed,
            agent_commands::start_claude_login,
            agent_commands::install_claude_cli,
            // Parse commands
            parse_commands::parse_file,
            parse_commands::parse_content,
            parse_commands::is_parseable,
            // Embedding commands
            embedding_commands::embedding_init,
            embedding_commands::embedding_index_code,
            embedding_commands::embedding_search_code,
            embedding_commands::embedding_embed_text,
            embedding_commands::embedding_clear_index,
            embedding_commands::embedding_get_stats,
            // Auth commands
            auth_commands::auth_start_oauth,
            auth_commands::auth_start_magic_link,
            auth_commands::auth_exchange_code,
            auth_commands::auth_get_session,
            auth_commands::auth_refresh_session,
            auth_commands::auth_sign_out,
            auth_commands::auth_get_access_token,
            // Terminal commands
            terminal_commands::spawn_pty,
            terminal_commands::write_pty,
            terminal_commands::resize_pty,
            terminal_commands::kill_pty,
            // Worktree commands
            worktree_commands::worktree_list,
            worktree_commands::worktree_create,
            worktree_commands::worktree_remove,
            worktree_commands::worktree_get,
            worktree_commands::worktree_set_active,
            worktree_commands::worktree_get_active,
            worktree_commands::worktree_lock,
            worktree_commands::worktree_unlock,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
