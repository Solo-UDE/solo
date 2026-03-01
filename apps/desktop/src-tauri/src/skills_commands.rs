//! Skills discovery commands for Solo IDE
//!
//! Scans `~/.solo/skills/` (user-scoped) and `{cwd}/.solo/skills/` (project-scoped)
//! for markdown skill files, parses their frontmatter, and returns metadata + content.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::debug;

/// Skill information returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub content: String,
    pub source: String, // "user" | "project"
    pub file_path: String,
    pub enabled: bool,
    pub priority: i32,
}

/// Simple frontmatter parser — extracts key: value pairs from YAML-like header.
fn parse_frontmatter(raw: &str) -> (std::collections::HashMap<String, String>, String) {
    let mut meta = std::collections::HashMap::new();

    if !raw.starts_with("---") {
        return (meta, raw.to_string());
    }

    // Find closing ---
    if let Some(end_idx) = raw[3..].find("\n---") {
        let fm_block = &raw[3..3 + end_idx];
        let body_start = 3 + end_idx + 4; // skip \n---
        let body = raw[body_start..].trim_start_matches('\n').to_string();

        for line in fm_block.lines() {
            let line = line.trim();
            if let Some(colon_idx) = line.find(':') {
                let key = line[..colon_idx].trim().to_string();
                let value = line[colon_idx + 1..].trim().to_string();
                if !key.is_empty() {
                    meta.insert(key, value);
                }
            }
        }

        (meta, body)
    } else {
        (meta, raw.to_string())
    }
}

/// Scan a single skills directory and return discovered skills.
async fn discover_skills_in_dir(dir: &Path, scope: &str) -> Vec<SkillInfo> {
    let mut skills = Vec::new();

    let mut entries = match fs::read_dir(dir).await {
        Ok(e) => e,
        Err(_) => return skills,
    };

    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let (raw, skill_path, derived_name) = if path.is_file()
            && path.extension().is_some_and(|e| e == "md")
        {
            // Flat file: my-skill.md
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            match fs::read_to_string(&path).await {
                Ok(content) => (content, path.clone(), name),
                Err(_) => continue,
            }
        } else if path.is_dir() {
            // Directory-based: my-skill/SKILL.md
            let skill_md = path.join("SKILL.md");
            if !skill_md.exists() {
                continue;
            }
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            match fs::read_to_string(&skill_md).await {
                Ok(content) => (content, skill_md, name),
                Err(_) => continue,
            }
        } else {
            continue;
        };

        let (meta, body) = parse_frontmatter(&raw);

        let name = meta
            .get("name")
            .filter(|v| !v.is_empty())
            .cloned()
            .unwrap_or(derived_name);
        let description = meta
            .get("description")
            .cloned()
            .unwrap_or_default();
        let enabled = meta
            .get("enabled")
            .map_or(true, |v| v != "false");
        let priority = meta
            .get("priority")
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(0);

        skills.push(SkillInfo {
            name,
            description,
            content: body,
            source: scope.to_string(),
            file_path: skill_path.to_string_lossy().into_owned(),
            enabled,
            priority,
        });
    }

    skills
}

/// Resolve the user skills directory: `~/.solo/skills/`
fn user_skills_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(|home| PathBuf::from(home).join(".solo").join("skills"))
}

/// List all available skills from user and project directories.
/// Project skills override user skills with the same name.
#[tauri::command]
pub async fn skills_list_available(cwd: String) -> Result<Vec<SkillInfo>, String> {
    let mut skill_map = std::collections::HashMap::new();

    // User-scoped skills first
    if let Some(user_dir) = user_skills_dir() {
        let user_skills = discover_skills_in_dir(&user_dir, "user").await;
        for skill in user_skills {
            skill_map.insert(skill.name.clone(), skill);
        }
    }

    // Project-scoped skills override by name
    let project_dir = PathBuf::from(&cwd).join(".solo").join("skills");
    let project_skills = discover_skills_in_dir(&project_dir, "project").await;
    for skill in project_skills {
        skill_map.insert(skill.name.clone(), skill);
    }

    let mut skills: Vec<SkillInfo> = skill_map.into_values().collect();

    // Sort by priority (desc), then name (asc)
    skills.sort_by(|a, b| {
        b.priority.cmp(&a.priority).then_with(|| a.name.cmp(&b.name))
    });

    debug!("Found {} skills for cwd={}", skills.len(), cwd);
    Ok(skills)
}
