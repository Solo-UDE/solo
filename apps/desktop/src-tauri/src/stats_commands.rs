//! Tauri bridge for `solo-stats` — the tier / gamification system.
//!
//! The `StatsState` owns a lazily-constructed `StatsCollector` so the tauri
//! setup hook can register this `.manage(...)` without blocking on disk I/O.
//! The collector is initialized on the first successful auth session (the
//! frontend calls `stats_initialize` once the user signs in) because we need
//! the Cognito access token to meaningfully sync anything.

use std::sync::Arc;

use async_trait::async_trait;
use solo_protocol::{
    CumulativeStats, DailyActivityEntry, LeaderboardEntry, StatsSnapshot, TierInfo,
};
use solo_stats::{DailyActivity, StatsCollector, StatsEvent, TokenProvider};
use tauri::State;
use tokio::sync::RwLock;
use tracing::{debug, warn};

use crate::auth_commands::AuthState;
use crate::desktop_config;
use crate::provider_commands::ProviderAuthState;

pub struct StatsState {
    collector: Arc<RwLock<Option<Arc<StatsCollector>>>>,
}

impl StatsState {
    pub fn new() -> Self {
        Self {
            collector: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn current(&self) -> Option<Arc<StatsCollector>> {
        self.collector.read().await.clone()
    }

    /// Record an event if the collector is initialized. Silent no-op when the
    /// user is signed out — events pre-auth are simply not counted.
    pub async fn record(&self, event: StatsEvent) {
        if let Some(collector) = self.collector.read().await.as_ref() {
            if let Err(err) = collector.record(event).await {
                warn!(?err, "stats record failed");
            }
        }
    }
}

impl Default for StatsState {
    fn default() -> Self {
        Self::new()
    }
}

/// Token provider that delegates to `AuthState` + vault for the access token.
struct AuthStateTokenProvider {
    access_token: Arc<RwLock<Option<String>>>,
}

#[async_trait]
impl TokenProvider for AuthStateTokenProvider {
    async fn bearer_token(&self) -> Option<String> {
        self.access_token.read().await.clone()
    }
}

/// Initialize the stats collector once the user has signed in. Called by the
/// frontend after a successful `auth_exchange_code` or when `auth_get_session`
/// returns an authenticated user on startup. Idempotent.
#[tauri::command]
pub async fn stats_initialize(
    state: State<'_, StatsState>,
    auth: State<'_, AuthState>,
    provider_auth: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    let mut slot = state.collector.write().await;
    if slot.is_some() {
        debug!("stats collector already initialized");
        return Ok(());
    }

    let token = crate::auth_commands::access_token_snapshot(&auth, &provider_auth).await;
    let Some(token) = token else {
        return Err("not authenticated".to_string());
    };

    let provider = Arc::new(AuthStateTokenProvider {
        access_token: Arc::new(RwLock::new(Some(token))),
    });

    let collector = StatsCollector::new(desktop_config::api_endpoint().to_string(), provider)
        .await
        .map_err(|e| format!("init stats: {e}"))?;
    let collector = Arc::new(collector);
    collector.spawn_sync_loop();
    *slot = Some(collector);
    Ok(())
}

/// Return the current snapshot (pending delta + cached cumulative). Fast —
/// reads from memory, no cloud call.
#[tauri::command]
pub async fn stats_current(state: State<'_, StatsState>) -> Result<StatsSnapshot, String> {
    match state.current().await {
        Some(collector) => {
            let snap = collector.current().await;
            Ok(to_protocol(snap))
        }
        None => Ok(StatsSnapshot::default()),
    }
}

/// Force an immediate sync. Returns the refreshed cumulative stats on success.
#[tauri::command]
pub async fn stats_sync_now(state: State<'_, StatsState>) -> Result<CumulativeStats, String> {
    let Some(collector) = state.current().await else {
        return Err("stats not initialized".to_string());
    };
    collector
        .sync_now()
        .await
        .map_err(|e| format!("sync failed: {e}"))?;
    let snap = collector.current().await;
    Ok(to_cumulative(snap.cumulative))
}

/// Fetch the signed-in user's 26-week usage heatmap. Each row is a day's
/// raw counters — usage score is computed on the frontend.
#[tauri::command]
pub async fn stats_get_heatmap(
    state: State<'_, StatsState>,
) -> Result<Vec<DailyActivityEntry>, String> {
    let Some(collector) = state.current().await else {
        return Err("stats not initialized".to_string());
    };
    let rows = collector
        .fetch_heatmap()
        .await
        .map_err(|e| format!("heatmap fetch: {e}"))?;
    Ok(rows.into_iter().map(to_daily_activity_entry).collect())
}

/// Fetch the current user's tier info + unlocked name pool from the cloud.
#[tauri::command]
pub async fn stats_get_tier(
    auth: State<'_, AuthState>,
    provider_auth: State<'_, ProviderAuthState>,
) -> Result<TierInfo, String> {
    let token = crate::auth_commands::access_token_snapshot(&auth, &provider_auth)
        .await
        .ok_or_else(|| "not authenticated".to_string())?;
    let url = format!(
        "{}/v1/tier/me",
        desktop_config::api_endpoint().trim_end_matches('/')
    );
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("tier fetch: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("tier fetch failed ({status}): {body}"));
    }
    resp.json::<TierInfo>()
        .await
        .map_err(|e| format!("parse tier: {e}"))
}

/// Fetch the global leaderboard (top N by score).
#[tauri::command]
pub async fn stats_get_leaderboard(
    limit: Option<u32>,
    auth: State<'_, AuthState>,
    provider_auth: State<'_, ProviderAuthState>,
) -> Result<Vec<LeaderboardEntry>, String> {
    let token = crate::auth_commands::access_token_snapshot(&auth, &provider_auth)
        .await
        .ok_or_else(|| "not authenticated".to_string())?;
    let cap = limit.unwrap_or(100).min(500);
    let url = format!(
        "{}/v1/leaderboard?limit={}",
        desktop_config::api_endpoint().trim_end_matches('/'),
        cap
    );
    let resp = reqwest::Client::new()
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("leaderboard fetch: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("leaderboard fetch failed ({status}): {body}"));
    }
    #[derive(serde::Deserialize)]
    struct Wrap {
        entries: Vec<LeaderboardEntry>,
    }
    let wrap: Wrap = resp
        .json()
        .await
        .map_err(|e| format!("parse leaderboard: {e}"))?;
    Ok(wrap.entries)
}

/// Generate a share card for the current user's tier. Returns a signed S3 URL.
#[tauri::command]
pub async fn stats_generate_card(
    auth: State<'_, AuthState>,
    provider_auth: State<'_, ProviderAuthState>,
) -> Result<String, String> {
    let token = crate::auth_commands::access_token_snapshot(&auth, &provider_auth)
        .await
        .ok_or_else(|| "not authenticated".to_string())?;
    let url = format!(
        "{}/v1/card/generate",
        desktop_config::api_endpoint().trim_end_matches('/')
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("card generate: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("card generate failed ({status}): {body}"));
    }
    #[derive(serde::Deserialize)]
    struct Wrap {
        url: String,
    }
    let wrap: Wrap = resp.json().await.map_err(|e| format!("parse card: {e}"))?;
    Ok(wrap.url)
}

fn to_protocol(snap: solo_stats::StatsSnapshot) -> StatsSnapshot {
    StatsSnapshot {
        pending: solo_protocol::StatsDelta {
            commits: snap.pending.commits,
            tokens: snap.pending.tokens,
            worktrees: snap.pending.worktrees,
            sessions: snap.pending.sessions,
            messages: snap.pending.messages,
        },
        cumulative: to_cumulative(snap.cumulative),
        last_sync_at: snap.last_sync_at.map(|dt| dt.to_rfc3339()),
    }
}

fn to_daily_activity_entry(row: DailyActivity) -> DailyActivityEntry {
    DailyActivityEntry {
        date: row.date,
        commits: row.commits,
        tokens: row.tokens,
        worktrees: row.worktrees,
        sessions: row.sessions,
        messages: row.messages,
    }
}

fn to_cumulative(c: solo_stats::CumulativeStats) -> CumulativeStats {
    CumulativeStats {
        commits: c.commits,
        tokens: c.tokens,
        worktrees: c.worktrees,
        sessions: c.sessions,
        messages: c.messages,
        tier: c.tier,
        tier_progress: c.tier_progress,
        score: c.score,
        streak_current: c.streak_current,
        streak_longest: c.streak_longest,
        last_active: c.last_active.map(|dt| dt.to_rfc3339()),
    }
}
