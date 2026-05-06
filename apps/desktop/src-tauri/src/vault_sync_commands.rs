use reqwest::Client;
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

#[derive(serde::Deserialize)]
struct UploadUrlResponse {
    presigned_url: String,
    content_type: String,
}

/// POST /vault/entries/{id}/upload → presigned S3 PUT URL valid for 5 min.
pub async fn remote_request_upload_url(
    token: &str,
    entry_id: &str,
    filename: &str,
    content_type: &str,
) -> Result<(String, String), String> {
    let base = desktop_config::vault_api_endpoint();
    let url = format!("{}/vault/entries/{}/upload", base.trim_end_matches('/'), entry_id);
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
    Ok((parsed.presigned_url, parsed.content_type))
}

/// PUT file bytes directly to S3 via presigned URL — no auth header required.
pub async fn upload_file_to_s3(presigned_url: &str, file_path: &str, content_type: &str) -> Result<(), String> {
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
            scope: VaultScope::Project { project_id: "project-1".to_string() },
            memory_type: MemoryType::User,
            pinned: true,
            tags: vec!["alpha".to_string(), "beta".to_string()],
            mime: Some("text/plain".to_string()),
            size_bytes: Some(42),
            index_status: IndexStatus::Indexed,
            cloud_sync_state: CloudSyncState::Offline,
            classifier_confidence: 0.99,
            retrieval_stats: RetrievalStats { hit_count: 2, last_retrieved_at: Some(123) },
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
    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("vault delete failed ({status}): {body_text}"));
    }
    Ok(())
}
