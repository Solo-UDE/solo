//! Skills marketplace integration.
//!
//! The browse/search surface follows skills.sh's public app endpoints
//! (`/api/skills/{view}/{page}` and `/api/search`). Installation is direct:
//! for GitHub-backed skills, Solo resolves the skill folder through the
//! GitHub tree API and copies the text files into `~/.solo/skills/<skill-id>/`.

use crate::skills_origin;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use solo_protocol::{
    InstalledSkillMeta, OriginSource, Registry, RegistryEntry, SkillAudit, SkillDetail, SkillFile,
    SkillSuggestion, SkillsEvent,
};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::fs;

const SKILLS_SH_BASE: &str = "https://skills.sh";
const CACHE_TTL_SECS: u64 = 30 * 60;
const FETCH_TIMEOUT_SECS: u64 = 20;
const MAX_SKILL_BYTES: u64 = 5 * 1024 * 1024;
const MAX_SKILL_FILES: usize = 300;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillsShPage {
    skills: Vec<SkillsShSkill>,
    #[serde(default)]
    has_more: bool,
    #[serde(default)]
    total_skills: Option<u32>,
    #[serde(default)]
    all_time_total: Option<u32>,
    #[serde(default)]
    view: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillsShSkill {
    #[serde(default)]
    id: Option<String>,
    source: String,
    skill_id: String,
    name: String,
    #[serde(default)]
    installs: u32,
    #[serde(default)]
    is_official: bool,
    #[serde(default)]
    is_duplicate: bool,
}

#[derive(Debug, Deserialize)]
struct GithubRepo {
    default_branch: String,
    #[serde(default)]
    html_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubTree {
    tree: Vec<GithubTreeEntry>,
    #[serde(default)]
    truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct GithubTreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Debug, Clone)]
struct SkillFolder {
    branch: String,
    root: String,
    instruction_path: String,
    repo_url: String,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn user_skills_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".solo").join("skills"))
}

fn cache_path(view: &str, page: u32) -> Option<PathBuf> {
    home_dir().map(|h| {
        h.join(".solo")
            .join("cache")
            .join("skills-sh")
            .join(format!("{}-{}.json", sanitize_file_segment(view), page))
    })
}

fn sanitize_file_segment(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

fn validate_skill_id(id: &str) -> Result<&str, String> {
    if id.is_empty() {
        return Err("skill id must not be empty".into());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("skill id '{}' contains disallowed characters", id));
    }
    Ok(id)
}

fn install_dir_name(entry: &RegistryEntry) -> Result<String, String> {
    let raw = if !entry.skill_id.trim().is_empty() {
        entry.skill_id.as_str()
    } else if !entry.name.trim().is_empty() {
        entry.name.as_str()
    } else {
        entry.id.as_str()
    };
    let sanitized = sanitize_file_segment(raw);
    validate_skill_id(&sanitized)?;
    Ok(sanitized)
}

fn is_domain_source(source: &str) -> bool {
    !source.contains('/') && source.contains('.')
}

fn is_github_source(source: &str) -> bool {
    let mut parts = source.split('/');
    matches!((parts.next(), parts.next(), parts.next()), (Some(a), Some(b), None) if !a.is_empty() && !b.is_empty())
}

fn source_from_entry(entry: &RegistryEntry) -> String {
    if !entry.source.is_empty() {
        return entry.source.clone();
    }
    let mut parts: Vec<&str> = entry.id.split('/').collect();
    if parts.len() >= 3 {
        parts.pop();
        return parts.join("/");
    }
    String::new()
}

fn skill_id_from_entry(entry: &RegistryEntry) -> String {
    if !entry.skill_id.is_empty() {
        entry.skill_id.clone()
    } else if !entry.name.is_empty() {
        entry.name.clone()
    } else {
        entry.id.rsplit('/').next().unwrap_or("").to_string()
    }
}

fn skills_sh_url(source: &str, skill_id: &str) -> String {
    if is_domain_source(source) {
        format!(
            "{}/site/{}/{}",
            SKILLS_SH_BASE,
            urlencoding::encode(source),
            urlencoding::encode(skill_id)
        )
    } else {
        format!(
            "{}/{}/{}",
            SKILLS_SH_BASE,
            source
                .split('/')
                .map(urlencoding::encode)
                .collect::<Vec<_>>()
                .join("/"),
            urlencoding::encode(skill_id)
        )
    }
}

