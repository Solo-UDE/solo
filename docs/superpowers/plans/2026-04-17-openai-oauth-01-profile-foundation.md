# Plan 1: Profile Foundation + Vault Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing single-token OAuth storage in a profile-keyed layer, with silent migration from the legacy shape. Anthropic OAuth continues to work throughout — no behavior change visible to the user after this plan lands.

**Architecture:** The vault is a `HashMap<String, String>` where each provider's OAuth is stored under `{provider}.oauth` as a single JSON-serialized `OAuthToken` (or `OpenAIOAuthToken` for OpenAI). We replace that value with a `ProviderOAuthStore` JSON: `{ active_profile: String, profiles: HashMap<String, OAuthProfile> }`. Migration detects the legacy shape by JSON content (absence of the `profiles` key) and wraps it into `profiles.default` on first vault load.

**Tech Stack:** Rust (workspace `solo-auth` crate), `serde_json`, `tokio`, existing `keyring` + macOS `security` CLI for vault persistence. Tests: in-crate `#[cfg(test)] mod tests` modules, `cargo test -p solo-auth`.

---

## File Structure

**New files:**
- `crates/solo-auth/src/oauth/profiles.rs` — `ProviderOAuthStore`, `OAuthProfile`, migration helpers

**Modified files:**
- `crates/solo-auth/src/oauth/mod.rs` — add `pub mod profiles;` and re-export
- `crates/solo-auth/src/credentials.rs` — route all OAuth read/write through `ProviderOAuthStore`; call migration from `load_vault`
- `crates/solo-auth/src/lib.rs` — no change expected; verify exports

**Unchanged this plan:**
- `apps/desktop/src/*` — frontend isn't touched
- `apps/desktop/src-tauri/src/provider_commands.rs` — command surface stays the same
- All provider-command tests should pass unchanged

---

## Task 1: ProviderOAuthStore and OAuthProfile types

**Files:**
- Create: `crates/solo-auth/src/oauth/profiles.rs`
- Modify: `crates/solo-auth/src/oauth/mod.rs`

- [ ] **Step 1: Write the failing tests**

Create `crates/solo-auth/src/oauth/profiles.rs` with ONLY the test module (no implementation yet):

```rust
//! Profile-keyed OAuth storage.
//!
//! Wraps one or more OAuth tokens under named profiles, allowing a single
//! provider to hold multiple accounts. The active profile is the one
//! `CredentialManager::get_credentials` returns by default.

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
```

- [ ] **Step 2: Register the module**

Edit `crates/solo-auth/src/oauth/mod.rs` to add the new module. Insert `pub mod profiles;` right after `pub mod callback_server;`:

```rust
pub mod types;
pub mod pkce;
pub mod callback_server;
pub mod profiles;
pub mod providers;
```

- [ ] **Step 3: Run the tests to confirm they fail**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo test -p solo-auth --lib oauth::profiles
```

Expected: compile errors — `ProviderOAuthStore` and `OAuthProfile` are undefined.

- [ ] **Step 4: Implement the types**

Add this to the top of `crates/solo-auth/src/oauth/profiles.rs` (above the `#[cfg(test)] mod tests` block):

```rust
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
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo test -p solo-auth --lib oauth::profiles
```

Expected: all 9 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
git add crates/solo-auth/src/oauth/profiles.rs crates/solo-auth/src/oauth/mod.rs
git commit -m "feat(solo-auth): add ProviderOAuthStore and OAuthProfile types"
```

---

## Task 2: Legacy-blob migration helpers

Add pure functions that convert a legacy single-token blob (whatever is currently stored at `{provider}.oauth`) into a `ProviderOAuthStore` with a `default` profile. Detection is content-based: if the JSON has a top-level `profiles` field it's already migrated; otherwise treat it as legacy.

**Files:**
- Modify: `crates/solo-auth/src/oauth/profiles.rs`

- [ ] **Step 1: Write the failing tests**

Append these tests to the existing `#[cfg(test)] mod tests` block in `crates/solo-auth/src/oauth/profiles.rs`, right before the closing `}`:

