//! Credential management for AI providers
//!
//! Supports multiple credential sources:
//! 1. Solo OAuth tokens (primary)
//! 2. API keys from macOS Keychain
//! 3. Claude Code OAuth (fallback for Anthropic)
//! 4. Codex CLI OAuth (fallback for OpenAI)
//! 5. Environment variables (fallback)

use crate::oauth::{
    AnthropicOAuthConfig, AuthMethodInfo, AuthType, OAuthToken, OpenAIOAuthConfig, OpenAIOAuthToken,
};
use crate::provider::{ProviderError, ProviderResult, ProviderType};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use ts_rs::TS;

/// Client ID used by Claude Code CLI for OAuth token refresh
const CLAUDE_CODE_OAUTH_CLIENT_ID: &str = "claude-desktop";
/// Token endpoint used by Claude Code CLI
const CLAUDE_CODE_TOKEN_ENDPOINT: &str = "https://api.anthropic.com/v1/oauth/token";
/// Treat tokens as expired 5 minutes early to avoid in-flight failures
const EXPIRY_BUFFER_MS: i64 = 300_000;

/// Source of credentials
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "kebab-case")]
pub enum CredentialSource {
    /// Stored in macOS Keychain (API key)
    Keychain,
    /// From environment variable
    Environment,
    /// From Claude Code OAuth (for Anthropic only)
    ClaudeOAuth,
    /// Solo IDE OAuth token
    SoloOAuth,
    /// From Claude Code credentials file (~/.claude/.credentials.json)
    ClaudeOAuthFile,
    /// From Codex CLI credentials file (~/.codex/auth.json)
    CodexOAuthFile,
}

impl std::fmt::Display for CredentialSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CredentialSource::Keychain => write!(f, "keychain"),
            CredentialSource::Environment => write!(f, "environment"),
            CredentialSource::ClaudeOAuth => write!(f, "claude-oauth"),
            CredentialSource::SoloOAuth => write!(f, "solo-oauth"),
            CredentialSource::ClaudeOAuthFile => write!(f, "claude-oauth-file"),
            CredentialSource::CodexOAuthFile => write!(f, "codex-oauth-file"),
        }
    }
}

/// Credential information
#[derive(Debug, Clone)]
pub struct CredentialInfo {
    /// The API key
    pub api_key: String,
    /// Source of the credential
    pub source: CredentialSource,
}

/// Single vault entry in the OS keychain — all Solo credentials stored as one JSON blob.
/// This ensures only ONE keychain ACL prompt on macOS when the binary changes.
const VAULT_SERVICE: &str = "com.solo-ide.credentials";
const VAULT_ACCOUNT: &str = "vault";

/// Reserved vault key for schema version tracking.
/// Allows future migrations to detect and transform older vault formats.
const VAULT_VERSION_KEY: &str = "_version";
/// Current vault schema version.
const VAULT_VERSION: &str = "1";
/// Sentinel key: once set, legacy migration is never attempted again.
const VAULT_MIGRATED_KEY: &str = "_migrated";

// =========================================================================
// Keychain helpers
// =========================================================================
//
// On macOS, shell out to `/usr/bin/security` instead of using the `keyring`
// crate's in-process SecKeychain calls. Keychain ACLs are bound to the code
// signature of the calling binary; `security` is Apple-signed with a stable
// identity, so a single "Always Allow" survives `cargo` rebuilds (each of
// which would otherwise give the Solo binary a fresh signature and re-prompt).
// On other platforms the keyring crate is used directly.

#[cfg(target_os = "macos")]
fn keychain_read(service: &str, account: Option<&str>) -> Result<Option<String>, String> {
    use std::process::Command;
    let mut args: Vec<&str> = vec!["find-generic-password", "-s", service];
    if let Some(a) = account {
        args.push("-a");
        args.push(a);
    }
    args.push("-w");
    let output = Command::new("/usr/bin/security")
        .args(&args)
        .output()
        .map_err(|e| format!("failed to spawn /usr/bin/security: {}", e))?;
    if !output.status.success() {
        // Non-zero exit (commonly 44 = item not found) — treat as absent.
        return Ok(None);
    }
    let s = String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string();
    if s.is_empty() {
        Ok(None)
    } else {
        Ok(Some(s))
    }
}

