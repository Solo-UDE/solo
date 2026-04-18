# Plan 2: OpenAI OAuth Wiring + Profile Management + API-Key Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenAI OAuth sign-in land a complete, labeled profile in the vault; add profile-management Tauri commands; validate API keys before storing; expose profile-aware actions on the frontend store.

**Architecture:** Most of the OAuth flow already works — `provider_commands.rs` already routes Anthropic AND OpenAI through `start_oauth_flow`/`complete_oauth_flow`, and Plan 1 made the underlying storage profile-capable. Plan 2 adds the missing pieces: (a) email extraction from the OpenAI id_token JWT so the active profile is labeled, (b) per-profile management commands that Plan 4's UI will consume, (c) a lightweight auth-check ping that rejects invalid API keys at paste time.

**Tech Stack:** Rust (solo-auth, solo-desktop), Tauri 2, ts-rs for TypeScript type generation, React/Zustand frontend store.

---

## File Structure

**New files:** none.

**Modified files:**
- `crates/solo-auth/src/oauth/providers/openai.rs` — add `extract_email_from_jwt`; thread email into `exchange_code` / `refresh_token` return value.
- `crates/solo-auth/src/oauth/types.rs` — add optional `email` field to `OpenAIOAuthToken` (serializable, backward-compatible via `#[serde(default)]`).
- `crates/solo-auth/src/credentials.rs` — `set_openai_oauth_token` honors the new `email` field on the token; add profile management methods (`list_profiles`, `set_active_profile`, `remove_profile`).
- `crates/solo-auth/src/lib.rs` — re-export new types if added.
- `apps/desktop/src-tauri/src/provider_commands.rs` — add Tauri commands `list_profiles`, `set_active_profile`, `remove_profile`, `sign_out_profile`, `validate_api_key`; wire a validation call into existing `set_credentials`.
- `apps/desktop/src-tauri/src/lib.rs` — register the new commands in `generate_handler!`.
- `apps/desktop/src/lib/backend.ts` OR the sibling `lib/tauri/*.ts` file — TS wrappers for the new commands. (Existing backend glue lives in `lib/backend.ts`; add wrappers there following the surrounding pattern.)
- `apps/desktop/src/stores/provider-store.ts` — add `profiles`, `activeProfile` state and `refreshProfiles`, `setActiveProfile`, `removeProfile`, `signOutProfile` actions.
- `apps/desktop/src/bindings/*` — regenerated via `bun run gen:bindings` after ts-rs types change. **Never hand-edit.**

**Unchanged this plan:**
- `agent-bridge/*` — sidecar work is Plan 3.
- `WelcomeScreen.tsx`, `AITab.tsx`, `model-picker.tsx` — UI upgrades are Plan 4.
- All of Plan 1's profile-store code in `oauth/profiles.rs` — stable.

---

## Task 1: Extract email from OpenAI id_token JWT, thread into profile

The `id_token` returned by OpenAI contains an `email` claim (standard OIDC). Today only `account_id` is extracted. This task adds email extraction and plumbs it through to the stored profile so the UI can show a meaningful account label.

**Files:**
- Modify: `crates/solo-auth/src/oauth/types.rs`
- Modify: `crates/solo-auth/src/oauth/providers/openai.rs`
- Modify: `crates/solo-auth/src/credentials.rs`

- [ ] **Step 1: Add `email` field to `OpenAIOAuthToken`**

Open `crates/solo-auth/src/oauth/types.rs`. Find the `OpenAIOAuthToken` struct (around line 256). Add the `email` field and update `from_response`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenAIOAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: u64,
    pub token_type: String,
    pub scope: Option<String>,
    pub id_token: Option<String>,
    pub account_id: Option<String>,
    /// Email extracted from the id_token's `email` claim. `None` if the JWT
    /// did not include one (e.g. older tokens, stripped by refresh flow).
    #[serde(default)]
    pub email: Option<String>,
}

impl OpenAIOAuthToken {
    pub fn from_response(
        response: OpenAITokenResponse,
        account_id: Option<String>,
        email: Option<String>,
    ) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or(std::time::Duration::ZERO)
            .as_secs();