fn registry_entry_from_skill(skill: SkillsShSkill) -> RegistryEntry {
    let id = skill
        .id
        .clone()
        .unwrap_or_else(|| format!("{}/{}", skill.source, skill.skill_id));
    let source_type = if is_domain_source(&skill.source) {
        "well-known"
    } else {
        "github"
    };
    let install_url = if is_domain_source(&skill.source) {
        format!("https://{}", skill.source)
    } else {
        format!("https://github.com/{}", skill.source)
    };
    let author = skill
        .source
        .split('/')
        .next()
        .unwrap_or(skill.source.as_str())
        .to_string();

    RegistryEntry {
        id,
        skill_id: skill.skill_id.clone(),
        name: skill.name,
        source: skill.source.clone(),
        source_type: source_type.to_string(),
        version: String::new(),
        description: String::new(),
        categories: Vec::new(),
        author,
        license: String::new(),
        tarball_url: String::new(),
        sha256: String::new(),
        tags: Vec::new(),
        updated_at: String::new(),
        install_url,
        url: skills_sh_url(&skill.source, &skill.skill_id),
        installs: skill.installs,
        is_official: skill.is_official,
        is_duplicate: skill.is_duplicate,
    }
}

fn registry_from_page(page: SkillsShPage, view: &str, page_no: u32) -> Registry {
    let total = page
        .total_skills
        .or(page.all_time_total)
        .unwrap_or_default();
    Registry {
        version: 1,
        generated_at: chrono::Utc::now().to_rfc3339(),
        skills: page.skills.into_iter().map(registry_entry_from_skill).collect(),
        total_skills: total,
        has_more: page.has_more,
        next_page: page.has_more.then_some(page_no + 1),
        view: page.view.unwrap_or_else(|| view.to_string()),
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Solo IDE skills marketplace"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/json,text/plain,*/*"));

    if let Ok(token) = std::env::var("GITHUB_TOKEN").or_else(|_| std::env::var("GH_TOKEN")) {
        if !token.trim().is_empty() {
            let value = format!("Bearer {}", token.trim());
            if let Ok(header) = HeaderValue::from_str(&value) {
                headers.insert(AUTHORIZATION, header);
            }
        }
    }

    reqwest::Client::builder()
        .timeout(Duration::from_secs(FETCH_TIMEOUT_SECS))
        .default_headers(headers)
        .build()
        .map_err(|e| format!("build http client: {}", e))
}

async fn cache_is_fresh(cache: &Path) -> bool {
    let Ok(meta) = fs::metadata(cache).await else {
        return false;
    };
    let Ok(modified) = meta.modified() else {
        return false;
    };
    modified
        .elapsed()
        .map(|d| d.as_secs() < CACHE_TTL_SECS)
        .unwrap_or(false)
}

async fn read_cache(cache: &Path) -> Option<Registry> {
    let raw = fs::read_to_string(cache).await.ok()?;
    serde_json::from_str::<Registry>(&raw).ok()
}

async fn write_cache(cache: &Path, registry: &Registry) {
    let Ok(text) = serde_json::to_string(registry) else {
        return;
    };
    if let Some(parent) = cache.parent() {
        if let Err(e) = fs::create_dir_all(parent).await {
            tracing::debug!("failed to create skills.sh cache dir: {}", e);
            return;
        }
    }
    if let Err(e) = fs::write(cache, text).await {
        tracing::debug!("failed to write skills.sh cache: {}", e);
    }
}

async fn fetch_registry_page_inner(view: &str, page: u32, force: bool) -> Result<Registry, String> {
    let view = match view {
        "all-time" | "trending" | "hot" => view,
        other => return Err(format!("unsupported skills.sh view '{}'", other)),
    };
    let cache = cache_path(view, page).ok_or_else(|| "could not resolve HOME".to_string())?;

    if !force && cache_is_fresh(&cache).await {
        if let Some(registry) = read_cache(&cache).await {
            return Ok(registry);
        }
    }

    let client = http_client()?;
    let url = format!("{}/api/skills/{}/{}", SKILLS_SH_BASE, view, page);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("fetch skills.sh page: {}", e))?;
    if !resp.status().is_success() {
        if let Some(stale) = read_cache(&cache).await {
            return Ok(stale);
        }
        return Err(format!("skills.sh page HTTP {}", resp.status()));
    }

    let page_json = resp
        .json::<SkillsShPage>()
        .await
        .map_err(|e| format!("parse skills.sh page: {}", e))?;
    let registry = registry_from_page(page_json, view, page);
    write_cache(&cache, &registry).await;
    Ok(registry)
}