#[cfg(target_os = "macos")]
#[cfg_attr(test, allow(dead_code))]
fn keychain_write(service: &str, account: &str, value: &str) -> Result<(), String> {
    use std::process::Command;
    let output = Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            service,
            "-a",
            account,
            "-w",
            value,
        ])
        .output()
        .map_err(|e| format!("failed to spawn /usr/bin/security: {}", e))?;
    if !output.status.success() {
        return Err(format!(
            "/usr/bin/security exited with status {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn keychain_read(service: &str, account: Option<&str>) -> Result<Option<String>, String> {
    let account = account.unwrap_or("default");
    match Entry::new(service, account) {
        Ok(entry) => match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        },
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
fn keychain_write(service: &str, account: &str, value: &str) -> Result<(), String> {
    Entry::new(service, account)
        .and_then(|e| e.set_password(value))
        .map_err(|e| e.to_string())
}

/// Legacy keychain entries from the pre-vault era.
/// Each tuple: (old_service, old_account, new_vault_key)
/// Kept for potential future use as a manual migration action in Settings.
#[allow(dead_code)]
const LEGACY_ENTRIES: &[(&str, &str, &str)] = &[
    (
        "solo.provider.anthropic.apiKey",
        "api-key",
        "anthropic.apiKey",
    ),
    ("solo.provider.openai.apiKey", "api-key", "openai.apiKey"),
    ("solo.provider.gemini.apiKey", "api-key", "gemini.apiKey"),
    (
        "solo.provider.anthropic.oauth",
        "oauth-token",
        "anthropic.oauth",
    ),
    ("solo.provider.openai.oauth", "oauth-token", "openai.oauth"),
    (
        "solo.supabase.accessToken",
        "solo-auth",
        "supabase.accessToken",
    ),
    (
        "solo.supabase.refreshToken",
        "solo-auth",
        "supabase.refreshToken",
    ),
];

/// Credential info with OAuth token support
#[derive(Debug, Clone)]
pub struct OAuthCredentialInfo {
    /// The OAuth token
    pub token: OAuthToken,
    /// Source of the credential
    pub source: CredentialSource,
}

/// Credential info with OpenAI OAuth token support
#[derive(Debug, Clone)]
pub struct OpenAIOAuthCredentialInfo {
    /// The OpenAI OAuth token (includes account_id)
    pub token: OpenAIOAuthToken,
    /// Source of the credential
    pub source: CredentialSource,
}

/// Cached Claude Code detailed info: token, expiry_ms, source, raw JSON.
type ClaudeCodeDetailedCache = Option<(String, Option<i64>, CredentialSource, serde_json::Value)>;
/// Lightweight view of one profile for UI display.
///
/// Intentionally does NOT carry tokens — callers only need display fields.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    /// Profile key (e.g. "default", "work").
    pub name: String,
    /// Display label — typically the account email. `""` if unknown.
    pub email: String,
    /// True if this is the active profile for its provider.
    pub is_active: bool,
    /// Seconds until the token expires. `None` if no token stored (shouldn't happen).
    pub expires_in_seconds: Option<u64>,
}

/// Credential manager for storing and retrieving API keys and OAuth tokens.
///
/// All Solo-managed credentials are stored in a single keychain entry ("vault")
/// as a JSON `HashMap<String, String>`. This ensures only one ACL prompt on macOS
/// when the app binary changes.
pub struct CredentialManager {
    /// Cache for API key credentials (to avoid repeated keychain access)
    cache: tokio::sync::RwLock<HashMap<ProviderType, CredentialInfo>>,
    /// Cache for OAuth tokens (generic)
    oauth_cache: tokio::sync::RwLock<HashMap<ProviderType, OAuthCredentialInfo>>,
    /// Cache for OpenAI OAuth tokens (with account_id)
    openai_oauth_cache: tokio::sync::RwLock<Option<OpenAIOAuthCredentialInfo>>,
    /// In-memory cache of the vault (loaded from single keychain entry)
    vault: tokio::sync::RwLock<Option<HashMap<String, String>>>,
    /// Serialize vault initialization — prevents concurrent keychain reads on startup
    vault_init: tokio::sync::Mutex<()>,
    /// Cache for GitHub OAuth token (for git operations, separate from AI provider tokens)
    github_oauth_cache: tokio::sync::RwLock<Option<OAuthToken>>,
    /// Cached Claude Code OAuth access token: None = not yet loaded, Some(None) = no token
    claude_code_cache: tokio::sync::RwLock<Option<Option<String>>>,
    /// Cached Claude Code detailed info: None = not yet loaded
    claude_code_detailed_cache: tokio::sync::RwLock<Option<ClaudeCodeDetailedCache>>,
    /// Serialize Claude Code keychain initialization (same double-checked locking pattern)
    claude_code_init: tokio::sync::Mutex<()>,
}

impl CredentialManager {
    /// Create a new credential manager
    pub fn new() -> Self {
        Self {
            cache: tokio::sync::RwLock::new(HashMap::new()),
            oauth_cache: tokio::sync::RwLock::new(HashMap::new()),
            openai_oauth_cache: tokio::sync::RwLock::new(None),
            vault: tokio::sync::RwLock::new(None),
            vault_init: tokio::sync::Mutex::new(()),
            github_oauth_cache: tokio::sync::RwLock::new(None),
            claude_code_cache: tokio::sync::RwLock::new(None),
            claude_code_detailed_cache: tokio::sync::RwLock::new(None),
            claude_code_init: tokio::sync::Mutex::new(()),
        }
    }

    // =========================================================================
    // Vault Infrastructure
    // =========================================================================

    /// Get the vault key for a provider's API key
    fn api_key_vault_key(provider: ProviderType) -> String {
        format!("{}.apiKey", provider.as_str())
    }

    fn codex_auth_path() -> Option<PathBuf> {
        if let Some(home) = std::env::var_os("CODEX_HOME").map(PathBuf::from) {
            return Some(home.join("auth.json"));
        }

        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join(".codex").join("auth.json"))
    }

    /// Get the vault key for a provider's OAuth token
    fn oauth_vault_key(provider: ProviderType) -> String {
        format!("{}.oauth", provider.as_str())
    }

    /// Vault key for GitHub OAuth token
    fn github_oauth_vault_key() -> &'static str {
        "github.oauth"
    }

    /// Load the vault from the single keychain entry (lazy, called once).
    ///
    /// Reads the vault JSON from the OS keychain and caches it in memory.
    /// Does NOT write back to the keychain — sentinel values (`_version`,
    /// `_migrated`) are stamped in memory only and will be naturally persisted
    /// the next time the user explicitly saves a credential via `vault_set`.
    ///
    /// This ensures only ONE keychain access (read) on startup, avoiding
    /// extra macOS permission prompts during development when each `cargo build`
    /// produces a new binary signature.
    async fn load_vault(&self) -> ProviderResult<()> {
        // Fast path: already loaded (no lock needed)
        if self.vault.read().await.is_some() {
            return Ok(());
        }

        // Serialize initialization — only one caller actually reads from keychain
        let _guard = self.vault_init.lock().await;

        // Double-check after acquiring lock (another caller may have loaded it)
        if self.vault.read().await.is_some() {
            return Ok(());
        }

        let mut data = match keychain_read(VAULT_SERVICE, Some(VAULT_ACCOUNT)) {
            Ok(None) => HashMap::new(),
            Ok(Some(json)) if json.is_empty() => HashMap::new(),
            Ok(Some(json)) => match serde_json::from_str::<HashMap<String, String>>(&json) {
                Ok(map) => map,
                Err(e) => {
                    tracing::error!("Vault JSON corrupted, attempting partial recovery: {}", e);
                    Self::attempt_partial_recovery(&json)
                }
            },
            Err(e) => {
                tracing::warn!("Failed to read vault from keychain: {}", e);
                HashMap::new()
            }
        };

        // Stamp sentinels in memory only (persisted on next vault_set call)
        if !data.contains_key(VAULT_MIGRATED_KEY) {
            data.insert(VAULT_MIGRATED_KEY.to_string(), "1".to_string());
        }
        if !data.contains_key(VAULT_VERSION_KEY) {
            data.insert(VAULT_VERSION_KEY.to_string(), VAULT_VERSION.to_string());
        }

        *self.vault.write().await = Some(data);
        Ok(())
    }

    /// Pre-load the vault from keychain. Call once during app setup
    /// to avoid race conditions from concurrent frontend commands.
    pub async fn pre_warm(&self) -> ProviderResult<()> {
        self.load_vault().await
    }

    /// Persist the vault HashMap to the single keychain entry
    #[cfg_attr(test, allow(dead_code))]
    fn persist_vault(data: &HashMap<String, String>) -> ProviderResult<()> {
        let json = serde_json::to_string(data).map_err(|e| {
            ProviderError::KeychainError(format!("Failed to serialize vault: {}", e))
        })?;

        keychain_write(VAULT_SERVICE, VAULT_ACCOUNT, &json)
            .map_err(|e| ProviderError::KeychainError(format!("Failed to write vault: {}", e)))?;

        Ok(())
    }

    /// Attempt to recover key-value pairs from corrupted vault JSON.
    ///
    /// Tries to parse the raw string as a `serde_json::Value` and walks any
    /// top-level object, extracting keys whose values are strings. This can
    /// salvage credentials when the JSON is partially valid (e.g., truncated).
    fn attempt_partial_recovery(json: &str) -> HashMap<String, String> {
        match serde_json::from_str::<serde_json::Value>(json) {
            Ok(serde_json::Value::Object(map)) => {
                let mut recovered = HashMap::new();
                for (k, v) in map {
                    if let serde_json::Value::String(s) = v {
                        recovered.insert(k, s);
                    }
                }
                if recovered.is_empty() {
                    tracing::error!("Vault JSON parsed as object but contained no string values");
                } else {
                    tracing::warn!(
                        "Partially recovered {} key(s) from corrupted vault",
                        recovered.len()
                    );
                }
                recovered
            }
            _ => {
                tracing::error!(
                    "Vault JSON is unrecoverably corrupted — starting with empty vault"
                );
                HashMap::new()
            }
        }
    }

    /// Migrate credentials from legacy per-key keychain entries into the vault.
    ///
    /// NOT called automatically on startup (to avoid keychain prompts).
    /// Kept for potential future use as a manual migration action in Settings.
    ///
    /// For each legacy entry:
    /// 1. Reads from the old service/account keychain entry
    /// 2. If the vault doesn't already have that key, copies the value in
    /// 3. Deletes the old keychain entry to avoid stale duplicates
    ///
    /// **Fail-fast:** If any entry returns a permission/platform error (not
    /// `NoEntry`), we stop immediately to avoid spamming the user with macOS
    /// keychain permission dialogs.
    #[allow(dead_code)]
    fn migrate_legacy_entries(vault: &mut HashMap<String, String>) {
        let mut migrated = 0u32;

        for &(old_service, old_account, new_key) in LEGACY_ENTRIES {
            // Don't overwrite newer vault data
            if vault.contains_key(new_key) {
                continue;
            }

            let entry = match Entry::new(old_service, old_account) {
                Ok(e) => e,
                Err(_) => continue,
            };

            match entry.get_password() {
                Ok(v) if !v.is_empty() => {
                    vault.insert(new_key.to_string(), v);
                    migrated += 1;

                    // Best-effort cleanup of the old entry
                    if let Err(e) = entry.delete_credential() {
                        tracing::debug!(
                            "Could not delete legacy entry {}/{}: {}",
                            old_service,
                            old_account,
                            e
                        );
                    }
                }
                Ok(_) => {}                        // empty value — skip
                Err(keyring::Error::NoEntry) => {} // doesn't exist — skip
                Err(e) => {
                    // Permission denied or platform error — stop immediately
                    // to avoid a cascade of macOS keychain dialogs
                    tracing::debug!(
                        "Stopping legacy migration at {}/{}: {}",
                        old_service,
                        old_account,
                        e
                    );
                    break;
                }
            }
        }

        if migrated > 0 {
            tracing::info!(
                "Migrated {} credential(s) from legacy keychain entries into vault",
                migrated
            );
        }
    }

    /// Get a value from the vault
    async fn vault_get(&self, key: &str) -> ProviderResult<Option<String>> {
        self.load_vault().await?;
        let guard = self.vault.read().await;
        Ok(guard.as_ref().and_then(|v| v.get(key).cloned()))
    }

    /// Set a value in the vault (updates in-memory + persists).
    ///
    /// Rolls back the in-memory state if the keychain write fails, so the
    /// cache never claims a credential is saved when it isn't persisted.
    async fn vault_set(&self, key: &str, value: &str) -> ProviderResult<()> {
        self.load_vault().await?;
        let mut guard = self.vault.write().await;
        let vault = guard.get_or_insert_with(HashMap::new);
        let old_value = vault.insert(key.to_string(), value.to_string());
        #[cfg(not(test))]
        if let Err(e) = Self::persist_vault(vault) {
            // Rollback in-memory state
            match old_value {
                Some(v) => {
                    vault.insert(key.to_string(), v);
                }
                None => {
                    vault.remove(key);
                }
            }
            return Err(e);
        }
        #[cfg(test)]
        let _ = old_value; // suppress unused warning; keychain writes skipped in tests
        Ok(())
    }

    /// Delete a value from the vault (removes from in-memory + persists).
    ///
    /// Rolls back the in-memory state if the keychain write fails.
    async fn vault_delete(&self, key: &str) -> ProviderResult<()> {
        self.load_vault().await?;
        let mut guard = self.vault.write().await;
        if let Some(vault) = guard.as_mut() {
            let old_value = vault.remove(key);
            #[cfg(not(test))]
            if let Err(e) = Self::persist_vault(vault) {
                // Rollback: re-insert the removed value
                if let Some(v) = old_value {
                    vault.insert(key.to_string(), v);
                }
                return Err(e);
            }
            #[cfg(test)]
            let _ = old_value; // suppress unused warning; keychain writes skipped in tests
        }
        Ok(())
    }

    /// Get a raw value from the vault (for non-provider credentials like Supabase)
    pub async fn vault_get_raw(&self, key: &str) -> ProviderResult<Option<String>> {
        self.vault_get(key).await
    }

    /// Set a raw value in the vault (for non-provider credentials like Supabase)
    pub async fn vault_set_raw(&self, key: &str, value: &str) -> ProviderResult<()> {
        self.vault_set(key, value).await
    }

    /// Delete a raw value from the vault (for non-provider credentials like Supabase)
    pub async fn vault_delete_raw(&self, key: &str) -> ProviderResult<()> {
        self.vault_delete(key).await
    }

    /// Get credentials for a provider, checking multiple sources
    pub async fn get_credentials(&self, provider: ProviderType) -> ProviderResult<Option<String>> {
        // Check cache first
        if let Some(info) = self.cache.read().await.get(&provider) {
            return Ok(Some(info.api_key.clone()));
        }

        // Try sources in order
        let credential_info = self.get_credentials_with_source(provider).await?;

        if let Some(ref info) = credential_info {
            // Cache the result
            self.cache.write().await.insert(provider, info.clone());
        }

        Ok(credential_info.map(|i| i.api_key))
    }

    /// Get credentials with source information
    ///
    /// Priority order:
    /// 1. Solo OAuth token (if valid) - includes OpenAI OAuth for OpenAI provider
    /// 2. API key from Keychain
    /// 3. Claude Code OAuth (Anthropic only)
    /// 4. Environment variable
    pub async fn get_credentials_with_source(
        &self,
        provider: ProviderType,
    ) -> ProviderResult<Option<CredentialInfo>> {
        // 1. Try Solo OAuth token first
        // For OpenAI, use the specialized OpenAI OAuth token
        if provider == ProviderType::OpenAI {
            if let Some(token) = self.get_openai_oauth_token().await? {
                // Check if token needs refresh
                if token.needs_refresh() && token.can_refresh() {
                    if let Ok(new_token) = self.refresh_openai_oauth_token().await {
                        return Ok(Some(CredentialInfo {
                            api_key: new_token.access_token,
                            source: CredentialSource::SoloOAuth,
                        }));
                    }
                }

                if !token.is_expired() {
                    return Ok(Some(CredentialInfo {
                        api_key: token.access_token,
                        source: CredentialSource::SoloOAuth,
                    }));
                }
            }
        } else if let Some(token) = self.get_oauth_token(provider).await? {
            // Check if token needs refresh
            if token.needs_refresh() && token.can_refresh() {
                if let Ok(new_token) = self.refresh_oauth_token(provider).await {
                    return Ok(Some(CredentialInfo {
                        api_key: new_token.access_token,
                        source: CredentialSource::SoloOAuth,
                    }));
                }
            }

            if !token.is_expired() {
                return Ok(Some(CredentialInfo {
                    api_key: token.access_token,
                    source: CredentialSource::SoloOAuth,
                }));
            }
        }

        // 2. Try API key from Keychain
        if let Some(key) = self.get_from_keychain(provider).await? {
            return Ok(Some(CredentialInfo {
                api_key: key,
                source: CredentialSource::Keychain,
            }));
        }

        // 3. For OpenAI, try the existing Codex CLI ChatGPT login.
        if provider == ProviderType::OpenAI {
            if let Some(token) = self.get_codex_oauth_from_file().await? {
                return Ok(Some(CredentialInfo {
                    api_key: token.access_token,
                    source: CredentialSource::CodexOAuthFile,
                }));
            }
        }

        // 4. For Anthropic, try Claude Code OAuth (file first, keychain fallback)
        if provider == ProviderType::Anthropic {
            // Primary: ~/.claude/.credentials.json — always complete, no size limits
            if let Some(key) = self.get_claude_oauth_from_file().await? {
                return Ok(Some(CredentialInfo {
                    api_key: key,
                    source: CredentialSource::ClaudeOAuthFile,
                }));
            }
            // Fallback: keychain via keyring crate
            if let Some(key) = self.get_claude_oauth().await? {
                return Ok(Some(CredentialInfo {
                    api_key: key,
                    source: CredentialSource::ClaudeOAuth,
                }));
            }
        }

        // 5. Try environment variable
        if let Some(key) = self.get_from_env(provider) {
            return Ok(Some(CredentialInfo {
                api_key: key,
                source: CredentialSource::Environment,
            }));
        }

        Ok(None)
    }

    /// Get credential source without exposing the key
    pub async fn get_credential_source(
        &self,
        provider: ProviderType,
    ) -> ProviderResult<Option<CredentialSource>> {
        // Check cache
        if let Some(info) = self.cache.read().await.get(&provider) {
            return Ok(Some(info.source));
        }

        // Get fresh
        Ok(self
            .get_credentials_with_source(provider)
            .await?
            .map(|i| i.source))
    }

    /// Get API key from the vault
    async fn get_from_keychain(&self, provider: ProviderType) -> ProviderResult<Option<String>> {
        let key = Self::api_key_vault_key(provider);
        match self.vault_get(&key).await {
            Ok(Some(v)) if v.is_empty() => Ok(None),
            other => other,
        }
    }

    /// Parse `expiresAt` from Claude Code credential JSON.
    /// The value may be a JSON number or a string containing digits.
    fn parse_expires_at(oauth_obj: &serde_json::Value) -> Option<i64> {
        oauth_obj.get("expiresAt").and_then(|exp| {
            exp.as_i64()
                .or_else(|| exp.as_str().and_then(|s| s.parse::<i64>().ok()))
        })
    }

    /// Check whether a Claude Code token is expired (with 5-minute buffer).
    fn is_claude_token_expired(expires_at: i64) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        expires_at <= now + EXPIRY_BUFFER_MS
    }

    /// Refresh a Claude Code CLI OAuth token using its refresh_token.
    ///
    /// POSTs to the Anthropic token endpoint with `client_id=claude-desktop`.
    /// Returns the new access token on success, `None` on any failure.
    /// Does NOT update the keychain — the CLI manages its own entries.
    async fn refresh_claude_code_token(refresh_token: &str) -> Option<String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .ok()?;

        let params = [
            ("grant_type", "refresh_token"),
            ("client_id", CLAUDE_CODE_OAUTH_CLIENT_ID),
            ("refresh_token", refresh_token),
        ];

        let resp = client
            .post(CLAUDE_CODE_TOKEN_ENDPOINT)
            .form(&params)
            .send()
            .await
            .ok()?;

        if !resp.status().is_success() {
            tracing::warn!(
                "Claude Code token refresh failed with status {}",
                resp.status()
            );
            return None;
        }

        let body: serde_json::Value = resp.json().await.ok()?;
        body.get("access_token")
            .and_then(|t| t.as_str())
            .map(|s| s.to_string())
    }

    /// Get Claude Code OAuth token from Keychain
    ///
    /// Claude Code CLI stores credentials in the keychain with service name
    /// "Claude Code-credentials" as a JSON object containing OAuth tokens.
    async fn get_claude_oauth(&self) -> ProviderResult<Option<String>> {
        // Fast path: return cached result
        if let Some(cached) = self.claude_code_cache.read().await.as_ref() {
            return Ok(cached.clone());
        }

        // Serialize initialization
        let _guard = self.claude_code_init.lock().await;

        // Double-check after acquiring lock
        if let Some(cached) = self.claude_code_cache.read().await.as_ref() {
            return Ok(cached.clone());
        }

        let result = self.read_claude_oauth_from_keychain().await?;
        *self.claude_code_cache.write().await = Some(result.clone());
        Ok(result)
    }

    /// Internal: read Claude Code OAuth token directly from keychain (no caching)
    async fn read_claude_oauth_from_keychain(&self) -> ProviderResult<Option<String>> {
        let json_str = match keychain_read("Claude Code-credentials", None) {
            Ok(Some(s)) => s,
            Ok(None) => return Ok(None),
            Err(e) => {
                tracing::warn!("Failed to read Claude OAuth from keychain: {}", e);
                return Ok(None);
            }
        };

        if json_str.is_empty() {
            return Ok(None);
        }

        // Parse the JSON to extract the access token
        // Format: {"claudeAiOauth":{"accessToken":"...", "expiresAt":..., "refreshToken":"...", ...}}
        match serde_json::from_str::<serde_json::Value>(&json_str) {
            Ok(value) => {
                let oauth_obj = match value.get("claudeAiOauth") {
                    Some(obj) => obj,
                    None => {
                        tracing::debug!("Claude Code credentials found but no claudeAiOauth");
                        return Ok(None);
                    }
                };

                let access_token = match oauth_obj.get("accessToken").and_then(|t| t.as_str()) {
                    Some(t) => t.to_string(),
                    None => {
                        tracing::debug!("Claude Code credentials found but no accessToken");
                        return Ok(None);
                    }
                };

                // Check if token is expired (with 5-min buffer)
                if let Some(expires_at) = Self::parse_expires_at(oauth_obj) {
                    if Self::is_claude_token_expired(expires_at) {
                        tracing::debug!("Claude Code OAuth token expired, attempting refresh");

                        // Try to refresh using the refresh token
                        if let Some(refresh_token) =
                            oauth_obj.get("refreshToken").and_then(|t| t.as_str())
                        {
                            if let Some(new_token) =
                                Self::refresh_claude_code_token(refresh_token).await
                            {
                                tracing::info!("Successfully refreshed Claude Code OAuth token");
                                return Ok(Some(new_token));
                            }
                            tracing::warn!("Failed to refresh Claude Code OAuth token");
                        } else {
                            tracing::debug!("No refreshToken in Claude Code credentials");
                        }

                        return Ok(None);
                    }
                }

                Ok(Some(access_token))
            }
            Err(e) => {
                tracing::warn!("Failed to parse Claude Code credentials JSON: {}", e);
                Ok(None)
            }
        }
    }

    /// Read Claude Code credentials from ~/.claude/.credentials.json
    ///
    /// This is a fallback when keychain access fails. Claude Code may write
    /// credentials here as an alternative storage mechanism.
    async fn get_claude_oauth_from_file(&self) -> ProviderResult<Option<String>> {
        let home = std::env::var("HOME").unwrap_or_default();
        if home.is_empty() {
            return Ok(None);
        }
        let path = std::path::PathBuf::from(&home)
            .join(".claude")
            .join(".credentials.json");

        let content = match std::fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };

        match serde_json::from_str::<serde_json::Value>(&content) {
            Ok(value) => {
                let oauth_obj = match value.get("claudeAiOauth") {
                    Some(obj) => obj,
                    None => return Ok(None),
                };

                let access_token = match oauth_obj.get("accessToken").and_then(|t| t.as_str()) {
                    Some(t) => t.to_string(),
                    None => return Ok(None),
                };

                // Check if token is expired (with 5-min buffer)
                if let Some(expires_at) = Self::parse_expires_at(oauth_obj) {
                    if Self::is_claude_token_expired(expires_at) {
                        tracing::debug!("Claude Code file OAuth token expired, attempting refresh");

                        if let Some(refresh_token) =
                            oauth_obj.get("refreshToken").and_then(|t| t.as_str())
                        {
                            if let Some(new_token) =
                                Self::refresh_claude_code_token(refresh_token).await
                            {
                                tracing::info!(
                                    "Successfully refreshed Claude Code file OAuth token"
                                );
                                return Ok(Some(new_token));
                            }
                            tracing::warn!("Failed to refresh Claude Code file OAuth token");
                        } else {
                            tracing::debug!("No refreshToken in Claude Code file credentials");
                        }

                        return Ok(None);
                    }
                }

                Ok(Some(access_token))
            }
            Err(e) => {
                tracing::warn!("Failed to parse ~/.claude/.credentials.json: {}", e);
                Ok(None)
            }
        }
    }

    /// Get detailed Claude OAuth credential info (token + expiry + source).
    ///
    /// Used by `verify_claude_setup` to return structured status.
    /// Returns (access_token, expires_at_ms, source, raw_oauth_json).
    pub async fn get_claude_oauth_detailed(
        &self,
    ) -> ProviderResult<Option<(String, Option<i64>, CredentialSource, serde_json::Value)>> {
        // Fast path: return cached result
        if let Some(cached) = self.claude_code_detailed_cache.read().await.as_ref() {
            return Ok(cached.clone());
        }

        // Serialize initialization (shares mutex with get_claude_oauth)
        let _guard = self.claude_code_init.lock().await;

        // Double-check after acquiring lock
        if let Some(cached) = self.claude_code_detailed_cache.read().await.as_ref() {
            return Ok(cached.clone());
        }

        let result = self.read_claude_oauth_detailed_inner().await?;
        *self.claude_code_detailed_cache.write().await = Some(result.clone());
        Ok(result)
    }

    /// Internal: read detailed Claude Code OAuth info directly from file/keychain (no caching)
    async fn read_claude_oauth_detailed_inner(
        &self,
    ) -> ProviderResult<Option<(String, Option<i64>, CredentialSource, serde_json::Value)>> {
        // Primary: ~/.claude/.credentials.json — always complete, no size limits
        let home = std::env::var("HOME").unwrap_or_default();
        if !home.is_empty() {
            let path = std::path::PathBuf::from(&home)
                .join(".claude")
                .join(".credentials.json");

            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(oauth_obj) = value.get("claudeAiOauth") {
                        if let Some(access_token) =
                            oauth_obj.get("accessToken").and_then(|t| t.as_str())
                        {
                            let expires_at = Self::parse_expires_at(oauth_obj);

                            let final_token = if let Some(exp) = expires_at {
                                if Self::is_claude_token_expired(exp) {
                                    if let Some(refresh_token) =
                                        oauth_obj.get("refreshToken").and_then(|t| t.as_str())
                                    {
                                        if let Some(new_token) =
                                            Self::refresh_claude_code_token(refresh_token).await
                                        {
                                            tracing::info!("Refreshed Claude Code file token in detailed check");
                                            new_token
                                        } else {
                                            access_token.to_string()
                                        }
                                    } else {
                                        access_token.to_string()
                                    }
                                } else {
                                    access_token.to_string()
                                }
                            } else {
                                access_token.to_string()
                            };

                            return Ok(Some((
                                final_token,
                                expires_at,
                                CredentialSource::ClaudeOAuthFile,
                                oauth_obj.clone(),
                            )));
                        }
                    }
                }
            }
        }

        // Fallback: keychain (via /usr/bin/security on macOS, keyring elsewhere)
        if let Ok(Some(json_str)) = keychain_read("Claude Code-credentials", None) {
            if !json_str.is_empty() {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json_str) {
                    if let Some(oauth_obj) = value.get("claudeAiOauth") {
                        if let Some(access_token) =
                            oauth_obj.get("accessToken").and_then(|t| t.as_str())
                        {
                            let expires_at = Self::parse_expires_at(oauth_obj);

                            // If expired, try to refresh and return the new token
                            let final_token = if let Some(exp) = expires_at {
                                if Self::is_claude_token_expired(exp) {
                                    if let Some(refresh_token) =
                                        oauth_obj.get("refreshToken").and_then(|t| t.as_str())
                                    {
                                        if let Some(new_token) =
                                            Self::refresh_claude_code_token(refresh_token).await
                                        {
                                            tracing::info!(
                                                "Refreshed Claude Code token in detailed check"
                                            );
                                            new_token
                                        } else {
                                            access_token.to_string()
                                        }
                                    } else {
                                        access_token.to_string()
                                    }
                                } else {
                                    access_token.to_string()
                                }
                            } else {
                                access_token.to_string()
                            };

                            return Ok(Some((
                                final_token,
                                expires_at,
                                CredentialSource::ClaudeOAuth,
                                oauth_obj.clone(),
                            )));
                        }
                    }
                }
            }
        }

        Ok(None)
    }

    /// Get credentials from environment variable
    fn get_from_env(&self, provider: ProviderType) -> Option<String> {
        std::env::var(provider.env_var_name()).ok()
    }

    /// Store credentials in the vault
    pub async fn set_credentials(
        &self,
        provider: ProviderType,
        api_key: &str,
    ) -> ProviderResult<()> {
        let key = Self::api_key_vault_key(provider);
        self.vault_set(&key, api_key).await?;

        // Update cache
        self.cache.write().await.insert(
            provider,
            CredentialInfo {
                api_key: api_key.to_string(),
                source: CredentialSource::Keychain,
            },
        );

        Ok(())
    }

    /// Remove credentials from the vault
    pub async fn clear_credentials(&self, provider: ProviderType) -> ProviderResult<()> {
        let key = Self::api_key_vault_key(provider);
        self.vault_delete(&key).await?;

        // Remove from cache
        self.cache.write().await.remove(&provider);

        Ok(())
    }

    /// Check if credentials exist for a provider
    pub async fn has_credentials(&self, provider: ProviderType) -> bool {
        self.get_credentials(provider)
            .await
            .map(|c| c.is_some())
            .unwrap_or(false)
    }

    /// Clear all in-memory caches (forces re-read from keychain on next access)
    pub async fn clear_cache(&self) {
        self.cache.write().await.clear();
        self.oauth_cache.write().await.clear();
        *self.openai_oauth_cache.write().await = None;
        *self.vault.write().await = None;
        *self.github_oauth_cache.write().await = None;
        *self.claude_code_cache.write().await = None;
        *self.claude_code_detailed_cache.write().await = None;
    }

    // =========================================================================
    // OAuth Token Management
    // =========================================================================

    /// Store an OAuth token in the vault
    pub async fn set_oauth_token(
        &self,
        provider: ProviderType,
        token: OAuthToken,
    ) -> ProviderResult<()> {
        let key = Self::oauth_vault_key(provider);

        // Load-or-create the store, migrating from legacy shape if present.
        let mut store = match self.vault_get(&key).await? {
            Some(s) if !s.is_empty() => {
                crate::oauth::profiles::migrate_legacy_blob(&s, provider.as_str())
                    .unwrap_or_else(|e| {
                        tracing::warn!(
                            "failed to parse existing OAuth store for {}: {} — starting fresh, existing profiles will be discarded",
                            provider.as_str(),
                            e
                        );
                        crate::oauth::profiles::ProviderOAuthStore::empty()
                    })
            }
            _ => crate::oauth::profiles::ProviderOAuthStore::empty(),
        };

        // Pick active profile name — "default" if the store is empty.
        let active_name = store
            .active_profile
            .clone()
            .unwrap_or_else(|| "default".to_string());
        let existing = store.get(&active_name).cloned();

        let profile = crate::oauth::profiles::OAuthProfile {
            access_token: token.access_token.clone(),
            refresh_token: token.refresh_token.clone().unwrap_or_default(),
            id_token: existing.as_ref().and_then(|e| e.id_token.clone()),
            expires_at: i64::try_from(token.expires_at).unwrap_or(i64::MAX),
            last_refresh: existing.as_ref().map(|e| e.last_refresh).unwrap_or(0),
            email: existing
                .as_ref()
                .map(|e| e.email.clone())
                .unwrap_or_default(),
            account_id: existing.as_ref().and_then(|e| e.account_id.clone()),
            plan_type: existing.as_ref().and_then(|e| e.plan_type.clone()),
        };
        store.upsert_profile(active_name, profile);

        let json = serde_json::to_string(&store).map_err(|e| {
            ProviderError::AuthError(format!("Failed to serialize OAuth store: {}", e))
        })?;
        self.vault_set(&key, &json).await?;

        // Cache the same shape get_oauth_token would return on a cold miss,
        // so warm and cold paths are indistinguishable.
        let cached_token = match store.active() {
            Some(p) => OAuthToken {
                access_token: p.access_token.clone(),
                refresh_token: if p.refresh_token.is_empty() {
                    None
                } else {
                    Some(p.refresh_token.clone())
                },
                expires_at: u64::try_from(p.expires_at.max(0)).unwrap_or(0),
                token_type: "Bearer".into(),
                scope: None,
            },
            None => token, // shouldn't happen — we just upserted
        };

        self.oauth_cache.write().await.insert(
            provider,
            OAuthCredentialInfo {
                token: cached_token,
                source: CredentialSource::SoloOAuth,
            },
        );

        // Clear API-key cache so OAuth takes priority (preserved behavior).
        self.cache.write().await.remove(&provider);

        tracing::info!("Stored OAuth token for {}", provider.as_str());
        Ok(())
    }

    /// Get OAuth token for a provider
    pub async fn get_oauth_token(
        &self,
        provider: ProviderType,
    ) -> ProviderResult<Option<OAuthToken>> {
        // Cache hit fast path — unchanged behavior.
        if let Some(info) = self.oauth_cache.read().await.get(&provider) {
            return Ok(Some(info.token.clone()));
        }

        let key = Self::oauth_vault_key(provider);
        let raw = match self.vault_get(&key).await? {
            Some(s) if !s.is_empty() => s,
            _ => return Ok(None),
        };

        // Parse — migrating from legacy shape if needed.
        let needs_migration = !crate::oauth::profiles::is_already_migrated(&raw);
        let store = match crate::oauth::profiles::migrate_legacy_blob(&raw, provider.as_str()) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(
                    "failed to parse OAuth store for {}: {} — treating as absent",
                    provider.as_str(),
                    e
                );
                return Ok(None);
            }
        };

        // If we just migrated, persist the new shape so subsequent reads are fast.
        if needs_migration {
            match serde_json::to_string(&store) {
                Ok(new_json) => {
                    if let Err(e) = self.vault_set(&key, &new_json).await {
                        tracing::warn!("failed to persist migrated OAuth store: {}", e);
                    }
                }
                Err(e) => tracing::warn!("failed to serialize migrated OAuth store: {}", e),
            }
        }

        self.cache.write().await.remove(&provider);

        let active = match store.active() {
            Some(p) => p,
            None => return Ok(None),
        };

        // Project the active profile into the legacy OAuthToken shape that
        // existing callers expect. Refresh-token empty-string → None.
        let expires_at = u64::try_from(active.expires_at.max(0)).unwrap_or(0);
        let token = OAuthToken {
            access_token: active.access_token.clone(),
            refresh_token: if active.refresh_token.is_empty() {
                None
            } else {
                Some(active.refresh_token.clone())
            },
            expires_at,
            token_type: "Bearer".into(),
            scope: None,
        };

        // Populate cache.
        self.oauth_cache.write().await.insert(
            provider,
            OAuthCredentialInfo {
                token: token.clone(),
                source: CredentialSource::SoloOAuth,
            },
        );

        Ok(Some(token))
    }

    /// Check if we have an OAuth token for a provider
    pub async fn has_oauth_token(&self, provider: ProviderType) -> bool {
        if let Ok(Some(token)) = self.get_oauth_token(provider).await {
            !token.is_expired()
        } else {
            false
        }
    }

    /// Refresh an OAuth token (for non-OpenAI providers)
    pub async fn refresh_oauth_token(&self, provider: ProviderType) -> ProviderResult<OAuthToken> {
        if provider == ProviderType::OpenAI {
            // Use specialized OpenAI method
            let openai_token = self.refresh_openai_oauth_token().await?;
            return Ok(openai_token.to_oauth_token());
        }

        let current_token = self
            .get_oauth_token(provider)
            .await?
            .ok_or_else(|| ProviderError::AuthError("No OAuth token to refresh".to_string()))?;

        let refresh_token = current_token
            .refresh_token
            .ok_or_else(|| ProviderError::AuthError("No refresh token available".to_string()))?;

        let new_token = match provider {
            ProviderType::Anthropic => AnthropicOAuthConfig::refresh_token(&refresh_token).await?,
            ProviderType::OpenAI | ProviderType::Gemini => unreachable!(), // Handled above or no OAuth
        };

        // Store the new token
        self.set_oauth_token(provider, new_token.clone()).await?;

        tracing::info!("Refreshed OAuth token for {}", provider.as_str());

        Ok(new_token)
    }

    // =========================================================================
    // OpenAI OAuth Token Management
    // =========================================================================

    /// Store an OpenAI OAuth token in the vault
    pub async fn set_openai_oauth_token(&self, token: OpenAIOAuthToken) -> ProviderResult<()> {
        let key = Self::oauth_vault_key(ProviderType::OpenAI);

        let mut store = match self.vault_get(&key).await? {
            Some(s) if !s.is_empty() => {
                crate::oauth::profiles::migrate_legacy_blob(&s, "openai").unwrap_or_else(|e| {
                    tracing::warn!(
                        "failed to parse existing OpenAI OAuth store: {} — starting fresh, existing profiles will be discarded",
                        e
                    );
                    crate::oauth::profiles::ProviderOAuthStore::empty()
                })
            }
            _ => crate::oauth::profiles::ProviderOAuthStore::empty(),
        };

        let active_name = store
            .active_profile
            .clone()
            .unwrap_or_else(|| "default".to_string());
        let existing = store.get(&active_name).cloned();

        // Identity fields: prefer the *new* token's values if present, else fall
        // back to what was already on the profile.
        let id_token = token
            .id_token
            .clone()
            .or_else(|| existing.as_ref().and_then(|e| e.id_token.clone()));
        let account_id = token
            .account_id
            .clone()
            .or_else(|| existing.as_ref().and_then(|e| e.account_id.clone()));

        let profile = crate::oauth::profiles::OAuthProfile {
            access_token: token.access_token.clone(),
            refresh_token: token.refresh_token.clone().unwrap_or_default(),
            id_token,
            expires_at: i64::try_from(token.expires_at).unwrap_or(i64::MAX),
            last_refresh: existing.as_ref().map(|e| e.last_refresh).unwrap_or(0),
            // Prefer the email from the newly-issued token; fall back to whatever
            // was already on the profile (preserves identity through refresh
            // cycles that don't re-issue an id_token); fall back to "" as last resort.
            email: token.email.clone().unwrap_or_else(|| {
                existing
                    .as_ref()
                    .map(|e| e.email.clone())
                    .unwrap_or_default()
            }),
            account_id,
            plan_type: existing.as_ref().and_then(|e| e.plan_type.clone()),
        };
        store.upsert_profile(active_name, profile);

        let json = serde_json::to_string(&store).map_err(|e| {
            ProviderError::AuthError(format!("Failed to serialize OpenAI OAuth store: {}", e))
        })?;
        self.vault_set(&key, &json).await?;

        // Cache the same projected shape get_openai_oauth_token returns on a cold miss.
        let cached_token = match store.active() {
            Some(p) => OpenAIOAuthToken {
                access_token: p.access_token.clone(),
                refresh_token: if p.refresh_token.is_empty() {
                    None
                } else {
                    Some(p.refresh_token.clone())
                },
                expires_at: u64::try_from(p.expires_at.max(0)).unwrap_or(0),
                token_type: "Bearer".into(),
                scope: None,
                id_token: p.id_token.clone(),
                account_id: p.account_id.clone(),
                email: if p.email.is_empty() {
                    None
                } else {
                    Some(p.email.clone())
                },
            },
            None => token, // shouldn't happen — we just upserted
        };

        *self.openai_oauth_cache.write().await = Some(OpenAIOAuthCredentialInfo {
            token: cached_token,
            source: CredentialSource::SoloOAuth,
        });

        // Clear API-key cache so OAuth takes priority.
        self.cache.write().await.remove(&ProviderType::OpenAI);

        tracing::info!("Stored OpenAI OAuth token");
        Ok(())
    }

    /// Get OpenAI OAuth token
    pub async fn get_openai_oauth_token(&self) -> ProviderResult<Option<OpenAIOAuthToken>> {
        // Cache hit fast path.
        if let Some(info) = self.openai_oauth_cache.read().await.as_ref() {
            return Ok(Some(info.token.clone()));
        }

        let key = Self::oauth_vault_key(ProviderType::OpenAI);
        let raw = match self.vault_get(&key).await? {
            Some(s) if !s.is_empty() => s,
            _ => return Ok(None),
        };

        let needs_migration = !crate::oauth::profiles::is_already_migrated(&raw);
        let store = match crate::oauth::profiles::migrate_legacy_blob(&raw, "openai") {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(
                    "failed to parse OpenAI OAuth store: {} — treating as absent",
                    e
                );
                return Ok(None);
            }
        };

        // Persist the migrated shape so the next read skips migration.
        if needs_migration {
            match serde_json::to_string(&store) {
                Ok(new_json) => {
                    if let Err(e) = self.vault_set(&key, &new_json).await {
                        tracing::warn!("failed to persist migrated OpenAI OAuth store: {}", e);
                    }
                }
                Err(e) => tracing::warn!("failed to serialize migrated OpenAI OAuth store: {}", e),
            }
        }

        // Clear API-key cache for OpenAI so OAuth takes priority (matches
        // set_openai_oauth_token's behavior; mirrors get_oauth_token for Anthropic).
        self.cache.write().await.remove(&ProviderType::OpenAI);

        let active = match store.active() {
            Some(p) => p,
            None => return Ok(None),
        };

        let expires_at = u64::try_from(active.expires_at.max(0)).unwrap_or(0);
        let token = OpenAIOAuthToken {
            access_token: active.access_token.clone(),
            refresh_token: if active.refresh_token.is_empty() {
                None
            } else {
                Some(active.refresh_token.clone())
            },
            expires_at,
            token_type: "Bearer".into(),
            scope: None,
            id_token: active.id_token.clone(),
            account_id: active.account_id.clone(),
            email: if active.email.is_empty() {
                None
            } else {
                Some(active.email.clone())
            },
        };

        *self.openai_oauth_cache.write().await = Some(OpenAIOAuthCredentialInfo {
            token: token.clone(),
            source: CredentialSource::SoloOAuth,
        });

        Ok(Some(token))
    }

    /// Check if we have an OpenAI OAuth token
    pub async fn has_openai_oauth_token(&self) -> bool {
        if let Ok(Some(token)) = self.get_openai_oauth_token().await {
            !token.is_expired()
        } else {
            false
        }
    }

    /// Read the Codex CLI ChatGPT OAuth cache.
    ///
    /// This is intentionally read-only. Codex owns refreshing and rotating this
    /// file; Solo only treats it as an external credential source, mirroring the
    /// way Claude Code credentials are consumed for Anthropic.
    pub async fn get_codex_oauth_from_file(&self) -> ProviderResult<Option<OpenAIOAuthToken>> {
        let Some(path) = Self::codex_auth_path() else {
            return Ok(None);
        };

        let raw = match tokio::fs::read_to_string(&path).await {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(ProviderError::IoError(e)),
        };

        let json: serde_json::Value = serde_json::from_str(&raw)?;
        let auth_mode = json
            .get("auth_mode")
            .and_then(|value| value.as_str())
            .unwrap_or_default();

        if auth_mode != "chatgpt" {
            return Ok(None);
        }

        let Some(tokens) = json.get("tokens") else {
            return Ok(None);
        };

        let Some(access_token) = tokens
            .get("access_token")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
        else {
            return Ok(None);
        };

        let refresh_token = tokens
            .get("refresh_token")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let id_token = tokens
            .get("id_token")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        let account_id = tokens
            .get("account_id")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);

        // Codex's auth cache does not currently expose an access-token expiry.
        // Keep the value far enough in the future that UI status does not mark
        // it as expired; failed live checks still surface stale-token problems.
        let expires_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::ZERO)
            .as_secs()
            + 24 * 60 * 60;

        Ok(Some(OpenAIOAuthToken {
            access_token,
            refresh_token,
            expires_at,
            token_type: "Bearer".into(),
            scope: None,
            id_token,
            account_id,
            email: None,
        }))
    }

    /// Refresh an OpenAI OAuth token
    pub async fn refresh_openai_oauth_token(&self) -> ProviderResult<OpenAIOAuthToken> {
        let current_token = self.get_openai_oauth_token().await?.ok_or_else(|| {
            ProviderError::AuthError("No OpenAI OAuth token to refresh".to_string())
        })?;

        let refresh_token = current_token
            .refresh_token
            .ok_or_else(|| ProviderError::AuthError("No refresh token available".to_string()))?;

        let mut new_token = OpenAIOAuthConfig::refresh_token(&refresh_token).await?;

        // Preserve the account_id from the old token if the new one doesn't have it
        if new_token.account_id.is_none() {
            new_token.account_id = current_token.account_id;
        }

        // Store the new token
        self.set_openai_oauth_token(new_token.clone()).await?;

        tracing::info!("Refreshed OpenAI OAuth token");

        Ok(new_token)
    }

    /// Get the ChatGPT account ID for API calls
    pub async fn get_openai_account_id(&self) -> ProviderResult<Option<String>> {
        if let Some(token) = self.get_openai_oauth_token().await? {
            return Ok(token.account_id);
        }
        if let Some(token) = self.get_codex_oauth_from_file().await? {
            return Ok(token.account_id);
        }
        Ok(None)
    }

    // =========================================================================
    // API Key Validation
    // =========================================================================

    /// Lightweight auth-check against the provider's API.
    ///
    /// Returns `Ok(())` if the key is accepted; `Err(ProviderError::AuthError)`
    /// with a human-readable message otherwise. Only checks auth correctness —
    /// does not validate quota, scopes, or feature access.
    ///
    /// Transient errors (5xx, network failures) are treated as "accept" to
    /// avoid blocking the user on provider-side hiccups.
    pub async fn validate_api_key_http(
        provider: ProviderType,
        api_key: &str,
    ) -> ProviderResult<()> {
        if api_key.is_empty() {
            return Err(ProviderError::AuthError("API key is empty".into()));
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| ProviderError::AuthError(format!("HTTP client: {}", e)))?;

        let (url, req) = match provider {
            ProviderType::OpenAI => {
                let r = client
                    .get("https://api.openai.com/v1/models")
                    .bearer_auth(api_key);
                ("https://api.openai.com/v1/models".to_string(), r)
            }
            ProviderType::Anthropic => {
                // Anthropic has no cheap models endpoint that works for all
                // key tiers. The cheapest check is POST /v1/messages with a
                // 1-token request; a 401/403 proves the key is bad, 400
                // (validation) or 200 both prove it's good.
                let r = client
                    .post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .header("content-type", "application/json")
                    .body(
                        r#"{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}"#,
                    );
                ("https://api.anthropic.com/v1/messages".to_string(), r)
            }
            ProviderType::Gemini => {
                return Err(ProviderError::AuthError(format!(
                    "API-key validation not implemented for {}",
                    provider.as_str()
                )));
            }
        };

        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(
                    "validation request to {} failed ({}) — accepting key optimistically",
                    url,
                    e
                );
                return Ok(());
            }
        };

        match resp.status().as_u16() {
            401 | 403 => Err(ProviderError::AuthError(
                "API key rejected by provider (401/403)".into(),
            )),
            200..=299 | 400 | 422 => Ok(()), // 400/422: model/validation errors — key itself is good
            code => {
                // 5xx, 429, etc. — don't block the user on transient provider issues
                tracing::warn!(
                    "API-key validation returned unexpected status {} — accepting",
                    code
                );
                Ok(())
            }
        }
    }

    // =========================================================================
    // Profile Management
    // =========================================================================

    /// List all profiles for a provider's OAuth store, in undefined order.
    ///
    /// Returns an empty Vec if no OAuth blob exists for the provider.
    pub async fn list_profiles(
        &self,
        provider: ProviderType,
    ) -> ProviderResult<Vec<ProfileSummary>> {
        let key = Self::oauth_vault_key(provider);
        let raw = match self.vault_get(&key).await? {
            Some(s) if !s.is_empty() => s,
            _ => return Ok(Vec::new()),
        };

        let store = match crate::oauth::profiles::migrate_legacy_blob(&raw, provider.as_str()) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(
                    "failed to parse OAuth store for {}: {}",
                    provider.as_str(),
                    e
                );
                return Ok(Vec::new());
            }
        };

        let active = store.active_profile.clone();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        Ok(store
            .profiles
            .iter()
            .map(|(name, profile)| {
                let remaining = (profile.expires_at - now).max(0) as u64;
                ProfileSummary {
                    name: name.clone(),
                    email: profile.email.clone(),
                    is_active: active.as_deref() == Some(name.as_str()),
                    expires_in_seconds: Some(remaining),
                }
            })
            .collect())
    }

    /// Set the active profile for a provider. Errors if the profile doesn't exist.
    pub async fn set_active_profile(
        &self,
        provider: ProviderType,
        profile_name: &str,
    ) -> ProviderResult<()> {
        let key = Self::oauth_vault_key(provider);
        let raw = self.vault_get(&key).await?.ok_or_else(|| {
            ProviderError::AuthError(format!(
                "no OAuth store for {} — cannot set active profile",
                provider.as_str()
            ))
        })?;

        let mut store = crate::oauth::profiles::migrate_legacy_blob(&raw, provider.as_str())
            .map_err(|e| ProviderError::AuthError(format!("parse OAuth store: {}", e)))?;

        store
            .set_active(profile_name)
            .map_err(ProviderError::AuthError)?;

        let json = serde_json::to_string(&store)
            .map_err(|e| ProviderError::AuthError(format!("serialize OAuth store: {}", e)))?;
        self.vault_set(&key, &json).await?;

        // Invalidate caches — the active token just changed.
        self.oauth_cache.write().await.remove(&provider);
        if provider == ProviderType::OpenAI {
            *self.openai_oauth_cache.write().await = None;
        }

        tracing::info!(
            "set active profile for {} to {:?}",
            provider.as_str(),
            profile_name
        );
        Ok(())
    }

    /// Remove a profile. If it was active, another profile (alphabetically first
    /// of the remainder) is promoted. If no profiles remain, the vault key is
    /// deleted entirely.
    pub async fn remove_profile(
        &self,
        provider: ProviderType,
        profile_name: &str,
    ) -> ProviderResult<()> {
        let key = Self::oauth_vault_key(provider);
        let raw = match self.vault_get(&key).await? {
            Some(s) if !s.is_empty() => s,
            _ => return Ok(()), // nothing to remove
        };

        let mut store = crate::oauth::profiles::migrate_legacy_blob(&raw, provider.as_str())
            .map_err(|e| ProviderError::AuthError(format!("parse OAuth store: {}", e)))?;

        let removed = store.remove_profile(profile_name);
        if removed.is_none() {
            // Idempotent — nothing to do.
            return Ok(());
        }

        if store.profiles.is_empty() {
            // No profiles left — drop the whole vault entry.
            self.vault_delete(&key).await?;
        } else {
            let json = serde_json::to_string(&store)
                .map_err(|e| ProviderError::AuthError(format!("serialize OAuth store: {}", e)))?;
            self.vault_set(&key, &json).await?;
        }

        // Invalidate caches.
        self.oauth_cache.write().await.remove(&provider);
        if provider == ProviderType::OpenAI {
            *self.openai_oauth_cache.write().await = None;
        }

        tracing::info!(
            "removed profile {:?} from {}",
            profile_name,
            provider.as_str()
        );
        Ok(())
    }

    /// Remove OAuth token from the vault
    pub async fn disconnect_oauth(&self, provider: ProviderType) -> ProviderResult<()> {
        let key = Self::oauth_vault_key(provider);
        self.vault_delete(&key).await?;

        // Remove from cache
        self.oauth_cache.write().await.remove(&provider);

        // Also clear OpenAI-specific cache if disconnecting OpenAI
        if provider == ProviderType::OpenAI {
            *self.openai_oauth_cache.write().await = None;
        }

        tracing::info!("Disconnected OAuth for {}", provider.as_str());

        Ok(())
    }

    // =========================================================================
    // GitHub OAuth Token Management (for git operations)
    // =========================================================================

    /// Store a GitHub OAuth token in cache + vault
    pub async fn set_github_oauth_token(&self, token: OAuthToken) -> ProviderResult<()> {
        let token_json = serde_json::to_string(&token).map_err(|e| {
            ProviderError::AuthError(format!("Failed to serialize GitHub token: {}", e))
        })?;

        self.vault_set(Self::github_oauth_vault_key(), &token_json)
            .await?;

        *self.github_oauth_cache.write().await = Some(token);
        tracing::info!("Stored GitHub OAuth token");
        Ok(())
    }

    /// Get the GitHub OAuth token (cache -> vault)
    pub async fn get_github_oauth_token(&self) -> ProviderResult<Option<OAuthToken>> {
        // Check cache
        if let Some(token) = self.github_oauth_cache.read().await.as_ref() {
            return Ok(Some(token.clone()));
        }

        // Try vault
        let token_json = match self.vault_get(Self::github_oauth_vault_key()).await? {
            Some(s) if !s.is_empty() => s,
            _ => return Ok(None),
        };

        match serde_json::from_str::<OAuthToken>(&token_json) {
            Ok(token) => {
                *self.github_oauth_cache.write().await = Some(token.clone());
                Ok(Some(token))
            }
            Err(e) => {
                tracing::warn!("Failed to parse GitHub OAuth token from vault: {}", e);
                Ok(None)
            }
        }
    }

    /// Clear the GitHub OAuth token from cache + vault
    pub async fn clear_github_oauth_token(&self) -> ProviderResult<()> {
        self.vault_delete(Self::github_oauth_vault_key()).await?;

        *self.github_oauth_cache.write().await = None;
        tracing::info!("Cleared GitHub OAuth token");
        Ok(())
    }

    /// Convenience: get just the access token string (or None)
    pub async fn get_github_access_token(&self) -> ProviderResult<Option<String>> {
        Ok(self.get_github_oauth_token().await?.map(|t| t.access_token))
    }

    /// Get authentication method info for a provider
    pub async fn get_auth_method_info(
        &self,
        provider: ProviderType,
    ) -> ProviderResult<AuthMethodInfo> {
        // Check for OAuth token first
        // For OpenAI, use the specialized token type
        if provider == ProviderType::OpenAI {
            if let Some(token) = self.get_openai_oauth_token().await? {
                if !token.is_expired() {
                    return Ok(AuthMethodInfo {
                        auth_type: AuthType::OAuth,
                        is_authenticated: true,
                        expires_in_seconds: Some(token.expires_in_seconds()),
                        credential_source: Some(CredentialSource::SoloOAuth.to_string()),
                    });
                }
            }
        } else if let Some(token) = self.get_oauth_token(provider).await? {
            if !token.is_expired() {
                return Ok(AuthMethodInfo {
                    auth_type: AuthType::OAuth,
                    is_authenticated: true,
                    expires_in_seconds: Some(token.expires_in_seconds()),
                    credential_source: Some(CredentialSource::SoloOAuth.to_string()),
                });
            }
        }

        // Check for API key
        if let Some(info) = self.get_credentials_with_source(provider).await? {
            let auth_type = match info.source {
                CredentialSource::Keychain => AuthType::ApiKey,
                CredentialSource::Environment => AuthType::ApiKey,
                CredentialSource::ClaudeOAuth | CredentialSource::ClaudeOAuthFile => {
                    AuthType::ClaudeOAuth
                }
                CredentialSource::SoloOAuth | CredentialSource::CodexOAuthFile => AuthType::OAuth,
            };

            return Ok(AuthMethodInfo {
                auth_type,
                is_authenticated: true,
                expires_in_seconds: None, // API keys don't expire
                credential_source: Some(info.source.to_string()),
            });
        }

        // No credentials
        Ok(AuthMethodInfo {
            auth_type: AuthType::None,
            is_authenticated: false,
            expires_in_seconds: None,
            credential_source: None,
        })
    }
}

