use reqwest::Client;
use solo_protocol::{EntryKind, VaultEntry};

use crate::desktop_config;

fn entry_type_str(kind: &EntryKind) -> &'static str {
    match kind {
        EntryKind::Snippet => "snippet",
        EntryKind::Keyvalue => "keyvalue",
        EntryKind::Config => "config",
        _ => "file",
    }
}

#[derive(serde::Serialize)]
struct CreateEntryBody<'a> {
    title: &'a str,
    content: Option<&'a str>,
    entry_type: &'static str,
    tags: &'a [String],
}

#[derive(serde::Deserialize)]
struct CreateEntryResponse {
    id: String,
}

pub async fn remote_create_entry(token: &str, entry: &VaultEntry) -> Result<String, String> {
    let base = desktop_config::vault_api_endpoint();
    let url = format!("{}/vault/entries", base.trim_end_matches('/'));
    let body = CreateEntryBody {
        title: &entry.title,
        content: entry.content.as_deref(),
        entry_type: entry_type_str(&entry.kind),
        tags: &entry.tags,
    };
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
