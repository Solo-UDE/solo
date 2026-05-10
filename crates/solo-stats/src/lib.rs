//! Local stats collector + cloud sync worker for Solo's tier/gamification
//! system.
//!
//! # Design
//!
//! Stats live in two places:
//!
//! * **Local store** (`~/.solo/stats.json`) — the source of truth while the
//!   desktop is offline. Writes are atomic (temp file + rename) so a crash
//!   mid-write can never corrupt the file.
//! * **Cloud store** (DynamoDB `solo-user-stats-{stage}`) — the source of truth
//!   across devices. Deltas flow one way: local → cloud via
//!   `POST /v1/stats/sync`. The cloud hydrates the local store at sign-in.
//!
//! Only aggregate counters ever leave the device: commits, tokens, worktrees,
//! sessions, messages. No file paths, no repo names, no code contents.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::{Mutex, RwLock};
use tracing::{debug, info, warn};

pub mod store;

pub use store::StatsStore;

const STATS_FILE: &str = "stats.json";
const SYNC_DEBOUNCE: Duration = Duration::from_secs(60);

/// Events the collector understands. One variant per meaningful action that
/// should move a tier counter forward.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StatsEvent {
    /// A git push succeeded. Cloud side increments `commits` by `count`.
    CommitsPushed { count: u32 },
    /// The agent consumed tokens. Fired after each assistant turn completes.
    TokensConsumed { count: u64 },
    /// A new worktree was created via `worktree_create`.
    WorktreeCreated,
    /// A new agent session was started.
    SessionCreated,
    /// The user submitted a message to the agent.
    MessageSent,
}

/// Counters aggregated on-device before a sync. Zeroed after a successful
/// POST to `/v1/stats/sync`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StatsDelta {
    #[serde(default)]
    pub commits: u64,
    #[serde(default)]
    pub tokens: u64,
    #[serde(default)]
    pub worktrees: u64,
    #[serde(default)]
    pub sessions: u64,
    #[serde(default)]
    pub messages: u64,
}

impl StatsDelta {
    fn is_empty(&self) -> bool {
        self.commits == 0
            && self.tokens == 0
            && self.worktrees == 0
            && self.sessions == 0
            && self.messages == 0
    }

    fn apply(&mut self, event: &StatsEvent) {
        match event {
            StatsEvent::CommitsPushed { count } => {
                self.commits = self.commits.saturating_add(u64::from(*count));
            }
            StatsEvent::TokensConsumed { count } => {
                self.tokens = self.tokens.saturating_add(*count);
            }
            StatsEvent::WorktreeCreated => {
                self.worktrees = self.worktrees.saturating_add(1);
            }
            StatsEvent::SessionCreated => {
                self.sessions = self.sessions.saturating_add(1);
            }
            StatsEvent::MessageSent => {
                self.messages = self.messages.saturating_add(1);
            }
        }
    }
}

/// Cumulative, cloud-hydrated stats. These mirror the columns in
/// `solo-user-stats-{stage}` and drive the Journey page UI.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CumulativeStats {
    #[serde(default)]
    pub commits: u64,
    #[serde(default)]
    pub tokens: u64,
    #[serde(default)]
    pub worktrees: u64,
    #[serde(default)]
    pub sessions: u64,
    #[serde(default)]
    pub messages: u64,
    #[serde(default)]
    pub tier: u8,
    #[serde(default, alias = "tierProgress")]
    pub tier_progress: f64,
    #[serde(default)]
    pub score: f64,
    #[serde(default, alias = "streakCurrent")]
    pub streak_current: u32,
    #[serde(default, alias = "streakLongest")]
    pub streak_longest: u32,
    #[serde(default, alias = "lastActive")]
    pub last_active: Option<DateTime<Utc>>,
}

/// On-disk shape of `~/.solo/stats.json`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StatsSnapshot {
    #[serde(default)]
    pub pending: StatsDelta,
    /// Per-day buckets (UTC `YYYY-MM-DD` keys) accumulated since the last
    /// successful sync. Drives the usage heatmap on the Journey page. Cleared
    /// alongside `pending` when the sync POST succeeds.
    #[serde(default)]
    pub pending_daily: HashMap<String, StatsDelta>,
    #[serde(default)]
    pub cumulative: CumulativeStats,
    #[serde(default)]
    pub last_sync_at: Option<DateTime<Utc>>,
}

