//! Shared desktop auth + cloud configuration.
//!
//! Finder-launched macOS apps do not inherit a shell environment, so release
//! builds rely on compile-time embedded values. During local `tauri dev`
//! sessions we also support runtime env vars, and in debug builds we
//! opportunistically load local env files so auth testing does not require
//! manual `export` steps every time.

use std::path::PathBuf;
use std::sync::OnceLock;
#[cfg(debug_assertions)]
use std::{collections::HashSet, path::Path};

use tracing::{debug, warn};
use url::Url;

pub const REDIRECT_URL: &str = "http://127.0.0.1:19877/callback";
pub const SIGNOUT_URL: &str = "soloide://auth/signout";

pub const COGNITO_DOMAIN_ENV_KEYS: &[&str] = &["SOLO_COGNITO_DOMAIN"];
pub const COGNITO_CLIENT_ID_ENV_KEYS: &[&str] = &["SOLO_COGNITO_CLIENT_ID"];
pub const COGNITO_REGION_ENV_KEYS: &[&str] = &["SOLO_AWS_REGION", "AWS_REGION"];
pub const API_ENDPOINT_ENV_KEYS: &[&str] = &["SOLO_API_ENDPOINT"];
pub const VAULT_API_ENDPOINT_ENV_KEYS: &[&str] = &["SOLO_VAULT_API_ENDPOINT"];

const DEFAULT_AWS_REGION: &str = "us-east-1";
const DEFAULT_API_ENDPOINT: &str = "https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com";
const DEFAULT_VAULT_API_ENDPOINT: &str =
    "https://tlrskvdxe2.execute-api.us-east-1.amazonaws.com/prod";

static COGNITO_CONFIG: OnceLock<Result<CognitoConfig, String>> = OnceLock::new();
static API_ENDPOINT: OnceLock<String> = OnceLock::new();
static VAULT_API_ENDPOINT: OnceLock<String> = OnceLock::new();

#[cfg(debug_assertions)]
static DEV_ENV_LOADED: OnceLock<()> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CognitoConfig {
    /// Fully-qualified Cognito domain, e.g.
    /// `solo-ide-dev.auth.us-east-1.amazoncognito.com`.
    pub domain: String,
    pub client_id: String,
    pub region: String,
}

impl CognitoConfig {
    pub fn base_url(&self) -> String {
        format!("https://{}", self.domain)
    }
}

pub fn maybe_load_local_env() {
    #[cfg(debug_assertions)]
    DEV_ENV_LOADED.get_or_init(|| {
        let protected_keys: HashSet<String> = std::env::vars().map(|(key, _)| key).collect();
        for path in candidate_env_files() {
            if !path.is_file() {
                continue;
            }
            match load_env_file(&path, &protected_keys) {
                Ok(loaded) => debug!(
                    path = %path.display(),
                    loaded,
                    "Loaded local desktop env file"
                ),
                Err(error) => warn!(
                    path = %path.display(),
                    %error,
                    "Failed to load local desktop env file"
                ),
            }
        }
    });
}

pub fn cognito_config() -> Result<&'static CognitoConfig, String> {
    maybe_load_local_env();
    match COGNITO_CONFIG.get_or_init(load_cognito_config) {
        Ok(cfg) => Ok(cfg),
        Err(error) => Err(error.clone()),
    }
}

pub fn api_endpoint() -> &'static str {
    maybe_load_local_env();
    API_ENDPOINT
        .get_or_init(|| {
            resolve_api_endpoint(
                option_env!("SOLO_API_ENDPOINT"),
                read_env(API_ENDPOINT_ENV_KEYS),
            )
        })
        .as_str()
}

pub fn vault_api_endpoint() -> &'static str {
    maybe_load_local_env();
    VAULT_API_ENDPOINT
        .get_or_init(|| {
            resolve_value(
                option_env!("SOLO_VAULT_API_ENDPOINT"),
                read_env(VAULT_API_ENDPOINT_ENV_KEYS),
            )
            .unwrap_or_else(|| DEFAULT_VAULT_API_ENDPOINT.to_string())
        })
        .as_str()
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."))
}

