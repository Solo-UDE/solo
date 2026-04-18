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
/// is handled by `migrate_legacy_blob` (added in a follow-up task) and
/// wired in from `CredentialManager`.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct ProviderOAuthStore {
    /// Name of the currently-active profile. `None` if no profiles.
    #[serde(default)]
    pub(crate) active_profile: Option<String>,
    #[serde(default)]
    pub(crate) profiles: HashMap<String, OAuthProfile>,
}

impl ProviderOAuthStore {
    pub fn empty() -> Self {
        Self::default()
    }

    /// Insert or replace a profile. If this is the first profile, it
    /// becomes active automatically.
    pub fn upsert_profile(&mut self, name: impl Into<String>, profile: OAuthProfile) {
        let name = name.into();
        let should_activate = match self.active_profile.as_deref() {
            None => true,
            Some(current) => !self.profiles.contains_key(current),
        };
        self.profiles.insert(name.clone(), profile);
        if should_activate {
            self.active_profile = Some(name);
        }
    }

    /// Set the active profile. Errors if the named profile does not exist.
    pub fn set_active(&mut self, name: &str) -> Result<(), String> {
        if !self.profiles.contains_key(name) {
            return Err(format!("profile {:?} not found", name));
        }
        self.active_profile = Some(name.to_string());
        Ok(())
    }

    /// Remove a profile. If it was active, picks another profile
    /// alphabetically (stable), or clears active if none remain.
    pub fn remove_profile(&mut self, name: &str) -> Option<OAuthProfile> {
        let removed = self.profiles.remove(name);
        if removed.is_some() && self.active_profile.as_deref() == Some(name) {
            self.active_profile = self.profiles.keys().min().cloned();
        }
        removed
    }

    /// Currently-active profile, if any.
    pub fn active(&self) -> Option<&OAuthProfile> {
        let name = self.active_profile.as_deref()?;
        self.profiles.get(name)
    }

    /// Mutable access to the active profile, if any.
    pub fn active_mut(&mut self) -> Option<&mut OAuthProfile> {
        let name = self.active_profile.clone()?;
        self.profiles.get_mut(&name)
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

/// Returns true if `json` is already in the new `ProviderOAuthStore` shape.
///
/// Uses a structural peek: presence of a top-level `profiles` field is the
/// discriminant. Not definitive for malformed JSON — callers should treat a
/// `false` result as "try to migrate" rather than "definitely legacy."
pub fn is_already_migrated(json: &str) -> bool {
    match serde_json::from_str::<serde_json::Value>(json) {
        Ok(serde_json::Value::Object(map)) => map.contains_key("profiles"),
        _ => false,
    }
}

/// Convert a legacy single-token OAuth JSON blob into a `ProviderOAuthStore`.
///
/// If the input is already in the new shape, returns the parsed store as-is
/// (idempotent).
///
/// The legacy shape is `OAuthToken` for Anthropic and `OpenAIOAuthToken` for
/// OpenAI — both share all the fields we care about via the tolerant parser
/// below, so we don't need to branch by provider at the field level. The
/// `provider` argument is accepted for logging/future use only.
pub fn migrate_legacy_blob(json: &str, provider: &str) -> Result<ProviderOAuthStore, String> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("legacy OAuth blob is not valid JSON: {}", e))?;

    // Fast path: already migrated.
    if v.get("profiles").is_some() {
        return serde_json::from_value::<ProviderOAuthStore>(v)
            .map_err(|e| format!("failed to parse already-migrated store: {}", e));
    }

    let obj = v.as_object().ok_or_else(|| {
        format!("legacy OAuth blob is not a JSON object (provider={})", provider)
    })?;

    let access_token = obj
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or_else(|| format!("legacy blob missing access_token (provider={})", provider))?
        .to_string();

    if access_token.is_empty() {
        return Err(format!("legacy blob has empty access_token (provider={})", provider));
    }

    // Legacy `OAuthToken` may or may not have refresh_token.
    let refresh_token = obj
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    let expires_at = obj
        .get("expires_at")
        .and_then(|x| x.as_i64())
        .or_else(|| {
            obj.get("expires_at")
                .and_then(|x| x.as_u64())
                .and_then(|n| i64::try_from(n).ok())
        })
        .unwrap_or(0);

