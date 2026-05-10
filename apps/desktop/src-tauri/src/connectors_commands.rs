//! Solo-owned app connector runtime.
//!
//! This is intentionally provider-agnostic: a plugin can declare an app
//! connector in `.app.json`, Solo stores the user's provider token in the
//! existing encrypted credential vault, and enabled plugin MCP configs can
//! reference that token with placeholders such as
//! `${provider:google:accessToken}`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use solo_auth::{
    oauth::{
        generate_code_challenge, generate_code_verifier, generate_state, start_callback_server,
        OAuthFlowResult, OAuthState,
    },
    CredentialManager,
};
use solo_core::settings as settings_io;
use solo_plugins::{list_plugins, load_plugin_apps, LoaderConfig};
use solo_protocol::{
    ConnectorAccountSummary, ConnectorOAuthCallbackResult, ConnectorPluginRequirement,
    ConnectorStoreTokenRequest, PluginId,
};
use tauri::State;
use url::Url;

use crate::plugins_commands::PluginsState;
use crate::provider_commands::ProviderAuthState;

const CONNECTOR_VAULT_KEY: &str = "connectors.tokens.v1";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct ConnectorVault {
    #[serde(default)]
    tokens: Vec<ConnectorTokenRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConnectorTokenRecord {
    provider: String,
    account_id: String,
    display_name: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    #[serde(default)]
    scopes: Vec<String>,
    expires_at: Option<String>,
    updated_at: String,
}

#[derive(Debug, Clone)]
struct ConnectorOAuthProvider {
    provider: String,
    client_id: String,
    client_secret: Option<String>,
    auth_url: String,
    token_url: String,
    redirect_uri: String,
}

#[derive(Debug, Deserialize)]
struct ConnectorTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    token_type: Option<String>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    ok: Option<bool>,
}

pub(crate) fn infer_connector_provider(
    app_id: &str,
    declared_provider: Option<&str>,
    connector_id: Option<&str>,
) -> Option<String> {
    if let Some(provider) = declared_provider.and_then(normalize_optional_segment) {
        return Some(provider);
    }

    let normalized_app = normalize_segment(app_id)?;
    match normalized_app.as_str() {
        "gmail" | "google" | "google-calendar" | "google-drive" | "drive" | "calendar"
        | "spreadsheets" | "sheets" | "presentations" | "slides" => Some("google".to_string()),
        "github" => Some("github".to_string()),
        "slack" => Some("slack".to_string()),
        "linear" => Some("linear".to_string()),
        "notion" => Some("notion".to_string()),
        "vercel" => Some("vercel".to_string()),
        "teams" | "sharepoint" | "outlook" | "outlook-email" | "outlook-calendar"
        | "microsoft" => Some("microsoft".to_string()),
        "chrome" | "browser" => Some("browser".to_string()),
        "computer-use" | "computer_use" => Some("computer-use".to_string()),
        other => connector_id
            .and_then(normalize_optional_segment)
            .filter(|_| !other.starts_with("connector_")),
    }
}

fn env_key_for_provider(provider: &str, suffix: &str) -> String {
    format!(
        "SOLO_CONNECTOR_{}_{}",
        provider.replace('-', "_").to_ascii_uppercase(),
        suffix
    )
}