#[tauri::command]
pub async fn skills_fetch_registry(app: AppHandle, force: bool) -> Result<Registry, String> {
    let registry = fetch_registry_page_inner("all-time", 0, force).await?;
    let _ = app.emit("skills-event", SkillsEvent::RegistryUpdated);
    Ok(registry)
}

#[tauri::command]
pub async fn skills_fetch_registry_page(
    view: String,
    page: u32,
    force: bool,
) -> Result<Registry, String> {
    fetch_registry_page_inner(&view, page, force).await
}

#[derive(Debug, Deserialize)]
struct SkillsShSearch {
    #[serde(default)]
    skills: Vec<SkillsShSkill>,
}

#[tauri::command]
pub async fn skills_search_marketplace(
    _app: AppHandle,
    query: String,
    installed_ids: Vec<String>,
) -> Result<Vec<SkillSuggestion>, String> {
    let trimmed = query.trim();
    if trimmed.len() < 2 {
        return Ok(Vec::new());
    }

    let installed: std::collections::HashSet<String> = installed_ids
        .into_iter()
        .map(|s| s.to_lowercase())
        .collect();
    let client = http_client()?;
    let url = format!(
        "{}/api/search?q={}&limit=50",
        SKILLS_SH_BASE,
        urlencoding::encode(trimmed)
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("search skills.sh: {}", e))?;
    if !resp.status().is_success() {
        tracing::debug!("skills.sh search returned {}", resp.status());
        return Ok(Vec::new());
    }

    let body = resp
        .json::<SkillsShSearch>()
        .await
        .map_err(|e| format!("parse skills.sh search: {}", e))?;
    Ok(body
        .skills
        .into_iter()
        .map(registry_entry_from_skill)
        .filter(|entry| {
            let id = entry.id.to_lowercase();
            let skill_id = entry.skill_id.to_lowercase();
            let name = entry.name.to_lowercase();
            !installed.contains(&id) && !installed.contains(&skill_id) && !installed.contains(&name)
        })
        .enumerate()
        .map(|(idx, entry)| SkillSuggestion {
            reason: if entry.is_official {
                "official skills.sh result".to_string()
            } else {
                "matches skills.sh search".to_string()
            },
            score: 1.0 - (idx as f32 * 0.05),
            entry,
        })
        .collect())
}

fn path_is_safe_relative(path: &Path) -> bool {
    if path.is_absolute() {
        return false;
    }
    path.components()
        .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

fn has_binary_extension(path: &Path) -> bool {
    const BINARY_EXTS: &[&str] = &[
        "exe", "bin", "so", "dll", "dylib", "app", "dmg", "pkg", "zip", "gz", "tgz", "tar",
        "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "woff", "woff2", "ttf", "otf",
    ];
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| BINARY_EXTS.iter().any(|b| b.eq_ignore_ascii_case(s)))
        .unwrap_or(false)
}

fn has_executable_magic(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }
    if &bytes[0..4] == b"\x7fELF" {
        return true;
    }
    let magic = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    if magic == 0xfeedface || magic == 0xfeedfacf || magic == 0xcefaedfe || magic == 0xcffaedfe {
        return true;
    }
    &bytes[0..2] == b"MZ"
}

fn encoded_path(path: &str) -> String {
    path.split('/')
        .map(urlencoding::encode)
        .collect::<Vec<_>>()
        .join("/")
}

fn raw_github_url(source: &str, branch: &str, path: &str) -> String {
    format!(
        "https://raw.githubusercontent.com/{}/{}/{}",
        source,
        urlencoding::encode(branch),
        encoded_path(path)
    )
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    url: &str,
) -> Result<T, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("fetch {}: {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!("{} returned HTTP {}", url, resp.status()));
    }
    resp.json::<T>()
        .await
        .map_err(|e| format!("parse {}: {}", url, e))
}

