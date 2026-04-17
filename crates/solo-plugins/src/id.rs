//! Stable plugin identifier parsing and validation.
//!
//! Forked and adapted from codex-rs/plugin/src/plugin_id.rs.

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
    pub fn new(marketplace: String, name: String) -> Result<Self, PluginIdError> {
        validate_plugin_segment(&marketplace, "marketplace name")
            .map_err(PluginIdError::Invalid)?;
        validate_plugin_segment(&name, "plugin name").map_err(PluginIdError::Invalid)?;
        Ok(Self { marketplace, name })
    }

    /// Stringified form used for display and as toggles.json keys.
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
}
