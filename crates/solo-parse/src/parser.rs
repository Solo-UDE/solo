//! Tree-sitter parser implementation

use crate::languages::{Language, LanguageRegistry};
use crate::symbols::{Range, Symbol, SymbolKind};
use std::time::Instant;
use thiserror::Error;

/// Errors that can occur during parsing
#[derive(Debug, Error)]
pub enum ParserError {
    #[error("Unsupported language for file: {0}")]
    UnsupportedLanguage(String),

    #[error("Failed to parse file: {0}")]
    ParseFailed(String),

    #[error("Tree-sitter error: {0}")]
    TreeSitter(String),
}

/// Result of parsing a file
#[derive(Debug, Clone)]
pub struct ParseResult {
    /// Extracted symbols
    pub symbols: Vec<Symbol>,
    /// Parse errors found in the file
    pub errors: Vec<ParseError>,
    /// Time taken to parse (in milliseconds)
    pub parse_time_ms: u64,
    /// Whether the tree has any errors
    pub has_errors: bool,
}

/// A parse error in the source code
#[derive(Debug, Clone)]
pub struct ParseError {
    /// Error message
    pub message: String,
    /// Location of the error
    pub range: Range,
}

/// Tree-sitter based parser
pub struct Parser {
    registry: LanguageRegistry,
}

impl Parser {
    /// Create a new parser
    pub fn new() -> Self {
        Self {
            registry: LanguageRegistry::new(),
        }
    }

    /// Parse a file and extract symbols
    pub fn parse(&self, path: &str, source: &str) -> Result<ParseResult, ParserError> {
        let start = Instant::now();

        // Detect language
        let language = self
            .registry
            .detect(path)
            .ok_or_else(|| ParserError::UnsupportedLanguage(path.to_string()))?;

        // Create parser for this language
        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&language.tree_sitter_language())
            .map_err(|e| ParserError::TreeSitter(e.to_string()))?;

        // Parse the source code
        let tree = parser
            .parse(source, None)
            .ok_or_else(|| ParserError::ParseFailed("Failed to parse source".to_string()))?;

        let root = tree.root_node();
        let has_errors = root.has_error();

        // Extract symbols based on language
        let symbols = self.extract_symbols(&root, source, language);

        // Collect parse errors
        let errors = self.collect_errors(&root, source);

        let parse_time_ms = start.elapsed().as_millis() as u64;