fn instruction_candidate_score(path: &str, entry: &RegistryEntry) -> i32 {
    let lower = path.to_lowercase();
    if !(lower.ends_with("/skill.md")
        || lower.ends_with("/agents.md")
        || lower == "skill.md"
        || lower == "agents.md")
    {
        return 0;
    }

    let skill_id = skill_id_from_entry(entry).to_lowercase();
    let name = entry.name.to_lowercase();
    let parent = Path::new(path)
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_lowercase();
    let root = Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
        .to_lowercase();

    let mut score = 1;
    if parent == skill_id || parent == name {
        score += 100;
    }
    if !parent.is_empty() && (skill_id.ends_with(&parent) || parent.ends_with(&skill_id)) {
        score += 80;
    }
    if !parent.is_empty() && (skill_id.contains(&parent) || parent.contains(&skill_id)) {
        score += 45;
    }
    if root == format!("skills/{}", skill_id) || root == format!("skills/{}", name) {
        score += 80;
    }
    if lower.ends_with("/agents.md") || lower == "agents.md" {
        score += 3;
    }
    score
}

async fn resolve_skill_folder(
    client: &reqwest::Client,
    entry: &RegistryEntry,
) -> Result<SkillFolder, String> {
    let source = source_from_entry(entry);
    if !is_github_source(&source) {
        return Err("only GitHub-backed skills can be installed directly right now".to_string());
    }

    let repo_url = format!("https://github.com/{}", source);
    let repo: GithubRepo = fetch_json(
        client,
        &format!("https://api.github.com/repos/{}", source),
    )
    .await?;
    let branch = repo.default_branch;
    let tree: GithubTree = fetch_json(
        client,
        &format!(
            "https://api.github.com/repos/{}/git/trees/{}?recursive=1",
            source,
            urlencoding::encode(&branch)
        ),
    )
    .await?;
    if tree.truncated {
        tracing::warn!("GitHub tree for {} was truncated", source);
    }

    let mut best: Option<(i32, String)> = None;
    for item in tree.tree.iter().filter(|item| item.kind == "blob") {
        let score = instruction_candidate_score(&item.path, entry);
        if score > 0 && best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
            best = Some((score, item.path.clone()));
        }
    }

    let (_, instruction_path) =
        best.ok_or_else(|| format!("could not find {} in {}", skill_id_from_entry(entry), source))?;
    let root = Path::new(&instruction_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(SkillFolder {
        branch,
        root,
        instruction_path,
        repo_url: if repo.html_url.is_empty() {
            repo_url
        } else {
            repo.html_url
        },
    })
}

fn entry_under_root<'a>(entry_path: &'a str, root: &str) -> Option<&'a str> {
    if root.is_empty() {
        Some(entry_path)
    } else {
        entry_path
            .strip_prefix(root)
            .and_then(|rest| rest.strip_prefix('/'))
    }
}

