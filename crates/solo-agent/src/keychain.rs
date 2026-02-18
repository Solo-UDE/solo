//! Minimal keychain helper for API key storage
//!
//! Uses the macOS Keychain (via security-framework) to store and retrieve
//! provider API keys. On other platforms, falls back to environment variables.

const SERVICE_NAME: &str = "com.solo-ide.agent";

/// Store an API key in the keychain
pub fn set_api_key(provider: &str, key: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::set_generic_password;
        set_generic_password(SERVICE_NAME, provider, key.as_bytes())
            .map_err(|e| format!("Failed to store API key: {}", e))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (provider, key);
        Err("Keychain storage is only supported on macOS".to_string())
    }
}

/// Retrieve an API key from the keychain, falling back to environment variable
pub fn get_api_key(provider: &str) -> Result<Option<String>, String> {
    // Try keychain first
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::get_generic_password;
        match get_generic_password(SERVICE_NAME, provider) {
            Ok(bytes) => {
                let key = String::from_utf8(bytes.to_vec())
                    .map_err(|e| format!("Invalid UTF-8 in keychain: {}", e))?;
                return Ok(Some(key));
            }
            Err(_) => {} // Fall through to env var
        }
    }

    // Fall back to environment variable
    let env_var = match provider {
        "anthropic" => "ANTHROPIC_API_KEY",
        "openai" => "OPENAI_API_KEY",
        "gemini" => "GOOGLE_API_KEY",
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
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::delete_generic_password;
        match delete_generic_password(SERVICE_NAME, provider) {
            Ok(_) => Ok(()),
            Err(e) => {
                // If not found, that's fine
                let msg = e.to_string();
                if msg.contains("not found") || msg.contains("-25300") {
                    Ok(())
                } else {
                    Err(format!("Failed to delete API key: {}", e))
                }
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = provider;
        Ok(())
    }
}