        Self {
            access_token: response.access_token,
            refresh_token: response.refresh_token,
            expires_at: now + response.expires_in,
            token_type: response.token_type,
            scope: response.scope,
            id_token: response.id_token,
            account_id,
            email,
        }
    }
```

(Leave the rest of `impl OpenAIOAuthToken` alone — `is_expired`, `needs_refresh`, `to_oauth_token`, etc. are unchanged.)

- [ ] **Step 2: Add tests for `extract_email_from_jwt`**

Open `crates/solo-auth/src/oauth/providers/openai.rs`. Append these tests to the existing `#[cfg(test)] mod tests` block (just before the closing `}` of the module):

```rust
    #[test]
    fn test_extract_email_from_jwt() {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(
            r#"{"iss":"https://auth.openai.com/","email":"alice@example.com","sub":"user"}"#,
        );
        let test_jwt = format!("{}.{}.", header, payload);
        assert_eq!(
            extract_email_from_jwt(&test_jwt),
            Some("alice@example.com".to_string())
        );
    }

    #[test]
    fn test_extract_email_wrong_issuer_rejected() {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(
            r#"{"iss":"https://evil.example.com/","email":"phish@evil.com"}"#,
        );
        let test_jwt = format!("{}.{}.", header, payload);
        assert!(extract_email_from_jwt(&test_jwt).is_none());
    }

    #[test]
    fn test_extract_email_missing_returns_none() {
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(
            r#"{"iss":"https://auth.openai.com/","sub":"user"}"#,
        );
        let test_jwt = format!("{}.{}.", header, payload);
        assert!(extract_email_from_jwt(&test_jwt).is_none());
    }

    #[test]
    fn test_extract_email_invalid_jwt_returns_none() {
        assert!(extract_email_from_jwt("not.a.jwt").is_none());
        assert!(extract_email_from_jwt("").is_none());
    }
```

- [ ] **Step 3: Run the new tests — they fail because `extract_email_from_jwt` doesn't exist**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
cargo test -p solo-auth --lib oauth::providers::openai::tests
```

Expected: compile error `cannot find function extract_email_from_jwt in this scope`.

- [ ] **Step 4: Implement `extract_email_from_jwt`**

In `crates/solo-auth/src/oauth/providers/openai.rs`, add this function right after `extract_account_id_from_jwt`:

```rust
/// Extract the account email from an OpenAI id_token JWT.
///
/// Validates `iss` matches OpenAI's auth domain before trusting the `email`
/// claim. Returns `None` on any parse failure or issuer mismatch. The caller
/// should treat `None` as "unknown email" rather than "email is genuinely
/// absent" — both cases land in the same code path (empty label in UI).
fn extract_email_from_jwt(id_token: &str) -> Option<String> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    let decoded = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    let json_str = String::from_utf8(decoded).ok()?;
    let claims: serde_json::Value = serde_json::from_str(&json_str).ok()?;

    // Same issuer check as extract_account_id_from_jwt.
    match claims.get("iss").and_then(|v| v.as_str()) {
        Some(iss) if iss == OPENAI_JWT_ISSUER => {}
        _ => return None,
    }

    claims
        .get("email")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}
```

- [ ] **Step 5: Run the tests — they should now pass**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
cargo test -p solo-auth --lib oauth::providers::openai::tests
```

Expected: all tests (existing + 4 new) pass.

- [ ] **Step 6: Thread email through `exchange_code` and `refresh_token`**

Still in `crates/solo-auth/src/oauth/providers/openai.rs`, find `exchange_code` (around line 67). Replace the final 5 lines (after the JSON parse) with:

```rust
        let account_id = token_response.id_token.as_ref()
            .and_then(|id_token| extract_account_id_from_jwt(id_token));
        let email = token_response.id_token.as_ref()
            .and_then(|id_token| extract_email_from_jwt(id_token));

        Ok(OpenAIOAuthToken::from_response(token_response, account_id, email))
    }
```

Apply the same change to `refresh_token` (around line 110):