fn default_oauth_urls(provider: &str) -> Option<(&'static str, &'static str)> {
    match provider {
        "google" => Some((
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
        )),
        "github" => Some((
            "https://github.com/login/oauth/authorize",
            "https://github.com/login/oauth/access_token",
        )),
        "slack" => Some((
            "https://slack.com/oauth/v2/authorize",
            "https://slack.com/api/oauth.v2.access",
        )),
        "microsoft" => Some((
            "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        )),
        "notion" => Some((
            "https://api.notion.com/v1/oauth/authorize",
            "https://api.notion.com/v1/oauth/token",
        )),
        "linear" => Some((
            "https://linear.app/oauth/authorize",
            "https://api.linear.app/oauth/token",
        )),
        "vercel" => Some((
            "https://vercel.com/oauth/authorize",
            "https://api.vercel.com/v2/oauth/access_token",
        )),
        _ => None,
    }
}

fn load_connector_oauth_provider(provider: &str) -> Result<ConnectorOAuthProvider, String> {
    let provider =
        normalize_segment(provider).ok_or_else(|| "connector provider is required".to_string())?;
    let client_id = std::env::var(env_key_for_provider(&provider, "CLIENT_ID")).map_err(|_| {
        format!(
            "missing {} for connector OAuth",
            env_key_for_provider(&provider, "CLIENT_ID")
        )
    })?;
    let client_secret = std::env::var(env_key_for_provider(&provider, "CLIENT_SECRET")).ok();
    let (default_auth_url, default_token_url) = default_oauth_urls(&provider).ok_or_else(|| {
        format!(
            "provider '{provider}' needs {} and {} overrides",
            env_key_for_provider(&provider, "AUTH_URL"),
            env_key_for_provider(&provider, "TOKEN_URL")
        )
    })?;
    let auth_url =
        std::env::var(env_key_for_provider(&provider, "AUTH_URL")).unwrap_or_else(|_| {
            default_auth_url.to_string()
        });
    let token_url =
        std::env::var(env_key_for_provider(&provider, "TOKEN_URL")).unwrap_or_else(|_| {
            default_token_url.to_string()
        });
    let redirect_uri = std::env::var(env_key_for_provider(&provider, "REDIRECT_URI"))
        .unwrap_or_else(|_| "http://127.0.0.1:19877/callback".to_string());

    Ok(ConnectorOAuthProvider {
        provider,
        client_id,
        client_secret,
        auth_url,
        token_url,
        redirect_uri,
    })
}

fn build_connector_auth_url(
    provider: &ConnectorOAuthProvider,
    scopes: &[String],
    state: &str,
    code_challenge: &str,
) -> Result<String, String> {
    let mut url = Url::parse(&provider.auth_url)
        .map_err(|err| format!("invalid connector auth URL: {err}"))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("response_type", "code")
            .append_pair("client_id", &provider.client_id)
            .append_pair("redirect_uri", &provider.redirect_uri)
            .append_pair("state", state)
            .append_pair("code_challenge", code_challenge)
            .append_pair("code_challenge_method", "S256");
        if !scopes.is_empty() {
            query.append_pair("scope", &scopes.join(" "));
        }
        if provider.provider == "google" {
            query
                .append_pair("access_type", "offline")
                .append_pair("prompt", "consent");
        }
    }
    Ok(url.to_string())
}

fn split_scopes(scope: Option<String>) -> Vec<String> {
    scope
        .unwrap_or_default()
        .split_whitespace()
        .filter_map(|scope| {
            let scope = scope.trim().to_string();
            (!scope.is_empty()).then_some(scope)
        })
        .collect()
}

pub(crate) async fn expand_provider_token_variables_in_mcp_config(
    config: JsonValue,
    credentials: &CredentialManager,
) -> Result<JsonValue, String> {
    let vault = load_connector_vault(credentials).await?;
    expand_with_connector_vault(config, &vault)
}

fn normalize_segment(raw: &str) -> Option<String> {
    let value = raw.trim().to_ascii_lowercase().replace('_', "-");
    (!value.is_empty()).then_some(value)
}

fn normalize_optional_segment(raw: &str) -> Option<String> {
    normalize_segment(raw)
}

fn account_key(provider: &str, account_id: &str) -> String {
    format!("{provider}/{account_id}")
}

async fn load_connector_vault(credentials: &CredentialManager) -> Result<ConnectorVault, String> {
    let Some(raw) = credentials
        .vault_get_raw(CONNECTOR_VAULT_KEY)
        .await
        .map_err(|err| err.to_string())?
    else {
        return Ok(ConnectorVault::default());
    };

    serde_json::from_str(&raw).map_err(|err| format!("failed to parse connector vault: {err}"))
}

async fn save_connector_vault(
    credentials: &CredentialManager,
    vault: &ConnectorVault,
) -> Result<(), String> {
    let raw = serde_json::to_string(vault)
        .map_err(|err| format!("failed to serialize connector vault: {err}"))?;
    credentials
        .vault_set_raw(CONNECTOR_VAULT_KEY, &raw)
        .await
        .map_err(|err| err.to_string())
}

fn summarize_token(token: &ConnectorTokenRecord) -> ConnectorAccountSummary {
    ConnectorAccountSummary {
        provider: token.provider.clone(),
        account_id: token.account_id.clone(),
        display_name: token.display_name.clone(),
        scopes: token.scopes.clone(),
        expires_at: token.expires_at.clone(),
        updated_at: token.updated_at.clone(),
        has_access_token: token.access_token.as_ref().is_some_and(|token| !token.is_empty()),
        has_refresh_token: token
            .refresh_token
            .as_ref()
            .is_some_and(|token| !token.is_empty()),
    }
}

fn find_provider_token<'a>(
    vault: &'a ConnectorVault,
    provider: &str,
) -> Option<&'a ConnectorTokenRecord> {
    let provider = normalize_segment(provider)?;
    vault
        .tokens
        .iter()
        .find(|token| token.provider == provider && token.account_id == "default")
        .or_else(|| vault.tokens.iter().find(|token| token.provider == provider))
}

