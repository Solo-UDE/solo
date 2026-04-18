#![warn(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::wildcard_imports,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::uninlined_format_args,
    clippy::doc_markdown,
    clippy::return_self_not_must_use,
    clippy::redundant_closure_for_method_calls,
    clippy::single_match_else,
    clippy::if_not_else,
    clippy::match_same_arms,
    clippy::map_unwrap_or,
    clippy::similar_names,
    clippy::struct_excessive_bools,
    // Tauri-specific: commands have AppHandle + State + many params
    clippy::too_many_arguments,
    clippy::too_many_lines,
    clippy::needless_pass_by_value,
)]

//! Solo Desktop Library
//!
//! This module provides the library interface for the Solo desktop application.

mod agent;
mod agent_commands;
mod auth_commands;
mod commands;
mod desktop_config;
mod elevenlabs_commands;
mod embedding_commands;
mod fs_commands;
mod git_commands;
mod parse_commands;
mod plan_commands;
mod provider_commands;
mod session_commands;
mod settings_commands;
mod skills_commands;
mod stats_commands;
mod terminal_commands;
mod update_commands;
mod vault_commands;
mod worktree_commands;

use auth_commands::AuthState;
use elevenlabs_commands::ElevenLabsState;
use embedding_commands::EmbeddingState;
use fs_commands::FsState;
use git_commands::GitState;
use provider_commands::ProviderAuthState;
use stats_commands::StatsState;
use tauri::Emitter;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;
use terminal_commands::TerminalState;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use vault_commands::VaultState;
use worktree_commands::WorktreeState;

