//! Credential management for AI providers
//!
//! Supports multiple credential sources:
//! 1. macOS Keychain (primary)
//! 2. Environment variables (fallback)

use crate::provider::{ProviderError, ProviderResult, ProviderType};
use serde::{Deserialize, Serialize};
use std::process::Command;
use ts_rs::TS;

/// Source of credentials
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../apps/desktop/src/bindings/")]
#[serde(rename_all = "kebab-case")]
pub enum CredentialSource {
    /// Stored in macOS Keychain
    Keychain,
    /// From environment variable
    Environment,
    /// From Claude Code OAuth (for Anthropic only)
    ClaudeOAuth,
}

impl std::fmt::Display for CredentialSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CredentialSource::Keychain => write!(f, "keychain"),
            CredentialSource::Environment => write!(f, "environment"),
            CredentialSource::ClaudeOAuth => write!(f, "claude-oauth"),
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

/// Credential manager for storing and retrieving API keys
pub struct CredentialManager {
    /// Cache for credentials (to avoid repeated keychain access)
    cache: tokio::sync::RwLock<std::collections::HashMap<ProviderType, CredentialInfo>>,
}

impl CredentialManager {
    /// Create a new credential manager
    pub fn new() -> Self {
        Self {
            cache: tokio::sync::RwLock::new(std::collections::HashMap::new()),
        }
    }

    /// Get the keychain service name for a provider
    fn keychain_service(provider: ProviderType) -> String {
        format!("{}.{}.apiKey", KEYCHAIN_SERVICE_PREFIX, provider.as_str())
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
    pub async fn get_credentials_with_source(
        &self,
        provider: ProviderType,
    ) -> ProviderResult<Option<CredentialInfo>> {
        // 1. Try Keychain
        if let Some(key) = self.get_from_keychain(provider).await? {
            return Ok(Some(CredentialInfo {
                api_key: key,
                source: CredentialSource::Keychain,
            }));
        }

        // 2. For Anthropic, try Claude Code OAuth
        if provider == ProviderType::Anthropic {
            if let Some(key) = self.get_claude_oauth().await? {
                return Ok(Some(CredentialInfo {
                    api_key: key,
                    source: CredentialSource::ClaudeOAuth,
                }));
            }
        }

        // 3. Try environment variable
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

    /// Get Claude Code OAuth token from Keychain
    async fn get_claude_oauth(&self) -> ProviderResult<Option<String>> {
        // Claude Code stores OAuth token in keychain with specific service name
        let output = Command::new("security")
            .args([
                "find-generic-password",
                "-s",
                "claude-code-oauth",
                "-a",
                "api-key",
                "-w",
            ])
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
            Ok(_) => Ok(None),
            Err(e) => {
                tracing::warn!("Failed to read Claude OAuth from keychain: {}", e);
                Ok(None)
            }
        }
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
    fn test_credential_source_display() {
        assert_eq!(CredentialSource::Keychain.to_string(), "keychain");
        assert_eq!(CredentialSource::Environment.to_string(), "environment");
        assert_eq!(CredentialSource::ClaudeOAuth.to_string(), "claude-oauth");
    }
}
