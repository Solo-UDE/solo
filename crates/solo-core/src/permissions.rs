//! Permission decision pipeline, modeled after Claude Code's `hasPermissionsToUseTool`.
//!
//! Rules are strings like `ToolName` (tool-wide) or `ToolName(content-pattern)`
//! (content-specific). Content patterns are glob-matched against a canonical
//! "content" string derived per tool (e.g. for `Bash` it's the command line).
//!
//! The decision pipeline, in order:
//!
//! 1. A matching `deny` rule  → `Deny`   (bypass-immune, even under Accept mode)
//! 2. A matching `ask` rule   → `Ask`    (bypass-immune under Accept mode)
//! 3. Tool tier is `Destructive` → `Ask` (bypass-immune under Accept mode)
//! 4. Mode is `Plan` + tier is `Mutate` → `Deny` ("exit plan mode")
//! 5. Mode is `Accept`        → `Allow` (we've already handled bypass-immune cases)
//! 6. A matching `allow` rule → `Allow`
//! 7. Tool tier is `Read`     → `Allow`
//! 8. Fall-through            → `Ask`

use globset::{Glob, GlobMatcher};
use serde_json::Value;
use solo_protocol::{
    PermissionDecision, PermissionMode, PermissionsConfig, ToolTier,
};

/// Default classification for every tool exposed via the Claude Agent SDK.
///
/// Any tool not in this table is treated as `Mutate` by default (conservative).
/// Users can override per tool via allow/ask/deny rules.
pub const DEFAULT_TOOL_TIERS: &[(&str, ToolTier)] = &[
    // Read-only
    ("Read", ToolTier::Read),
    ("Glob", ToolTier::Read),
    ("Grep", ToolTier::Read),
    ("WebSearch", ToolTier::Read),
    ("WebFetch", ToolTier::Read),
    ("BashOutput", ToolTier::Read),
    ("AskUserQuestion", ToolTier::Read),
    ("TodoWrite", ToolTier::Read),
    ("ExitPlanMode", ToolTier::Read),
    ("Task", ToolTier::Read),
    ("ToolSearch", ToolTier::Read),
    ("Skill", ToolTier::Read),
    // Mutating
    ("Write", ToolTier::Mutate),
    ("Edit", ToolTier::Mutate),
    ("NotebookEdit", ToolTier::Mutate),
    ("Bash", ToolTier::Mutate),
    ("KillShell", ToolTier::Mutate),
];

/// Classify a tool using the default table. Unknown tools default to `Mutate`.
#[must_use]
pub fn default_tier(tool_name: &str) -> ToolTier {
    for (name, tier) in DEFAULT_TOOL_TIERS {
        if *name == tool_name {
            return *tier;
        }
    }
    ToolTier::Mutate
}

/// Parsed form of a permission rule string.
///
/// `"Bash"`             → `Rule { tool: "Bash", content: None }`
/// `"Bash(npm i *)"`    → `Rule { tool: "Bash", content: Some("npm i *") }`
#[derive(Debug, Clone)]
pub struct Rule {
    pub tool: String,
    pub content: Option<String>,
    matcher: Option<GlobMatcher>,
}

impl Rule {
    /// Parse a rule string. Invalid content globs make the rule content-less
    /// (degrades to a tool-wide rule, which is safer than silently ignoring).
    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        if let Some(open) = trimmed.find('(') {
            if trimmed.ends_with(')') {
                let tool = trimmed[..open].to_string();
                let content_raw = &trimmed[open + 1..trimmed.len() - 1];
                let content = unescape(content_raw);
                let matcher = Glob::new(&content).ok().map(|g| g.compile_matcher());
                return Self {
                    tool,
                    content: Some(content),
                    matcher,
                };
            }
        }
        Self {
            tool: trimmed.to_string(),
            content: None,
            matcher: None,
        }
    }

    /// Returns true if the rule applies to this tool call.
    pub fn matches(&self, tool_name: &str, content: &str) -> bool {
        if self.tool != tool_name {
            return false;
        }
        match (&self.content, &self.matcher) {
            (None, _) => true,
            (Some(_), Some(m)) => m.is_match(content),
            // Parse failed → degraded to tool-wide match; shouldn't happen if matcher is None
            // but content is Some (parsing error), be conservative and don't match.
            (Some(_), None) => false,
        }
    }
}

/// Reverse of Claude Code's `escapeRuleContent` — turn `\(` into `(` etc.
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(&next) = chars.peek() {
                if matches!(next, '(' | ')' | '\\') {
                    out.push(next);
                    chars.next();
                    continue;
                }
            }
        }
        out.push(c);
    }
    out
}