use std::env;
use std::path::PathBuf;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    desktop_config::maybe_load_local_env();

    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                "solo_desktop_lib=debug,solo_elevenlabs=debug,tauri=info".into()
            }),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Solo IDE...");

    // Initialize agent session manager
    // Resolve agent-bridge path from the Cargo manifest directory (compile-time)
    let sidecar_path = {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // manifest_dir = apps/desktop/src-tauri → go up 3 levels to workspace root
        let dev_path = manifest_dir.join("../../../agent-bridge/dist/index.js");
        if dev_path.exists() {
            dev_path
        } else {
            // Fallback: try relative to cwd (for production bundles)
            env::current_dir().map_or_else(
                |_| PathBuf::from("agent-bridge/dist/index.js"),
                |p| p.join("agent-bridge/dist/index.js"),
            )
        }
    };
    tracing::info!("Agent bridge sidecar path: {}", sidecar_path.display());
    let session_manager = Arc::new(agent::SessionManager::new(sidecar_path));
    let session_manager_for_state = Arc::clone(&session_manager);

    tauri::Builder::default()
        // Tauri's deep-link plugin expects single-instance to be registered
        // first so link-triggered secondary launches are forwarded correctly.
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
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
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
                match app.deep_link().get_current() {
                    Ok(Some(urls)) => {
                        tracing::info!("Initial deep link URLs: {:?}", urls);
                    }
                    Ok(None) => {}
                    Err(error) => {
                        tracing::warn!("Failed to read initial deep links: {}", error);
                    }
                }
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

            // Pre-warm credential vault — single keychain read before frontend mounts
            // (Solo OAuth / Claude / Anthropic credentials still live here; the
            // vault's semantic search now runs locally via fastembed-rs so no
            // OpenAI key forwarding is needed anymore.)
            {
                use tauri::Manager;
                let auth = app.state::<ProviderAuthState>();
                let creds = Arc::clone(&auth.credentials);
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = creds.pre_warm().await {
                        tracing::warn!("Vault pre-warm failed: {}", e);
                    }
                });
            }

            // Wire up agent event callbacks
            agent_commands::setup_event_callbacks(app.handle(), &session_manager);

            // macOS: position traffic lights and apply native vibrancy
            #[cfg(target_os = "macos")]
            {
                use tauri::window::{Effect, EffectState, EffectsBuilder};
                use tauri::Manager;
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
        .manage(ProviderAuthState::new())
        .manage(session_manager_for_state)
        .manage(AuthState::new())
        .manage(EmbeddingState::new())
        .manage(TerminalState::new())
        .manage(GitState::new())
        .manage(WorktreeState::new())
        .manage(ElevenLabsState::new())
        .manage(VaultState::new())
        .manage(StatsState::new())
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
            // Agent commands (bridge-based)
            agent_commands::agent_create_session,
            agent_commands::agent_delete_session,
            agent_commands::agent_send_message,
            agent_commands::agent_interrupt,
            agent_commands::agent_is_session_ready,
            agent_commands::agent_get_sdk_session_id,
            agent_commands::agent_respond_permission,
            agent_commands::agent_set_thinking_mode,
            agent_commands::agent_get_thinking_mode,
            agent_commands::agent_set_model,
            agent_commands::agent_set_plan_mode,
            agent_commands::agent_get_plan_mode,
            agent_commands::agent_set_accept_mode,
            agent_commands::agent_get_accept_mode,
            agent_commands::agent_set_debug_mode,
            agent_commands::agent_get_debug_mode,
            agent_commands::agent_set_tool_policy,
            agent_commands::agent_generate_commit_message,
            agent_commands::agent_refine_transcript,
            agent_commands::agent_generate_session_title,
            // Provider/auth commands
            provider_commands::get_providers,
            provider_commands::get_active_provider,
            provider_commands::set_active_provider,
            provider_commands::get_provider_status,
            provider_commands::set_credentials,
            provider_commands::has_credentials,
            provider_commands::clear_credentials,
            provider_commands::get_models,
            provider_commands::get_models_for_provider_cmd,
            provider_commands::get_auth_method,
            provider_commands::start_oauth_flow,
            provider_commands::complete_oauth_flow,
            provider_commands::wait_for_oauth_callback,
            provider_commands::disconnect_oauth,
            provider_commands::check_claude_auth_status,
            provider_commands::check_claude_cli_installed,
            provider_commands::start_claude_login,
            provider_commands::install_claude_cli,
            provider_commands::verify_claude_setup,
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
            auth_commands::auth_get_id_token,
            // Terminal commands
            terminal_commands::spawn_pty,
            terminal_commands::write_pty,
            terminal_commands::resize_pty,
            terminal_commands::kill_pty,
            // Git commands
            git_commands::git_get_status,
            git_commands::git_setup,
            git_commands::git_commit,
            git_commands::git_push,
            git_commands::git_pull,
            git_commands::git_get_current_sha,
            git_commands::git_get_changes,
            git_commands::git_get_file_diff,
            git_commands::git_get_branch_diff,
            git_commands::git_discard_file,
            git_commands::git_discard_all,
            git_commands::git_cleanup_locks,
            git_commands::git_stage_file,
            git_commands::git_unstage_file,
            git_commands::git_stage_all,
            git_commands::git_unstage_all,
            git_commands::git_create_branch,
            git_commands::git_clone,
            git_commands::git_fetch,
            git_commands::git_list_branches,
            git_commands::git_checkout_branch,
            git_commands::git_delete_branch,
            git_commands::git_merge,
            git_commands::git_stash,
            git_commands::git_stash_pop,
            git_commands::git_stash_list,
            git_commands::github_start_auth,
            git_commands::github_complete_auth,
            git_commands::github_get_token,
            git_commands::github_disconnect,
            git_commands::github_start_device_auth,
            git_commands::github_poll_device_auth,
            // Session persistence commands
            session_commands::session_get_dir,
            session_commands::session_list_files,
            session_commands::session_read_file,
            session_commands::session_write_file,
            session_commands::session_delete_file,
            // Settings & permissions commands
            settings_commands::settings_load,
            settings_commands::settings_load_scope,
            settings_commands::settings_save,
            settings_commands::settings_add_allow_rule,
            settings_commands::settings_add_deny_rule,
            settings_commands::settings_add_ask_rule,
            settings_commands::settings_get_permissions,
            settings_commands::settings_default_mode,
            settings_commands::permissions_check,
            // Plan file commands
            plan_commands::plan_new_slug,
            plan_commands::plan_write,
            plan_commands::plan_read,
            plan_commands::plan_list,
            plan_commands::plan_delete,
            plan_commands::plan_path,
            // Worktree commands
            worktree_commands::worktree_list,
            worktree_commands::worktree_create,
            worktree_commands::worktree_remove,
            worktree_commands::worktree_get,
            worktree_commands::worktree_set_active,
            worktree_commands::worktree_get_active,
            worktree_commands::worktree_lock,
            worktree_commands::worktree_unlock,
            worktree_commands::worktree_prune,
            worktree_commands::worktree_bind_agent,
            worktree_commands::worktree_unbind_agent,
            worktree_commands::worktree_find_by_agent,
            worktree_commands::worktree_diff_from_base,
            worktree_commands::worktree_promote,
            worktree_commands::worktree_rename,
            worktree_commands::worktree_set_setup_commands,
            worktree_commands::worktree_get_setup_commands,
            // Skills commands
            skills_commands::skills_list_available,
            skills_commands::skills_write_skill,
            skills_commands::skills_onboarding_status,
            skills_commands::skills_onboarding_apply,
            skills_commands::skills_onboarding_dismiss,
            skills_commands::skills_onboarding_reset,
            skills_commands::skills_set_imports,
            // Stats & tier commands
            stats_commands::stats_initialize,
            stats_commands::stats_current,
            stats_commands::stats_sync_now,
            stats_commands::stats_get_tier,
            stats_commands::stats_get_leaderboard,
            stats_commands::stats_generate_card,
            // ElevenLabs voice commands
            elevenlabs_commands::elevenlabs_set_api_key,
            elevenlabs_commands::elevenlabs_has_api_key,
            elevenlabs_commands::elevenlabs_clear_api_key,
            elevenlabs_commands::elevenlabs_stt_start,
            elevenlabs_commands::elevenlabs_stt_send_audio,
            elevenlabs_commands::elevenlabs_stt_commit,
            elevenlabs_commands::elevenlabs_stt_stop,
            elevenlabs_commands::elevenlabs_tts_speak,
            elevenlabs_commands::elevenlabs_tts_stop,
            // Update commands
            update_commands::check_for_update,
            update_commands::install_update,
            // Vault commands
            vault_commands::vault_drop_paths,
            vault_commands::vault_list,
            vault_commands::vault_get,
            vault_commands::vault_update_tags,
            vault_commands::vault_set_pinned,
            vault_commands::vault_move_scope,
            vault_commands::vault_move_bucket,
            vault_commands::vault_delete,
            vault_commands::vault_search,
            vault_commands::vault_suggest_placement,
            vault_commands::vault_accept_placement,
            vault_commands::vault_backfill_embeddings,
            vault_commands::vault_pending_embeddings_count,
            vault_commands::vault_log_classifier_correction,
            vault_commands::vault_unsorted_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
