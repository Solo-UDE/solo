//! Symbol types for representing code structure

use serde::{Deserialize, Serialize};

/// The kind of symbol (function, class, struct, etc.)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SymbolKind {
    /// A function or method
    Function,
    /// A method (function inside a class/impl)
    Method,
    /// A class definition
    Class,
    /// A struct definition
    Struct,
    /// An enum definition
    Enum,
    /// An interface definition (TypeScript)
    Interface,
    /// A type alias
    TypeAlias,
    /// A constant or static variable
    Constant,
    /// A variable declaration
    Variable,
    /// A module or namespace
    Module,
    /// A property or field
    Property,
    /// An enum variant
    EnumMember,
    /// A trait definition (Rust)
    Trait,
    /// An impl block (Rust)
    Impl,
    /// A macro definition
    Macro,
    /// Unknown or unrecognized symbol type
    Unknown,
}

impl SymbolKind {
    /// Get a display icon for this symbol kind
    pub fn icon(&self) -> &'static str {
        match self {
            SymbolKind::Function => "ƒ",
            SymbolKind::Method => "m",
            SymbolKind::Class => "C",
            SymbolKind::Struct => "S",
            SymbolKind::Enum => "E",
            SymbolKind::Interface => "I",
            SymbolKind::TypeAlias => "T",
            SymbolKind::Constant => "c",
            SymbolKind::Variable => "v",
            SymbolKind::Module => "M",
            SymbolKind::Property => "p",
            SymbolKind::EnumMember => "e",
            SymbolKind::Trait => "t",
            SymbolKind::Impl => "i",
            SymbolKind::Macro => "!",
            SymbolKind::Unknown => "?",
        }
    }

    /// Get a display name for this symbol kind
    pub fn display_name(&self) -> &'static str {
        match self {
            SymbolKind::Function => "Function",
            SymbolKind::Method => "Method",
            SymbolKind::Class => "Class",
            SymbolKind::Struct => "Struct",
            SymbolKind::Enum => "Enum",
            SymbolKind::Interface => "Interface",
            SymbolKind::TypeAlias => "Type",
            SymbolKind::Constant => "Constant",
            SymbolKind::Variable => "Variable",
            SymbolKind::Module => "Module",
            SymbolKind::Property => "Property",
            SymbolKind::EnumMember => "Enum Member",
            SymbolKind::Trait => "Trait",
            SymbolKind::Impl => "Implementation",
            SymbolKind::Macro => "Macro",
            SymbolKind::Unknown => "Unknown",
        }
    }
}

/// A range in the source code (0-indexed lines and columns)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    /// Start line (0-indexed)
    pub start_line: u32,
    /// Start column (0-indexed)
    pub start_col: u32,
    /// End line (0-indexed)
    pub end_line: u32,
    /// End column (0-indexed)
    pub end_col: u32,
}

impl Range {
    /// Create a new range
    pub fn new(start_line: u32, start_col: u32, end_line: u32, end_col: u32) -> Self {
        Self {
            start_line,
            start_col,
            end_line,
            end_col,
        }
    }

    /// Create a range from a tree-sitter node
    pub fn from_node(node: &tree_sitter::Node) -> Self {
        let start = node.start_position();
        let end = node.end_position();
        Self {
            start_line: start.row as u32,
            start_col: start.column as u32,
            end_line: end.row as u32,
            end_col: end.column as u32,
        }
    }

    /// Check if this range contains a position
    pub fn contains(&self, line: u32, col: u32) -> bool {
        if line < self.start_line || line > self.end_line {
            return false;
        }
        if line == self.start_line && col < self.start_col {
            return false;
        }
        if line == self.end_line && col > self.end_col {
            return false;
        }
        true
    }
}

/// A symbol extracted from source code
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Symbol {
    /// Symbol name
    pub name: String,
    /// Kind of symbol
    pub kind: SymbolKind,
    /// Range in the source file
    pub range: Range,
    /// Range of just the symbol name (for navigation)
    pub selection_range: Range,
    /// Nested symbols (methods inside a class, etc.)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Symbol>,
    /// Additional details (type signature, etc.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Symbol {
    /// Create a new symbol
    pub fn new(name: impl Into<String>, kind: SymbolKind, range: Range) -> Self {
        Self {
            name: name.into(),
            kind,
            range,
            selection_range: range,
            children: Vec::new(),
            detail: None,
        }
    }

    /// Set the selection range
    pub fn with_selection_range(mut self, range: Range) -> Self {
        self.selection_range = range;
        self
    }

    /// Add a child symbol
    pub fn add_child(&mut self, child: Symbol) {
        self.children.push(child);
    }

    /// Set detail string
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}