fn today_utc_iso() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

/// Wire format for `POST /v1/stats/sync`, matching the syncStats Lambda's
/// `SyncBody` (camelCase).
#[derive(Debug, Serialize)]
struct SyncRequest<'a> {
    delta: &'a StatsDelta,
    daily: &'a HashMap<String, StatsDelta>,
    #[serde(rename = "lastActive", skip_serializing_if = "Option::is_none")]
    last_active: Option<String>,
}

/// Shape returned by the syncStats Lambda. Intentionally narrow — the Lambda
/// only echoes tier-derived fields. Parsing into `CumulativeStats` directly
/// would wipe the counter fields since they're absent in the response.
#[derive(Debug, Deserialize)]
struct SyncResponse {
    #[serde(default)]
    tier: u8,
    /// Lambda returns this rounded to the 0–100 integer scale. Translated to
    /// the local 0–1 float scale when merged into `CumulativeStats`.
    #[serde(default, alias = "tierProgress")]
    tier_progress: f64,
    #[serde(default)]
    score: f64,
}

/// One row of the 26-week rolling usage heatmap. Raw counters — the usage
/// score itself is computed client-side so weights can be tuned without a
/// Lambda deploy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyActivity {
    pub date: String,
    #[serde(default)]
    pub commits: u64,
    #[serde(default)]
    pub tokens: u64,
    #[serde(default)]
    pub worktrees: u64,
    #[serde(default)]
    pub sessions: u64,
    #[serde(default)]
    pub messages: u64,
}

/// Envelope returned by `GET /v1/stats/my`.
#[derive(Debug, Deserialize)]
struct MyStatsResponse {
    #[serde(default)]
    stats: Option<CumulativeStats>,
    #[serde(default)]
    heatmap: Vec<DailyActivity>,
}

#[derive(Debug, Error)]
pub enum StatsError {
    #[error("missing auth token - cannot sync stats")]
    NotAuthenticated,
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("persistence error: {0}")]
    Persist(String),
    #[error("api returned {status}: {body}")]
    ApiError { status: u16, body: String },
}

impl From<anyhow::Error> for StatsError {
    fn from(err: anyhow::Error) -> Self {
        StatsError::Persist(err.to_string())
    }
}

/// Returns `~/.solo/stats.json`, creating parent dirs if needed.
pub fn stats_file_path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("home directory not found")?;
    let dir = home.join(".solo");
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    Ok(dir.join(STATS_FILE))
}

/// Provides an auth token on demand. Injected by the Tauri layer which owns
/// `AuthState`. `None` means the user is signed out — we keep buffering
/// locally until they sign back in.
#[async_trait::async_trait]
pub trait TokenProvider: Send + Sync {
    async fn bearer_token(&self) -> Option<String>;
}

/// The stats collector. Cheap to clone — all state is `Arc`'d.
pub struct StatsCollector {
    store: Arc<StatsStore>,
    token_provider: Arc<dyn TokenProvider>,
    client: reqwest::Client,
    api_base: String,
    sync_lock: Arc<Mutex<()>>,
    snapshot: Arc<RwLock<StatsSnapshot>>,
}

impl StatsCollector {
    pub async fn new(
        api_base: impl Into<String>,
        token_provider: Arc<dyn TokenProvider>,
    ) -> Result<Self> {
        let store = Arc::new(StatsStore::new(stats_file_path()?).await?);
        let initial = store.load().await?;
        Ok(Self {
            store,
            token_provider,
            client: reqwest::Client::new(),
            api_base: api_base.into(),
            sync_lock: Arc::new(Mutex::new(())),
            snapshot: Arc::new(RwLock::new(initial)),
        })
    }

    /// Record an event. Updates the on-disk pending delta atomically. The
    /// in-memory snapshot is kept in sync so `current()` reflects the latest
    /// counters without waiting for a sync.
    pub async fn record(&self, event: StatsEvent) -> Result<()> {
        debug!(?event, "stats event recorded");
        let day_key = today_utc_iso();
        let mut snap = self.snapshot.write().await;
        snap.pending.apply(&event);
        snap.pending_daily.entry(day_key).or_default().apply(&event);
        self.store.save(&snap).await?;
        Ok(())
    }

