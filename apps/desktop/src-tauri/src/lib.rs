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
mod embedding_commands;
mod fs_commands;
mod git_commands;
mod parse_commands;
mod plan_commands;
mod plugins_commands;
mod provider_commands;
mod session_commands;
mod settings_commands;
mod skills_aggregate;
mod skills_bundled;
mod skills_commands;
mod skills_marketplace;
mod skills_origin;
mod stats_commands;
mod cycles_commands;
mod labels_commands;
mod projects_commands;
mod task_commands;
mod task_executor;
mod task_planner;
mod terminal_commands;
mod update_commands;
mod vault_commands;
mod vault_sync_commands;
mod voice;
mod voice_commands;
mod worktree_commands;

use auth_commands::AuthState;
use embedding_commands::EmbeddingState;
use fs_commands::FsState;
use git_commands::GitState;
use plugins_commands::PluginsState;
use provider_commands::ProviderAuthState;
use stats_commands::StatsState;
use tauri::Emitter;
use task_commands::TaskState;
use task_executor::ExecutorMap;
use task_planner::ProactiveGate;
use terminal_commands::TerminalState;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use vault_commands::VaultState;
use voice_commands::VoiceState;
use worktree_commands::WorktreeState;

use std::env;
use std::path::PathBuf;
use std::sync::Arc;

fn resolve_agent_bridge_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_path = manifest_dir.join("../../../agent-bridge/dist/index.js");

    // Dev builds run the Bun-built JS sidecar from the workspace so the
    // agent-bridge watcher can update it without recompiling the Tauri app.
    #[cfg(debug_assertions)]
    if dev_path.exists() {
        return dev_path;
    }

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for candidate in [
                exe_dir.join("agent-bridge"),
                exe_dir.join("agent-bridge-aarch64-apple-darwin"),
            ] {
                if candidate.exists() {
                    return candidate;
                }
            }
        }
    }

    if dev_path.exists() {
        return dev_path;
    }

    env::current_dir().map_or_else(
        |_| PathBuf::from("agent-bridge/dist/index.js"),
        |p| p.join("agent-bridge/dist/index.js"),
    )
}