fn replace_connector_placeholders(input: &str, vault: &ConnectorVault) -> Result<String, String> {
    let mut output = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(start) = rest.find("${") {
        output.push_str(&rest[..start]);
        let after_start = &rest[start + 2..];
        let Some(end) = after_start.find('}') else {
            output.push_str(&rest[start..]);
            return Ok(output);
        };

        let placeholder = &after_start[..end];
        if let Some(replacement) = resolve_connector_placeholder(placeholder, vault)? {
            output.push_str(&replacement);
        } else {
            output.push_str("${");
            output.push_str(placeholder);
            output.push('}');
        }
        rest = &after_start[end + 1..];
    }

    output.push_str(rest);
    Ok(output)
}

fn resolve_connector_placeholder(
    placeholder: &str,
    vault: &ConnectorVault,
) -> Result<Option<String>, String> {
    let parts = placeholder.split(':').collect::<Vec<_>>();
    if parts.len() != 3 || !matches!(parts[0], "provider" | "connector") {
        return Ok(None);
    }

    let provider = normalize_segment(parts[1])
        .ok_or_else(|| format!("invalid connector placeholder provider: {placeholder}"))?;
    let token = find_provider_token(vault, &provider).ok_or_else(|| {
        format!("plugin requires a Solo connector token for provider '{provider}'")
    })?;

    let value = match parts[2] {
        "accessToken" | "access_token" | "token" => token.access_token.as_deref(),
        "refreshToken" | "refresh_token" => token.refresh_token.as_deref(),
        "accountId" | "account_id" => Some(token.account_id.as_str()),
        "scopes" => return Ok(Some(token.scopes.join(" "))),
        field => {
            return Err(format!(
                "unsupported connector placeholder field '{field}' for provider '{provider}'"
            ));
        }
    };

    value
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| {
            format!("Solo connector token for provider '{provider}' is missing {}", parts[2])
        })
        .map(Some)
}

fn expand_with_connector_vault(
    value: JsonValue,
    vault: &ConnectorVault,
) -> Result<JsonValue, String> {
    match value {
        JsonValue::String(value) => Ok(JsonValue::String(replace_connector_placeholders(
            &value, vault,
        )?)),
        JsonValue::Array(values) => values
            .into_iter()
            .map(|value| expand_with_connector_vault(value, vault))
            .collect::<Result<Vec<_>, _>>()
            .map(JsonValue::Array),
        JsonValue::Object(values) => values
            .into_iter()
            .map(|(key, value)| expand_with_connector_vault(value, vault).map(|value| (key, value)))
            .collect::<Result<JsonMap<String, JsonValue>, _>>()
            .map(JsonValue::Object),
        value => Ok(value),
    }
}

fn plugin_display_name(record: &solo_plugins::PluginRecord) -> String {
    record
        .manifest
        .as_ref()
        .and_then(|manifest| manifest.interface.as_ref())
        .and_then(|interface| interface.display_name.clone())
        .unwrap_or_else(|| record.id.name.clone())
}

