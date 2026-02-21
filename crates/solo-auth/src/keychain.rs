//! Cross-platform keychain helper for API key storage
//!
//! Uses the `keyring` crate to store and retrieve provider API keys.
//! Supports macOS Keychain, Windows Credential Manager, and Linux libsecret.

use keyring::Entry;

const SERVICE_NAME: &str = "com.solo-ide.agent";

/// Store an API key in the keychain
pub fn set_api_key(provider: &str, key: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, provider)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    entry
        .set_password(key)
        .map_err(|e| format!("Failed to store API key: {}", e))
}

/// Retrieve an API key from the keychain, falling back to environment variable
pub fn get_api_key(provider: &str) -> Result<Option<String>, String> {
    // Try keychain first
    let entry = Entry::new(SERVICE_NAME, provider)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.get_password() {
        Ok(key) => return Ok(Some(key)),
        Err(keyring::Error::NoEntry) => {}
        Err(e) => {
            tracing::warn!("Failed to read from keyring: {}", e);
        }
    }

    // Fall back to environment variable
    let env_var = match provider {
        "anthropic" => "ANTHROPIC_API_KEY",
        "openai" => "OPENAI_API_KEY",
        "gemini" => "GOOGLE_API_KEY",
        "elevenlabs" => "ELEVENLABS_API_KEY",
        _ => return Ok(None),
    };

    Ok(std::env::var(env_var).ok())
}

/// Check if an API key exists for a provider
pub fn has_api_key(provider: &str) -> Result<bool, String> {
    get_api_key(provider).map(|k| k.is_some())
}

/// Remove an API key from the keychain
pub fn clear_api_key(provider: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, provider)
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already gone, that's fine
        Err(e) => Err(format!("Failed to delete API key: {}", e)),
    }
}
