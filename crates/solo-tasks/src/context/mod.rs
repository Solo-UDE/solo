//! Context aggregator — pluggable providers that supply context fragments.

pub mod fragment;
pub use fragment::ContextFragment;

/// Bundle of provider keys the caller wants aggregated. Identifies string
/// names ("vault", "skills", "git", "tasks", "notes", "sessions") — the
/// actual provider implementations live in the Tauri layer because they
/// need access to Tauri State (store, worktree state, agent sessions, etc.)
/// that a pure Rust crate can't reference.
pub type Bundle = Vec<String>;

pub const DEFAULT_BUNDLE: &[&str] = &["vault", "skills", "git", "tasks"];

/// Total token budget for a single planner call. Fragments beyond this are truncated.
pub const DEFAULT_TOKEN_BUDGET: usize = 8000;

/// Format a list of fragments into a prompt string. Applies a per-fragment
/// header so the LLM knows where each piece came from.
pub fn render_prompt(goal: &str, fragments: &[ContextFragment]) -> String {
    let mut out = String::new();
    out.push_str("You are the Solo Task Allocator's planner.\n\n");
    out.push_str("GOAL: ");
    out.push_str(goal);
    out.push_str("\n\n");
    out.push_str("CONTEXT:\n");
    for f in fragments {
        use std::fmt::Write as _;
        writeln!(&mut out, "\n--- {} ---\n{}\n", f.source, f.content).ok();
    }
    out.push_str("\n\nINSTRUCTIONS:\n");
    out.push_str("Decompose the goal into 3-7 concrete tasks. Return ONLY a JSON array with this shape:\n");
    out.push_str(r#"[
  {
    "title": "short imperative title",
    "description": "2-3 sentence context — what + why",
    "executor": "manual" | "agent",
    "priority": "low" | "medium" | "high" | "urgent"
  }
]"#);
    out.push_str("\n\nOutput ONLY the JSON array, no prose, no markdown fences.\n");
    out
}

/// Trim fragments to fit a token budget. Keeps earliest fragments in order.
pub fn trim_to_budget(mut fragments: Vec<ContextFragment>, budget: usize) -> Vec<ContextFragment> {
    let mut running = 0;
    let mut cutoff = fragments.len();
    for (i, f) in fragments.iter().enumerate() {
        running += f.token_estimate;
        if running > budget {
            cutoff = i;
            break;
        }
    }
    fragments.truncate(cutoff);
    fragments
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_prompt_contains_goal_and_fragments() {
        let fragments = vec![
            ContextFragment::new("vault", "entry A"),
            ContextFragment::new("skills", "git skill"),
        ];
        let p = render_prompt("ship billing", &fragments);
        assert!(p.contains("ship billing"));
        assert!(p.contains("--- vault ---"));
        assert!(p.contains("entry A"));
        assert!(p.contains("JSON array"));
    }

    #[test]
    fn trim_to_budget_drops_overflow() {
        // Each fragment has content.len()/4 tokens. Make 3 fragments, each ~100 tokens.
        let f = |n: usize| ContextFragment::new("x", "a".repeat(n * 4));
        let frags = vec![f(100), f(100), f(100)];
        let trimmed = trim_to_budget(frags, 150);
        assert_eq!(trimmed.len(), 1); // 100 fits, second would push to 200 > 150
    }
}
