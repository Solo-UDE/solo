//! Dynamic system prompt builder for AI coding agents
//!
//! Generates a system prompt that describes available tools, workspace context,
//! and behavioral guidelines.

use crate::provider::ToolDefinition;

/// Build a coding-agent system prompt from the current tool set and workspace info.
pub fn build_system_prompt(tools: &[ToolDefinition], workspace_root: &str) -> String {
    let mut prompt = String::with_capacity(4096);

    // ── Role ─────────────────────────────────────────────────────────
    prompt.push_str(
        "You are an expert software engineering assistant embedded in the Solo IDE. \
         You help users understand, write, debug, and refactor code. \
         You have access to the user's workspace and can read files, write files, \
         run shell commands, and search code.\n\n",
    );

    // ── Workspace context ────────────────────────────────────────────
    prompt.push_str(&format!("## Workspace\n\nCurrent workspace root: `{}`\n\n", workspace_root));

    // ── Tool descriptions ────────────────────────────────────────────
    if !tools.is_empty() {
        prompt.push_str("## Available Tools\n\n");
        prompt.push_str(
            "You can call tools to interact with the workspace. Each tool call must include \
             valid JSON arguments matching the schema below.\n\n",
        );

        for tool in tools {
            prompt.push_str(&format!("### `{}`\n", tool.name));
            prompt.push_str(&format!("{}\n", tool.description));
            if tool.needs_approval {
                prompt.push_str("*Requires user approval before execution.*\n");
            }
            // Include a compact schema
            if let Ok(schema_str) = serde_json::to_string_pretty(&tool.input_schema) {
                prompt.push_str(&format!("```json\n{}\n```\n", schema_str));
            }
            prompt.push('\n');
        }
    }

    // ── Behavioral guidelines ────────────────────────────────────────
    prompt.push_str("## Guidelines\n\n");
    prompt.push_str(
        "1. **Read before edit.** Always read a file before modifying it so you understand \
         the existing structure, indentation, and conventions.\n\
         2. **Prefer editing over rewriting.** Use the `edit` tool (string replacement) \
         instead of rewriting entire files with `write_file` when only a small portion needs \
         to change.\n\
         3. **Minimal changes.** Only make changes that are directly requested or clearly \
         necessary. Do not refactor surrounding code unless asked.\n\
         4. **Verify with tools.** After making changes, read the file back or run tests \
         to confirm correctness when appropriate.\n\
         5. **Explain your reasoning.** Briefly explain what you plan to do before making \
         changes. Keep explanations concise.\n\
         6. **Absolute paths.** Always use absolute paths when calling file tools.\n\
         7. **Safety.** Never execute destructive commands (e.g. `rm -rf /`) or expose \
         credentials.\n",
    );

    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_system_prompt_basic() {
        let tools = vec![
            ToolDefinition {
                name: "read_file".to_string(),
                description: "Read the contents of a file".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" }
                    },
                    "required": ["path"]
                }),
                needs_approval: false,
            },
            ToolDefinition {
                name: "bash".to_string(),
                description: "Execute a bash command".to_string(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" }
                    },
                    "required": ["command"]
                }),
                needs_approval: true,
            },
        ];

        let prompt = build_system_prompt(&tools, "/home/user/project");
        assert!(prompt.contains("Solo IDE"));
        assert!(prompt.contains("/home/user/project"));
        assert!(prompt.contains("### `read_file`"));
        assert!(prompt.contains("### `bash`"));
        assert!(prompt.contains("Requires user approval"));
        assert!(prompt.contains("Read before edit"));
    }

    #[test]
    fn test_build_system_prompt_no_tools() {
        let prompt = build_system_prompt(&[], "/tmp");
        assert!(prompt.contains("/tmp"));
        assert!(!prompt.contains("Available Tools"));
        assert!(prompt.contains("Guidelines"));
    }
}
