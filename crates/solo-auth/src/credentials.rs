//! Credential management for AI providers
//!
//! Supports multiple credential sources:
//! 1. Solo OAuth tokens (primary)
//! 2. API keys from macOS Keychain
//! 3. Claude Code OAuth (fallback for Anthropic)
//! 4. Environment variables (fallback)

use crate::oauth::{
    AuthMethodInfo, AuthType, OAuthToken, OpenAIOAuthToken, AnthropicOAuthConfig, OpenAIOAuthConfig,
};
use crate::provider::{ProviderError, ProviderResult, ProviderType};
use serde::{Deserialize, Serialize};
use std::process::Command;
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
}

impl std::fmt::Display for CredentialSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CredentialSource::Keychain => write!(f, "keychain"),
            CredentialSource::Environment => write!(f, "environment"),
            CredentialSource::ClaudeOAuth => write!(f, "claude-oauth"),
            CredentialSource::SoloOAuth => write!(f, "solo-oauth"),
            CredentialSource::ClaudeOAuthFile => write!(f, "claude-oauth-file"),
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

/// Keychain service names
const KEYCHAIN_SERVICE_PREFIX: &str = "solo.provider";

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

/// Credential manager for storing and retrieving API keys and OAuth tokens
pub struct CredentialManager {
    /// Cache for API key credentials (to avoid repeated keychain access)
    cache: tokio::sync::RwLock<std::collections::HashMap<ProviderType, CredentialInfo>>,
    /// Cache for OAuth tokens (generic)
    oauth_cache: tokio::sync::RwLock<std::collections::HashMap<ProviderType, OAuthCredentialInfo>>,
    /// Cache for OpenAI OAuth tokens (with account_id)
    openai_oauth_cache: tokio::sync::RwLock<Option<OpenAIOAuthCredentialInfo>>,
}

impl CredentialManager {
    /// Create a new credential manager
    pub fn new() -> Self {
        Self {
            cache: tokio::sync::RwLock::new(std::collections::HashMap::new()),
            oauth_cache: tokio::sync::RwLock::new(std::collections::HashMap::new()),
            openai_oauth_cache: tokio::sync::RwLock::new(None),
        }
    }

    /// Get the keychain service name for a provider's API key
    fn keychain_service(provider: ProviderType) -> String {
        format!("{}.{}.apiKey", KEYCHAIN_SERVICE_PREFIX, provider.as_str())
    }

    /// Get the keychain service name for a provider's OAuth token
    fn oauth_keychain_service(provider: ProviderType) -> String {
        format!("{}.{}.oauth", KEYCHAIN_SERVICE_PREFIX, provider.as_str())
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

        // 3. For Anthropic, try Claude Code OAuth (keychain then file)
        if provider == ProviderType::Anthropic {
            if let Some(key) = self.get_claude_oauth().await? {
                return Ok(Some(CredentialInfo {
                    api_key: key,
                    source: CredentialSource::ClaudeOAuth,
                }));
            }
            if let Some(key) = self.get_claude_oauth_from_file().await? {
                return Ok(Some(CredentialInfo {
                    api_key: key,
                    source: CredentialSource::ClaudeOAuthFile,
                }));
            }
        }

        // 4. Try environment variable
        if let Some(key) = self.get_from_env(provider) {
            return Ok(Some(CredentialInfo {
                api_key: key,
                source: CredentialSource::Environment,
            }));
        }

        Ok(None)
    }

    /// Get credential source without exposing the key
    pub async fn get_credential_source(&self, provider: ProviderType) -> ProviderResult<Option<CredentialSource>> {
        // Check cache
        if let Some(info) = self.cache.read().await.get(&provider) {
            return Ok(Some(info.source));
        }

        // Get fresh
        Ok(self.get_credentials_with_source(provider).await?.map(|i| i.source))
    }