async fn fetch_skill_files(
    client: &reqwest::Client,
    source: &str,
    folder: &SkillFolder,
) -> Result<Vec<SkillFile>, String> {
    let tree: GithubTree = fetch_json(
        client,
        &format!(
            "https://api.github.com/repos/{}/git/trees/{}?recursive=1",
            source,
            urlencoding::encode(&folder.branch)
        ),
    )
    .await?;

    let mut entries: Vec<GithubTreeEntry> = tree
        .tree
        .into_iter()
        .filter(|item| item.kind == "blob")
        .filter(|item| entry_under_root(&item.path, &folder.root).is_some())
        .collect();
    entries.sort_by(|a, b| a.path.cmp(&b.path));

    if entries.len() > MAX_SKILL_FILES {
        return Err(format!(
            "skill has {} files, above Solo's {} file limit",
            entries.len(),
            MAX_SKILL_FILES
        ));
    }

    let mut total_bytes = 0_u64;
    let mut files = Vec::new();
    for item in entries {
        let Some(rel) = entry_under_root(&item.path, &folder.root) else {
            continue;
        };
        let rel_path = Path::new(rel);
        if !path_is_safe_relative(rel_path) {
            return Err(format!("unsafe skill file path: {}", item.path));
        }
        if has_binary_extension(rel_path) {
            tracing::debug!("skipping binary skill file {}", item.path);
            continue;
        }

        let hinted_size = item.size.unwrap_or_default();
        total_bytes = total_bytes.saturating_add(hinted_size);
        if total_bytes > MAX_SKILL_BYTES {
            return Err(format!("skill exceeds {} byte limit", MAX_SKILL_BYTES));
        }

        let resp = client
            .get(raw_github_url(source, &folder.branch, &item.path))
            .send()
            .await
            .map_err(|e| format!("fetch {}: {}", item.path, e))?;
        if !resp.status().is_success() {
            return Err(format!("{} returned HTTP {}", item.path, resp.status()));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("read {}: {}", item.path, e))?;
        if has_executable_magic(&bytes) {
            return Err(format!("binary magic bytes in {}", item.path));
        }
        total_bytes = total_bytes.saturating_add(bytes.len() as u64);
        if total_bytes > MAX_SKILL_BYTES {
            return Err(format!("skill exceeds {} byte limit", MAX_SKILL_BYTES));
        }

        let contents = String::from_utf8(bytes.to_vec())
            .map_err(|_| format!("{} is not valid UTF-8 text", item.path))?;
        files.push(SkillFile {
            path: rel.to_string(),
            bytes: bytes.len() as u32,
            contents,
        });
    }

    if !files
        .iter()
        .any(|file| file.path == "AGENTS.md" || file.path == "SKILL.md")
    {
        let instruction_name = Path::new(&folder.instruction_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("SKILL.md");
        return Err(format!("skill folder did not include {}", instruction_name));
    }

    Ok(files)
}

fn parse_frontmatter_field(content: &str, field: &str) -> Option<String> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    let prefix = format!("{}:", field);
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if let Some(value) = trimmed.strip_prefix(&prefix) {
            return Some(value.trim().trim_matches('"').trim_matches('\'').to_string());
        }
    }
    None
}

fn fallback_description(content: &str) -> String {
    content
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with("---")
                && !line.starts_with('#')
                && !line.starts_with("**Version")
        })
        .map(|line| {
            line.trim_start_matches('>')
                .trim_start_matches('-')
                .trim_matches('*')
                .trim()
                .to_string()
        })
        .find(|line| line.len() > 24)
        .unwrap_or_default()
}

fn detail_description(files: &[SkillFile], entry: &RegistryEntry) -> String {
    let instruction = files
        .iter()
        .find(|file| file.path == "AGENTS.md")
        .or_else(|| files.iter().find(|file| file.path == "SKILL.md"));
    if let Some(file) = instruction {
        if let Some(desc) = parse_frontmatter_field(&file.contents, "description") {
            if !desc.is_empty() {
                return desc;
            }
        }
        let fallback = fallback_description(&file.contents);
        if !fallback.is_empty() {
            return fallback;
        }
    }
    entry.description.clone()
}

async fn fetch_skill_detail_inner(entry: RegistryEntry) -> Result<SkillDetail, String> {
    let source = source_from_entry(&entry);
    let skill_id = skill_id_from_entry(&entry);
    let web_url = if entry.url.is_empty() {
        skills_sh_url(&source, &skill_id)
    } else {
        entry.url.clone()
    };
    let source_url = if entry.install_url.is_empty() {
        if is_github_source(&source) {
            format!("https://github.com/{}", source)
        } else {
            format!("https://{}", source)
        }
    } else {
        entry.install_url.clone()
    };
    let install_command = if is_github_source(&source) {
        format!("npx skills add {} --skill {}", source_url, skill_id)
    } else {
        format!("npx skills add {} --skill {}", source_url, skill_id)
    };

    if !is_github_source(&source) {
        return Ok(SkillDetail {
            description: entry.description.clone(),
            entry,
            install_command,
            web_url,
            source_url,
            hash: None,
            files: Vec::new(),
            audits: Vec::<SkillAudit>::new(),
            installable: false,
            install_note: "Solo can preview this skills.sh listing, but direct install currently supports GitHub-backed skills.".to_string(),
        });
    }

    let client = http_client()?;
    let folder = resolve_skill_folder(&client, &entry).await?;
    let files = fetch_skill_files(&client, &source, &folder).await?;
    let mut hash = Sha256::new();
    for file in &files {
        hash.update(file.path.as_bytes());
        hash.update([0]);
        hash.update(file.contents.as_bytes());
        hash.update([0]);
    }
    let hash = format!("{:x}", hash.finalize());
    let description = detail_description(&files, &entry);

    Ok(SkillDetail {
        entry,
        description,
        install_command,
        web_url,
        source_url: folder.repo_url,
        hash: Some(hash),
        files,
        audits: Vec::<SkillAudit>::new(),
        installable: true,
        install_note: "Installs directly from the GitHub source shown on skills.sh.".to_string(),
    })
}

