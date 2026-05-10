//! Plan-file persistence for Plan mode.
//!
//! Plans are stored at `<workspace>/.solo/plans/<slug>.md`. The slug is a
//! short random word pair (Docker-style) generated on first write and held in
//! memory by the caller for the lifetime of the session.
//!
//! The plan file itself is a cached projection — source of truth is the
//! message log. `recover_plan_from_messages` rebuilds the plan from an
//! `ExitPlanMode` tool call's input if the file goes missing.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rand::seq::SliceRandom;

const PLANS_DIR: &str = ".solo/plans";

const ADJECTIVES: &[&str] = &[
    "adaptive", "bold", "calm", "distant", "eager", "fierce", "gentle", "hidden", "icy", "jolly",
    "keen", "lucid", "mellow", "noble", "opal", "pine", "quiet", "rapid", "silent", "tidy",
    "usual", "vivid", "warm", "zesty",
];

const NOUNS: &[&str] = &[
    "anchor", "breeze", "cliff", "delta", "ember", "flame", "grove", "harbor", "island", "jewel",
    "knoll", "lagoon", "meadow", "nebula", "orchid", "prairie", "quartz", "ridge", "summit",
    "thistle", "valley", "willow", "zenith",
];

/// Resolve `<workspace>/.solo/plans/`, creating it if missing.
pub fn plans_dir(workspace: &Path) -> Result<PathBuf> {
    let dir = workspace.join(PLANS_DIR);
    if !dir.exists() {
        fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    Ok(dir)
}

/// Generate a fresh slug that doesn't collide with existing plan files.
///
/// Retries up to 10 times; falls back to a timestamp suffix after that.
pub fn new_slug(workspace: &Path) -> Result<String> {
    let dir = plans_dir(workspace)?;
    let mut rng = rand::thread_rng();

    for _ in 0..10 {
        let adj = ADJECTIVES.choose(&mut rng).copied().unwrap_or("plan");
        let noun = NOUNS.choose(&mut rng).copied().unwrap_or("file");
        let slug = format!("{}-{}", adj, noun);
        if !dir.join(format!("{}.md", slug)).exists() {
            return Ok(slug);
        }
    }

    // Fallback: append millis timestamp.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Ok(format!("plan-{}", ts))
}

/// Full path to a plan file, given a slug.
pub fn plan_path(workspace: &Path, slug: &str) -> Result<PathBuf> {
    Ok(plans_dir(workspace)?.join(format!("{}.md", slug)))
}

/// Atomically write plan content to disk.
///
/// Writes to `<slug>.md.tmp` then renames, so a crash mid-write leaves the
/// previous version intact.
pub fn write_plan(workspace: &Path, slug: &str, content: &str) -> Result<PathBuf> {
    let target = plan_path(workspace, slug)?;
    let tmp = target.with_extension("md.tmp");
    fs::write(&tmp, content).with_context(|| format!("writing {}", tmp.display()))?;
    fs::rename(&tmp, &target).with_context(|| format!("renaming to {}", target.display()))?;
    Ok(target)
}

/// Read plan content from disk, or `None` if the file doesn't exist.
pub fn read_plan(workspace: &Path, slug: &str) -> Result<Option<String>> {
    let path = plan_path(workspace, slug)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    Ok(Some(raw))
}

/// Delete a plan file. Idempotent — returns `Ok` even if the file is missing.
pub fn delete_plan(workspace: &Path, slug: &str) -> Result<()> {
    let path = plan_path(workspace, slug)?;
    if path.exists() {
        fs::remove_file(&path).with_context(|| format!("removing {}", path.display()))?;
    }
    Ok(())
}

/// List all plan slugs in the workspace, sorted lexically.
pub fn list_plans(workspace: &Path) -> Result<Vec<String>> {
    let dir = plans_dir(workspace)?;
    let mut slugs: Vec<String> = fs::read_dir(&dir)
        .with_context(|| format!("reading dir {}", dir.display()))?
        .filter_map(Result::ok)
        .filter_map(|e| {
            let path = e.path();
            if path.extension().is_some_and(|ext| ext == "md") {
                path.file_stem().and_then(|s| s.to_str()).map(String::from)
            } else {
                None
            }
        })
        .collect();
    slugs.sort();
    Ok(slugs)
}

/// Try to recover plan content from a list of tool-call inputs.
///
/// Scans for the most recent `ExitPlanMode` invocation and returns its
/// `plan` field. Used when the on-disk file is missing after a resume.
#[must_use]
pub fn recover_plan_from_tool_calls(tool_calls: &[(&str, &serde_json::Value)]) -> Option<String> {
    for (name, input) in tool_calls.iter().rev() {
        if *name == "ExitPlanMode" {
            if let Some(plan) = input.get("plan").and_then(|v| v.as_str()) {
                return Some(plan.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    #[test]
    fn write_then_read_roundtrip() {
        let dir = TempDir::new().unwrap();
        let slug = "test-plan";
        let content = "# My Plan\n\n- step 1\n";
        write_plan(dir.path(), slug, content).unwrap();
        let back = read_plan(dir.path(), slug).unwrap();
        assert_eq!(back.as_deref(), Some(content));
    }

    #[test]
    fn missing_plan_returns_none() {
        let dir = TempDir::new().unwrap();
        let back = read_plan(dir.path(), "nonexistent").unwrap();
        assert_eq!(back, None);
    }

    #[test]
    fn new_slug_produces_unique_names() {
        let dir = TempDir::new().unwrap();
        let s1 = new_slug(dir.path()).unwrap();
        write_plan(dir.path(), &s1, "x").unwrap();
        let s2 = new_slug(dir.path()).unwrap();
        assert_ne!(s1, s2);
    }

    #[test]
    fn plans_dir_is_created_on_first_access() {
        let dir = TempDir::new().unwrap();
        let plans = plans_dir(dir.path()).unwrap();
        assert!(plans.exists());
        assert!(plans.ends_with(".solo/plans"));
    }

    #[test]
    fn recover_from_exit_plan_tool_call() {
        let read_input = json!({});
        let plan = json!({"plan": "# Recovered\n- step A"});
        let calls: Vec<(&str, &serde_json::Value)> =
            vec![("Read", &read_input), ("ExitPlanMode", &plan)];
        let recovered = recover_plan_from_tool_calls(&calls);
        assert_eq!(recovered.as_deref(), Some("# Recovered\n- step A"));
    }

    #[test]
    fn recover_returns_none_without_exit_plan_mode() {
        let read_input = json!({});
        let calls: Vec<(&str, &serde_json::Value)> = vec![("Read", &read_input)];
        assert!(recover_plan_from_tool_calls(&calls).is_none());
    }

    #[test]
    fn list_plans_returns_sorted_slugs() {
        let dir = TempDir::new().unwrap();
        write_plan(dir.path(), "zebra", "").unwrap();
        write_plan(dir.path(), "apple", "").unwrap();
        write_plan(dir.path(), "mango", "").unwrap();
        let list = list_plans(dir.path()).unwrap();
        assert_eq!(list, vec!["apple", "mango", "zebra"]);
    }

    #[test]
    fn delete_plan_is_idempotent() {
        let dir = TempDir::new().unwrap();
        delete_plan(dir.path(), "nope").unwrap();
        write_plan(dir.path(), "real", "x").unwrap();
        delete_plan(dir.path(), "real").unwrap();
        assert_eq!(read_plan(dir.path(), "real").unwrap(), None);
    }
}
