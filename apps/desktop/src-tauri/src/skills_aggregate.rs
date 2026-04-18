//! Workspace-root `AGENTS.md` aggregator.
//!
//! Solo writes a solo-fenced block at the root of every workspace listing its
//! installed skills, so other AGENTS.md-aware tools (Cursor, Codex, Windsurf,
//! Aider, …) see what the user has without any Solo-specific integration.
//!
//! The aggregator is non-destructive: if the user has hand-authored content in
//! their `AGENTS.md`, we only replace the block between `<!-- solo:begin -->`
//! and `<!-- solo:end -->`. If no fence is present, we append one.

use crate::skills_commands;
use solo_protocol::SkillInfo;
use std::path::{Path, PathBuf};
use tokio::fs;

const BEGIN_FENCE: &str = "<!-- solo:begin -->";
const END_FENCE: &str = "<!-- solo:end -->";

/// Build the solo-fenced block describing installed skills.
pub fn build_block(skills: &[SkillInfo]) -> String {
    let mut out = String::new();
    out.push_str(BEGIN_FENCE);
    out.push_str("\n# Installed Solo Skills\n");
    if skills.is_empty() {
        out.push_str("\n_(no skills installed)_\n");
    } else {
        out.push('\n');
        for s in skills {
            let desc = s.description.lines().next().unwrap_or("").trim();
            out.push_str(&format!("- **{}** — {}\n", s.name, desc));
        }
    }
    out.push_str("\nFull instructions at `~/.solo/skills/<name>/AGENTS.md`.\n");
    out.push_str(END_FENCE);
    out.push('\n');
    out
}

/// Write / replace the solo fence block in `<workspace>/AGENTS.md`.
///
/// - Missing file → create with just the block.
/// - File with existing fence → replace fence contents in place.
/// - File without fence → append the block after a blank line.
pub async fn write_workspace_agents_md(
    workspace: &Path,
    skills: &[SkillInfo],
) -> std::io::Result<()> {
    let path = workspace.join("AGENTS.md");
    let block = build_block(skills);
    let new_contents = match fs::read_to_string(&path).await {
        Ok(existing) => replace_or_append(&existing, &block),
        Err(_) => block.clone(),
    };
    fs::write(&path, new_contents).await
}

fn replace_or_append(existing: &str, block: &str) -> String {
    if let (Some(begin_idx), Some(end_idx)) = (existing.find(BEGIN_FENCE), existing.find(END_FENCE))
    {
        if begin_idx < end_idx {
            let after = end_idx + END_FENCE.len();
            // Absorb the trailing newline after END_FENCE if present to avoid
            // accumulating blank lines across runs.
            let tail_start = if existing[after..].starts_with('\n') {
                after + 1
            } else {
                after
            };
            let mut out = String::new();
            out.push_str(&existing[..begin_idx]);
            out.push_str(block);
            out.push_str(&existing[tail_start..]);
            return out;
        }
    }
    let mut out = existing.trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(block);
    out
}

/// Tauri command: regenerate the workspace-root `AGENTS.md` from currently
/// installed skills.
#[tauri::command]
pub async fn skills_write_workspace_agents_md(cwd: String) -> Result<(), String> {
    let workspace = PathBuf::from(&cwd);
    let skills = skills_commands::skills_list_available(cwd).await?;
    write_workspace_agents_md(&workspace, &skills)
        .await
        .map_err(|e| format!("write_workspace_agents_md: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use solo_protocol::SkillSource;

    fn sample(name: &str, desc: &str) -> SkillInfo {
        SkillInfo {
            name: name.into(),
            description: desc.into(),
            content: String::new(),
            source: SkillSource::User,
            file_path: String::new(),
            enabled: true,
            priority: 0,
        }
    }

    #[tokio::test]
    async fn creates_file_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let skills = vec![sample("ui", "Build UIs.")];
        write_workspace_agents_md(tmp.path(), &skills).await.unwrap();
        let content = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        assert!(content.contains(BEGIN_FENCE));
        assert!(content.contains("**ui** — Build UIs."));
    }

    #[tokio::test]
    async fn preserves_user_content_when_fence_absent() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("AGENTS.md"),
            "# My Project\n\nSome custom notes.\n",
        )
        .unwrap();
        let skills = vec![sample("ui", "Build UIs.")];
        write_workspace_agents_md(tmp.path(), &skills).await.unwrap();
        let content = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        assert!(content.contains("Some custom notes."));
        assert!(content.contains(BEGIN_FENCE));
    }

    #[tokio::test]
    async fn replaces_existing_fence_block() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join("AGENTS.md"),
            "# My Project\n\n<!-- solo:begin -->\nOLD CONTENT\n<!-- solo:end -->\n\n## After\n",
        )
        .unwrap();
        let skills = vec![sample("ui", "Build UIs.")];
        write_workspace_agents_md(tmp.path(), &skills).await.unwrap();
        let content = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        assert!(!content.contains("OLD CONTENT"));
        assert!(content.contains("**ui** — Build UIs."));
        assert!(content.contains("## After"));
    }

    #[tokio::test]
    async fn idempotent_across_runs() {
        let tmp = tempfile::tempdir().unwrap();
        let skills = vec![sample("ui", "Build UIs."), sample("poetry", "Rhymes.")];
        write_workspace_agents_md(tmp.path(), &skills).await.unwrap();
        let first = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        write_workspace_agents_md(tmp.path(), &skills).await.unwrap();
        let second = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        assert_eq!(first, second, "regenerating must be idempotent");
    }

    #[tokio::test]
    async fn handles_empty_installed_list() {
        let tmp = tempfile::tempdir().unwrap();
        write_workspace_agents_md(tmp.path(), &[]).await.unwrap();
        let content = std::fs::read_to_string(tmp.path().join("AGENTS.md")).unwrap();
        assert!(content.contains("_(no skills installed)_"));
    }

    #[test]
    fn only_first_line_of_description_used() {
        let skill = sample("s", "short one-liner\nwith extra paragraph");
        let block = build_block(&[skill]);
        assert!(block.contains("**s** — short one-liner"));
        assert!(!block.contains("with extra paragraph"));
    }
}
