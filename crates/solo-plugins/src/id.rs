//! Stable plugin identifier parsing and validation.
//!
//! Forked and adapted from `codex-rs/plugin/src/plugin_id.rs` (Apache-2.0).
//! See the crate-level `README.md` for full attribution.

#[derive(Debug, thiserror::Error)]
pub enum PluginIdError {
    #[error("{0}")]
    Invalid(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PluginId {
    pub marketplace: String,
    pub name: String,
}

impl PluginId {
    /// Construct a validated `PluginId`.
    ///
    /// Arguments are `marketplace` first, then `name` — matching the struct's
    /// field order. This diverges from upstream codex, which takes
    /// `(plugin_name, marketplace_name)`; the reversal is deliberate and
    /// matches the on-wire serialization order used in `solo-protocol`.
    pub fn new(marketplace: String, name: String) -> Result<Self, PluginIdError> {
        validate_plugin_segment(&marketplace, "marketplace name")
            .map_err(PluginIdError::Invalid)?;
        validate_plugin_segment(&name, "plugin name").map_err(PluginIdError::Invalid)?;
        Ok(Self { marketplace, name })
    }

    /// Stable serialized form: `"<marketplace>/<name>"`.
    ///
    /// This format is a persistent contract — it is the key used in
    /// `~/.solo/plugins/toggles.json`, and any change to the separator or
    /// field order would corrupt existing on-disk state. Upstream codex
    /// uses `<plugin>@<marketplace>`; Solo deliberately diverged to `/` to
    /// stay filesystem-path-friendly for future marketplace names.
    pub fn as_key(&self) -> String {
        format!("{}/{}", self.marketplace, self.name)
    }
}

pub fn validate_plugin_segment(segment: &str, kind: &str) -> Result<(), String> {
    if segment.is_empty() {
        return Err(format!("invalid {kind}: must not be empty"));
    }
    if !segment
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(format!(
            "invalid {kind}: only ASCII letters, digits, `_`, and `-` are allowed"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_id_constructs() {
        let id = PluginId::new("local".into(), "github-1".into()).unwrap();
        assert_eq!(id.as_key(), "local/github-1");
    }

    #[test]
    fn empty_segment_rejected() {
        assert!(PluginId::new(String::new(), "x".into()).is_err());
        assert!(PluginId::new("x".into(), String::new()).is_err());
    }

    #[test]
    fn invalid_characters_rejected() {
        assert!(PluginId::new("local".into(), "a b".into()).is_err());
        assert!(PluginId::new("local".into(), "../evil".into()).is_err());
        assert!(PluginId::new("local".into(), "dot.name".into()).is_err());
        assert!(PluginId::new("slash/name".into(), "x".into()).is_err());
        assert!(PluginId::new("local".into(), "name@marketplace".into()).is_err());
    }

    #[test]
    fn uppercase_and_digits_allowed() {
        assert!(PluginId::new("OpenAI".into(), "Github_1".into()).is_ok());
    }

    #[test]
    fn validate_segment_returns_descriptive_error() {
        let err = validate_plugin_segment("a b", "plugin name").unwrap_err();
        assert!(err.contains("plugin name"), "error was: {err}");
    }

    #[test]
    fn separator_only_segments_are_valid() {
        // Current rule allows any mix of ASCII alphanum + '_' + '-',
        // including all-separator strings. Surprising but intentional —
        // we deliberately match upstream codex's permissiveness here.
        assert!(PluginId::new("---".into(), "___".into()).is_ok());
    }

    #[test]
    fn unicode_alphanumeric_is_rejected() {
        // `café` is Unicode alphanumeric but not ASCII alphanumeric.
        // validate_plugin_segment must reject it.
        assert!(PluginId::new("local".into(), "caf\u{00e9}".into()).is_err());
        assert!(PluginId::new("caf\u{00e9}".into(), "x".into()).is_err());
    }
}
