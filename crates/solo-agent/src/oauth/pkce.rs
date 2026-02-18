//! PKCE (Proof Key for Code Exchange) utilities for OAuth 2.0
//!
//! Implements RFC 7636 for public clients to secure authorization code exchanges.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};

/// Minimum length for code verifier (RFC 7636 requirement)
const CODE_VERIFIER_MIN_LENGTH: usize = 43;
/// Maximum length for code verifier (RFC 7636 requirement)
const CODE_VERIFIER_MAX_LENGTH: usize = 128;
/// Default length for code verifier
const CODE_VERIFIER_DEFAULT_LENGTH: usize = 64;

/// Characters allowed in code verifier (unreserved URI characters)
const UNRESERVED_CHARS: &[u8] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/// Generate a cryptographically secure code verifier
///
/// The code verifier is a high-entropy cryptographic random string using the
/// unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~", with
/// a minimum length of 43 characters and a maximum length of 128 characters.
pub fn generate_code_verifier() -> String {
    generate_code_verifier_with_length(CODE_VERIFIER_DEFAULT_LENGTH)
}

/// Generate a code verifier with specific length
pub fn generate_code_verifier_with_length(length: usize) -> String {
    let length = length.clamp(CODE_VERIFIER_MIN_LENGTH, CODE_VERIFIER_MAX_LENGTH);

    let mut random_bytes = vec![0u8; length];
    getrandom::getrandom(&mut random_bytes).expect("Failed to generate random bytes");

    random_bytes
        .iter()
        .map(|&byte| {
            let idx = (byte as usize) % UNRESERVED_CHARS.len();
            UNRESERVED_CHARS[idx] as char
        })
        .collect()
}

/// Generate a code challenge from a code verifier using S256 method
///
/// The code challenge is the Base64 URL-encoded SHA256 hash of the code verifier.
/// This is the S256 code challenge method as specified in RFC 7636.
pub fn generate_code_challenge(code_verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let hash = hasher.finalize();

    URL_SAFE_NO_PAD.encode(hash)
}

/// Generate a random state parameter for CSRF protection
pub fn generate_state() -> String {
    let mut random_bytes = [0u8; 32];
    getrandom::getrandom(&mut random_bytes).expect("Failed to generate random bytes");
    URL_SAFE_NO_PAD.encode(random_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_code_verifier_length() {
        let verifier = generate_code_verifier();
        assert_eq!(verifier.len(), CODE_VERIFIER_DEFAULT_LENGTH);

        let short = generate_code_verifier_with_length(10); // Should clamp to min
        assert_eq!(short.len(), CODE_VERIFIER_MIN_LENGTH);

        let long = generate_code_verifier_with_length(200); // Should clamp to max
        assert_eq!(long.len(), CODE_VERIFIER_MAX_LENGTH);
    }

    #[test]
    fn test_code_verifier_valid_chars() {
        let verifier = generate_code_verifier();
        for c in verifier.chars() {
            assert!(
                c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_' || c == '~',
                "Invalid character in verifier: {}",
                c
            );
        }
    }

    #[test]
    fn test_generate_code_challenge() {
        // Known test vector from RFC 7636 Appendix B
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = generate_code_challenge(verifier);
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn test_generate_state() {
        let state1 = generate_state();
        let state2 = generate_state();

        // States should be unique
        assert_ne!(state1, state2);

        // Base64 URL-safe encoded 32 bytes = 43 chars
        assert_eq!(state1.len(), 43);

        // Should only contain URL-safe base64 chars
        for c in state1.chars() {
            assert!(
                c.is_ascii_alphanumeric() || c == '-' || c == '_',
                "Invalid character in state: {}",
                c
            );
        }
    }

    #[test]
    fn test_verifier_uniqueness() {
        let v1 = generate_code_verifier();
        let v2 = generate_code_verifier();
        assert_ne!(v1, v2);
    }
}
