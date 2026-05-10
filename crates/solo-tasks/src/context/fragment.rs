//! A single fragment of context supplied to the planner.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextFragment {
    /// Which source produced this fragment (vault, skills, git, tasks, notes, sessions).
    pub source: String,
    /// Human-readable body — will be concatenated into the LLM prompt.
    pub content: String,
    /// Rough token estimate (`content.len() / 4`).
    pub token_estimate: usize,
}

impl ContextFragment {
    pub fn new(source: impl Into<String>, content: impl Into<String>) -> Self {
        let content = content.into();
        let token_estimate = content.len() / 4;
        Self {
            source: source.into(),
            content,
            token_estimate,
        }
    }
}