    /// Get credentials from macOS Keychain
    async fn get_from_keychain(&self, provider: ProviderType) -> ProviderResult<Option<String>> {
        let service = Self::keychain_service(provider);

        // Use security command to read from Keychain
        let output = Command::new("security")
            .args(["find-generic-password", "-s", &service, "-w"])
            .output();

        match output {
            Ok(output) if output.status.success() => {
                let key = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .to_string();
                if key.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(key))
                }
            }
            Ok(_) => Ok(None), // Not found in keychain
            Err(e) => {
                tracing::warn!("Failed to read from keychain: {}", e);
                Ok(None)
            }
        }
    }

    /// Parse `expiresAt` from Claude Code credential JSON.
    /// The value may be a JSON number or a string containing digits.
    fn parse_expires_at(oauth_obj: &serde_json::Value) -> Option<i64> {
        oauth_obj.get("expiresAt").and_then(|exp| {
            exp.as_i64().or_else(|| {
                exp.as_str()
                    .and_then(|s| s.parse::<i64>().ok())
            })
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
        // Claude Code stores OAuth token in keychain with this service name
        let output = Command::new("security")
            .args([
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-w",
            ])
            .output();

        match output {
            Ok(output) if output.status.success() => {
                let json_str = String::from_utf8_lossy(&output.stdout)
                    .trim()
                    .to_string();
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
                                if let Some(refresh_token) = oauth_obj.get("refreshToken").and_then(|t| t.as_str()) {
                                    if let Some(new_token) = Self::refresh_claude_code_token(refresh_token).await {
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
            Ok(_) => Ok(None),
            Err(e) => {
                tracing::warn!("Failed to read Claude OAuth from keychain: {}", e);
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

                        if let Some(refresh_token) = oauth_obj.get("refreshToken").and_then(|t| t.as_str()) {
                            if let Some(new_token) = Self::refresh_claude_code_token(refresh_token).await {
                                tracing::info!("Successfully refreshed Claude Code file OAuth token");
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
        // Try keychain first
        let keychain_result = Command::new("security")
            .args([
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-w",
            ])
            .output();

        if let Ok(output) = keychain_result {
            if output.status.success() {
                let json_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !json_str.is_empty() {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json_str) {
                        if let Some(oauth_obj) = value.get("claudeAiOauth") {
                            if let Some(access_token) = oauth_obj.get("accessToken").and_then(|t| t.as_str()) {
                                let expires_at = Self::parse_expires_at(oauth_obj);

                                // If expired, try to refresh and return the new token
                                let final_token = if let Some(exp) = expires_at {
                                    if Self::is_claude_token_expired(exp) {
                                        if let Some(refresh_token) = oauth_obj.get("refreshToken").and_then(|t| t.as_str()) {
                                            if let Some(new_token) = Self::refresh_claude_code_token(refresh_token).await {
                                                tracing::info!("Refreshed Claude Code token in detailed check");
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
        }

        // Try file fallback
        let home = std::env::var("HOME").unwrap_or_default();
        if !home.is_empty() {
            let path = std::path::PathBuf::from(&home)
                .join(".claude")
                .join(".credentials.json");

            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(oauth_obj) = value.get("claudeAiOauth") {
                        if let Some(access_token) = oauth_obj.get("accessToken").and_then(|t| t.as_str()) {
                            let expires_at = Self::parse_expires_at(oauth_obj);

                            let final_token = if let Some(exp) = expires_at {
                                if Self::is_claude_token_expired(exp) {
                                    if let Some(refresh_token) = oauth_obj.get("refreshToken").and_then(|t| t.as_str()) {
                                        if let Some(new_token) = Self::refresh_claude_code_token(refresh_token).await {
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

        Ok(None)
    }

    /// Get credentials from environment variable
    fn get_from_env(&self, provider: ProviderType) -> Option<String> {
        std::env::var(provider.env_var_name()).ok()
    }

    /// Store credentials in Keychain
    pub async fn set_credentials(&self, provider: ProviderType, api_key: &str) -> ProviderResult<()> {
        let service = Self::keychain_service(provider);

        // Delete existing entry if it exists
        let _ = Command::new("security")
            .args(["delete-generic-password", "-s", &service])
            .output();

        // Add new entry
        let output = Command::new("security")
            .args([
                "add-generic-password",
                "-s",
                &service,
                "-a",
                "api-key",
                "-w",
                api_key,
                "-U", // Update if exists
            ])
            .output()
            .map_err(|e| ProviderError::KeychainError(e.to_string()))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(ProviderError::KeychainError(error.to_string()));
        }

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

    /// Remove credentials from Keychain
    pub async fn clear_credentials(&self, provider: ProviderType) -> ProviderResult<()> {
        let service = Self::keychain_service(provider);

        let output = Command::new("security")
            .args(["delete-generic-password", "-s", &service])
            .output()
            .map_err(|e| ProviderError::KeychainError(e.to_string()))?;

        // Ignore "item not found" errors
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            if !error.contains("could not be found") {
                return Err(ProviderError::KeychainError(error.to_string()));
            }
        }

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

    /// Clear the credential cache
    pub async fn clear_cache(&self) {
        self.cache.write().await.clear();
        self.oauth_cache.write().await.clear();
        *self.openai_oauth_cache.write().await = None;
    }

    // =========================================================================
    // OAuth Token Management
    // =========================================================================

    /// Store an OAuth token in the keychain
    pub async fn set_oauth_token(
        &self,
        provider: ProviderType,
        token: OAuthToken,
    ) -> ProviderResult<()> {
        let service = Self::oauth_keychain_service(provider);

        // Serialize token to JSON
        let token_json = serde_json::to_string(&token)
            .map_err(|e| ProviderError::AuthError(format!("Failed to serialize token: {}", e)))?;

        // Delete existing entry if it exists
        let _ = Command::new("security")
            .args(["delete-generic-password", "-s", &service])
            .output();

        // Add new entry
        let output = Command::new("security")
            .args([
                "add-generic-password",
                "-s",
                &service,
                "-a",
                "oauth-token",
                "-w",
                &token_json,
                "-U",
            ])
            .output()
            .map_err(|e| ProviderError::KeychainError(e.to_string()))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(ProviderError::KeychainError(error.to_string()));
        }

        // Update cache
        self.oauth_cache.write().await.insert(
            provider,
            OAuthCredentialInfo {
                token,
                source: CredentialSource::SoloOAuth,
            },
        );

        // Clear API key cache for this provider to ensure OAuth takes priority
        self.cache.write().await.remove(&provider);

        tracing::info!("Stored OAuth token for {}", provider.as_str());

        Ok(())
    }

    /// Get OAuth token for a provider
    pub async fn get_oauth_token(&self, provider: ProviderType) -> ProviderResult<Option<OAuthToken>> {
        // Check cache first
        if let Some(info) = self.oauth_cache.read().await.get(&provider) {
            return Ok(Some(info.token.clone()));
        }

        // Try to load from keychain
        let service = Self::oauth_keychain_service(provider);

        let output = Command::new("security")
            .args(["find-generic-password", "-s", &service, "-w"])
            .output();

        match output {
            Ok(output) if output.status.success() => {
                let token_json = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if token_json.is_empty() {
                    return Ok(None);
                }

                match serde_json::from_str::<OAuthToken>(&token_json) {
                    Ok(token) => {
                        // Cache the token
                        self.oauth_cache.write().await.insert(
                            provider,
                            OAuthCredentialInfo {
                                token: token.clone(),
                                source: CredentialSource::SoloOAuth,
                            },
                        );
                        Ok(Some(token))
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse OAuth token from keychain: {}", e);
                        Ok(None)
                    }
                }
            }
            Ok(_) => Ok(None),
            Err(e) => {
                tracing::warn!("Failed to read OAuth token from keychain: {}", e);
                Ok(None)
            }
        }
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
            ProviderType::OpenAI | ProviderType::Gemini => unreachable!(), // Handled above
        };

        // Store the new token
        self.set_oauth_token(provider, new_token.clone()).await?;

        tracing::info!("Refreshed OAuth token for {}", provider.as_str());

        Ok(new_token)
    }

    // =========================================================================
    // OpenAI OAuth Token Management
    // =========================================================================

    /// Store an OpenAI OAuth token in the keychain
    pub async fn set_openai_oauth_token(&self, token: OpenAIOAuthToken) -> ProviderResult<()> {
        let service = Self::oauth_keychain_service(ProviderType::OpenAI);

        // Serialize token to JSON
        let token_json = serde_json::to_string(&token)
            .map_err(|e| ProviderError::AuthError(format!("Failed to serialize OpenAI token: {}", e)))?;

        // Delete existing entry if it exists
        let _ = Command::new("security")
            .args(["delete-generic-password", "-s", &service])
            .output();

        // Add new entry
        let output = Command::new("security")
            .args([
                "add-generic-password",
                "-s",
                &service,
                "-a",
                "oauth-token",
                "-w",
                &token_json,
                "-U",
            ])
            .output()
            .map_err(|e| ProviderError::KeychainError(e.to_string()))?;

        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(ProviderError::KeychainError(error.to_string()));
        }

        // Update cache
        *self.openai_oauth_cache.write().await = Some(OpenAIOAuthCredentialInfo {
            token,
            source: CredentialSource::SoloOAuth,
        });

        // Clear API key cache for OpenAI to ensure OAuth takes priority
        self.cache.write().await.remove(&ProviderType::OpenAI);

        tracing::info!("Stored OpenAI OAuth token");

        Ok(())
    }

    /// Get OpenAI OAuth token
    pub async fn get_openai_oauth_token(&self) -> ProviderResult<Option<OpenAIOAuthToken>> {
        // Check cache first
        if let Some(info) = self.openai_oauth_cache.read().await.as_ref() {
            return Ok(Some(info.token.clone()));
        }

        // Try to load from keychain
        let service = Self::oauth_keychain_service(ProviderType::OpenAI);

        let output = Command::new("security")
            .args(["find-generic-password", "-s", &service, "-w"])
            .output();

        match output {
            Ok(output) if output.status.success() => {
                let token_json = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if token_json.is_empty() {
                    return Ok(None);
                }

                match serde_json::from_str::<OpenAIOAuthToken>(&token_json) {
                    Ok(token) => {
                        // Cache the token
                        *self.openai_oauth_cache.write().await = Some(OpenAIOAuthCredentialInfo {
                            token: token.clone(),
                            source: CredentialSource::SoloOAuth,
                        });
                        Ok(Some(token))
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse OpenAI OAuth token from keychain: {}", e);
                        Ok(None)
                    }
                }
            }
            Ok(_) => Ok(None),
            Err(e) => {
                tracing::warn!("Failed to read OpenAI OAuth token from keychain: {}", e);
                Ok(None)
            }
        }
    }

    /// Check if we have an OpenAI OAuth token
    pub async fn has_openai_oauth_token(&self) -> bool {
        if let Ok(Some(token)) = self.get_openai_oauth_token().await {
            !token.is_expired()
        } else {
            false
        }
    }

    /// Refresh an OpenAI OAuth token
    pub async fn refresh_openai_oauth_token(&self) -> ProviderResult<OpenAIOAuthToken> {
        let current_token = self
            .get_openai_oauth_token()
            .await?
            .ok_or_else(|| ProviderError::AuthError("No OpenAI OAuth token to refresh".to_string()))?;

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
        Ok(None)
    }

    /// Remove OAuth token from keychain
    pub async fn disconnect_oauth(&self, provider: ProviderType) -> ProviderResult<()> {
        let service = Self::oauth_keychain_service(provider);

        let output = Command::new("security")
            .args(["delete-generic-password", "-s", &service])
            .output()
            .map_err(|e| ProviderError::KeychainError(e.to_string()))?;

        // Ignore "item not found" errors
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            if !error.contains("could not be found") {
                return Err(ProviderError::KeychainError(error.to_string()));
            }
        }

        // Remove from cache
        self.oauth_cache.write().await.remove(&provider);

        // Also clear OpenAI-specific cache if disconnecting OpenAI
        if provider == ProviderType::OpenAI {
            *self.openai_oauth_cache.write().await = None;
        }

        tracing::info!("Disconnected OAuth for {}", provider.as_str());

        Ok(())
    }

    /// Get authentication method info for a provider
    pub async fn get_auth_method_info(&self, provider: ProviderType) -> ProviderResult<AuthMethodInfo> {
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
                CredentialSource::ClaudeOAuth | CredentialSource::ClaudeOAuthFile => AuthType::ClaudeOAuth,
                CredentialSource::SoloOAuth => AuthType::OAuth,
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
    fn test_keychain_service_name() {
        assert_eq!(
            CredentialManager::keychain_service(ProviderType::Anthropic),
            "solo.provider.anthropic.apiKey"
        );
        assert_eq!(
            CredentialManager::keychain_service(ProviderType::OpenAI),
            "solo.provider.openai.apiKey"
        );
    }

    #[test]
    fn test_oauth_keychain_service_name() {
        assert_eq!(
            CredentialManager::oauth_keychain_service(ProviderType::Anthropic),
            "solo.provider.anthropic.oauth"
        );
        assert_eq!(
            CredentialManager::oauth_keychain_service(ProviderType::OpenAI),
            "solo.provider.openai.oauth"
        );
    }

    #[test]
    fn test_credential_source_display() {
        assert_eq!(CredentialSource::Keychain.to_string(), "keychain");
        assert_eq!(CredentialSource::Environment.to_string(), "environment");
        assert_eq!(CredentialSource::ClaudeOAuth.to_string(), "claude-oauth");
        assert_eq!(CredentialSource::SoloOAuth.to_string(), "solo-oauth");
        assert_eq!(CredentialSource::ClaudeOAuthFile.to_string(), "claude-oauth-file");
    }
}
