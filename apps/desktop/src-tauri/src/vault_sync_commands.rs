use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde_json::Value;
use solo_protocol::{CloudSyncState, EntryKind, IndexStatus, MemoryType, VaultEntry, VaultScope};

use crate::desktop_config;

#[derive(serde::Serialize)]
struct CreateEntryBody<'a> {
    id: &'a str,
    kind: EntryKind,
    subkind: Option<&'a str>,
    title: &'a str,
    content: Option<&'a str>,
    source_path: Option<&'a str>,
    vault_blob_path: Option<&'a str>,
    scope_type: &'static str,
    scope_project_id: Option<&'a str>,
    memory_type: MemoryType,
    pinned: u8,
    tags: String,
    mime: Option<&'a str>,
    size_bytes: Option<u64>,
    index_status: IndexStatus,
    cloud_sync_state: CloudSyncState,
    classifier_confidence: f32,
    hit_count: u32,
    last_retrieved_at: Option<u64>,
    created_at: u64,
    updated_at: u64,
}

#[derive(serde::Deserialize)]
struct CreateEntryResponse {
    id: String,
}

fn create_entry_body(entry: &VaultEntry) -> CreateEntryBody<'_> {
    let (scope_type, scope_project_id) = match &entry.scope {
        VaultScope::Global => ("global", None),
        VaultScope::Project { project_id } => ("project", Some(project_id.as_str())),
    };

    CreateEntryBody {
        id: &entry.id,
        kind: entry.kind,
        subkind: entry.subkind.as_deref(),
        title: &entry.title,
        content: entry.content.as_deref(),
        // Do not upload local absolute paths to the cloud. The upload endpoint
        // replaces vault_blob_path with the scoped S3 key after presigning.
        source_path: None,
        vault_blob_path: None,
        scope_type,
        scope_project_id,
        memory_type: entry.memory_type,
        pinned: u8::from(entry.pinned),
        tags: serde_json::to_string(&entry.tags).unwrap_or_else(|_| "[]".to_string()),
        mime: entry.mime.as_deref(),
        size_bytes: entry.size_bytes,
        index_status: entry.index_status,
        cloud_sync_state: if entry.vault_blob_path.is_some() {
            CloudSyncState::Pending
        } else {
            CloudSyncState::Synced
        },
        classifier_confidence: entry.classifier_confidence,
        hit_count: entry.retrieval_stats.hit_count,
        last_retrieved_at: entry.retrieval_stats.last_retrieved_at,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
    }
}