```rust
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

        assert_eq!(store.active_profile, "default");
        assert_eq!(store.profiles.len(), 1);
        let p = store.profiles.get("default").unwrap();
        assert_eq!(p.access_token, "sk-ant-oat-abc");
        assert_eq!(p.refresh_token, "sk-ant-ort-abc");
        assert_eq!(p.expires_at, 1_700_000_000);
        assert_eq!(p.email, "default");
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
    }

    #[test]
    fn is_already_migrated_detects_profiles_key() {
        assert!(is_already_migrated(r#"{"profiles":{},"active_profile":""}"#));
        assert!(!is_already_migrated(r#"{"access_token":"x","expires_at":1}"#));
        assert!(!is_already_migrated("not even json"));
    }
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo test -p solo-auth --lib oauth::profiles
```

Expected: compile errors for `migrate_legacy_blob` and `is_already_migrated`.

- [ ] **Step 3: Implement the migration helpers**

Add these functions to `crates/solo-auth/src/oauth/profiles.rs`, after the `ProviderOAuthStore` impl block and before the `#[cfg(test)]` block:

```rust
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
    // Fast path: already migrated.
    if is_already_migrated(json) {
        return serde_json::from_str::<ProviderOAuthStore>(json)
            .map_err(|e| format!("failed to parse already-migrated store: {}", e));
    }

    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("legacy OAuth blob is not valid JSON: {}", e))?;

    let obj = v.as_object().ok_or_else(|| {
        format!("legacy OAuth blob is not a JSON object (provider={})", provider)
    })?;

    let access_token = obj
        .get("access_token")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "legacy blob missing access_token".to_string())?
        .to_string();

    // Legacy `OAuthToken` may or may not have refresh_token.
    let refresh_token = obj
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    let expires_at = obj
        .get("expires_at")
        .and_then(|x| x.as_i64())
        .or_else(|| obj.get("expires_at").and_then(|x| x.as_u64()).map(|n| n as i64))
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

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let profile = OAuthProfile {
        access_token,
        refresh_token,
        id_token,
        expires_at,
        last_refresh: now,
        email: "default".to_string(),
        account_id,
        plan_type,
    };

    let mut store = ProviderOAuthStore::empty();
    store.upsert_profile("default", profile);
    Ok(store)
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo test -p solo-auth --lib oauth::profiles
```

Expected: all tests in the module (originals + new) pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
git add crates/solo-auth/src/oauth/profiles.rs
git commit -m "feat(solo-auth): add migrate_legacy_blob for profile store migration"
```

---

## Task 3: Route OAuth reads through ProviderOAuthStore

Replace the internals of `get_oauth_token`, `save_oauth_token`, and their OpenAI twins in `credentials.rs` so they operate on `ProviderOAuthStore` instead of a single token. Migration happens lazily on read: when the stored blob is legacy, we wrap it, **write the migrated version back**, and then return the active profile.

Keep the existing public method signatures (`get_oauth_token(provider) -> Option<OAuthToken>`, etc.) so callers compile unchanged.

**Files:**
- Modify: `crates/solo-auth/src/credentials.rs`

- [ ] **Step 1: Read the existing implementations**

Find these in `crates/solo-auth/src/credentials.rs` (use `grep -n 'fn get_oauth_token\|fn save_oauth_token\|fn get_openai_oauth_token\|fn save_openai_oauth_token\|fn clear_oauth\|fn clear_openai_oauth' crates/solo-auth/src/credentials.rs` to locate exact line numbers). They currently read/write the `{provider}.oauth` vault key as a JSON-serialized `OAuthToken` or `OpenAIOAuthToken` directly.

Note the existing method signatures before touching them; they must stay the same.

- [ ] **Step 2: Add failing tests**

Append a new `#[cfg(test)]` module at the bottom of `crates/solo-auth/src/credentials.rs` (if one exists already, append to it; otherwise add fresh). These tests exercise the end-to-end profile-store round trip through the CredentialManager's public API:

```rust
#[cfg(test)]
mod profile_tests {
    use super::*;
    use crate::oauth::profiles::ProviderOAuthStore;
    use crate::provider::ProviderType;

    /// Helper: build a CredentialManager whose vault is pre-populated with
    /// the given in-memory map, bypassing keychain I/O.
    ///
    /// Must be awaited from inside a tokio test context — does not spawn
    /// its own runtime.
    async fn manager_with_vault(data: HashMap<String, String>) -> CredentialManager {
        let m = CredentialManager::new();
        *m.vault.write().await = Some(data);
        m
    }

    #[tokio::test]
    async fn get_oauth_token_returns_active_profile_as_oauth_token() {
        let store = ProviderOAuthStore {
            active_profile: "default".into(),
            profiles: {
                let mut m = HashMap::new();
                m.insert(
                    "default".into(),
                    crate::oauth::profiles::OAuthProfile {
                        access_token: "ak-abc".into(),
                        refresh_token: "rk-abc".into(),
                        id_token: None,
                        expires_at: 9_999_999_999,
                        last_refresh: 0,
                        email: "me@x".into(),
                        account_id: None,
                        plan_type: None,
                    },
                );
                m
            },
        };
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
    }

    #[tokio::test]
    async fn save_oauth_token_creates_default_profile() {
        let m = manager_with_vault(HashMap::new()).await;
        let token = crate::oauth::OAuthToken::new(
            "new-ak".into(),
            Some("new-rk".into()),
            3600,
            "Bearer".into(),
            None,
        );
        m.save_oauth_token(ProviderType::Anthropic, token.clone())
            .await
            .unwrap();

        let got = m
            .get_oauth_token(ProviderType::Anthropic)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(got.access_token, "new-ak");
    }

    #[tokio::test]
    async fn clear_oauth_removes_all_profiles() {
        let m = manager_with_vault(HashMap::new()).await;
        let token = crate::oauth::OAuthToken::new(
            "ak".into(),
            None,
            3600,
            "Bearer".into(),
            None,
        );
        m.save_oauth_token(ProviderType::Anthropic, token).await.unwrap();
        m.clear_oauth_token(ProviderType::Anthropic).await.unwrap();

        assert!(m
            .get_oauth_token(ProviderType::Anthropic)
            .await
            .unwrap()
            .is_none());
    }
}
```

