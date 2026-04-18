#![warn(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::wildcard_imports,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::uninlined_format_args,
    clippy::doc_markdown,
    clippy::return_self_not_must_use,
    clippy::redundant_closure_for_method_calls,
    clippy::single_match_else,
    clippy::if_not_else,
    clippy::match_same_arms,
    clippy::map_unwrap_or,
    clippy::similar_names,
    clippy::struct_excessive_bools
)]

//! Solo Parse - Tree-sitter based code parsing for Solo IDE
//!
//! This crate provides:
//! - Language detection from file extensions
//! - AST parsing using tree-sitter
//! - Symbol extraction (functions, classes, structs, etc.)
//! - Incremental parsing support for efficient updates

mod languages;
mod parser;
mod symbols;

pub use languages::{Language, LanguageRegistry};
pub use parser::{ParseResult, Parser, ParserError};
pub use symbols::{Range, Symbol, SymbolKind};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rust_file() {
        let parser = Parser::new();
        let code = r#"
fn main() {
    println!("Hello, world!");
}

struct Point {
    x: f64,
    y: f64,
}

impl Point {
    fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}
"#;

        let result = parser.parse("test.rs", code).unwrap();
        assert!(!result.symbols.is_empty());

        // Should find main function, Point struct, and new method
        let names: Vec<&str> = result.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"main"));
        assert!(names.contains(&"Point"));
    }

    #[test]
    fn test_parse_typescript_file() {
        let parser = Parser::new();
        let code = r"
interface User {
    name: string;
    age: number;
}

function greet(user: User): string {
    return `Hello, ${user.name}!`;
}

class UserService {
    private users: User[] = [];

    addUser(user: User): void {
        this.users.push(user);
    }
}
";

        let result = parser.parse("test.ts", code).unwrap();
        assert!(!result.symbols.is_empty());

        let names: Vec<&str> = result.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"User"));
        assert!(names.contains(&"greet"));
        assert!(names.contains(&"UserService"));
    }

    #[test]
    fn test_parse_python_file() {
        let parser = Parser::new();
        let code = r#"
def greet(name: str) -> str:
    return f"Hello, {name}!"

class Calculator:
    def __init__(self):
        self.result = 0

    def add(self, x: int, y: int) -> int:
        return x + y
"#;

        let result = parser.parse("test.py", code).unwrap();
        assert!(!result.symbols.is_empty());

        let names: Vec<&str> = result.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"greet"));
        assert!(names.contains(&"Calculator"));
    }

    #[test]
    fn test_unknown_language() {
        let parser = Parser::new();
        let result = parser.parse("test.xyz", "some content");

        assert!(matches!(result, Err(ParserError::UnsupportedLanguage(_))));
    }
}