    /// Current in-memory snapshot (pending delta + last known cumulative).
    pub async fn current(&self) -> StatsSnapshot {
        self.snapshot.read().await.clone()
    }

    /// Force an immediate sync. Called on app close and periodically by
    /// `spawn_sync_loop`.
    pub async fn sync_now(&self) -> Result<(), StatsError> {
        let _guard = self.sync_lock.lock().await;

        let snapshot = self.snapshot.read().await.clone();
        if snapshot.pending.is_empty() && snapshot.pending_daily.is_empty() {
            debug!("no pending stats — skipping sync");
            return Ok(());
        }

        let Some(token) = self.token_provider.bearer_token().await else {
            debug!("no auth token — deferring sync");
            return Err(StatsError::NotAuthenticated);
        };

        let url = format!("{}/v1/stats/sync", self.api_base.trim_end_matches('/'));
        let last_active = Some(Utc::now().to_rfc3339());
        let request = SyncRequest {
            delta: &snapshot.pending,
            daily: &snapshot.pending_daily,
            last_active,
        };
        let response = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            warn!(%status, %body, "stats sync failed");
            return Err(StatsError::ApiError {
                status: status.as_u16(),
                body,
            });
        }

        // The sync Lambda returns a narrow `{tier, tier_progress (0-100), score}`
        // response — only these three fields are authoritatively updated here.
        // Counter totals are updated locally from the delta that just synced;
        // cross-device totals are refreshed by `GET /v1/stats/my`.
        let resp: SyncResponse = response.json().await.map_err(StatsError::from)?;
        info!(
            tier = resp.tier,
            progress = resp.tier_progress,
            "stats sync ok"
        );