        Ok(ParseResult {
            symbols,
            errors,
            parse_time_ms,
            has_errors,
        })
    }

    /// Parse with an existing tree for incremental updates
    pub fn parse_incremental(
        &self,
        path: &str,
        source: &str,
        old_tree: Option<&tree_sitter::Tree>,
    ) -> Result<(ParseResult, tree_sitter::Tree), ParserError> {
        let start = Instant::now();

        let language = self
            .registry
            .detect(path)
            .ok_or_else(|| ParserError::UnsupportedLanguage(path.to_string()))?;

        let mut parser = tree_sitter::Parser::new();
        parser
            .set_language(&language.tree_sitter_language())
            .map_err(|e| ParserError::TreeSitter(e.to_string()))?;

        let tree = parser
            .parse(source, old_tree)
            .ok_or_else(|| ParserError::ParseFailed("Failed to parse source".to_string()))?;

        let root = tree.root_node();
        let has_errors = root.has_error();

        let symbols = self.extract_symbols(&root, source, language);
        let errors = self.collect_errors(&root, source);

        let parse_time_ms = start.elapsed().as_millis() as u64;

        Ok((
            ParseResult {
                symbols,
                errors,
                parse_time_ms,
                has_errors,
            },
            tree,
        ))
    }

    /// Extract symbols from a syntax tree
    fn extract_symbols(
        &self,
        root: &tree_sitter::Node,
        source: &str,
        language: Language,
    ) -> Vec<Symbol> {
        match language {
            Language::Rust => self.extract_rust_symbols(root, source),
            Language::TypeScript | Language::JavaScript => self.extract_ts_symbols(root, source),
            Language::Python => self.extract_python_symbols(root, source),
            Language::Json => self.extract_json_symbols(root, source),
            Language::Html => self.extract_html_symbols(root, source),
            Language::Css => self.extract_css_symbols(root, source),
            Language::Markdown => self.extract_markdown_symbols(root, source),
        }
    }

    /// Extract symbols from Rust code
    fn extract_rust_symbols(&self, root: &tree_sitter::Node, source: &str) -> Vec<Symbol> {
        let mut symbols = Vec::new();
        let mut cursor = root.walk();

        for child in root.children(&mut cursor) {
            if let Some(symbol) = self.extract_rust_node(&child, source) {
                symbols.push(symbol);
            }
        }

        symbols
    }

    #[allow(clippy::too_many_lines)]
    fn extract_rust_node(&self, node: &tree_sitter::Node, source: &str) -> Option<Symbol> {
        let kind = node.kind();

        match kind {
            "function_item" => {
                let name_node = node.child_by_field_name("name")?;
                let name = self.get_node_text(&name_node, source);
                let mut symbol = Symbol::new(name, SymbolKind::Function, Range::from_node(node))
                    .with_selection_range(Range::from_node(&name_node));

                // Extract parameters for detail
                if let Some(params) = node.child_by_field_name("parameters") {
                    let params_text = self.get_node_text(&params, source);
                    symbol = symbol.with_detail(params_text);
                }

                Some(symbol)
            }
            "struct_item" => {
                let name_node = node.child_by_field_name("name")?;
                let name = self.get_node_text(&name_node, source);
                let mut symbol = Symbol::new(name, SymbolKind::Struct, Range::from_node(node))
                    .with_selection_range(Range::from_node(&name_node));

                // Extract fields as children
                if let Some(body) = node.child_by_field_name("body") {
                    let mut cursor = body.walk();
                    for field in body.children(&mut cursor) {
                        if field.kind() == "field_declaration" {
                            if let Some(field_name) = field.child_by_field_name("name") {
                                let field_symbol = Symbol::new(
                                    self.get_node_text(&field_name, source),
                                    SymbolKind::Property,
                                    Range::from_node(&field),
                                )
                                .with_selection_range(Range::from_node(&field_name));
                                symbol.add_child(field_symbol);
                            }
                        }
                    }
                }

                Some(symbol)
            }
            "enum_item" => {
                let name_node = node.child_by_field_name("name")?;
                let name = self.get_node_text(&name_node, source);
                let mut symbol = Symbol::new(name, SymbolKind::Enum, Range::from_node(node))
                    .with_selection_range(Range::from_node(&name_node));

                // Extract variants as children
                if let Some(body) = node.child_by_field_name("body") {
                    let mut cursor = body.walk();
                    for variant in body.children(&mut cursor) {
                        if variant.kind() == "enum_variant" {
                            if let Some(variant_name) = variant.child_by_field_name("name") {
                                let variant_symbol = Symbol::new(
                                    self.get_node_text(&variant_name, source),
                                    SymbolKind::EnumMember,
                                    Range::from_node(&variant),
                                )
                                .with_selection_range(Range::from_node(&variant_name));
                                symbol.add_child(variant_symbol);
                            }
                        }
                    }
                }

                Some(symbol)
            }
            "impl_item" => {
                // Get the type being implemented
                let type_node = node.child_by_field_name("type")?;
                let type_name = self.get_node_text(&type_node, source);

                // Check for trait implementation
                let trait_name = node
                    .child_by_field_name("trait")
                    .map(|t| self.get_node_text(&t, source));

                let name = if let Some(trait_name) = trait_name {
                    format!("{} for {}", trait_name, type_name)
                } else {
                    type_name
                };

                let mut symbol = Symbol::new(name, SymbolKind::Impl, Range::from_node(node))
                    .with_selection_range(Range::from_node(&type_node));

                // Extract methods
                if let Some(body) = node.child_by_field_name("body") {
                    let mut cursor = body.walk();
                    for item in body.children(&mut cursor) {
                        if item.kind() == "function_item" {
                            if let Some(name_node) = item.child_by_field_name("name") {
                                let method = Symbol::new(
                                    self.get_node_text(&name_node, source),
                                    SymbolKind::Method,
                                    Range::from_node(&item),
                                )
                                .with_selection_range(Range::from_node(&name_node));
                                symbol.add_child(method);
                            }
                        }
                    }
                }

                Some(symbol)
            }
            "trait_item" => {
                let name_node = node.child_by_field_name("name")?;
                let name = self.get_node_text(&name_node, source);
                let symbol = Symbol::new(name, SymbolKind::Trait, Range::from_node(node))
                    .with_selection_range(Range::from_node(&name_node));
                Some(symbol)
            }
            "mod_item" => {
                let name_node = node.child_by_field_name("name")?;
                let name = self.get_node_text(&name_node, source);
                let symbol = Symbol::new(name, SymbolKind::Module, Range::from_node(node))
                    .with_selection_range(Range::from_node(&name_node));
                Some(symbol)
            }
            "const_item" | "static_item" => {
                let name_node = node.child_by_field_name("name")?;
                let name = self.get_node_text(&name_node, source);
                let symbol = Symbol::new(name, SymbolKind::Constant, Range::from_node(node))
                    .with_selection_range(Range::from_node(&name_node));
                Some(symbol)
            }
            "type_item" => {
                let name_node = node.child_by_field_name("name")?;
                let name = self.get_node_text(&name_node, source);
                let symbol = Symbol::new(name, SymbolKind::TypeAlias, Range::from_node(node))
                    .with_selection_range(Range::from_node(&name_node));
                Some(symbol)
            }
            "macro_definition" => {
                let name_node = node.child_by_field_name("name")?;
                let name = self.get_node_text(&name_node, source);
                let symbol = Symbol::new(name, SymbolKind::Macro, Range::from_node(node))
                    .with_selection_range(Range::from_node(&name_node));
                Some(symbol)
            }
            _ => None,
        }
    }

    /// Extract symbols from TypeScript/JavaScript code
    fn extract_ts_symbols(&self, root: &tree_sitter::Node, source: &str) -> Vec<Symbol> {
        let mut symbols = Vec::new();
        self.extract_ts_node_recursive(root, source, &mut symbols);
        symbols
    }

    #[allow(clippy::too_many_lines)]
    fn extract_ts_node_recursive(
        &self,
        node: &tree_sitter::Node,
        source: &str,
        symbols: &mut Vec<Symbol>,
    ) {
        let kind = node.kind();

        match kind {
            "function_declaration" | "function" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let symbol = Symbol::new(
                        self.get_node_text(&name_node, source),
                        SymbolKind::Function,
                        Range::from_node(node),
                    )
                    .with_selection_range(Range::from_node(&name_node));
                    symbols.push(symbol);
                }
            }
            "class_declaration" | "class" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let mut symbol = Symbol::new(
                        self.get_node_text(&name_node, source),
                        SymbolKind::Class,
                        Range::from_node(node),
                    )
                    .with_selection_range(Range::from_node(&name_node));

                    // Extract methods
                    if let Some(body) = node.child_by_field_name("body") {
                        let mut cursor = body.walk();
                        for member in body.children(&mut cursor) {
                            if member.kind() == "method_definition" {
                                if let Some(method_name) = member.child_by_field_name("name") {
                                    let method = Symbol::new(
                                        self.get_node_text(&method_name, source),
                                        SymbolKind::Method,
                                        Range::from_node(&member),
                                    )
                                    .with_selection_range(Range::from_node(&method_name));
                                    symbol.add_child(method);
                                }
                            } else if member.kind() == "public_field_definition"
                                || member.kind() == "field_definition"
                            {
                                if let Some(prop_name) = member.child_by_field_name("name") {
                                    let prop = Symbol::new(
                                        self.get_node_text(&prop_name, source),
                                        SymbolKind::Property,
                                        Range::from_node(&member),
                                    )
                                    .with_selection_range(Range::from_node(&prop_name));
                                    symbol.add_child(prop);
                                }
                            }
                        }
                    }

                    symbols.push(symbol);
                }
            }
            "interface_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let symbol = Symbol::new(
                        self.get_node_text(&name_node, source),
                        SymbolKind::Interface,
                        Range::from_node(node),
                    )
                    .with_selection_range(Range::from_node(&name_node));
                    symbols.push(symbol);
                }
            }
            "type_alias_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let symbol = Symbol::new(
                        self.get_node_text(&name_node, source),
                        SymbolKind::TypeAlias,
                        Range::from_node(node),
                    )
                    .with_selection_range(Range::from_node(&name_node));
                    symbols.push(symbol);
                }
            }
            "enum_declaration" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let symbol = Symbol::new(
                        self.get_node_text(&name_node, source),
                        SymbolKind::Enum,
                        Range::from_node(node),
                    )
                    .with_selection_range(Range::from_node(&name_node));
                    symbols.push(symbol);
                }
            }
            "lexical_declaration" | "variable_declaration" => {
                // Handle const/let/var declarations
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "variable_declarator" {
                        if let Some(name_node) = child.child_by_field_name("name") {
                            // Only include top-level exports or significant declarations
                            let is_const = node.kind() == "lexical_declaration"
                                && node.child(0).map(|c| c.kind()) == Some("const");
                            let symbol_kind = if is_const {
                                SymbolKind::Constant
                            } else {
                                SymbolKind::Variable
                            };
                            let symbol = Symbol::new(
                                self.get_node_text(&name_node, source),
                                symbol_kind,
                                Range::from_node(&child),
                            )
                            .with_selection_range(Range::from_node(&name_node));
                            symbols.push(symbol);
                        }
                    }
                }
            }
            // arrow_function / function_expression: anonymous, skip unless assigned to a variable
            "export_statement" => {
                // Recurse into exported declarations
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    self.extract_ts_node_recursive(&child, source, symbols);
                }
            }
            "program" | "statement_block" => {
                // Recurse into children for top-level and nested blocks
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    self.extract_ts_node_recursive(&child, source, symbols);
                }
            }
            _ => {
                // Don't recurse into unknown nodes to avoid duplicates
            }
        }
    }

    /// Extract symbols from Python code
    fn extract_python_symbols(&self, root: &tree_sitter::Node, source: &str) -> Vec<Symbol> {
        let mut symbols = Vec::new();
        self.extract_python_node_recursive(root, source, &mut symbols);
        symbols
    }

    fn extract_python_node_recursive(
        &self,
        node: &tree_sitter::Node,
        source: &str,
        symbols: &mut Vec<Symbol>,
    ) {
        let kind = node.kind();

        match kind {
            "function_definition" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let symbol = Symbol::new(
                        self.get_node_text(&name_node, source),
                        SymbolKind::Function,
                        Range::from_node(node),
                    )
                    .with_selection_range(Range::from_node(&name_node));
                    symbols.push(symbol);
                }
            }
            "class_definition" => {
                if let Some(name_node) = node.child_by_field_name("name") {
                    let mut symbol = Symbol::new(
                        self.get_node_text(&name_node, source),
                        SymbolKind::Class,
                        Range::from_node(node),
                    )
                    .with_selection_range(Range::from_node(&name_node));

                    // Extract methods
                    if let Some(body) = node.child_by_field_name("body") {
                        let mut cursor = body.walk();
                        for member in body.children(&mut cursor) {
                            if member.kind() == "function_definition" {
                                if let Some(method_name) = member.child_by_field_name("name") {
                                    let method = Symbol::new(
                                        self.get_node_text(&method_name, source),
                                        SymbolKind::Method,
                                        Range::from_node(&member),
                                    )
                                    .with_selection_range(Range::from_node(&method_name));
                                    symbol.add_child(method);
                                }
                            }
                        }
                    }

                    symbols.push(symbol);
                }
            }
            "module" => {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    self.extract_python_node_recursive(&child, source, symbols);
                }
            }
            _ => {}
        }
    }

    /// Extract symbols from JSON
    fn extract_json_symbols(&self, root: &tree_sitter::Node, source: &str) -> Vec<Symbol> {
        let mut symbols = Vec::new();

        // Only extract top-level object keys
        if root.kind() == "document" {
            if let Some(value) = root.child(0) {
                if value.kind() == "object" {
                    let mut cursor = value.walk();
                    for child in value.children(&mut cursor) {
                        if child.kind() == "pair" {
                            if let Some(key) = child.child_by_field_name("key") {
                                let key_text = self.get_node_text(&key, source);
                                // Remove quotes
                                let name = key_text.trim_matches('"');
                                let symbol = Symbol::new(
                                    name,
                                    SymbolKind::Property,
                                    Range::from_node(&child),
                                )
                                .with_selection_range(Range::from_node(&key));
                                symbols.push(symbol);
                            }
                        }
                    }
                }
            }
        }

        symbols
    }

    /// Extract symbols from HTML
    #[allow(clippy::unused_self)]
    fn extract_html_symbols(&self, _root: &tree_sitter::Node, _source: &str) -> Vec<Symbol> {
        // HTML doesn't have meaningful "symbols" in the traditional sense
        Vec::new()
    }

    /// Extract symbols from CSS
    fn extract_css_symbols(&self, root: &tree_sitter::Node, source: &str) -> Vec<Symbol> {
        let mut symbols = Vec::new();
        let mut cursor = root.walk();

        for child in root.children(&mut cursor) {
            if child.kind() == "rule_set" {
                if let Some(selectors) = child.child(0) {
                    let selector_text = self.get_node_text(&selectors, source);
                    let symbol =
                        Symbol::new(selector_text, SymbolKind::Class, Range::from_node(&child))
                            .with_selection_range(Range::from_node(&selectors));
                    symbols.push(symbol);
                }
            }
        }

        symbols
    }

    /// Extract symbols from Markdown
    fn extract_markdown_symbols(&self, root: &tree_sitter::Node, source: &str) -> Vec<Symbol> {
        let mut symbols = Vec::new();
        self.extract_markdown_recursive(root, source, &mut symbols);
        symbols
    }

    fn extract_markdown_recursive(
        &self,
        node: &tree_sitter::Node,
        source: &str,
        symbols: &mut Vec<Symbol>,
    ) {
        if node.kind().starts_with("atx_heading") || node.kind() == "setext_heading" {
            let heading_text = self.get_node_text(node, source);
            // Remove # prefix
            let name = heading_text.trim_start_matches('#').trim();
            let symbol = Symbol::new(name, SymbolKind::Module, Range::from_node(node));
            symbols.push(symbol);
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            self.extract_markdown_recursive(&child, source, symbols);
        }
    }

    /// Collect parse errors from the tree
    fn collect_errors(&self, root: &tree_sitter::Node, _source: &str) -> Vec<ParseError> {
        let mut errors = Vec::new();
        self.collect_errors_recursive(root, &mut errors);
        errors
    }

    #[allow(clippy::self_only_used_in_recursion)]
    fn collect_errors_recursive(&self, node: &tree_sitter::Node, errors: &mut Vec<ParseError>) {
        if node.is_error() || node.is_missing() {
            errors.push(ParseError {
                message: if node.is_missing() {
                    format!("Missing {}", node.kind())
                } else {
                    "Syntax error".to_string()
                },
                range: Range::from_node(node),
            });
        }

        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            self.collect_errors_recursive(&child, errors);
        }
    }

    /// Get the text content of a node
    #[allow(clippy::unused_self)]
    fn get_node_text(&self, node: &tree_sitter::Node, source: &str) -> String {
        source[node.byte_range()].to_string()
    }
}

impl Default for Parser {
    fn default() -> Self {
        Self::new()
    }
}