```rust
        let account_id = token_response.id_token.as_ref()
            .and_then(|id_token| extract_account_id_from_jwt(id_token));
        let email = token_response.id_token.as_ref()
            .and_then(|id_token| extract_email_from_jwt(id_token));

        Ok(OpenAIOAuthToken::from_response(token_response, account_id, email))
    }
```

- [ ] **Step 7: Update `set_openai_oauth_token` in credentials.rs to persist the email on the profile**

Open `crates/solo-auth/src/credentials.rs`. Locate `pub async fn set_openai_oauth_token` and find the profile construction block. The existing `email` line reads from `existing`:

```rust
email: existing
    .as_ref()
    .map(|e| e.email.clone())
    .unwrap_or_default(),
```

Replace it with:

```rust
// Prefer the email from the newly-issued token; fall back to whatever was
// already on the profile (preserves identity through refresh cycles that
// don't re-issue an id_token); fall back to "" as last resort.
email: token.email.clone().unwrap_or_else(|| {
    existing
        .as_ref()
        .map(|e| e.email.clone())
        .unwrap_or_default()
}),
```

- [ ] **Step 8: Add a test asserting email lands on the profile when the token carries one**

In `crates/solo-auth/src/credentials.rs`, append this test to the `#[cfg(test)] mod profile_tests` block:

```rust
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
```

Also update any pre-existing test that constructs `OpenAIOAuthToken { ... }` literally — grep for the struct literal inside `credentials.rs`:

```bash
grep -n "OpenAIOAuthToken {" crates/solo-auth/src/credentials.rs
```

For each construction site that is inside a test, add `email: None,` to the struct literal.

- [ ] **Step 9: Run all solo-auth tests**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
cargo test -p solo-auth --lib
```

Expected: 78 + 4 new JWT tests + 2 new profile tests = **84 pass, 0 fail**.

- [ ] **Step 10: Verify downstream (solo-desktop) still compiles**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
cargo check -p solo-desktop
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
```

Expected: clean compile (pre-existing dead_code warning in `solo-embeddings` is fine).

- [ ] **Step 11: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add crates/solo-auth/src/oauth/types.rs \
        crates/solo-auth/src/oauth/providers/openai.rs \
        crates/solo-auth/src/credentials.rs
git commit -m "feat(solo-auth): extract email from OpenAI id_token, persist on profile

OpenAIOAuthToken gains an optional email field, populated from the JWT's
standard email claim when exchange_code or refresh_token returns an
id_token. set_openai_oauth_token persists the email on the active
profile, falling back to the existing profile's email when the new
token doesn't carry one (covers refresh responses that strip identity)."
```

No Claude attribution. No `--no-verify`.

---

## Task 2: Profile management Tauri commands (list, set active, remove, sign out)

Adds commands the Plan 4 UI will consume. Keep them narrow — each does one thing, with a single happy path and a clear error.

**Files:**
- Modify: `crates/solo-auth/src/credentials.rs` — three new methods on `CredentialManager`: `list_profiles`, `set_active_profile`, `remove_profile`.
- Modify: `apps/desktop/src-tauri/src/provider_commands.rs` — four Tauri commands: `list_profiles`, `set_active_profile`, `remove_profile`, `sign_out_profile`.
- Modify: `apps/desktop/src-tauri/src/lib.rs` — register the new commands.

- [ ] **Step 1: Add a `ProfileSummary` type**

Open `crates/solo-auth/src/credentials.rs`. Near the top, after the `OAuthCredentialInfo` / `OpenAIOAuthCredentialInfo` structs, add:

```rust
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
```

(This uses `ts_rs::TS` so the TypeScript binding is generated automatically. The file is already a consumer of `ts_rs` — confirm by grepping `grep 'ts_rs::TS' crates/solo-auth/src/credentials.rs`.)

- [ ] **Step 2: Add tests for the three CredentialManager methods**

In the `#[cfg(test)] mod profile_tests` block at the bottom of `crates/solo-auth/src/credentials.rs`, append:

```rust
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
        // ProviderError stringifies via Display — just check it's not empty
        assert!(!err.to_string().is_empty());
    }

    #[tokio::test]
    async fn remove_profile_drops_it_and_picks_new_active() {
        let m = manager_with_vault(seed_two_profiles()).await;
        // Remove the active profile — another should become active.
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
        // One-profile store — remove that profile.
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
        assert!(m
            .vault_get_raw("anthropic.oauth")
            .await
            .unwrap()
            .is_none_or(|s| s.is_empty()));
    }
```

- [ ] **Step 3: Implement the three methods on `CredentialManager`**

In `crates/solo-auth/src/credentials.rs`, add these methods inside the `impl CredentialManager` block — placement: right after `disconnect_oauth` (around line 1186), before the `// GitHub OAuth Token Management` section:

```rust
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
                tracing::warn!("failed to parse OAuth store for {}: {}", provider.as_str(), e);
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

        let mut store =
            crate::oauth::profiles::migrate_legacy_blob(&raw, provider.as_str())
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

        let mut store =
            crate::oauth::profiles::migrate_legacy_blob(&raw, provider.as_str())
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
```

- [ ] **Step 4: Run the credentials tests**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
cargo test -p solo-auth --lib credentials::profile_tests
```

Expected: all tests pass (6 new + existing).

- [ ] **Step 5: Add the four Tauri commands**

Open `apps/desktop/src-tauri/src/provider_commands.rs`. Find the `// OAuth Commands` section (around line 273) — we'll add a new section after the existing OAuth commands but before `// Claude Code CLI Commands`. Insert this block right after the existing `disconnect_oauth` function:

```rust
// =============================================================================
// Profile Management Commands
// =============================================================================

use solo_auth::credentials::ProfileSummary;

/// List OAuth profiles for a provider.
#[tauri::command]
pub async fn list_profiles(
    provider: String,
    state: State<'_, ProviderAuthState>,
) -> Result<Vec<ProfileSummary>, String> {
    debug!(provider = %provider, "Listing profiles");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    state
        .credentials
        .list_profiles(provider_type)
        .await
        .map_err(|e| e.to_string())
}

/// Set the active profile for a provider.
#[tauri::command]
pub async fn set_active_profile(
    provider: String,
    profile_name: String,
    state: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    info!(provider = %provider, profile = %profile_name, "Setting active profile");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    state
        .credentials
        .set_active_profile(provider_type, &profile_name)
        .await
        .map_err(|e| e.to_string())
}

/// Remove a named profile.
#[tauri::command]
pub async fn remove_profile(
    provider: String,
    profile_name: String,
    state: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    info!(provider = %provider, profile = %profile_name, "Removing profile");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    state
        .credentials
        .remove_profile(provider_type, &profile_name)
        .await
        .map_err(|e| e.to_string())
}

/// Sign out of a specific profile. If `profile_name` is None, removes ALL
/// profiles for the provider (equivalent to the existing disconnect_oauth).
#[tauri::command]
pub async fn sign_out_profile(
    provider: String,
    profile_name: Option<String>,
    state: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    info!(provider = %provider, profile = ?profile_name, "Signing out profile");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    match profile_name {
        Some(name) => state
            .credentials
            .remove_profile(provider_type, &name)
            .await
            .map_err(|e| e.to_string()),
        None => state
            .credentials
            .disconnect_oauth(provider_type)
            .await
            .map_err(|e| e.to_string()),
    }
}
```

- [ ] **Step 6: Register the new commands in `lib.rs`**

Open `apps/desktop/src-tauri/src/lib.rs`. Find the `tauri::generate_handler![ ... ]` macro call. Inside it, find the line that registers `provider_commands::disconnect_oauth` (or any existing provider command). Add the four new commands in the same list:

```rust
            provider_commands::list_profiles,
            provider_commands::set_active_profile,
            provider_commands::remove_profile,
            provider_commands::sign_out_profile,
```

- [ ] **Step 7: Regenerate TypeScript bindings**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
bun run gen:bindings
```

Expected: creates/updates `apps/desktop/src/bindings/ProfileSummary.ts` and any other types that changed. Do NOT hand-edit these files.

- [ ] **Step 8: Compile the solo-desktop crate to confirm commands are wired correctly**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
cargo check -p solo-desktop
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
```