- [ ] **Step 3: Run the tests to confirm they fail**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo test -p solo-auth --lib credentials::profile_tests
```

Expected: some combination of FAIL / compile error for `clear_oauth_token` if that name differs. If the existing method is named differently (e.g., `delete_oauth_token` or `sign_out`), update the test to match the existing name — do NOT rename the implementation.

- [ ] **Step 4: Rewrite the OAuth read/write internals**

This step edits **only the bodies** of these methods in `crates/solo-auth/src/credentials.rs`:
- `get_oauth_token`
- `save_oauth_token`
- `clear_oauth_token` (or whatever the existing delete method is called — keep the existing name)

Do not change the signatures. Do not touch the OpenAI-specific variants yet (next task).

Inside `credentials.rs`, find the current `get_oauth_token` implementation. Replace its body with:

```rust
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
    let store = match crate::oauth::profiles::migrate_legacy_blob(&raw, provider.as_str()) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(
                "failed to parse OAuth store for {}: {} — treating as absent",
                provider.as_str(), e
            );
            return Ok(None);
        }
    };

    // If we just migrated, persist the new shape back so next load is fast.
    if !crate::oauth::profiles::is_already_migrated(&raw) {
        if let Ok(new_json) = serde_json::to_string(&store) {
            if let Err(e) = self.vault_set(&key, &new_json).await {
                tracing::warn!("failed to persist migrated OAuth store: {}", e);
            }
        }
    }

    let active = match store.active() {
        Some(p) => p,
        None => return Ok(None),
    };

    // Project the active profile into the legacy OAuthToken shape that
    // callers still expect.
    let token = OAuthToken {
        access_token: active.access_token.clone(),
        refresh_token: if active.refresh_token.is_empty() {
            None
        } else {
            Some(active.refresh_token.clone())
        },
        expires_at: active.expires_at.max(0) as u64,
        token_type: "Bearer".into(),
        scope: None,
    };

    Ok(Some(token))
}
```

Replace `save_oauth_token`'s body with:

```rust
pub async fn save_oauth_token(
    &self,
    provider: ProviderType,
    token: OAuthToken,
) -> ProviderResult<()> {
    let key = Self::oauth_vault_key(provider);

    // Load-or-create the store.
    let mut store = match self.vault_get(&key).await? {
        Some(s) if !s.is_empty() => {
            crate::oauth::profiles::migrate_legacy_blob(&s, provider.as_str())
                .unwrap_or_else(|_| crate::oauth::profiles::ProviderOAuthStore::empty())
        }
        _ => crate::oauth::profiles::ProviderOAuthStore::empty(),
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Preserve existing email/account_id/plan_type for the active profile
    // when overwriting — we only have a token, not identity fields.
    let active_name = if store.active_profile.is_empty() {
        "default".to_string()
    } else {
        store.active_profile.clone()
    };
    let existing = store.profiles.get(&active_name).cloned();

    let profile = crate::oauth::profiles::OAuthProfile {
        access_token: token.access_token,
        refresh_token: token.refresh_token.unwrap_or_default(),
        id_token: existing.as_ref().and_then(|e| e.id_token.clone()),
        expires_at: token.expires_at as i64,
        last_refresh: now,
        email: existing.as_ref().map(|e| e.email.clone()).unwrap_or_else(|| "default".into()),
        account_id: existing.as_ref().and_then(|e| e.account_id.clone()),
        plan_type: existing.as_ref().and_then(|e| e.plan_type.clone()),
    };
    store.upsert_profile(active_name, profile);

    let json = serde_json::to_string(&store).map_err(|e| {
        ProviderError::KeychainError(format!("serialize OAuth store: {}", e))
    })?;
    self.vault_set(&key, &json).await?;

    // Invalidate cache.
    self.oauth_cache.write().await.remove(&provider);
    Ok(())
}
```

Replace `clear_oauth_token` (or whatever the existing name is; keep that name) with:

```rust
pub async fn clear_oauth_token(&self, provider: ProviderType) -> ProviderResult<()> {
    let key = Self::oauth_vault_key(provider);
    self.vault_delete(&key).await?;
    self.oauth_cache.write().await.remove(&provider);
    Ok(())
}
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo test -p solo-auth --lib credentials::profile_tests
```

Expected: all 4 tests pass. If `clear_oauth_token` is named differently in the existing codebase (e.g., `delete_oauth_token`), the test must use the existing name — do not introduce a new alias.

- [ ] **Step 6: Confirm the full crate still builds and tests pass**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo test -p solo-auth
```

Expected: all pre-existing tests still pass alongside the new ones. No warnings newly introduced.

- [ ] **Step 7: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
git add crates/solo-auth/src/credentials.rs
git commit -m "refactor(solo-auth): route Anthropic OAuth through ProviderOAuthStore

Adds lazy migration: the first read of a legacy single-token blob wraps
it into profiles.default and persists the new shape. Public API is
unchanged — get_oauth_token / save_oauth_token still take OAuthToken."
```

---

## Task 4: Route OpenAI OAuth through ProviderOAuthStore

Mirror Task 3 for `get_openai_oauth_token`, `save_openai_oauth_token`, and the OpenAI clear method. The OpenAI profile retains `id_token` and `account_id`, which the generic `OAuthToken` shape doesn't carry.

**Files:**
- Modify: `crates/solo-auth/src/credentials.rs`

- [ ] **Step 1: Locate the existing OpenAI OAuth methods**

Use grep to find them:

```bash
grep -n 'fn get_openai_oauth_token\|fn save_openai_oauth_token\|fn clear_openai_oauth\|fn delete_openai_oauth' crates/solo-auth/src/credentials.rs
```

Note their existing signatures. They operate on `OpenAIOAuthToken` (with `id_token` and `account_id`).

- [ ] **Step 2: Add failing tests**

Append to the `profile_tests` module at the bottom of `crates/solo-auth/src/credentials.rs`:

```rust
    #[tokio::test]
    async fn get_openai_oauth_token_returns_active_profile_with_account_id() {
        let store = ProviderOAuthStore {
            active_profile: "default".into(),
            profiles: {
                let mut m = HashMap::new();
                m.insert(
                    "default".into(),
                    crate::oauth::profiles::OAuthProfile {
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
                m
            },
        };
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
        assert_eq!(token.account_id.as_deref(), Some("acct-xyz"));
        assert_eq!(token.id_token.as_deref(), Some("eyJ.p.s"));
    }

    #[tokio::test]
    async fn save_openai_oauth_token_persists_identity_fields() {
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
        };
        m.save_openai_oauth_token(token, Some("me@openai".into()))
            .await
            .unwrap();

        let got = m.get_openai_oauth_token().await.unwrap().unwrap();
        assert_eq!(got.account_id.as_deref(), Some("acct-fresh"));
        assert_eq!(got.id_token.as_deref(), Some("jwt"));
    }
```

Note: the test calls `save_openai_oauth_token(token, Some("me@openai"))` — this is the **new** signature (with an optional email). If the existing signature is just `(token)`, the test will fail to compile and Step 4 will fix it by accepting a second arg with a default (see below).

- [ ] **Step 3: Run to confirm the tests fail**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo test -p solo-auth --lib credentials::profile_tests::save_openai_oauth_token_persists_identity_fields credentials::profile_tests::get_openai_oauth_token_returns_active_profile_with_account_id
```

Expected: FAIL.

- [ ] **Step 4: Rewrite the OpenAI OAuth methods**

Replace `get_openai_oauth_token`'s body with:

```rust
pub async fn get_openai_oauth_token(&self) -> ProviderResult<Option<OpenAIOAuthToken>> {
    if let Some(info) = self.openai_oauth_cache.read().await.as_ref() {
        return Ok(Some(info.token.clone()));
    }

    let key = Self::oauth_vault_key(ProviderType::OpenAI);
    let raw = match self.vault_get(&key).await? {
        Some(s) if !s.is_empty() => s,
        _ => return Ok(None),
    };

    let store = match crate::oauth::profiles::migrate_legacy_blob(&raw, "openai") {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("failed to parse OpenAI OAuth store: {} — treating as absent", e);
            return Ok(None);
        }
    };

    if !crate::oauth::profiles::is_already_migrated(&raw) {
        if let Ok(new_json) = serde_json::to_string(&store) {
            let _ = self.vault_set(&key, &new_json).await;
        }
    }

    let active = match store.active() {
        Some(p) => p,
        None => return Ok(None),
    };

    let token = OpenAIOAuthToken {
        access_token: active.access_token.clone(),
        refresh_token: if active.refresh_token.is_empty() {
            None
        } else {
            Some(active.refresh_token.clone())
        },
        expires_at: active.expires_at.max(0) as u64,
        token_type: "Bearer".into(),
        scope: None,
        id_token: active.id_token.clone(),
        account_id: active.account_id.clone(),
    };
    Ok(Some(token))
}
```

Replace `save_openai_oauth_token`. The new signature takes an optional email; if the existing signature was `(token)`, adjust it — **and update every caller** (we'll grep to find them):

```rust
pub async fn save_openai_oauth_token(
    &self,
    token: OpenAIOAuthToken,
    email: Option<String>,
) -> ProviderResult<()> {
    let key = Self::oauth_vault_key(ProviderType::OpenAI);

    let mut store = match self.vault_get(&key).await? {
        Some(s) if !s.is_empty() => {
            crate::oauth::profiles::migrate_legacy_blob(&s, "openai")
                .unwrap_or_else(|_| crate::oauth::profiles::ProviderOAuthStore::empty())
        }
        _ => crate::oauth::profiles::ProviderOAuthStore::empty(),
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let active_name = if store.active_profile.is_empty() {
        "default".to_string()
    } else {
        store.active_profile.clone()
    };
    let existing = store.profiles.get(&active_name).cloned();

    let resolved_email = email
        .or_else(|| existing.as_ref().map(|e| e.email.clone()))
        .unwrap_or_else(|| "default".into());

    let profile = crate::oauth::profiles::OAuthProfile {
        access_token: token.access_token,
        refresh_token: token.refresh_token.unwrap_or_default(),
        id_token: token.id_token.or_else(|| existing.as_ref().and_then(|e| e.id_token.clone())),
        expires_at: token.expires_at as i64,
        last_refresh: now,
        email: resolved_email,
        account_id: token.account_id.or_else(|| existing.as_ref().and_then(|e| e.account_id.clone())),
        plan_type: existing.as_ref().and_then(|e| e.plan_type.clone()),
    };
    store.upsert_profile(active_name, profile);

    let json = serde_json::to_string(&store).map_err(|e| {
        ProviderError::KeychainError(format!("serialize OpenAI OAuth store: {}", e))
    })?;
    self.vault_set(&key, &json).await?;

    *self.openai_oauth_cache.write().await = None;
    Ok(())
}
```

Replace the OpenAI OAuth clear method (keep its existing name) with:

```rust
pub async fn clear_openai_oauth_token(&self) -> ProviderResult<()> {
    let key = Self::oauth_vault_key(ProviderType::OpenAI);
    self.vault_delete(&key).await?;
    *self.openai_oauth_cache.write().await = None;
    Ok(())
}
```

- [ ] **Step 5: Fix any callers of save_openai_oauth_token that broke**

Grep for callers across the workspace and add `None` as the second argument:

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
grep -rn "save_openai_oauth_token" --include="*.rs"
```

For each hit outside `crates/solo-auth/src/credentials.rs`, replace the call:
- OLD: `save_openai_oauth_token(token)`
- NEW: `save_openai_oauth_token(token, None)`

Each caller site fix is a one-line edit; do them all in this step.

- [ ] **Step 6: Build + test the full crate**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
cargo test -p solo-auth
bun run check
```

Expected: all tests pass. `bun run check` runs `cargo check` + `tsc` — both clean. TypeScript typecheck is fine at this stage; we haven't touched any TS yet.

- [ ] **Step 7: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
git add crates/solo-auth/src/credentials.rs
# Also stage any caller files modified in Step 5 (grep output tells you which).
git commit -m "refactor(solo-auth): route OpenAI OAuth through ProviderOAuthStore

OpenAIOAuthToken reads/writes now go through the profile store, with
lazy migration from legacy blobs. save_openai_oauth_token now accepts
an optional email for the profile label."
```

---

## Task 5: Smoke test — real startup with legacy data

Before handing off to Plan 2, verify the migration works end-to-end against a real vault on disk. This is the only manual step in the plan.

**Files:** none modified — this is a manual verification.

- [ ] **Step 1: Back up any existing vault**

If the developer machine has been used with Solo before and may contain real Anthropic OAuth credentials, save a copy:

```bash
/usr/bin/security find-generic-password -s com.solo-ide.credentials -a vault -w > /tmp/solo-vault-backup-$(date +%s).json
```

If it errors with "item not found," there is no vault — skip to Step 2.

- [ ] **Step 2: Run Solo in dev mode**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo
bun run dev
```

Wait for the app to open. Confirm Settings → AI tab still shows the Anthropic provider as "Connected" (if you had it connected before) with the correct email.

- [ ] **Step 3: Inspect the migrated vault**

After the app has loaded and the vault was read at least once, inspect:

```bash
/usr/bin/security find-generic-password -s com.solo-ide.credentials -a vault -w | python3 -m json.tool | grep -A 20 '"anthropic.oauth"'
```

Expected: the `anthropic.oauth` value is now a JSON string containing `"active_profile":"default"` and `"profiles":{"default":{...}}`. (Note: the vault's outer shape is `HashMap<String, String>` so the inner JSON appears as an escaped string.)

If the value still looks like the legacy `{"access_token":..., "expires_at":...}` shape, the migration didn't run. Check the tracing logs from the dev mode terminal for any warning emitted by the `migrate_legacy_blob` call path.

- [ ] **Step 4: Confirm signing in still works**

In Settings → AI tab, sign out of Anthropic, then sign back in via OAuth. Confirm:
- The sign-in flow completes.
- The vault now contains a `profiles.default` entry with the new email.
- The chat still works — send a test message to Claude.

- [ ] **Step 5: Commit nothing**

No code changes in this task — it's verification only. If anything failed, open a new task to fix and rerun; do not proceed to Plan 2 until smoke test is clean.

---

## Plan complete

State at end of Plan 1:
- **Vault storage** for `{provider}.oauth` is `ProviderOAuthStore`-shaped.
- **Legacy migration** runs silently on first read, then persists the new shape.
- **All existing public APIs** (`get_oauth_token`, `save_oauth_token`, and OpenAI twins) work unchanged from the caller's perspective.
- **No frontend changes.** Settings UI is untouched.
- **No new commands.** No BackendEvent additions.
- **No OpenAI end-user-visible behavior.** Plan 2 introduces that.

Next plan: `docs/superpowers/plans/2026-04-17-openai-oauth-02-auth-wiring.md` — generalize `provider_commands.rs` OAuth commands to be profile-aware, wire the OpenAI OAuth flow end-to-end, add API-key validation, emit `OAuthFlow*` BackendEvents.