/// Extract the "content" string used for pattern matching against a tool call.
///
/// This is a stable projection per tool:
///   - `Bash`       → the `command` field
///   - `Write`/`Edit`/`NotebookEdit` → the `file_path` field
///   - `Read`       → the `file_path` field
///   - anything else → empty string (tool-wide rules only)
#[must_use]
pub fn content_for(tool_name: &str, input: &Value) -> String {
    let key = match tool_name {
        "Bash" => "command",
        "BashOutput" => "bash_id",
        "Write" | "Edit" | "Read" => "file_path",
        "NotebookEdit" => "notebook_path",
        "WebFetch" => "url",
        "WebSearch" => "query",
        "Glob" | "Grep" => "pattern",
        _ => return String::new(),
    };
    input
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Run the full permission pipeline.
#[must_use]
pub fn check(
    tool_name: &str,
    tool_input: &Value,
    mode: PermissionMode,
    config: &PermissionsConfig,
) -> PermissionDecision {
    let content = content_for(tool_name, tool_input);
    let tier = default_tier(tool_name);

    let deny_rules: Vec<Rule> = config.deny.iter().map(|s| Rule::parse(s)).collect();
    let ask_rules: Vec<Rule> = config.ask.iter().map(|s| Rule::parse(s)).collect();
    let allow_rules: Vec<Rule> = config.allow.iter().map(|s| Rule::parse(s)).collect();

    // 1. Deny rules — bypass-immune.
    for r in &deny_rules {
        if r.matches(tool_name, &content) {
            return PermissionDecision::Deny {
                message: format!(
                    "Tool '{}' is denied by rule '{}'.",
                    tool_name,
                    format_rule(r)
                ),
            };
        }
    }

    // 2. Ask rules — bypass-immune under Accept mode.
    for r in &ask_rules {
        if r.matches(tool_name, &content) {
            return PermissionDecision::Ask {
                message: format!(
                    "Tool '{}' requires approval (rule '{}').",
                    tool_name,
                    format_rule(r)
                ),
                tier: Some(tier),
            };
        }
    }

    // 3. Destructive tier — always prompt, bypass-immune.
    if tier == ToolTier::Destructive {
        return PermissionDecision::Ask {
            message: format!("'{}' is a destructive operation and requires approval.", tool_name),
            tier: Some(tier),
        };
    }

    // 4. Plan mode: block any mutation.
    if mode == PermissionMode::Plan && tier == ToolTier::Mutate {
        return PermissionDecision::Deny {
            message: format!(
                "Plan mode is active. '{}' mutates state; write a plan and call ExitPlanMode to proceed.",
                tool_name
            ),
        };
    }

    // 5. Accept mode: auto-approve everything still here.
    if mode == PermissionMode::Accept && !config.disable_accept_mode {
        return PermissionDecision::Allow {
            reason: Some("Accept mode (bypass permissions).".into()),
        };
    }

    // 6. Allow rules.
    for r in &allow_rules {
        if r.matches(tool_name, &content) {
            return PermissionDecision::Allow {
                reason: Some(format!("Allowed by rule '{}'.", format_rule(r))),
            };
        }
    }

    // 7. Read tier — always allow.
    if tier == ToolTier::Read {
        return PermissionDecision::Allow {
            reason: Some("Read-only tool.".into()),
        };
    }

    // 8. Fall-through — prompt.
    PermissionDecision::Ask {
        message: format!("Approval required for '{}'.", tool_name),
        tier: Some(tier),
    }
}

fn format_rule(r: &Rule) -> String {
    match &r.content {
        Some(c) => format!("{}({})", r.tool, c),
        None => r.tool.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cfg(allow: &[&str], deny: &[&str], ask: &[&str]) -> PermissionsConfig {
        PermissionsConfig {
            default_mode: None,
            allow: allow.iter().map(|s| (*s).to_string()).collect(),
            deny: deny.iter().map(|s| (*s).to_string()).collect(),
            ask: ask.iter().map(|s| (*s).to_string()).collect(),
            additional_directories: vec![],
            disable_accept_mode: false,
        }
    }

    #[test]
    fn read_tool_is_auto_allowed_in_default_mode() {
        let d = check(
            "Read",
            &json!({"file_path": "/tmp/foo.txt"}),
            PermissionMode::Default,
            &cfg(&[], &[], &[]),
        );
        assert!(matches!(d, PermissionDecision::Allow { .. }));
    }

    #[test]
    fn write_tool_prompts_in_default_mode() {
        let d = check(
            "Write",
            &json!({"file_path": "/tmp/foo.txt", "content": "hi"}),
            PermissionMode::Default,
            &cfg(&[], &[], &[]),
        );
        assert!(matches!(d, PermissionDecision::Ask { .. }));
    }

    #[test]
    fn write_tool_is_allowed_under_accept_mode() {
        let d = check(
            "Write",
            &json!({"file_path": "/tmp/foo.txt"}),
            PermissionMode::Accept,
            &cfg(&[], &[], &[]),
        );
        assert!(matches!(d, PermissionDecision::Allow { .. }));
    }

    #[test]
    fn deny_rule_is_bypass_immune_under_accept() {
        let d = check(
            "Bash",
            &json!({"command": "rm -rf /tmp/test"}),
            PermissionMode::Accept,
            &cfg(&[], &["Bash(rm -rf *)"], &[]),
        );
        assert!(matches!(d, PermissionDecision::Deny { .. }));
    }

    #[test]
    fn ask_rule_is_bypass_immune_under_accept() {
        let d = check(
            "Bash",
            &json!({"command": "git push --force origin main"}),
            PermissionMode::Accept,
            &cfg(&[], &[], &["Bash(git push --force*)"]),
        );
        assert!(matches!(d, PermissionDecision::Ask { .. }));
    }

    #[test]
    fn plan_mode_blocks_mutations() {
        let d = check(
            "Write",
            &json!({"file_path": "/tmp/foo.txt"}),
            PermissionMode::Plan,
            &cfg(&[], &[], &[]),
        );
        assert!(matches!(d, PermissionDecision::Deny { .. }));
    }

    #[test]
    fn plan_mode_allows_reads() {
        let d = check(
            "Read",
            &json!({"file_path": "/tmp/foo.txt"}),
            PermissionMode::Plan,
            &cfg(&[], &[], &[]),
        );
        assert!(matches!(d, PermissionDecision::Allow { .. }));
    }

    #[test]
    fn allow_rule_grants_specific_bash_command() {
        let d = check(
            "Bash",
            &json!({"command": "git status"}),
            PermissionMode::Default,
            &cfg(&["Bash(git status)"], &[], &[]),
        );
        assert!(matches!(d, PermissionDecision::Allow { .. }));
    }

    #[test]
    fn glob_pattern_matches_bash_subcommand() {
        let cfg = cfg(&["Bash(npm *)"], &[], &[]);
        let allowed = check(
            "Bash",
            &json!({"command": "npm install lodash"}),
            PermissionMode::Default,
            &cfg,
        );
        assert!(matches!(allowed, PermissionDecision::Allow { .. }));

        let prompted = check(
            "Bash",
            &json!({"command": "pip install foo"}),
            PermissionMode::Default,
            &cfg,
        );
        assert!(matches!(prompted, PermissionDecision::Ask { .. }));
    }

    #[test]
    fn unescape_handles_escaped_parens() {
        assert_eq!(unescape(r"git commit -m \(hi\)"), "git commit -m (hi)");
        assert_eq!(unescape(r"a\\b"), r"a\b");
    }

    #[test]
    fn rule_parse_tool_wide() {
        let r = Rule::parse("Bash");
        assert_eq!(r.tool, "Bash");
        assert_eq!(r.content, None);
        assert!(r.matches("Bash", "any command"));
        assert!(!r.matches("Write", ""));
    }

    #[test]
    fn rule_parse_with_content() {
        let r = Rule::parse("Bash(git *)");
        assert_eq!(r.tool, "Bash");
        assert_eq!(r.content.as_deref(), Some("git *"));
        assert!(r.matches("Bash", "git status"));
        assert!(!r.matches("Bash", "npm install"));
    }

    #[test]
    fn disable_accept_mode_forces_prompt_even_under_accept() {
        let mut c = cfg(&[], &[], &[]);
        c.disable_accept_mode = true;
        let d = check(
            "Write",
            &json!({"file_path": "/tmp/foo.txt"}),
            PermissionMode::Accept,
            &c,
        );
        assert!(matches!(d, PermissionDecision::Ask { .. }));
    }

    #[test]
    fn unknown_tool_defaults_to_mutate_tier() {
        assert_eq!(default_tier("SomeRandomTool"), ToolTier::Mutate);
    }

    #[test]
    fn debug_mode_gates_like_default() {
        let d = check(
            "Write",
            &json!({"file_path": "/tmp/foo.txt"}),
            PermissionMode::Debug,
            &cfg(&[], &[], &[]),
        );
        // Debug mode is Default + goal-capture overlay; gating is identical.
        assert!(matches!(d, PermissionDecision::Ask { .. }));
    }
}