Expected: clean build.

- [ ] **Step 9: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add crates/solo-auth/src/credentials.rs \
        apps/desktop/src-tauri/src/provider_commands.rs \
        apps/desktop/src-tauri/src/lib.rs \
        apps/desktop/src/bindings/
git commit -m "feat(solo-desktop): profile management commands

Add list_profiles, set_active_profile, remove_profile, sign_out_profile
Tauri commands plus the underlying CredentialManager methods. Removing
the last profile clears the vault key entirely. Caches are invalidated
on active-profile changes and removals."
```

---

## Task 3: API-key validation on set_credentials

Today `set_credentials(provider, apiKey)` stores whatever the user pastes, with no validation. Add a lightweight ping that rejects obviously-invalid keys before they land in the vault. This prevents the silent "nothing happens when I chat" class of bug.

**Files:**
- Modify: `crates/solo-auth/src/credentials.rs` — add `validate_api_key_http` helper.
- Modify: `apps/desktop/src-tauri/src/provider_commands.rs` — new `validate_api_key` command + wire into the existing `set_credentials` command.

- [ ] **Step 1: Add the helper method**

In `crates/solo-auth/src/credentials.rs`, add this method inside `impl CredentialManager`, right before the profile management methods you added in Task 2:

```rust
    /// Lightweight auth-check against the provider's API.
    ///
    /// Returns `Ok(())` if the key is accepted; `Err(ProviderError::AuthError)`
    /// with a human-readable message otherwise. Only checks auth correctness —
    /// does not validate quota, scopes, or feature access.
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
                // 1-token request; a `401` proves the key is bad, `400`
                // (model error) or `200` both prove it's good.
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
            ProviderType::Gemini | ProviderType::ElevenLabs => {
                return Err(ProviderError::AuthError(format!(
                    "API-key validation not implemented for {}",
                    provider.as_str()
                )));
            }
        };

        let resp = req.send().await.map_err(|e| {
            ProviderError::AuthError(format!("validation request to {} failed: {}", url, e))
        })?;

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
```

- [ ] **Step 2: Add a Tauri `validate_api_key` command**

In `apps/desktop/src-tauri/src/provider_commands.rs`, add this command next to the existing auth-related commands (after `get_auth_method`):

```rust
/// Auth-check an API key WITHOUT storing it.
///
/// Returns Ok(()) if the key is accepted by the provider. Useful for "Test
/// connection" buttons; also called internally before `set_credentials`
/// persists the key.
#[tauri::command]
pub async fn validate_api_key(
    provider: String,
    api_key: String,
) -> Result<(), String> {
    debug!(provider = %provider, "Validating API key");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;
    solo_auth::CredentialManager::validate_api_key_http(provider_type, &api_key)
        .await
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 3: Wire validation into `set_credentials`**

Find the existing `set_credentials` command in `apps/desktop/src-tauri/src/provider_commands.rs` (grep for `pub async fn set_credentials`). Modify its body so it calls `validate_api_key_http` before persisting — reject invalid keys:

```rust
/// Store an API key for a provider after validating it with the provider's API.
#[tauri::command]
pub async fn set_credentials(
    provider: String,
    api_key: String,
    state: State<'_, ProviderAuthState>,
) -> Result<(), String> {
    info!(provider = %provider, "Setting credentials");
    let provider_type = ProviderType::from_str(&provider)
        .ok_or_else(|| format!("Unknown provider: {}", provider))?;

    // Validate the key against the provider's API before storing it.
    // Transient errors (5xx, network) do NOT block — see validate_api_key_http.
    solo_auth::CredentialManager::validate_api_key_http(provider_type, &api_key)
        .await
        .map_err(|e| e.to_string())?;

    state
        .credentials
        .set_credentials(provider_type, &api_key)
        .await
        .map_err(|e| e.to_string())
}
```

(If the existing `set_credentials` differs — e.g. already has extra logic — keep the extras; only insert the validation call between parameter parsing and the store.)

- [ ] **Step 4: Register the new `validate_api_key` command in lib.rs**

Open `apps/desktop/src-tauri/src/lib.rs`. In the same `generate_handler!` list where you added Task 2's commands, add:

```rust
            provider_commands::validate_api_key,
```

- [ ] **Step 5: Confirm the crate compiles**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
cargo check -p solo-auth
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
cargo check -p solo-desktop
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add crates/solo-auth/src/credentials.rs \
        apps/desktop/src-tauri/src/provider_commands.rs \
        apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(solo-desktop): validate API keys before storing

set_credentials now auth-checks the pasted key against the provider
(OpenAI /v1/models, Anthropic /v1/messages with a 1-token ping). 401/403
rejects the paste; 5xx and network errors accept anyway to avoid
blocking users on transient provider issues."
```

---

## Task 4: Frontend provider-store profile actions + bindings

Wire the new Rust commands into the Zustand store. Plan 4's UI will consume these — this task is just the data-plane.

**Files:**
- Modify: `apps/desktop/src/stores/provider-store.ts`
- Possibly modify: `apps/desktop/src/lib/backend.ts` (depending on how the existing wrappers are organized — search for where the existing `startOAuthFlow` etc. come from). The goal is consistency with existing patterns.

- [ ] **Step 1: Locate where the existing backend wrappers live**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
grep -rn "export async function startOAuthFlow\b\|export const startOAuthFlow\b" apps/desktop/src/lib/
```

The wrappers live in the file(s) emitted by that grep. Open it and note the pattern: how do existing wrappers call `invoke(...)`? Follow the same pattern for the new commands.

- [ ] **Step 2: Add the four new command wrappers**

In the same file where `startOAuthFlow` / `disconnectOAuth` are exported, add (adjust imports and style to match surrounding code):

```ts
import type { ProfileSummary } from "../bindings/ProfileSummary";

export async function listProfiles(provider: string): Promise<ProfileSummary[]> {
    return invoke<ProfileSummary[]>("list_profiles", { provider });
}

export async function setActiveProfile(provider: string, profileName: string): Promise<void> {
    return invoke<void>("set_active_profile", { provider, profileName });
}

export async function removeProfile(provider: string, profileName: string): Promise<void> {
    return invoke<void>("remove_profile", { provider, profileName });
}

export async function signOutProfile(provider: string, profileName?: string): Promise<void> {
    return invoke<void>("sign_out_profile", { provider, profileName });
}

export async function validateApiKey(provider: string, apiKey: string): Promise<void> {
    return invoke<void>("validate_api_key", { provider, apiKey });
}

export type { ProfileSummary };
```

- [ ] **Step 3: Extend the provider store state and actions**

Open `apps/desktop/src/stores/provider-store.ts`. Update imports, state, and actions:

First, add the new imports alongside the existing `startOAuthFlow` / `disconnectOAuth` imports at the top:

```ts
import {
    // ... existing imports ...
    listProfiles as listProfilesBackend,
    setActiveProfile as setActiveProfileBackend,
    removeProfile as removeProfileBackend,
    signOutProfile as signOutProfileBackend,
} from "../lib/backend";
import type { ProfileSummary } from "../lib/backend";
```

(If the existing file imports `disconnectOAuth` from `"../lib/backend"`, the above lines belong in the same import statement — merge them into the existing one rather than duplicating.)

Then extend the `ProviderState` interface:

```ts
interface ProviderState {
    // ... existing fields unchanged ...
    /// Profiles per provider.
    profiles: Record<string, ProfileSummary[]>;
    /// Currently-active profile name per provider (empty string if none).
    activeProfile: Record<string, string>;
}
```

Extend `ProviderActions`:

```ts
interface ProviderActions {
    // ... existing actions unchanged ...
    refreshProfiles: (provider: string) => Promise<void>;
    setActiveProfile: (provider: string, profileName: string) => Promise<void>;
    removeProfile: (provider: string, profileName: string) => Promise<void>;
    signOutProfile: (provider: string, profileName?: string) => Promise<void>;
}
```

In the `create<ProviderStore>()` call, add the new state slots to the initial state and the new action implementations. Initial state additions:

```ts
    profiles: {},
    activeProfile: {},
```

Action implementations (placed after `disconnectOAuth`):

```ts
    refreshProfiles: async (provider: string) => {
        try {
            const profiles = await listProfilesBackend(provider);
            const active = profiles.find((p) => p.isActive)?.name ?? "";
            set((state) => ({
                profiles: { ...state.profiles, [provider]: profiles },
                activeProfile: { ...state.activeProfile, [provider]: active },
            }));
        } catch (error) {
            console.error(`Failed to refresh profiles for ${provider}:`, error);
        }
    },

    setActiveProfile: async (provider: string, profileName: string) => {
        try {
            await setActiveProfileBackend(provider, profileName);
            await get().refreshProfiles(provider);
            await get().refreshProviderStatus(provider);
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    },

    removeProfile: async (provider: string, profileName: string) => {
        try {
            await removeProfileBackend(provider, profileName);
            await get().refreshProfiles(provider);
            await get().refreshProviderStatus(provider);
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    },

    signOutProfile: async (provider: string, profileName?: string) => {
        try {
            await signOutProfileBackend(provider, profileName);
            await get().refreshProfiles(provider);
            await get().refreshProviderStatus(provider);
            await get().refreshAuthMethod(provider);
        } catch (error) {
            set({
                error: error instanceof Error ? error.message : String(error),
            });
        }
    },
```

- [ ] **Step 4: Add two selector hooks**

At the bottom of `provider-store.ts`, next to the existing selector hooks (`useActiveProvider`, `useProviders`, etc.), add:

```ts
export const useProviderProfiles = (provider: string): ProfileSummary[] => {
    return useProviderStore((state) => state.profiles[provider] ?? []);
};

export const useActiveProfile = (provider: string): string => {
    return useProviderStore((state) => state.activeProfile[provider] ?? "");
};
```

- [ ] **Step 5: Extend `initialize` to preload profiles for each provider**

In the `initialize` action body (the async function currently defined in the store), after the existing `for (const provider of providers) { ... }` loop that fetches statuses, add a second call inside the same loop to also load profiles:

```ts
            const statusMap: Record<string, ProviderStatus> = {};
            const profileMap: Record<string, ProfileSummary[]> = {};
            const activeProfileMap: Record<string, string> = {};
            for (const provider of providers) {
                const status = await getProviderStatus(provider);
                statusMap[provider] = status;

                // Load profiles (empty array is fine if none exist).
                try {
                    const profs = await listProfilesBackend(provider);
                    profileMap[provider] = profs;
                    activeProfileMap[provider] = profs.find((p) => p.isActive)?.name ?? "";
                } catch (e) {
                    console.warn(`listProfiles failed for ${provider}:`, e);
                    profileMap[provider] = [];
                    activeProfileMap[provider] = "";
                }
            }
```

Then in the final `set({...})` call of `initialize`, add:

```ts
                profiles: profileMap,
                activeProfile: activeProfileMap,
```

- [ ] **Step 6: Typecheck**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
mkdir -p apps/desktop/dist && touch apps/desktop/dist/index.html
bun run check
rm -rf apps/desktop/dist
git checkout -- apps/desktop/src-tauri/gen/ 2>/dev/null || true
```

Expected: zero TypeScript errors; the Rust side also compiles clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
git add apps/desktop/src/stores/provider-store.ts \
        apps/desktop/src/lib/backend.ts \
        apps/desktop/src/bindings/
git commit -m "feat(solo-desktop): profile-aware provider store

Adds profiles/activeProfile state and refreshProfiles, setActiveProfile,
removeProfile, signOutProfile actions. initialize() now preloads the
profile list alongside provider status for each registered provider.
Existing single-account callers are unaffected."
```

(If your `grep` in Step 1 found the wrappers in a different file than `lib/backend.ts`, replace that path in the `git add` accordingly.)

---

## Task 5: Manual smoke test — OpenAI OAuth end-to-end

Human-gated. Proves the sign-in flow actually completes against real `auth.openai.com`.

**Prerequisites:** an active ChatGPT (Plus/Pro/etc.) account you're willing to sign in with.

- [ ] **Step 1: Back up the keychain vault (optional)**

```bash
/usr/bin/security find-generic-password -s com.solo-ide.credentials -a vault -w \
    > /tmp/solo-vault-backup-$(date +%s).json 2>/dev/null || true
```

- [ ] **Step 2: Launch Solo in dev mode from the worktree**

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/.claude/worktrees/mercury-openai-oauth
bun run dev
```

Watch the terminal log — no warnings/errors about `OAuth`, `profile`, `vault`, or `migrate` should appear on startup.

- [ ] **Step 3: Sign in with OpenAI**

In the app window:
1. Open Settings → AI tab.
2. On the OpenAI card, click **"Sign in with ChatGPT"** (or equivalent OAuth button).
3. The browser opens `https://auth.openai.com/oauth/authorize?...`. Complete the consent.
4. Browser redirects to `http://localhost:1455/...`. The page should say something like "Authentication successful — you can close this window."
5. Back in the app, the OpenAI card should flip to "Connected" with your email shown next to it.

- [ ] **Step 4: Verify the vault shape**

From a separate terminal:

```bash
/usr/bin/security find-generic-password -s com.solo-ide.credentials -a vault -w \
    | python3 -c "
import json, sys
d = json.load(sys.stdin)
for k in sorted(d.keys()):
    val = d[k]
    if k.endswith('.oauth') and val:
        try:
            inner = json.loads(val)
            active = inner.get('active_profile')
            profiles = list(inner.get('profiles', {}).keys())
            active_email = inner.get('profiles', {}).get(active, {}).get('email', '?')
            print(f'  {k}: active={active!r} email={active_email!r} profiles={profiles}')
        except Exception as e:
            print(f'  {k}: [parse error] {e}')
    else:
        print(f'  {k}: <{len(val)} chars>')
"
```

Expected output includes a line like:

```
  openai.oauth: active='default' email='your.email@example.com' profiles=['default']
```

If `email` shows as `''` or `'default'`, the id_token email extraction isn't working — report and we'll debug. If `email` shows your actual ChatGPT email, Task 1 is working end-to-end.

- [ ] **Step 5: Test profile management round-trip from the dev console**

In the Solo app, open the Chrome DevTools console (on macOS: right-click → Inspect). Run:

```js
// Replace with your actual provider string if different
await window.__TAURI__.core.invoke("list_profiles", { provider: "openai" })
```

Expected: returns an array of one `ProfileSummary` with `name: "default"`, `isActive: true`, `email: "<your email>"`, and a positive `expiresInSeconds`.

- [ ] **Step 6: (Optional) Test API-key validation**

In the OpenAI card's API Key field, paste an obviously-invalid key like `sk-invalid123` and save. Expected: the UI shows an error toast / inline message rejecting the key; the key does NOT get stored (check the vault again — `openai.apiKey` should not appear).

Paste a valid key if you have one and save. Expected: saved silently, vault now has `openai.apiKey`.

- [ ] **Step 7: (Optional) Sign out the OpenAI profile**

In DevTools console:

```js
await window.__TAURI__.core.invoke("sign_out_profile", { provider: "openai", profileName: "default" })
```

Then re-check the vault — `openai.oauth` should be gone (since we removed the only profile).

- [ ] **Step 8: Report**

If all steps pass → Plan 2 done. If any step fails, paste the error and terminal logs for triage before proceeding to Plan 3.

---

## Plan 2 complete — what's shipped

At the end of Plan 2:

- OpenAI OAuth sign-in completes end-to-end, landing a profile with the user's email visible.
- Profile management (list / set active / remove / sign out) is callable from the frontend.
- API-key paste is validated at the boundary.
- Provider store exposes per-provider profile lists and active-profile state.
- Anthropic path continues to work unchanged.

**Still to come:**
- **Plan 3** — the agent-bridge sidecar learns provider dispatch; sending a message with an OpenAI model actually routes to the OpenAI API.
- **Plan 4** — the UI catches up (dual-provider onboarding card, multi-account rows in Settings, grouped model picker).