#[tauri::command]
pub async fn connectors_list_accounts(
    provider: Option<String>,
    state: State<'_, ProviderAuthState>,
) -> Result<Vec<ConnectorAccountSummary>, String> {
    let provider = provider.as_deref().and_then(normalize_segment);
    let vault = load_connector_vault(&state.credentials).await?;
    let mut accounts = vault
        .tokens
        .iter()
        .filter(|token| {
            provider
                .as_ref()
                .is_none_or(|provider| token.provider == *provider)
        })
        .map(summarize_token)
        .collect::<Vec<_>>();
    accounts.sort_by(|a, b| {
        account_key(&a.provider, &a.account_id).cmp(&account_key(&b.provider, &b.account_id))
    });
    Ok(accounts)
}

#[tauri::command]
pub async fn connectors_store_token(
    request: ConnectorStoreTokenRequest,
    state: State<'_, ProviderAuthState>,
) -> Result<ConnectorAccountSummary, String> {
    let provider = normalize_segment(&request.provider)
        .ok_or_else(|| "connector provider is required".to_string())?;
    let account_id = normalize_segment(&request.account_id).unwrap_or_else(|| "default".to_string());

    if request
        .access_token
        .as_ref()
        .is_none_or(|token| token.trim().is_empty())
        && request
            .refresh_token
            .as_ref()
            .is_none_or(|token| token.trim().is_empty())
    {
        return Err("connector token storage requires an access token or refresh token".to_string());
    }

    let mut vault = load_connector_vault(&state.credentials).await?;
    let mut by_key = vault
        .tokens
        .into_iter()
        .map(|token| (account_key(&token.provider, &token.account_id), token))
        .collect::<BTreeMap<_, _>>();
    let key = account_key(&provider, &account_id);
    let existing = by_key.remove(&key);
    let updated = ConnectorTokenRecord {
        provider: provider.clone(),
        account_id: account_id.clone(),
        display_name: request
            .display_name
            .or_else(|| existing.as_ref().and_then(|token| token.display_name.clone())),
        access_token: request
            .access_token
            .filter(|token| !token.trim().is_empty())
            .or_else(|| existing.as_ref().and_then(|token| token.access_token.clone())),
        refresh_token: request
            .refresh_token
            .filter(|token| !token.trim().is_empty())
            .or_else(|| existing.as_ref().and_then(|token| token.refresh_token.clone())),
        scopes: if request.scopes.is_empty() {
            existing
                .as_ref()
                .map(|token| token.scopes.clone())
                .unwrap_or_default()
        } else {
            request
                .scopes
                .into_iter()
                .filter_map(|scope| {
                    let trimmed = scope.trim().to_string();
                    (!trimmed.is_empty()).then_some(trimmed)
                })
                .collect()
        },
        expires_at: request
            .expires_at
            .or_else(|| existing.as_ref().and_then(|token| token.expires_at.clone())),
        updated_at: Utc::now().to_rfc3339(),
    };

    by_key.insert(key, updated.clone());
    vault.tokens = by_key.into_values().collect();
    save_connector_vault(&state.credentials, &vault).await?;
    Ok(summarize_token(&updated))
}

#[tauri::command]
pub async fn connectors_delete_token(
    provider: String,
    account_id: String,
    state: State<'_, ProviderAuthState>,
) -> Result<bool, String> {
    let provider = normalize_segment(&provider)
        .ok_or_else(|| "connector provider is required".to_string())?;
    let account_id = normalize_segment(&account_id).unwrap_or_else(|| "default".to_string());
    let mut vault = load_connector_vault(&state.credentials).await?;
    let before = vault.tokens.len();
    vault
        .tokens
        .retain(|token| !(token.provider == provider && token.account_id == account_id));
    let removed = vault.tokens.len() != before;
    if removed {
        save_connector_vault(&state.credentials, &vault).await?;
    }
    Ok(removed)
}