impl Default for CredentialManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vault_key_names() {
        assert_eq!(
            CredentialManager::api_key_vault_key(ProviderType::Anthropic),
            "anthropic.apiKey"
        );
        assert_eq!(
            CredentialManager::api_key_vault_key(ProviderType::OpenAI),
            "openai.apiKey"
        );
        assert_eq!(
            CredentialManager::api_key_vault_key(ProviderType::Gemini),
            "gemini.apiKey"
        );
    }

    #[test]
    fn test_oauth_vault_key_names() {
        assert_eq!(
            CredentialManager::oauth_vault_key(ProviderType::Anthropic),
            "anthropic.oauth"
        );
        assert_eq!(
            CredentialManager::oauth_vault_key(ProviderType::OpenAI),
            "openai.oauth"
        );
    }

    #[test]
    fn test_github_oauth_vault_key() {
        assert_eq!(CredentialManager::github_oauth_vault_key(), "github.oauth");
    }

    #[test]
    fn test_credential_source_display() {
        assert_eq!(CredentialSource::Keychain.to_string(), "keychain");
        assert_eq!(CredentialSource::Environment.to_string(), "environment");
        assert_eq!(CredentialSource::ClaudeOAuth.to_string(), "claude-oauth");
        assert_eq!(CredentialSource::SoloOAuth.to_string(), "solo-oauth");
        assert_eq!(
            CredentialSource::ClaudeOAuthFile.to_string(),
            "claude-oauth-file"
        );
    }

    #[test]
    fn test_vault_version_constants() {
        assert_eq!(VAULT_VERSION_KEY, "_version");
        assert_eq!(VAULT_VERSION, "1");
    }

    #[test]
    fn test_legacy_entries_mapping() {
        // Verify all 7 legacy entries are defined with correct vault keys
        assert_eq!(LEGACY_ENTRIES.len(), 7);

        let vault_keys: Vec<&str> = LEGACY_ENTRIES.iter().map(|(_, _, k)| *k).collect();
        assert!(vault_keys.contains(&"anthropic.apiKey"));
        assert!(vault_keys.contains(&"openai.apiKey"));
        assert!(vault_keys.contains(&"gemini.apiKey"));
        assert!(vault_keys.contains(&"anthropic.oauth"));
        assert!(vault_keys.contains(&"openai.oauth"));
        assert!(vault_keys.contains(&"supabase.accessToken"));
        assert!(vault_keys.contains(&"supabase.refreshToken"));
    }

    #[test]
    fn test_partial_recovery_valid_object() {
        let json = r#"{"anthropic.apiKey":"sk-ant-123","openai.apiKey":"sk-openai-456"}"#;
        let recovered = CredentialManager::attempt_partial_recovery(json);
        assert_eq!(recovered.len(), 2);
        assert_eq!(recovered.get("anthropic.apiKey").unwrap(), "sk-ant-123");
        assert_eq!(recovered.get("openai.apiKey").unwrap(), "sk-openai-456");
    }

    #[test]
    fn test_partial_recovery_mixed_types() {
        // Only string values should be recovered; non-string values are skipped
        let json = r#"{"key1":"value1","key2":42,"key3":"value3","key4":null}"#;
        let recovered = CredentialManager::attempt_partial_recovery(json);
        assert_eq!(recovered.len(), 2);
        assert_eq!(recovered.get("key1").unwrap(), "value1");
        assert_eq!(recovered.get("key3").unwrap(), "value3");
    }

    #[test]
    fn test_partial_recovery_garbage() {
        let recovered = CredentialManager::attempt_partial_recovery("{broken json");
        assert!(recovered.is_empty());
    }

    #[test]
    fn test_partial_recovery_non_object() {
        // A JSON array or primitive can't be recovered as key-value pairs
        let recovered = CredentialManager::attempt_partial_recovery("[1, 2, 3]");
        assert!(recovered.is_empty());
    }

    #[test]
    fn test_migrate_legacy_entries_skips_existing() {
        let mut vault = HashMap::new();
        vault.insert("anthropic.apiKey".to_string(), "existing-key".to_string());

        // Migration should not overwrite existing vault keys
        // (We can't test actual keychain reads in unit tests, but we verify
        // the contains_key guard works — migration would skip this entry)
        CredentialManager::migrate_legacy_entries(&mut vault);

        assert_eq!(vault.get("anthropic.apiKey").unwrap(), "existing-key");
    }
}

