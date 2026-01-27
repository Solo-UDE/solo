//! Language detection and tree-sitter grammar management

use std::collections::HashMap;
use std::path::Path;

/// Supported programming languages
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    Rust,
    TypeScript,
    JavaScript,
    Python,
    Json,
    Html,
    Css,
    Markdown,
}

impl Language {
    /// Get the tree-sitter language for this language
    pub fn tree_sitter_language(&self) -> tree_sitter::Language {
        match self {
            Language::Rust => tree_sitter_rust::LANGUAGE.into(),
            Language::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Language::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Language::Python => tree_sitter_python::LANGUAGE.into(),
            Language::Json => tree_sitter_json::LANGUAGE.into(),
            Language::Html => tree_sitter_html::LANGUAGE.into(),
            Language::Css => tree_sitter_css::LANGUAGE.into(),
            Language::Markdown => tree_sitter_md::LANGUAGE.into(),
        }
    }

    /// Get the display name for this language
    pub fn display_name(&self) -> &'static str {
        match self {
            Language::Rust => "Rust",
            Language::TypeScript => "TypeScript",
            Language::JavaScript => "JavaScript",
            Language::Python => "Python",
            Language::Json => "JSON",
            Language::Html => "HTML",
            Language::Css => "CSS",
            Language::Markdown => "Markdown",
        }
    }
}

/// Registry for language detection from file extensions
pub struct LanguageRegistry {
    extensions: HashMap<&'static str, Language>,
}

impl LanguageRegistry {
    /// Create a new language registry with default mappings
    pub fn new() -> Self {
        let mut extensions = HashMap::new();

        // Rust
        extensions.insert("rs", Language::Rust);

        // TypeScript
        extensions.insert("ts", Language::TypeScript);
        extensions.insert("tsx", Language::TypeScript);
        extensions.insert("mts", Language::TypeScript);
        extensions.insert("cts", Language::TypeScript);

        // JavaScript
        extensions.insert("js", Language::JavaScript);
        extensions.insert("jsx", Language::JavaScript);
        extensions.insert("mjs", Language::JavaScript);
        extensions.insert("cjs", Language::JavaScript);

        // Python
        extensions.insert("py", Language::Python);
        extensions.insert("pyw", Language::Python);
        extensions.insert("pyi", Language::Python);

        // JSON
        extensions.insert("json", Language::Json);
        extensions.insert("jsonc", Language::Json);

        // HTML
        extensions.insert("html", Language::Html);
        extensions.insert("htm", Language::Html);

        // CSS
        extensions.insert("css", Language::Css);

        // Markdown
        extensions.insert("md", Language::Markdown);
        extensions.insert("markdown", Language::Markdown);

        Self { extensions }
    }

    /// Detect language from file path
    pub fn detect(&self, path: &str) -> Option<Language> {
        let ext = Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase());

        ext.as_deref().and_then(|e| self.extensions.get(e).copied())
    }

    /// Check if a file extension is supported
    pub fn is_supported(&self, path: &str) -> bool {
        self.detect(path).is_some()
    }
}

impl Default for LanguageRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_rust() {
        let registry = LanguageRegistry::new();
        assert_eq!(registry.detect("main.rs"), Some(Language::Rust));
        assert_eq!(registry.detect("lib.rs"), Some(Language::Rust));
    }

    #[test]
    fn test_detect_typescript() {
        let registry = LanguageRegistry::new();
        assert_eq!(registry.detect("app.ts"), Some(Language::TypeScript));
        assert_eq!(registry.detect("component.tsx"), Some(Language::TypeScript));
    }

    #[test]
    fn test_detect_javascript() {
        let registry = LanguageRegistry::new();
        assert_eq!(registry.detect("index.js"), Some(Language::JavaScript));
        assert_eq!(registry.detect("component.jsx"), Some(Language::JavaScript));
    }

    #[test]
    fn test_detect_python() {
        let registry = LanguageRegistry::new();
        assert_eq!(registry.detect("script.py"), Some(Language::Python));
    }

    #[test]
    fn test_detect_unknown() {
        let registry = LanguageRegistry::new();
        assert_eq!(registry.detect("file.xyz"), None);
        assert_eq!(registry.detect("no_extension"), None);
    }

    #[test]
    fn test_case_insensitive() {
        let registry = LanguageRegistry::new();
        assert_eq!(registry.detect("FILE.RS"), Some(Language::Rust));
        assert_eq!(registry.detect("App.Ts"), Some(Language::TypeScript));
    }
}