#[tauri::command]
pub async fn connectors_start_oauth(
    provider: String,
    scopes: Vec<String>,
    open_browser: Option<bool>,
    state: State<'_, ProviderAuthState>,
) -> Result<OAuthFlowResult, String> {
    let provider_config = load_connector_oauth_provider(&provider)?;
    let state_param = generate_state();
    let code_verifier = generate_code_verifier();
    let code_challenge = generate_code_challenge(&code_verifier);
    let auth_url =
        build_connector_auth_url(&provider_config, &scopes, &state_param, &code_challenge)?;

    state.oauth_pending.write().await.insert(
        state_param.clone(),
        OAuthState::new(
            state_param.clone(),
            code_verifier,
            format!("connector:{}", provider_config.provider),
        ),
    );

    if open_browser.unwrap_or(true) {
        webbrowser::open(&auth_url).map_err(|err| format!("failed to open browser: {err}"))?;
    }

    Ok(OAuthFlowResult {
        auth_url,
        state: state_param,
    })
}

#[tauri::command]
pub async fn connectors_wait_for_oauth_callback(
    state_param: String,
) -> Result<ConnectorOAuthCallbackResult, String> {
    let callback = start_callback_server(&state_param, Some(std::time::Duration::from_secs(300)))
        .await
        .map_err(|err| err.to_string())?;
    Ok(ConnectorOAuthCallbackResult {
        code: callback.code,
        state: callback.state,
    })
}

#[tauri::command]
pub async fn connectors_complete_oauth(
    provider: String,
    state_param: String,
    code: String,
    state: State<'_, ProviderAuthState>,
) -> Result<ConnectorAccountSummary, String> {
    let provider_config = load_connector_oauth_provider(&provider)?;
    let pending = state
        .oauth_pending
        .write()
        .await
        .remove(&state_param)
        .ok_or_else(|| "no pending connector OAuth flow for state".to_string())?;
    if pending.is_expired() {
        return Err("pending connector OAuth flow expired".to_string());
    }
    if pending.provider != format!("connector:{}", provider_config.provider) {
        return Err("connector OAuth provider mismatch".to_string());
    }

    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code),
        ("redirect_uri", provider_config.redirect_uri.clone()),
        ("client_id", provider_config.client_id.clone()),
        ("code_verifier", pending.code_verifier),
    ];
    if provider_config.provider != "notion" {
        if let Some(secret) = provider_config.client_secret.as_ref() {
            form.push(("client_secret", secret.clone()));
        }
    }

    let client = reqwest::Client::new();
    let mut request = client
        .post(&provider_config.token_url)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(&form);
    if provider_config.provider == "notion" {
        if let Some(secret) = provider_config.client_secret.as_ref() {
            request = request.basic_auth(&provider_config.client_id, Some(secret));
        }
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("connector token exchange failed: {err}"))?;
    let status = response.status();
    let token_response = response
        .json::<ConnectorTokenResponse>()
        .await
        .map_err(|err| format!("failed to parse connector token response: {err}"))?;

    if !status.is_success() || token_response.ok == Some(false) {
        let message = token_response
            .error_description
            .or(token_response.error)
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!("connector OAuth token exchange rejected: {message}"));
    }

    let access_token = token_response
        .access_token
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| "connector OAuth token response did not include access_token".to_string())?;
    let expires_at = token_response.expires_in.and_then(|expires_in| {
        chrono::Duration::try_seconds(i64::try_from(expires_in).ok()?)
            .map(|duration| (Utc::now() + duration).to_rfc3339())
    });
    let scopes = split_scopes(token_response.scope);
    let _token_type = token_response.token_type.as_deref().unwrap_or("Bearer");

    connectors_store_token(
        ConnectorStoreTokenRequest {
            provider: provider_config.provider.clone(),
            account_id: "default".to_string(),
            display_name: Some(provider_config.provider),
            access_token: Some(access_token),
            refresh_token: token_response.refresh_token,
            scopes,
            expires_at,
        },
        state,
    )
    .await
}