        let mut snap = self.snapshot.write().await;
        snap.cumulative.commits = snap
            .cumulative
            .commits
            .saturating_add(snapshot.pending.commits);
        snap.cumulative.tokens = snap
            .cumulative
            .tokens
            .saturating_add(snapshot.pending.tokens);
        snap.cumulative.worktrees = snap
            .cumulative
            .worktrees
            .saturating_add(snapshot.pending.worktrees);
        snap.cumulative.sessions = snap
            .cumulative
            .sessions
            .saturating_add(snapshot.pending.sessions);
        snap.cumulative.messages = snap
            .cumulative
            .messages
            .saturating_add(snapshot.pending.messages);
        snap.pending = StatsDelta::default();
        snap.pending_daily.clear();
        snap.cumulative.tier = resp.tier;
        snap.cumulative.tier_progress = resp.tier_progress / 100.0;
        snap.cumulative.score = resp.score;
        snap.cumulative.last_active = Some(Utc::now());
        snap.last_sync_at = Some(Utc::now());
        self.store.save(&snap).await?;
        Ok(())
    }

    /// Ensure the signed-in user has a cloud stats row even before any local
    /// activity has accumulated. This makes fresh users visible to stats reads
    /// and the leaderboard without turning the periodic sync loop into a
    /// constant no-op writer.
    pub async fn ensure_cloud_row(&self) -> Result<(), StatsError> {
        let snapshot = self.snapshot.read().await.clone();
        let Some(token) = self.token_provider.bearer_token().await else {
            return Err(StatsError::NotAuthenticated);
        };

        let url = format!("{}/v1/stats/sync", self.api_base.trim_end_matches('/'));
        let empty_daily = HashMap::new();
        let empty_delta = StatsDelta::default();
        let request = SyncRequest {
            delta: &empty_delta,
            daily: &empty_daily,
            last_active: Some(Utc::now().to_rfc3339()),
        };
        let response = self
            .client
            .post(&url)
            .bearer_auth(token)
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(StatsError::ApiError {
                status: status.as_u16(),
                body,
            });
        }

        let resp: SyncResponse = response.json().await.map_err(StatsError::from)?;
        let mut snap = self.snapshot.write().await;
        snap.cumulative.tier = if resp.tier == 0 { 1 } else { resp.tier };
        snap.cumulative.tier_progress = resp.tier_progress / 100.0;
        snap.cumulative.score = resp.score;
        snap.cumulative.last_active = Some(Utc::now());
        snap.last_sync_at = snapshot.last_sync_at.or_else(|| Some(Utc::now()));
        self.store.save(&snap).await?;
        Ok(())
    }

    /// Refresh cumulative totals from the cloud. This hydrates a new device or
    /// a freshly signed-in session before the Journey page reads local state.
    pub async fn refresh_from_cloud(&self) -> Result<(), StatsError> {
        let payload = self.fetch_my_stats().await?;
        if let Some(stats) = payload.stats {
            let mut snap = self.snapshot.write().await;
            snap.cumulative = normalize_cumulative(stats);
            self.store.save(&snap).await?;
        }
        Ok(())
    }

    /// Fetch the server's 26-week usage heatmap (per-day deltas) for the
    /// signed-in user. Merged with `pending_daily` so cells reflect activity
    /// that hasn't been synced yet. Returns rows sorted by date ascending.
    pub async fn fetch_heatmap(&self) -> Result<Vec<DailyActivity>, StatsError> {
        let payload = self.fetch_my_stats().await?;
        if let Some(stats) = payload.stats {
            let mut snap = self.snapshot.write().await;
            snap.cumulative = normalize_cumulative(stats);
            self.store.save(&snap).await?;
        }

        // Collapse server rows into a map, then layer pending (unsynced) daily
        // counters on top so the UI can reflect activity still buffered locally.
        let mut by_date: HashMap<String, DailyActivity> = payload
            .heatmap
            .into_iter()
            .map(|row| (row.date.clone(), row))
            .collect();

        let pending_daily = self.snapshot.read().await.pending_daily.clone();
        for (date, delta) in pending_daily {
            let entry = by_date
                .entry(date.clone())
                .or_insert_with(|| DailyActivity {
                    date: date.clone(),
                    commits: 0,
                    tokens: 0,
                    worktrees: 0,
                    sessions: 0,
                    messages: 0,
                });
            entry.commits += delta.commits;
            entry.tokens += delta.tokens;
            entry.worktrees += delta.worktrees;
            entry.sessions += delta.sessions;
            entry.messages += delta.messages;
        }

        let mut rows: Vec<DailyActivity> = by_date.into_values().collect();
        rows.sort_by(|a, b| a.date.cmp(&b.date));
        Ok(rows)
    }

    async fn fetch_my_stats(&self) -> Result<MyStatsResponse, StatsError> {
        let Some(token) = self.token_provider.bearer_token().await else {
            return Err(StatsError::NotAuthenticated);
        };
        let url = format!("{}/v1/stats/my", self.api_base.trim_end_matches('/'));
        let response = self.client.get(&url).bearer_auth(token).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(StatsError::ApiError {
                status: status.as_u16(),
                body,
            });
        }
        response.json().await.map_err(StatsError::from)
    }

    /// Spawn a background task that periodically syncs. Returns immediately.
    /// The task lives for the process lifetime; cancel by dropping the
    /// `JoinHandle`.
    pub fn spawn_sync_loop(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let me = Arc::clone(self);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(SYNC_DEBOUNCE);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                if let Err(err) = me.sync_now().await {
                    debug!(?err, "deferred stats sync");
                }
            }
        })
    }
}

fn normalize_cumulative(mut stats: CumulativeStats) -> CumulativeStats {
    if stats.tier == 0 {
        stats.tier = 1;
    }
    if stats.tier_progress > 1.0 {
        stats.tier_progress /= 100.0;
    }
    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delta_is_empty_by_default() {
        assert!(StatsDelta::default().is_empty());
    }

    #[test]
    fn delta_applies_events_cumulatively() {
        let mut d = StatsDelta::default();
        d.apply(&StatsEvent::CommitsPushed { count: 3 });
        d.apply(&StatsEvent::TokensConsumed { count: 1000 });
        d.apply(&StatsEvent::WorktreeCreated);
        d.apply(&StatsEvent::SessionCreated);
        d.apply(&StatsEvent::MessageSent);

        assert_eq!(d.commits, 3);
        assert_eq!(d.tokens, 1000);
        assert_eq!(d.worktrees, 1);
        assert_eq!(d.sessions, 1);
        assert_eq!(d.messages, 1);
        assert!(!d.is_empty());
    }

    #[test]
    fn saturating_arithmetic_prevents_overflow() {
        let mut d = StatsDelta {
            tokens: u64::MAX - 10,
            ..StatsDelta::default()
        };
        d.apply(&StatsEvent::TokensConsumed { count: 100 });
        assert_eq!(d.tokens, u64::MAX);
    }
}
