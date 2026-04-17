//! Profile-keyed OAuth storage.
//!
//! Wraps one or more OAuth tokens under named profiles, allowing a single
//! provider to hold multiple accounts. The active profile is the one
//! `CredentialManager::get_credentials` returns by default.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// One OAuth account under a profile name.
///
/// Fields are flat (not nested behind a `Credential` enum) because the
/// store serializes to a single JSON string in the vault. OpenAI-specific
/// fields (`id_token`, `account_id`, `plan_type`) are `Option`al so the
/// same struct serves both providers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OAuthProfile {
    pub access_token: String,
    pub refresh_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    /// Unix seconds
    pub expires_at: i64,
    /// Unix seconds — when this profile last successfully refreshed.
    pub last_refresh: i64,
    /// Display label (typically the account email).
    pub email: String,
    /// OpenAI's `chatgpt-account-id` header. `None` for Anthropic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    /// OpenAI ChatGPT plan ("plus", "pro", ...). `None` for Anthropic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_type: Option<String>,
}

/// Vault value for `{provider}.oauth`.
///
/// Replaces the legacy single-token blob. Migration from the legacy shape
/// is handled in [`migrate_legacy_blob`] and wired in from `CredentialManager`.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ProviderOAuthStore {
    /// Name of the currently-active profile. Empty string if no profiles.
    #[serde(default)]
    pub active_profile: String,
    #[serde(default)]
    pub profiles: HashMap<String, OAuthProfile>,
}

impl ProviderOAuthStore {
    pub fn empty() -> Self {
        Self::default()
    }

    /// Insert or replace a profile. If this is the first profile, it
    /// becomes active automatically.
    pub fn upsert_profile(&mut self, name: impl Into<String>, profile: OAuthProfile) {
        let name = name.into();
        let was_empty = self.profiles.is_empty();
        self.profiles.insert(name.clone(), profile);
        if was_empty {
            self.active_profile = name;
        }
    }

    /// Set the active profile. Errors if the named profile does not exist.
    pub fn set_active(&mut self, name: &str) -> Result<(), String> {
        if !self.profiles.contains_key(name) {
            return Err(format!("profile {:?} not found", name));
        }
        self.active_profile = name.to_string();
        Ok(())
    }

    /// Remove a profile. If it was active, picks another profile
    /// alphabetically (stable), or clears active if none remain.
    pub fn remove_profile(&mut self, name: &str) -> Option<OAuthProfile> {
        let removed = self.profiles.remove(name);
        if removed.is_some() && self.active_profile == name {
            self.active_profile = self
                .profiles
                .keys()
                .min()
                .cloned()
                .unwrap_or_default();
        }
        removed
    }

    /// Currently-active profile, if any.
    pub fn active(&self) -> Option<&OAuthProfile> {
        if self.active_profile.is_empty() {
            return None;
        }
        self.profiles.get(&self.active_profile)
    }

    /// Mutable access to the active profile, if any.
    pub fn active_mut(&mut self) -> Option<&mut OAuthProfile> {
        if self.active_profile.is_empty() {
            return None;
        }
        self.profiles.get_mut(&self.active_profile)
    }

    /// Look up a profile by name.
    pub fn get(&self, name: &str) -> Option<&OAuthProfile> {
        self.profiles.get(name)
    }

    /// Mutable profile lookup by name.
    pub fn get_mut(&mut self, name: &str) -> Option<&mut OAuthProfile> {
        self.profiles.get_mut(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_profile(email: &str) -> OAuthProfile {
        OAuthProfile {
            access_token: "access-xyz".to_string(),
            refresh_token: "refresh-xyz".to_string(),
            id_token: None,
            expires_at: 1_700_000_000,
            last_refresh: 1_699_999_000,
            email: email.to_string(),
            account_id: None,
            plan_type: None,
        }
    }

    #[test]
    fn empty_store_has_no_active_profile() {
        let store = ProviderOAuthStore::empty();
        assert!(store.profiles.is_empty());
        assert_eq!(store.active_profile, "");
    }

    #[test]
    fn add_first_profile_sets_active() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("default", sample_profile("a@b.com"));
        assert_eq!(store.active_profile, "default");
        assert_eq!(store.profiles.len(), 1);
    }

    #[test]
    fn add_second_profile_does_not_change_active() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("work", sample_profile("work@co.com"));
        store.upsert_profile("home", sample_profile("home@me.com"));
        assert_eq!(store.active_profile, "work");
        assert_eq!(store.profiles.len(), 2);
    }

    #[test]
    fn set_active_changes_active_field() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("a", sample_profile("a@x"));
        store.upsert_profile("b", sample_profile("b@x"));
        assert!(store.set_active("b").is_ok());
        assert_eq!(store.active_profile, "b");
    }

    #[test]
    fn set_active_unknown_profile_errors() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("a", sample_profile("a@x"));
        assert!(store.set_active("nonexistent").is_err());
    }

    #[test]
    fn remove_active_profile_picks_another() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("a", sample_profile("a@x"));
        store.upsert_profile("b", sample_profile("b@x"));
        assert_eq!(store.active_profile, "a");
        store.remove_profile("a");
        assert_eq!(store.active_profile, "b");
        assert_eq!(store.profiles.len(), 1);
    }

    #[test]
    fn remove_last_profile_clears_active() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("a", sample_profile("a@x"));
        store.remove_profile("a");
        assert_eq!(store.active_profile, "");
        assert!(store.profiles.is_empty());
    }

    #[test]
    fn active_returns_active_profile() {
        let mut store = ProviderOAuthStore::empty();
        let profile = sample_profile("me@example.com");
        store.upsert_profile("default", profile.clone());
        let got = store.active().expect("active profile should exist");
        assert_eq!(got.email, "me@example.com");
    }

    #[test]
    fn active_on_empty_store_returns_none() {
        let store = ProviderOAuthStore::empty();
        assert!(store.active().is_none());
    }

    #[test]
    fn serde_round_trip() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("default", sample_profile("me@x"));
        let json = serde_json::to_string(&store).unwrap();
        let parsed: ProviderOAuthStore = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.active_profile, "default");
        assert_eq!(parsed.profiles["default"].email, "me@x");
    }
}