#[tauri::command]
pub async fn connectors_list_plugin_requirements(
    cwd: String,
    plugins_state: State<'_, PluginsState>,
    provider_state: State<'_, ProviderAuthState>,
) -> Result<Vec<ConnectorPluginRequirement>, String> {
    let solo_home = plugins_state.solo_home();
    let workspace = PathBuf::from(&cwd);
    let config = settings_io::load_plugins_config(&workspace).unwrap_or_default();
    let claude_plugins_dir = {
        let dir = plugins_state.claude_plugins_dir();
        dir.exists().then_some(dir)
    };
    let codex_cache_dir = {
        let dir = plugins_state.codex_cache_dir();
        dir.exists().then_some(dir)
    };
    let outcome = list_plugins(LoaderConfig {
        solo_home: &solo_home,
        claude_plugins_dir,
        codex_cache_dir,
        adapter_claude_plugins: config.adapter_claude_plugins,
        adapter_codex_user: config.adapter_codex_user,
    });
    let vault = load_connector_vault(&provider_state.credentials).await?;
    let mut requirements = Vec::new();

    for record in outcome.plugins {
        let Some(apps_path) = record
            .manifest
            .as_ref()
            .and_then(|manifest| manifest.paths.apps.as_ref())
        else {
            continue;
        };

        let loaded = load_plugin_apps(apps_path.as_path());
        for app in loaded.apps {
            let provider = infer_connector_provider(
                &app.app_id,
                app.provider.as_deref(),
                app.connector_id.as_deref(),
            );
            let connected = provider
                .as_deref()
                .and_then(|provider| find_provider_token(&vault, provider))
                .is_some();
            let supported = provider.is_some();
            let status = match (supported, connected) {
                (false, _) => "unsupported_connector_runtime",
                (true, false) => "needs_connection",
                (true, true) => "connected",
            }
            .to_string();

            requirements.push(ConnectorPluginRequirement {
                plugin_id: PluginId {
                    marketplace: record.id.marketplace.clone(),
                    name: record.id.name.clone(),
                },
                plugin_display_name: plugin_display_name(&record),
                app_id: app.app_id,
                connector_id: app.connector_id,
                provider,
                scopes: app.scopes,
                supported,
                connected,
                status,
            });
        }
    }

    requirements.sort_by(|a, b| {
        let left = format!(
            "{}/{}:{}",
            a.plugin_id.marketplace, a.plugin_id.name, a.app_id
        );
        let right = format!(
            "{}/{}:{}",
            b.plugin_id.marketplace, b.plugin_id.name, b.app_id
        );
        left.cmp(&right)
    });
    Ok(requirements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn infers_common_openai_connector_providers() {
        assert_eq!(
            infer_connector_provider("gmail", None, Some("connector_123")).as_deref(),
            Some("google")
        );
        assert_eq!(
            infer_connector_provider("outlook-calendar", None, Some("connector_456")).as_deref(),
            Some("microsoft")
        );
        assert_eq!(
            infer_connector_provider("github", Some("GitHub"), None).as_deref(),
            Some("github")
        );
    }

    #[test]
    fn expands_provider_placeholders_without_leaking_other_variables() {
        let vault = ConnectorVault {
            tokens: vec![ConnectorTokenRecord {
                provider: "google".to_string(),
                account_id: "default".to_string(),
                display_name: None,
                access_token: Some("access-123".to_string()),
                refresh_token: Some("refresh-123".to_string()),
                scopes: vec!["gmail.readonly".to_string(), "drive.readonly".to_string()],
                expires_at: None,
                updated_at: "2026-05-10T00:00:00Z".to_string(),
            }],
        };
        let expanded = expand_with_connector_vault(
            json!({
                "env": {
                    "ACCESS": "${provider:google:accessToken}",
                    "REFRESH": "${connector:google:refreshToken}",
                    "OTHER": "${PLUGIN_ROOT}"
                }
            }),
            &vault,
        )
        .unwrap();

        assert_eq!(expanded["env"]["ACCESS"], "access-123");
        assert_eq!(expanded["env"]["REFRESH"], "refresh-123");
        assert_eq!(expanded["env"]["OTHER"], "${PLUGIN_ROOT}");
    }

    #[test]
    fn errors_when_required_provider_token_is_missing() {
        let err = expand_with_connector_vault(
            json!({"env": {"ACCESS": "${provider:slack:accessToken}"}}),
            &ConnectorVault::default(),
        )
        .unwrap_err();
        assert!(err.contains("provider 'slack'"));
    }
}