    let id_token = obj
        .get("id_token")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());

    let account_id = obj
        .get("account_id")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());

    let plan_type = obj
        .get("plan_type")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());

    // `email` is left empty on migration because we have no identity
    // information from the legacy blob. It will be populated on the next
    // successful OAuth sign-in via save_{provider}_oauth_token.
    let profile = OAuthProfile {
        access_token,
        refresh_token,
        id_token,
        expires_at,
        last_refresh: 0,
        email: String::new(),
        account_id,
        plan_type,
    };

    let mut store = ProviderOAuthStore::empty();
    store.upsert_profile("default", profile);
    Ok(store)
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
        assert!(store.active_profile.is_none());
    }

    #[test]
    fn add_first_profile_sets_active() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("default", sample_profile("a@b.com"));
        assert_eq!(store.active_profile.as_deref(), Some("default"));
        assert_eq!(store.profiles.len(), 1);
    }

    #[test]
    fn add_second_profile_does_not_change_active() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("work", sample_profile("work@co.com"));
        store.upsert_profile("home", sample_profile("home@me.com"));
        assert_eq!(store.active_profile.as_deref(), Some("work"));
        assert_eq!(store.profiles.len(), 2);
    }

    #[test]
    fn set_active_changes_active_field() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("a", sample_profile("a@x"));
        store.upsert_profile("b", sample_profile("b@x"));
        assert!(store.set_active("b").is_ok());
        assert_eq!(store.active_profile.as_deref(), Some("b"));
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
        assert_eq!(store.active_profile.as_deref(), Some("a"));
        store.remove_profile("a");
        assert_eq!(store.active_profile.as_deref(), Some("b"));
        assert_eq!(store.profiles.len(), 1);
    }

    #[test]
    fn remove_last_profile_clears_active() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("a", sample_profile("a@x"));
        store.remove_profile("a");
        assert!(store.active_profile.is_none());
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
        assert_eq!(parsed.active_profile.as_deref(), Some("default"));
        assert_eq!(parsed.profiles["default"].email, "me@x");
    }

    #[test]
    fn active_returns_none_for_stale_cursor() {
        // Simulates a vault blob where active_profile names a profile that
        // no longer exists (partial-write or manual edit scenario).
        let json = r#"{"active_profile":"ghost","profiles":{}}"#;
        let store: ProviderOAuthStore = serde_json::from_str(json).unwrap();
        assert!(store.active().is_none());
    }

    #[test]
    fn upsert_repairs_stale_cursor() {
        // If the store is deserialized with a stale cursor, the next upsert
        // should promote the newly-inserted profile to active.
        let json = r#"{"active_profile":"ghost","profiles":{}}"#;
        let mut store: ProviderOAuthStore = serde_json::from_str(json).unwrap();
        store.upsert_profile("new", sample_profile("new@x"));
        assert_eq!(store.active_profile.as_deref(), Some("new"));
        assert!(store.active().is_some());
    }

    #[test]
    fn remove_active_picks_alphabetical_min_from_three() {
        // Verifies the "alphabetically (stable)" claim in the doc comment.
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("charlie", sample_profile("c@x"));
        store.upsert_profile("alpha", sample_profile("a@x"));
        store.upsert_profile("bravo", sample_profile("b@x"));
        // charlie became active first (first profile), so make it active explicitly
        store.set_active("charlie").unwrap();
        store.remove_profile("charlie");
        // Remaining: alpha, bravo. Min = alpha.
        assert_eq!(store.active_profile.as_deref(), Some("alpha"));
    }

    #[test]
    fn migrate_legacy_anthropic_blob() {
        // Legacy shape: the JSON of an `OAuthToken`.
        let legacy = r#"{
            "access_token": "sk-ant-oat-abc",
            "refresh_token": "sk-ant-ort-abc",
            "expires_at": 1700000000,
            "token_type": "Bearer",
            "scope": null
        }"#;

        let store = migrate_legacy_blob(legacy, "anthropic")
            .expect("should migrate legacy blob");

        assert_eq!(store.active_profile.as_deref(), Some("default"));
        assert_eq!(store.profiles.len(), 1);
        let p = store.profiles.get("default").unwrap();
        assert_eq!(p.access_token, "sk-ant-oat-abc");
        assert_eq!(p.refresh_token, "sk-ant-ort-abc");
        assert_eq!(p.expires_at, 1_700_000_000);
        assert_eq!(p.email, "");
        assert!(p.id_token.is_none());
        assert!(p.account_id.is_none());
    }

    #[test]
    fn migrate_legacy_openai_blob_with_account_id() {
        // OpenAI legacy shape includes id_token and account_id.
        let legacy = r#"{
            "access_token": "sk-openai-abc",
            "refresh_token": "ref-abc",
            "expires_at": 1700000000,
            "token_type": "Bearer",
            "scope": null,
            "id_token": "eyJheyJ.payload.sig",
            "account_id": "acct-123"
        }"#;

        let store = migrate_legacy_blob(legacy, "openai")
            .expect("should migrate legacy blob");
        let p = store.profiles.get("default").unwrap();
        assert_eq!(p.account_id.as_deref(), Some("acct-123"));
        assert_eq!(p.id_token.as_deref(), Some("eyJheyJ.payload.sig"));
    }

    #[test]
    fn migrate_detects_already_migrated() {
        let mut store = ProviderOAuthStore::empty();
        store.upsert_profile("default", sample_profile("a@b"));
        let json = serde_json::to_string(&store).unwrap();
        // Round-trips: migrating an already-migrated blob returns Ok(it_as_is).
        let migrated = migrate_legacy_blob(&json, "anthropic").unwrap();
        assert_eq!(migrated, store);
    }

    #[test]
    fn migrate_garbage_json_errors() {
        assert!(migrate_legacy_blob("not json", "anthropic").is_err());
        assert!(migrate_legacy_blob("{}", "anthropic").is_err());
        assert!(migrate_legacy_blob("null", "anthropic").is_err());
        assert!(migrate_legacy_blob("", "anthropic").is_err());
        // Empty access_token string must not produce a usable profile.
        assert!(migrate_legacy_blob(
            r#"{"access_token":"","refresh_token":"r","expires_at":1}"#,
            "anthropic"
        ).is_err());
    }

    #[test]
    fn is_already_migrated_detects_profiles_key() {
        assert!(is_already_migrated(r#"{"profiles":{},"active_profile":null}"#));
        assert!(is_already_migrated(r#"{"profiles":{}}"#));
        assert!(!is_already_migrated(r#"{"access_token":"x","expires_at":1}"#));
        assert!(!is_already_migrated("not even json"));
    }
}