#[cfg(test)]
mod profile_tests {
    use super::*;
    use crate::oauth::profiles::{OAuthProfile, ProviderOAuthStore};
    use crate::provider::ProviderType;

    /// Helper: build a CredentialManager whose vault is pre-populated with
    /// the given in-memory map, bypassing keychain I/O.
    /// Must be awaited from inside a tokio test — does not spawn its own runtime.
    async fn manager_with_vault(data: HashMap<String, String>) -> CredentialManager {
        let m = CredentialManager::new();
        *m.vault.write().await = Some(data);
        m
    }

    fn profile(access: &str, refresh: &str, expires_at: i64, email: &str) -> OAuthProfile {
        OAuthProfile {
            access_token: access.into(),
            refresh_token: refresh.into(),
            id_token: None,
            expires_at,
            last_refresh: 0,
            email: email.into(),
            account_id: None,
            plan_type: None,
        }
    }

    #[tokio::test]
    async fn get_oauth_token_returns_active_profile_as_oauth_token() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile(
            "default",
            profile("ak-abc", "rk-abc", 9_999_999_999, "me@x"),
        );
        let json = serde_json::to_string(&store).unwrap();
        let mut vault = HashMap::new();
        vault.insert("anthropic.oauth".into(), json);

        let m = manager_with_vault(vault).await;
        let token = m
            .get_oauth_token(ProviderType::Anthropic)
            .await
            .unwrap()
            .expect("oauth token");
        assert_eq!(token.access_token, "ak-abc");
        assert_eq!(token.refresh_token.as_deref(), Some("rk-abc"));
    }

    #[tokio::test]
    async fn get_oauth_token_migrates_legacy_blob_transparently() {
        let legacy = r#"{"access_token":"legacy-ak","refresh_token":"legacy-rk","expires_at":9999999999,"token_type":"Bearer","scope":null}"#;
        let mut vault = HashMap::new();
        vault.insert("anthropic.oauth".into(), legacy.into());

        let m = manager_with_vault(vault).await;
        let token = m
            .get_oauth_token(ProviderType::Anthropic)
            .await
            .unwrap()
            .expect("oauth token");
        assert_eq!(token.access_token, "legacy-ak");
        assert_eq!(token.refresh_token.as_deref(), Some("legacy-rk"));
    }

    #[tokio::test]
    async fn set_oauth_token_creates_default_profile() {
        let m = manager_with_vault(HashMap::new()).await;
        let token = crate::oauth::OAuthToken::new(
            "new-ak".into(),
            Some("new-rk".into()),
            3600,
            "Bearer".into(),
            None,
        );
        m.set_oauth_token(ProviderType::Anthropic, token)
            .await
            .unwrap();

        let got = m
            .get_oauth_token(ProviderType::Anthropic)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(got.access_token, "new-ak");
        assert_eq!(got.refresh_token.as_deref(), Some("new-rk"));
    }

    #[tokio::test]
    async fn set_oauth_token_preserves_existing_email_on_active_profile() {
        // Seed the vault with an existing profile that has a known email.
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile(
            "default",
            profile("old-ak", "old-rk", 1_000_000, "work@co.com"),
        );
        let json = serde_json::to_string(&store).unwrap();
        let mut vault = HashMap::new();
        vault.insert("anthropic.oauth".into(), json);

        let m = manager_with_vault(vault).await;
        // Overwrite with a new token (no identity info).
        let new_token = crate::oauth::OAuthToken::new(
            "new-ak".into(),
            Some("new-rk".into()),
            3600,
            "Bearer".into(),
            None,
        );
        m.set_oauth_token(ProviderType::Anthropic, new_token)
            .await
            .unwrap();

        // Read the raw vault entry and verify the email survived.
        let raw = m.vault_get_raw("anthropic.oauth").await.unwrap().unwrap();
        let saved: ProviderOAuthStore = serde_json::from_str(&raw).unwrap();
        let saved_active = saved.active().expect("active profile");
        assert_eq!(saved_active.email, "work@co.com");
        assert_eq!(saved_active.access_token, "new-ak");

        // Also verify cache-cold read path returns consistent data.
        m.oauth_cache.write().await.remove(&ProviderType::Anthropic);
        let via_get = m
            .get_oauth_token(ProviderType::Anthropic)
            .await
            .unwrap()
            .expect("oauth token");
        assert_eq!(via_get.access_token, "new-ak");
        assert_eq!(via_get.refresh_token.as_deref(), Some("new-rk"));
    }

    #[tokio::test]
    async fn disconnect_oauth_clears_all_profiles() {
        let m = manager_with_vault(HashMap::new()).await;
        let token = crate::oauth::OAuthToken::new("ak".into(), None, 3600, "Bearer".into(), None);
        m.set_oauth_token(ProviderType::Anthropic, token)
            .await
            .unwrap();
        m.disconnect_oauth(ProviderType::Anthropic).await.unwrap();
        assert!(m
            .get_oauth_token(ProviderType::Anthropic)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn get_openai_oauth_token_returns_active_profile_with_account_id() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile(
            "default",
            OAuthProfile {
                access_token: "oa-ak".into(),
                refresh_token: "oa-rk".into(),
                id_token: Some("eyJ.p.s".into()),
                expires_at: 9_999_999_999,
                last_refresh: 0,
                email: "me@openai".into(),
                account_id: Some("acct-xyz".into()),
                plan_type: Some("plus".into()),
            },
        );
        let json = serde_json::to_string(&store).unwrap();
        let mut vault = HashMap::new();
        vault.insert("openai.oauth".into(), json);

        let m = manager_with_vault(vault).await;
        let token = m
            .get_openai_oauth_token()
            .await
            .unwrap()
            .expect("openai oauth token");
        assert_eq!(token.access_token, "oa-ak");
        assert_eq!(token.refresh_token.as_deref(), Some("oa-rk"));
        assert_eq!(token.account_id.as_deref(), Some("acct-xyz"));
        assert_eq!(token.id_token.as_deref(), Some("eyJ.p.s"));
    }

    #[tokio::test]
    async fn get_openai_oauth_token_migrates_legacy_blob() {
        let legacy = r#"{
            "access_token": "legacy-ak",
            "refresh_token": "legacy-rk",
            "expires_at": 9999999999,
            "token_type": "Bearer",
            "scope": null,
            "id_token": "legacy.jwt.sig",
            "account_id": "legacy-acct"
        }"#;
        let mut vault = HashMap::new();
        vault.insert("openai.oauth".into(), legacy.into());

        let m = manager_with_vault(vault).await;
        let token = m
            .get_openai_oauth_token()
            .await
            .unwrap()
            .expect("openai oauth token");
        assert_eq!(token.access_token, "legacy-ak");
        assert_eq!(token.account_id.as_deref(), Some("legacy-acct"));
        assert_eq!(token.id_token.as_deref(), Some("legacy.jwt.sig"));
    }

    #[tokio::test]
    async fn set_openai_oauth_token_persists_account_id_and_id_token() {
        let m = manager_with_vault(HashMap::new()).await;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let token = crate::oauth::OpenAIOAuthToken {
            access_token: "fresh-ak".into(),
            refresh_token: Some("fresh-rk".into()),
            expires_at: now + 3600,
            token_type: "Bearer".into(),
            scope: None,
            id_token: Some("jwt".into()),
            account_id: Some("acct-fresh".into()),
            email: None,
        };
        m.set_openai_oauth_token(token).await.unwrap();

        // Cold-cache read must see the same identity fields.
        *m.openai_oauth_cache.write().await = None;
        let got = m.get_openai_oauth_token().await.unwrap().unwrap();
        assert_eq!(got.access_token, "fresh-ak");
        assert_eq!(got.refresh_token.as_deref(), Some("fresh-rk"));
        assert_eq!(got.account_id.as_deref(), Some("acct-fresh"));
        assert_eq!(got.id_token.as_deref(), Some("jwt"));
    }

    #[tokio::test]
    async fn set_openai_oauth_token_preserves_existing_email_and_plan_type() {
        // Seed the vault with an existing profile that has identity info.
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile(
            "default",
            OAuthProfile {
                access_token: "old-ak".into(),
                refresh_token: "old-rk".into(),
                id_token: Some("old.jwt".into()),
                expires_at: 1_000_000,
                last_refresh: 42,
                email: "me@openai.com".into(),
                account_id: Some("acct-old".into()),
                plan_type: Some("pro".into()),
            },
        );
        let json = serde_json::to_string(&store).unwrap();
        let mut vault = HashMap::new();
        vault.insert("openai.oauth".into(), json);

        let m = manager_with_vault(vault).await;
        let new_token = crate::oauth::OpenAIOAuthToken {
            access_token: "new-ak".into(),
            refresh_token: Some("new-rk".into()),
            expires_at: 9_999_999_999,
            token_type: "Bearer".into(),
            scope: None,
            id_token: None,   // new token has no id_token
            account_id: None, // new token has no account_id
            email: None,
        };
        m.set_openai_oauth_token(new_token).await.unwrap();

        // Read back the raw vault — email and plan_type must be preserved,
        // and id_token/account_id must fall back to the existing values
        // since the new token didn't carry them.
        let raw = m.vault_get_raw("openai.oauth").await.unwrap().unwrap();
        let saved: ProviderOAuthStore = serde_json::from_str(&raw).unwrap();
        let saved_active = saved.active().expect("active profile");
        assert_eq!(saved_active.email, "me@openai.com");
        assert_eq!(saved_active.plan_type.as_deref(), Some("pro"));
        assert_eq!(saved_active.id_token.as_deref(), Some("old.jwt"));
        assert_eq!(saved_active.account_id.as_deref(), Some("acct-old"));
        assert_eq!(saved_active.access_token, "new-ak");
        assert_eq!(saved_active.last_refresh, 42);
    }

    #[tokio::test]
    async fn set_openai_oauth_token_overwrites_identity_when_new_token_has_them() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile(
            "default",
            OAuthProfile {
                access_token: "old-ak".into(),
                refresh_token: "old-rk".into(),
                id_token: Some("old.jwt".into()),
                expires_at: 1_000_000,
                last_refresh: 100,
                email: "me@openai.com".into(),
                account_id: Some("acct-old".into()),
                plan_type: Some("pro".into()),
            },
        );
        let json = serde_json::to_string(&store).unwrap();
        let mut vault = HashMap::new();
        vault.insert("openai.oauth".into(), json);

        let m = manager_with_vault(vault).await;
        let new_token = crate::oauth::OpenAIOAuthToken {
            access_token: "new-ak".into(),
            refresh_token: Some("new-rk".into()),
            expires_at: 9_999_999_999,
            token_type: "Bearer".into(),
            scope: None,
            id_token: Some("NEW.jwt".into()),
            account_id: Some("acct-new".into()),
            email: None,
        };
        m.set_openai_oauth_token(new_token).await.unwrap();

        let raw = m.vault_get_raw("openai.oauth").await.unwrap().unwrap();
        let saved: ProviderOAuthStore = serde_json::from_str(&raw).unwrap();
        let saved_active = saved.active().expect("active profile");
        assert_eq!(saved_active.id_token.as_deref(), Some("NEW.jwt"));
        assert_eq!(saved_active.account_id.as_deref(), Some("acct-new"));
        // email and plan_type stay put — the token carries no such info.
        assert_eq!(saved_active.email, "me@openai.com");
        assert_eq!(saved_active.plan_type.as_deref(), Some("pro"));
    }

    #[tokio::test]
    async fn set_openai_oauth_token_persists_email_from_token() {
        let m = manager_with_vault(HashMap::new()).await;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let token = crate::oauth::OpenAIOAuthToken {
            access_token: "ak".into(),
            refresh_token: Some("rk".into()),
            expires_at: now + 3600,
            token_type: "Bearer".into(),
            scope: None,
            id_token: Some("jwt".into()),
            account_id: Some("acct".into()),
            email: Some("user@example.com".into()),
        };
        m.set_openai_oauth_token(token).await.unwrap();

        let raw = m.vault_get_raw("openai.oauth").await.unwrap().unwrap();
        let saved: ProviderOAuthStore = serde_json::from_str(&raw).unwrap();
        let saved_active = saved.active().expect("active profile");
        assert_eq!(saved_active.email, "user@example.com");
    }

    #[tokio::test]
    async fn set_openai_oauth_token_preserves_email_when_token_has_none() {
        // Seed an existing profile with an email.
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile(
            "default",
            OAuthProfile {
                access_token: "old-ak".into(),
                refresh_token: "old-rk".into(),
                id_token: None,
                expires_at: 1_000_000,
                last_refresh: 0,
                email: "kept@example.com".into(),
                account_id: None,
                plan_type: None,
            },
        );
        let mut vault = HashMap::new();
        vault.insert(
            "openai.oauth".into(),
            serde_json::to_string(&store).unwrap(),
        );

        let m = manager_with_vault(vault).await;
        // New token has email: None — should keep the existing email.
        let token = crate::oauth::OpenAIOAuthToken {
            access_token: "new-ak".into(),
            refresh_token: Some("new-rk".into()),
            expires_at: 9_999_999_999,
            token_type: "Bearer".into(),
            scope: None,
            id_token: None,
            account_id: None,
            email: None,
        };
        m.set_openai_oauth_token(token).await.unwrap();

        let raw = m.vault_get_raw("openai.oauth").await.unwrap().unwrap();
        let saved: ProviderOAuthStore = serde_json::from_str(&raw).unwrap();
        assert_eq!(saved.active().unwrap().email, "kept@example.com");
    }

    fn seed_two_profiles() -> HashMap<String, String> {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile(
            "default",
            OAuthProfile {
                access_token: "ak-1".into(),
                refresh_token: "rk-1".into(),
                id_token: None,
                expires_at: 9_999_999_999,
                last_refresh: 0,
                email: "a@x".into(),
                account_id: None,
                plan_type: None,
            },
        );
        store.upsert_profile(
            "work",
            OAuthProfile {
                access_token: "ak-2".into(),
                refresh_token: "rk-2".into(),
                id_token: None,
                expires_at: 9_999_999_999,
                last_refresh: 0,
                email: "b@x".into(),
                account_id: None,
                plan_type: None,
            },
        );
        let mut vault = HashMap::new();
        vault.insert(
            "anthropic.oauth".into(),
            serde_json::to_string(&store).unwrap(),
        );
        vault
    }

    #[tokio::test]
    async fn list_profiles_returns_both_with_active_flag() {
        let m = manager_with_vault(seed_two_profiles()).await;
        let mut profiles = m.list_profiles(ProviderType::Anthropic).await.unwrap();
        profiles.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0].name, "default");
        assert_eq!(profiles[0].email, "a@x");
        assert!(profiles[0].is_active);
        assert_eq!(profiles[1].name, "work");
        assert!(!profiles[1].is_active);
    }

    #[tokio::test]
    async fn list_profiles_returns_empty_when_no_oauth() {
        let m = manager_with_vault(HashMap::new()).await;
        let profiles = m.list_profiles(ProviderType::Anthropic).await.unwrap();
        assert!(profiles.is_empty());
    }

    #[tokio::test]
    async fn set_active_profile_updates_cursor() {
        let m = manager_with_vault(seed_two_profiles()).await;
        m.set_active_profile(ProviderType::Anthropic, "work")
            .await
            .unwrap();

        let raw = m.vault_get_raw("anthropic.oauth").await.unwrap().unwrap();
        let store: ProviderOAuthStore = serde_json::from_str(&raw).unwrap();
        assert_eq!(store.active_profile.as_deref(), Some("work"));
    }

    #[tokio::test]
    async fn set_active_profile_errors_on_unknown() {
        let m = manager_with_vault(seed_two_profiles()).await;
        let err = m
            .set_active_profile(ProviderType::Anthropic, "ghost")
            .await
            .unwrap_err();
        assert!(!err.to_string().is_empty());
    }

    #[tokio::test]
    async fn remove_profile_drops_it_and_picks_new_active() {
        let m = manager_with_vault(seed_two_profiles()).await;
        m.remove_profile(ProviderType::Anthropic, "default")
            .await
            .unwrap();

        let raw = m.vault_get_raw("anthropic.oauth").await.unwrap().unwrap();
        let store: ProviderOAuthStore = serde_json::from_str(&raw).unwrap();
        assert_eq!(store.profiles.len(), 1);
        assert_eq!(store.active_profile.as_deref(), Some("work"));
    }

    #[tokio::test]
    async fn remove_last_profile_clears_vault_key() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile(
            "default",
            OAuthProfile {
                access_token: "ak".into(),
                refresh_token: "".into(),
                id_token: None,
                expires_at: 1,
                last_refresh: 0,
                email: "a@x".into(),
                account_id: None,
                plan_type: None,
            },
        );
        let mut vault = HashMap::new();
        vault.insert(
            "anthropic.oauth".into(),
            serde_json::to_string(&store).unwrap(),
        );

        let m = manager_with_vault(vault).await;
        m.remove_profile(ProviderType::Anthropic, "default")
            .await
            .unwrap();

        // When the last profile is removed, the vault key should be cleared.
        let raw = m.vault_get_raw("anthropic.oauth").await.unwrap();
        assert!(raw.is_none() || raw.as_deref() == Some(""));
    }
}