async fn dispatch_fire(app: &tauri::AppHandle, task_id: String) {
    use tauri::Manager as _;
    let exec_map = app.state::<Arc<task_executor::ExecutorMap>>().inner().clone();
    let session_mgr = app.state::<Arc<agent::SessionManager>>().inner().clone();
    let Ok(store) = task_commands::get_store_for_setup(app).await else { return };

    // Capacity gate: respect MAX_ACTIVE_SESSIONS (3). If at capacity, skip this
    // tick; the task's next_fire already advanced, so this fire is dropped for
    // the current window.
    //
    // TODO (v2): proper queueing persists dropped fires until capacity frees.
    // For Phase 4 we accept skipped fires — they appear as missed days in the
    // Runs history which the user can run manually.
    if let Err(e) = task_executor::spawn_agent_for_task(
        app, store, exec_map, session_mgr, task_id.clone(),
    ).await {
        tracing::warn!(task_id, error = %e, "scheduled fire: dispatch failed");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    desktop_config::maybe_load_local_env();

    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "solo_desktop_lib=debug,solo_voice=debug,tauri=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Solo IDE...");

    // Initialize agent session manager.
    // Release builds bundle a standalone sidecar next to the app executable.
    // Dev builds keep using the Bun-built script from the workspace.
    let sidecar_path = resolve_agent_bridge_path();
    tracing::info!("Agent bridge sidecar path: {}", sidecar_path.display());
    let session_manager = Arc::new(agent::SessionManager::new(sidecar_path));
    let session_manager_for_state = Arc::clone(&session_manager);

    tauri::Builder::default()
        // single_instance MUST be registered before deep_link when the
        // single-instance plugin's `deep-link` feature is enabled.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_macos_permissions::init())
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

            // Install task allocator agent listeners
            let handle_for_listeners = app.handle().clone();
            let sm_for_listeners = session_manager.clone();
            tauri::async_runtime::block_on(async {
                if let Ok(store) = task_commands::get_store_for_setup(&handle_for_listeners).await {
                    use tauri::Manager as _;
                    let map = handle_for_listeners.state::<std::sync::Arc<ExecutorMap>>().inner().clone();
                    task_executor::install_agent_listeners(&handle_for_listeners, store, map, sm_for_listeners);
                }
            });

            // Start the task scheduler tick loop (Phase 4)
            {
                let handle_for_scheduler = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use std::sync::Arc;
                    use tauri::Manager as _;
                    // Wait a moment for stores to initialize
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    let Ok(store) = task_commands::get_store_for_setup(&handle_for_scheduler).await else {
                        tracing::warn!("task scheduler: store unavailable");
                        return;
                    };
                    let sched = Arc::new(solo_tasks::Scheduler::new(store));

                    // Catch-up pass
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
                        .unwrap_or(0);
                    if let Ok(fires) = sched.catch_up(now) {
                        for fire in fires {
                            tracing::info!(task_id = %fire.task_id, "catch-up fire");
                            dispatch_fire(&handle_for_scheduler, fire.task_id).await;
                        }
                    }

                    // Tick loop
                    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(15));
                    loop {
                        ticker.tick().await;
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| i64::try_from(d.as_millis()).unwrap_or(0))
                            .unwrap_or(0);
                        match sched.tick(now_ms) {
                            Ok(fires) => {
                                for fire in fires {
                                    tracing::info!(task_id = %fire.task_id, "scheduled fire");
                                    dispatch_fire(&handle_for_scheduler, fire.task_id).await;
                                }
                            }
                            Err(e) => tracing::warn!(error = %e, "scheduler tick failed"),
                        }
                    }
                });
            }

            // First-launch: extract the bundled UI skill into ~/.solo/skills/ui/
            // if not already present. Idempotent — subsequent launches are a no-op.
            {
                tauri::async_runtime::spawn(async move {
                    let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) else {
                        return;
                    };
                    let user_skills = std::path::PathBuf::from(home).join(".solo").join("skills");
                    match skills_bundled::extract_bundled_if_missing(&user_skills).await {
                        Ok(true) => tracing::info!("extracted bundled ui skill to {}", user_skills.display()),
                        Ok(false) => tracing::debug!("bundled ui skill already present"),
                        Err(e) => tracing::warn!("failed to extract bundled skill: {}", e),
                    }
                });
            }

            // macOS: apply native vibrancy. Traffic-light position is set
            // natively via `trafficLightPosition` in tauri.conf.json — the
            // decorum-based approach crashed on macOS 26 (Tahoe) because the
            // private NSView hierarchy it traverses changed.
            #[cfg(target_os = "macos")]
            {
                use tauri::window::{Effect, EffectState, EffectsBuilder};
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
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
        .manage(VaultState::new())
        .manage(TaskState::new())
        .manage(ExecutorMap::new())
        .manage(ProactiveGate::new())
        .manage(VoiceState::new())
        .manage(std::sync::Arc::new(voice::hud::HudState::new()))
        .manage(StatsState::new())
        .manage(PluginsState::new())
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
            provider_commands::validate_api_key,
            provider_commands::verify_provider_model,
            provider_commands::start_oauth_flow,
            provider_commands::complete_oauth_flow,
            provider_commands::wait_for_oauth_callback,
            provider_commands::disconnect_oauth,
            provider_commands::list_profiles,
            provider_commands::set_active_profile,
            provider_commands::remove_profile,
            provider_commands::sign_out_profile,
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
            auth_commands::auth_diagnose,
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
            settings_commands::settings_get_planner_notes,
            settings_commands::settings_set_planner_notes,
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
            skills_aggregate::skills_write_workspace_agents_md,
            skills_marketplace::skills_fetch_registry,
            skills_marketplace::skills_search_marketplace,
            skills_marketplace::skills_install,
            skills_marketplace::skills_uninstall,
            skills_marketplace::skills_read_installed,
            skills_marketplace::skills_write_installed,
            // Plugin commands
            plugins_commands::plugins_list,
            plugins_commands::plugins_get_detail,
            plugins_commands::plugins_set_enabled,
            plugins_commands::plugins_install_local,
            plugins_commands::plugins_uninstall,
            // Stats & tier commands
            stats_commands::stats_initialize,
            stats_commands::stats_current,
            stats_commands::stats_sync_now,
            stats_commands::stats_get_tier,
            stats_commands::stats_get_heatmap,
            stats_commands::stats_get_leaderboard,
            stats_commands::stats_generate_card,
            // Voice commands
            voice_commands::voice_enable,
            voice_commands::voice_download_parakeet,
            voice_commands::voice_begin,
            voice_commands::voice_end,
            voice_commands::voice_cancel,
            voice_commands::voice_history_list,
            voice_commands::voice_history_delete,
            voice_commands::voice_parakeet_installed,
            voice_commands::voice_get_shortcuts,
            voice_commands::voice_set_shortcuts,
            voice_commands::voice_check_permissions,
            voice_commands::voice_request_permission,
            voice_commands::voice_clear_badge,
            // Task commands
            task_commands::task_list,
            task_commands::task_get,
            task_commands::task_create,
            task_commands::task_update,
            task_commands::task_delete,
            task_commands::task_search,
            task_commands::task_subtask_add,
            task_commands::task_subtask_toggle,
            task_commands::task_subtask_rename,
            task_commands::task_subtask_remove,
            task_commands::task_subtask_reorder,
            task_commands::task_run,
            task_commands::task_cancel,
            task_commands::task_review_merge,
            task_commands::task_review_discard,
            task_commands::task_review_open_pr,
            task_commands::task_schedule_preview,
            task_commands::plan_from_goal,
            task_commands::plan_accept_draft,
            task_commands::plan_dismiss_draft,
            task_commands::plan_proactive,
            // Label commands
            labels_commands::label_list,
            labels_commands::label_create,
            labels_commands::label_update,
            labels_commands::label_delete,
            labels_commands::task_label_add,
            labels_commands::task_label_remove,
            // Project commands
            projects_commands::project_list,
            projects_commands::project_get,
            projects_commands::project_create,
            projects_commands::project_update,
            projects_commands::project_delete,
            // Cycle commands
            cycles_commands::cycle_list,
            cycles_commands::cycle_create,
            cycles_commands::cycle_update,
            cycles_commands::cycle_delete,
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
            vault_commands::vault_reextract,
            vault_commands::vault_pending_reextract_count,
            vault_commands::vault_log_classifier_correction,
            vault_commands::vault_unsorted_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