#[tauri::command]
pub async fn skills_fetch_detail(entry: RegistryEntry) -> Result<SkillDetail, String> {
    fetch_skill_detail_inner(entry).await
}

#[tauri::command]
pub async fn skills_install(app: AppHandle, entry: RegistryEntry) -> Result<(), String> {
    let detail = fetch_skill_detail_inner(entry).await?;
    if !detail.installable {
        return Err(detail.install_note);
    }

    let id = install_dir_name(&detail.entry)?;
    let user_dir = user_skills_dir().ok_or_else(|| "could not resolve HOME".to_string())?;
    let dest = user_dir.join(&id);
    if dest.exists() {
        return Err(format!("skill '{}' is already installed", id));
    }

    let staging = user_dir.join(format!(".tmp-install-{}", id));
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .await
            .map_err(|e| format!("clean staging: {}", e))?;
    }
    fs::create_dir_all(&staging)
        .await
        .map_err(|e| format!("create staging: {}", e))?;

    for file in &detail.files {
        let rel = Path::new(&file.path);
        if !path_is_safe_relative(rel) {
            return Err(format!("unsafe skill file path: {}", file.path));
        }
        let out_path = staging.join(rel);
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("create {}: {}", parent.display(), e))?;
        }
        fs::write(&out_path, &file.contents)
            .await
            .map_err(|e| format!("write {}: {}", out_path.display(), e))?;
    }

    fs::rename(&staging, &dest)
        .await
        .map_err(|e| format!("commit install: {}", e))?;

    let meta = InstalledSkillMeta {
        source: OriginSource::Registry,
        id: detail.entry.id.clone(),
        version: detail.hash.clone().unwrap_or_else(|| "skills.sh".to_string()),
        installed_at: chrono::Utc::now().to_rfc3339(),
        modified: false,
        upstream_sha256: detail.hash.clone(),
    };
    skills_origin::write_origin(&dest, &meta)
        .await
        .map_err(|e| format!("write origin: {}", e))?;

    let _ = app.emit(
        "skills-event",
        SkillsEvent::Installed {
            skill_id: id.clone(),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn skills_uninstall(app: AppHandle, skill_id: String) -> Result<(), String> {
    let id = validate_skill_id(&skill_id)?.to_string();
    let user_dir = user_skills_dir().ok_or_else(|| "could not resolve HOME".to_string())?;
    let dest = user_dir.join(&id);

    let canonical_user = fs::canonicalize(&user_dir)
        .await
        .map_err(|e| format!("canonicalize user skills dir: {}", e))?;
    let canonical_dest = fs::canonicalize(&dest)
        .await
        .map_err(|e| format!("canonicalize skill dir: {}", e))?;
    if !canonical_dest.starts_with(&canonical_user) {
        return Err("refusing to remove path outside skills dir".to_string());
    }

    fs::remove_dir_all(&canonical_dest)
        .await
        .map_err(|e| format!("remove skill dir: {}", e))?;

    let _ = app.emit(
        "skills-event",
        SkillsEvent::Uninstalled {
            skill_id: id.clone(),
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn skills_read_installed(skill_id: String) -> Result<String, String> {
    let id = validate_skill_id(&skill_id)?.to_string();
    let user_dir = user_skills_dir().ok_or_else(|| "could not resolve HOME".to_string())?;
    let skill_dir = user_dir.join(&id);
    if !skill_dir.exists() {
        return Err(format!("skill '{}' is not installed", id));
    }
    let agents_md = skill_dir.join("AGENTS.md");
    let skill_md = skill_dir.join("SKILL.md");
    let path = if agents_md.exists() {
        agents_md
    } else if skill_md.exists() {
        skill_md
    } else {
        return Err(format!("no AGENTS.md or SKILL.md for '{}'", id));
    };
    fs::read_to_string(&path)
        .await
        .map_err(|e| format!("read {}: {}", path.display(), e))
}

#[tauri::command]
pub async fn skills_write_installed(skill_id: String, content: String) -> Result<(), String> {
    let id = validate_skill_id(&skill_id)?.to_string();
    let user_dir = user_skills_dir().ok_or_else(|| "could not resolve HOME".to_string())?;
    let skill_dir = user_dir.join(&id);
    if !skill_dir.exists() {
        return Err(format!("skill '{}' is not installed", id));
    }
    let agents_md = skill_dir.join("AGENTS.md");
    fs::write(&agents_md, content)
        .await
        .map_err(|e| format!("write AGENTS.md: {}", e))?;
    skills_origin::mark_modified(&skill_dir)
        .await
        .map_err(|e| format!("mark modified: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entry(source: &str, skill_id: &str, name: &str) -> RegistryEntry {
        RegistryEntry {
            id: format!("{}/{}", source, skill_id),
            skill_id: skill_id.into(),
            name: name.into(),
            source: source.into(),
            source_type: "github".into(),
            version: String::new(),
            description: String::new(),
            categories: Vec::new(),
            author: source.split('/').next().unwrap_or("").into(),
            license: String::new(),
            tarball_url: String::new(),
            sha256: String::new(),
            tags: Vec::new(),
            updated_at: String::new(),
            install_url: format!("https://github.com/{}", source),
            url: skills_sh_url(source, skill_id),
            installs: 0,
            is_official: false,
            is_duplicate: false,
        }
    }

    #[test]
    fn install_dir_name_uses_safe_skill_id() {
        let entry = sample_entry("anthropics/skills", "skill-creator", "Skill Creator");
        assert_eq!(install_dir_name(&entry).unwrap(), "skill-creator");
    }

    #[test]
    fn validate_skill_id_rejects_dangerous() {
        assert!(validate_skill_id("").is_err());
        assert!(validate_skill_id("..").is_err());
        assert!(validate_skill_id("../evil").is_err());
        assert!(validate_skill_id("a/b").is_err());
        assert!(validate_skill_id("a b").is_err());
        assert!(validate_skill_id(".hidden").is_err());
        assert!(validate_skill_id("has\0null").is_err());
    }

    #[test]
    fn path_safe_accepts_relative() {
        assert!(path_is_safe_relative(Path::new("foo/bar.md")));
        assert!(path_is_safe_relative(Path::new("./foo.md")));
    }

    #[test]
    fn path_safe_rejects_absolute_and_parent_dir() {
        assert!(!path_is_safe_relative(Path::new("/etc/passwd")));
        assert!(!path_is_safe_relative(Path::new("../escape")));
        assert!(!path_is_safe_relative(Path::new("foo/../../escape")));
    }

    #[test]
    fn binary_exts_reject_archives_and_images_but_allow_scripts() {
        assert!(has_binary_extension(Path::new("x.zip")));
        assert!(has_binary_extension(Path::new("foo.png")));
        assert!(!has_binary_extension(Path::new("script.py")));
        assert!(!has_binary_extension(Path::new("guide.md")));
    }

    #[test]
    fn magic_bytes_detect_elf_macho_pe() {
        assert!(has_executable_magic(b"\x7fELF\x02\x01\x01\x00"));
        assert!(has_executable_magic(&[0xfe, 0xed, 0xfa, 0xcf]));
        assert!(has_executable_magic(b"MZ\x90\x00"));
        assert!(!has_executable_magic(b"# Hello, world"));
    }

    #[test]
    fn candidate_score_matches_prefixed_skills() {
        let entry = sample_entry(
            "vercel-labs/agent-skills",
            "vercel-react-best-practices",
            "vercel-react-best-practices",
        );
        let exact = instruction_candidate_score("skills/react-best-practices/AGENTS.md", &entry);
        let unrelated = instruction_candidate_score("skills/deploy-to-vercel/SKILL.md", &entry);
        assert!(exact > unrelated);
    }

    #[test]
    fn parses_frontmatter_description() {
        let content = "---\nname: test\ndescription: Use this for tests.\n---\n# Body";
        assert_eq!(
            parse_frontmatter_field(content, "description").as_deref(),
            Some("Use this for tests.")
        );
    }
}