pub async fn remote_create_entry(token: &str, entry: &VaultEntry) -> Result<String, String> {
    let base = desktop_config::vault_api_endpoint();
    let url = format!("{}/vault/entries", base.trim_end_matches('/'));
    let body = create_entry_body(entry);
    let resp = Client::new()
        .post(&url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("vault sync create: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("vault create failed ({status}): {body_text}"));
    }
    let parsed = resp
        .json::<CreateEntryResponse>()
        .await
        .map_err(|e| format!("vault create parse: {e}"))?;
    Ok(parsed.id)
}

pub fn resolved_cloud_sync_state(
    index_status: IndexStatus,
    cloud_sync_state: CloudSyncState,
) -> CloudSyncState {
    if matches!(
        cloud_sync_state,
        CloudSyncState::Synced | CloudSyncState::Failed
    ) {
        return cloud_sync_state;
    }

    match index_status {
        IndexStatus::Indexed => CloudSyncState::Synced,
        IndexStatus::Failed | IndexStatus::ExtractionFailed => CloudSyncState::Failed,
        _ => cloud_sync_state,
    }
}

#[derive(serde::Deserialize)]
struct UploadUrlResponse {
    upload_url: Option<String>,
    presigned_url: Option<String>,
    s3_key: String,
    content_type: String,
    expires_in: Option<u64>,
}

pub struct RemoteUploadUrl {
    pub upload_url: String,
    pub s3_key: String,
    pub content_type: String,
    pub expires_in: u64,
}

/// POST /vault/entries/{id}/upload → presigned S3 PUT URL valid for 5 min.
pub async fn remote_request_upload_url(
    token: &str,
    entry_id: &str,
    filename: &str,
    content_type: &str,
) -> Result<RemoteUploadUrl, String> {
    let base = desktop_config::vault_api_endpoint();
    let url = format!(
        "{}/vault/entries/{}/upload",
        base.trim_end_matches('/'),
        entry_id
    );
    let body = serde_json::json!({ "filename": filename, "content_type": content_type });
    let resp = Client::new()
        .post(&url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("vault upload url request: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("upload url failed ({status}): {text}"));
    }
    let parsed = resp
        .json::<UploadUrlResponse>()
        .await
        .map_err(|e| format!("upload url parse: {e}"))?;
    let upload_url = parsed
        .upload_url
        .or(parsed.presigned_url)
        .ok_or_else(|| "upload url response did not include upload_url".to_string())?;
    Ok(RemoteUploadUrl {
        upload_url,
        s3_key: parsed.s3_key,
        content_type: parsed.content_type,
        expires_in: parsed.expires_in.unwrap_or(300),
    })
}

/// PUT file bytes directly to S3 via presigned URL — no auth header required.
pub async fn upload_file_to_s3(
    presigned_url: &str,
    file_path: &str,
    content_type: &str,
) -> Result<(), String> {
    let bytes = std::fs::read(file_path).map_err(|e| format!("read file for upload: {e}"))?;
    let resp = Client::new()
        .put(presigned_url)
        .header("Content-Type", content_type)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("s3 put: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("s3 put failed ({})", resp.status()));
    }
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
pub struct CompleteUploadResponse {
    pub entry_id: String,
    pub s3_key: String,
    pub index_status: IndexStatus,
    pub cloud_sync_state: CloudSyncState,
    pub indexing_started: bool,
}

impl CompleteUploadResponse {
    pub fn resolved_cloud_sync_state(&self) -> CloudSyncState {
        resolved_cloud_sync_state(self.index_status, self.cloud_sync_state)
    }
}

/// POST /vault/entries/{id}/upload/complete after the S3 PUT succeeds.
pub async fn remote_complete_upload(
    token: &str,
    entry_id: &str,
    s3_key: &str,
) -> Result<CompleteUploadResponse, String> {
    let base = desktop_config::vault_api_endpoint();
    let url = format!(
        "{}/vault/entries/{}/upload/complete",
        base.trim_end_matches('/'),
        entry_id
    );
    let body = serde_json::json!({ "s3_key": s3_key });
    let resp = Client::new()
        .post(&url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("vault upload complete request: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("upload complete failed ({status}): {text}"));
    }
    resp.json::<CompleteUploadResponse>()
        .await
        .map_err(|e| format!("upload complete parse: {e}"))
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct RemoteEntryStatus {
    pub id: String,
    pub index_status: IndexStatus,
    pub cloud_sync_state: CloudSyncState,
    #[serde(default)]
    pub index_error: Option<String>,
    #[serde(default)]
    pub chunk_count: Option<u64>,
}

impl RemoteEntryStatus {
    pub fn resolved_cloud_sync_state(&self) -> CloudSyncState {
        resolved_cloud_sync_state(self.index_status, self.cloud_sync_state)
    }
}

fn parse_index_status(value: &str) -> Option<IndexStatus> {
    match value {
        "pending" => Some(IndexStatus::Pending),
        "extracting" => Some(IndexStatus::Extracting),
        "chunking" => Some(IndexStatus::Chunking),
        "embedding" => Some(IndexStatus::Embedding),
        "storing" => Some(IndexStatus::Storing),
        "indexed" => Some(IndexStatus::Indexed),
        "extraction_failed" => Some(IndexStatus::ExtractionFailed),
        "failed" => Some(IndexStatus::Failed),
        _ => None,
    }
}

fn parse_cloud_sync_state(value: &str) -> Option<CloudSyncState> {
    match value {
        "offline" => Some(CloudSyncState::Offline),
        "pending" => Some(CloudSyncState::Pending),
        "uploading" => Some(CloudSyncState::Uploading),
        "indexing_remote" => Some(CloudSyncState::IndexingRemote),
        "synced" => Some(CloudSyncState::Synced),
        "failed" => Some(CloudSyncState::Failed),
        _ => None,
    }
}

fn parse_remote_entry_status_text(text: &str) -> Result<RemoteEntryStatus, String> {
    let json: Value =
        serde_json::from_str(text).map_err(|e| format!("response is not valid JSON: {e}"))?;
    let entry = json
        .get("data")
        .or_else(|| json.get("entry"))
        .unwrap_or(&json);

    let id = entry
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "response did not include id".to_string())?
        .to_string();
    let index_status_raw = entry
        .get("index_status")
        .and_then(Value::as_str)
        .ok_or_else(|| "response did not include index_status".to_string())?;
    let cloud_sync_state_raw = entry
        .get("cloud_sync_state")
        .and_then(Value::as_str)
        .ok_or_else(|| "response did not include cloud_sync_state".to_string())?;

    let index_status = parse_index_status(index_status_raw)
        .ok_or_else(|| format!("unknown index_status: {index_status_raw}"))?;
    let cloud_sync_state = parse_cloud_sync_state(cloud_sync_state_raw)
        .ok_or_else(|| format!("unknown cloud_sync_state: {cloud_sync_state_raw}"))?;
    let index_error = entry
        .get("index_error")
        .and_then(Value::as_str)
        .map(str::to_string);
    let chunk_count = entry.get("chunk_count").and_then(|value| match value {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse::<u64>().ok(),
        _ => None,
    });

    Ok(RemoteEntryStatus {
        id,
        index_status,
        cloud_sync_state,
        index_error,
        chunk_count,
    })
}

pub async fn remote_try_get_entry_status(
    token: &str,
    entry_id: &str,
) -> Result<Option<RemoteEntryStatus>, String> {
    let base = desktop_config::vault_api_endpoint();
    let url = format!("{}/vault/entries/{}", base.trim_end_matches('/'), entry_id);
    let resp = Client::new()
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("vault get status: {e}"))?;
    if resp.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("vault get status failed ({status}): {text}"));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("vault get status read: {e}"))?;
    parse_remote_entry_status_text(&text)
        .map(Some)
        .map_err(|e| format!("vault get status parse: {e}; body={text}"))
}

pub async fn remote_get_entry_status(
    token: &str,
    entry_id: &str,
) -> Result<RemoteEntryStatus, String> {
    remote_try_get_entry_status(token, entry_id)
        .await?
        .ok_or_else(|| format!("vault entry not found: {entry_id}"))
}

pub async fn remote_poll_entry_until_terminal(
    token: &str,
    entry_id: &str,
    max_attempts: usize,
    delay: Duration,
) -> Result<RemoteEntryStatus, String> {
    let mut last: Option<RemoteEntryStatus> = None;
    for _ in 0..max_attempts {
        let status = remote_get_entry_status(token, entry_id).await?;
        if matches!(
            status.resolved_cloud_sync_state(),
            CloudSyncState::Synced | CloudSyncState::Failed
        ) {
            return Ok(status);
        }
        last = Some(status);
        tokio::time::sleep(delay).await;
    }
    last.ok_or_else(|| "remote status polling did not run".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use solo_protocol::{RetrievalStats, VaultScope};

    fn sample_entry() -> VaultEntry {
        VaultEntry {
            id: "entry-1".to_string(),
            kind: EntryKind::Document,
            subkind: Some("txt".to_string()),
            title: "Notes.txt".to_string(),
            content: None,
            source_path: Some("/Users/example/Notes.txt".to_string()),
            vault_blob_path: Some("/Users/example/.solo/vault/blobs/blob.txt".to_string()),
            scope: VaultScope::Project {
                project_id: "project-1".to_string(),
            },
            memory_type: MemoryType::User,
            pinned: true,
            tags: vec!["alpha".to_string(), "beta".to_string()],
            mime: Some("text/plain".to_string()),
            size_bytes: Some(42),
            index_status: IndexStatus::Indexed,
            cloud_sync_state: CloudSyncState::Offline,
            classifier_confidence: 0.99,
            retrieval_stats: RetrievalStats {
                hit_count: 2,
                last_retrieved_at: Some(123),
            },
            created_at: 100,
            updated_at: 101,
        }
    }

    #[test]
    fn create_body_matches_local_parity_backend_contract() {
        let entry = sample_entry();
        let body = create_entry_body(&entry);
        let json = serde_json::to_value(body).expect("serialize create body");

        assert_eq!(json["id"], "entry-1");
        assert_eq!(json["kind"], "document");
        assert_eq!(json["scope_type"], "project");
        assert_eq!(json["scope_project_id"], "project-1");
        assert_eq!(json["memory_type"], "user");
        assert_eq!(json["pinned"], 1);
        assert_eq!(json["tags"], "[\"alpha\",\"beta\"]");
        assert_eq!(json["index_status"], "indexed");
        assert_eq!(json["cloud_sync_state"], "pending");
        assert!(json["source_path"].is_null());
        assert!(json["vault_blob_path"].is_null());
    }

    #[test]
    fn content_only_entries_are_created_as_synced() {
        let mut entry = sample_entry();
        entry.vault_blob_path = None;
        entry.content = Some("Remember this".to_string());

        let json = serde_json::to_value(create_entry_body(&entry)).expect("serialize create body");

        assert_eq!(json["cloud_sync_state"], "synced");
        assert_eq!(json["content"], "Remember this");
    }

    #[test]
    fn indexed_remote_status_resolves_to_synced_even_when_cloud_state_lags() {
        assert_eq!(
            resolved_cloud_sync_state(IndexStatus::Indexed, CloudSyncState::IndexingRemote),
            CloudSyncState::Synced,
        );
        assert_eq!(
            resolved_cloud_sync_state(IndexStatus::ExtractionFailed, CloudSyncState::Uploading),
            CloudSyncState::Failed,
        );
        assert_eq!(
            resolved_cloud_sync_state(IndexStatus::Pending, CloudSyncState::Uploading),
            CloudSyncState::Uploading,
        );
    }

    #[test]
    fn parses_remote_entry_status_from_full_entry_body() {
        let status = parse_remote_entry_status_text(
            r#"{
                "id": "entry-1",
                "index_status": "indexed",
                "cloud_sync_state": "indexing_remote",
                "chunk_count": 12,
                "index_error": null,
                "title": "Notes.txt",
                "pinned": 0,
                "tags": "[]"
            }"#,
        )
        .expect("parse full entry body");

        assert_eq!(status.id, "entry-1");
        assert_eq!(status.index_status, IndexStatus::Indexed);
        assert_eq!(status.cloud_sync_state, CloudSyncState::IndexingRemote);
        assert_eq!(status.resolved_cloud_sync_state(), CloudSyncState::Synced);
        assert_eq!(status.chunk_count, Some(12));
    }

    #[test]
    fn parses_remote_entry_status_from_wrapped_body() {
        let status = parse_remote_entry_status_text(
            r#"{
                "data": {
                    "id": "entry-2",
                    "index_status": "pending",
                    "cloud_sync_state": "uploading",
                    "chunk_count": "4",
                    "index_error": "still running"
                }
            }"#,
        )
        .expect("parse wrapped body");

        assert_eq!(status.id, "entry-2");
        assert_eq!(status.index_status, IndexStatus::Pending);
        assert_eq!(status.cloud_sync_state, CloudSyncState::Uploading);
        assert_eq!(status.chunk_count, Some(4));
        assert_eq!(status.index_error.as_deref(), Some("still running"));
    }
}

pub async fn remote_delete_entry(token: &str, remote_id: &str) -> Result<(), String> {
    let base = desktop_config::vault_api_endpoint();
    let url = format!("{}/vault/entries/{}", base.trim_end_matches('/'), remote_id);
    let resp = Client::new()
        .delete(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| format!("vault sync delete: {e}"))?;
    if resp.status() == StatusCode::NOT_FOUND {
        return Ok(());
    }
    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("vault delete failed ({status}): {body_text}"));
    }
    Ok(())
}