fn candidate_env_files() -> [PathBuf; 4] {
    let root = workspace_root();
    [
        root.join("infra/.env"),
        root.join("infra/.env.dev"),
        root.join(".env"),
        root.join(".env.local"),
    ]
}

#[cfg(debug_assertions)]
fn load_env_file(path: &Path, protected_keys: &HashSet<String>) -> Result<usize, dotenvy::Error> {
    let mut loaded = 0;
    for entry in dotenvy::from_path_iter(path)? {
        let (key, value) = entry?;
        if protected_keys.contains(&key) {
            continue;
        }
        unsafe {
            std::env::set_var(&key, &value);
        }
        loaded += 1;
    }
    Ok(loaded)
}

fn read_env(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        std::env::var(key)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn resolve_value(compile_value: Option<&str>, runtime_value: Option<String>) -> Option<String> {
    compile_value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(runtime_value)
}

fn missing_config_error(label: &str, keys: &[&str]) -> String {
    format!(
        "{label} is not configured. Set {} before building the app, or export it before running `bun run dev:auth`.",
        keys.join(" or ")
    )
}

fn normalize_cognito_domain(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let candidate = if trimmed.starts_with("https://") {
        trimmed.trim_start_matches("https://").to_string()
    } else if trimmed.starts_with("http://") {
        return Err(format!(
            "Invalid Cognito domain `{trimmed}`: must be https, not http"
        ));
    } else {
        trimmed.to_string()
    };

    let probe = format!("https://{}", candidate);
    let parsed =
        Url::parse(&probe).map_err(|err| format!("Invalid Cognito domain `{candidate}`: {err}"))?;
    if parsed.host_str().is_none() {
        return Err(format!(
            "Invalid Cognito domain `{candidate}`: missing host"
        ));
    }
    if !candidate.contains(".amazoncognito.com") && !candidate.contains('.') {
        return Err(format!(
            "Invalid Cognito domain `{candidate}`: expected a fully-qualified hostname"
        ));
    }
    Ok(candidate)
}

fn resolve_cognito_config(
    compile_domain: Option<&str>,
    compile_client_id: Option<&str>,
    compile_region: Option<&str>,
    runtime_domain: Option<String>,
    runtime_client_id: Option<String>,
    runtime_region: Option<String>,
) -> Result<CognitoConfig, String> {
    let domain = resolve_value(compile_domain, runtime_domain)
        .ok_or_else(|| missing_config_error("Desktop Cognito domain", COGNITO_DOMAIN_ENV_KEYS))?;

    let client_id = resolve_value(compile_client_id, runtime_client_id).ok_or_else(|| {
        missing_config_error("Desktop Cognito client ID", COGNITO_CLIENT_ID_ENV_KEYS)
    })?;

    let region = resolve_value(compile_region, runtime_region)
        .unwrap_or_else(|| DEFAULT_AWS_REGION.to_string());

    Ok(CognitoConfig {
        domain: normalize_cognito_domain(&domain)?,
        client_id,
        region,
    })
}

fn resolve_api_endpoint(
    compile_endpoint: Option<&str>,
    runtime_endpoint: Option<String>,
) -> String {
    resolve_value(compile_endpoint, runtime_endpoint)
        .unwrap_or_else(|| DEFAULT_API_ENDPOINT.to_string())
}

fn load_cognito_config() -> Result<CognitoConfig, String> {
    resolve_cognito_config(
        option_env!("SOLO_COGNITO_DOMAIN"),
        option_env!("SOLO_COGNITO_CLIENT_ID"),
        option_env!("SOLO_AWS_REGION"),
        read_env(COGNITO_DOMAIN_ENV_KEYS),
        read_env(COGNITO_CLIENT_ID_ENV_KEYS),
        read_env(COGNITO_REGION_ENV_KEYS),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_cognito_domain, resolve_api_endpoint, resolve_cognito_config, CognitoConfig,
    };

    fn sample_runtime_config() -> CognitoConfig {
        CognitoConfig {
            domain: "runtime.auth.us-east-1.amazoncognito.com".to_string(),
            client_id: "runtime-client".to_string(),
            region: "us-west-2".to_string(),
        }
    }

    #[test]
    fn uses_compile_time_values_when_present() {
        let cfg = resolve_cognito_config(
            Some("solo-ide-dev.auth.us-east-1.amazoncognito.com"),
            Some("compile-client"),
            Some("us-east-1"),
            Some(sample_runtime_config().domain),
            Some(sample_runtime_config().client_id),
            Some(sample_runtime_config().region),
        )
        .unwrap();

        assert_eq!(cfg.domain, "solo-ide-dev.auth.us-east-1.amazoncognito.com");
        assert_eq!(cfg.client_id, "compile-client");
        assert_eq!(cfg.region, "us-east-1");
    }

    #[test]
    fn falls_back_to_runtime_values() {
        let cfg = resolve_cognito_config(
            None,
            None,
            None,
            Some(sample_runtime_config().domain),
            Some(sample_runtime_config().client_id),
            Some(sample_runtime_config().region),
        )
        .unwrap();

        assert_eq!(cfg, sample_runtime_config());
    }

    #[test]
    fn defaults_region_when_missing() {
        let cfg = resolve_cognito_config(
            None,
            None,
            None,
            Some("runtime.auth.us-east-1.amazoncognito.com".to_string()),
            Some("runtime-client".to_string()),
            None,
        )
        .unwrap();

        assert_eq!(cfg.region, "us-east-1");
    }

    #[test]
    fn returns_actionable_missing_domain_error() {
        let error = resolve_cognito_config(
            None,
            Some("runtime-client"),
            None,
            None,
            Some("runtime-client".to_string()),
            None,
        )
        .unwrap_err();

        assert!(error.contains("Desktop Cognito domain"));
        assert!(error.contains("SOLO_COGNITO_DOMAIN"));
        assert!(error.contains("bun run dev:auth"));
    }

    #[test]
    fn returns_actionable_missing_client_id_error() {
        let error = resolve_cognito_config(
            Some("solo-ide-dev.auth.us-east-1.amazoncognito.com"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap_err();

        assert!(error.contains("Desktop Cognito client ID"));
        assert!(error.contains("SOLO_COGNITO_CLIENT_ID"));
    }

    #[test]
    fn rejects_http_domain() {
        let error = normalize_cognito_domain("http://example.amazoncognito.com").unwrap_err();
        assert!(error.to_lowercase().contains("https"));
    }

    #[test]
    fn accepts_domain_with_scheme_prefix() {
        let normalized =
            normalize_cognito_domain("https://x.auth.us-east-1.amazoncognito.com/").unwrap();
        assert_eq!(normalized, "x.auth.us-east-1.amazoncognito.com");
    }

    #[test]
    fn api_endpoint_prefers_compile_time_value() {
        let endpoint = resolve_api_endpoint(
            Some("https://compile.execute-api.us-east-1.amazonaws.com"),
            Some("https://runtime.execute-api.us-east-1.amazonaws.com".to_string()),
        );
        assert_eq!(
            endpoint,
            "https://compile.execute-api.us-east-1.amazonaws.com"
        );
    }

    #[test]
    fn api_endpoint_falls_back_to_runtime_or_default() {
        let runtime = resolve_api_endpoint(
            None,
            Some("https://runtime.execute-api.us-east-1.amazonaws.com".to_string()),
        );
        assert_eq!(
            runtime,
            "https://runtime.execute-api.us-east-1.amazonaws.com"
        );

        let default = resolve_api_endpoint(None, None);
        assert_eq!(
            default,
            "https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com"
        );
    }
}
