//! Embedding command handlers for Solo IDE
//!
//! This module contains IPC commands for semantic search and embeddings.

use solo_embeddings::{
    CodeChunk, CodeIndex, EmbeddingProvider, OpenAIEmbeddingModel, OpenAIEmbeddingProvider,
    SearchResult,
};
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;
use tracing::{debug, info};

// =============================================================================
// State
// =============================================================================

/// Embedding state for the application
pub struct EmbeddingState {
    /// Code index for semantic search
    code_index: Arc<RwLock<Option<CodeIndex>>>,
    /// Embedding provider
    provider: Arc<RwLock<Option<Arc<dyn EmbeddingProvider>>>>,
}

impl EmbeddingState {
    pub fn new() -> Self {
        Self {
            code_index: Arc::new(RwLock::new(None)),
            provider: Arc::new(RwLock::new(None)),
        }
    }

    /// Borrow the current embedding provider, if any. Used by other
    /// subsystems (e.g. solo-vault) that want to share the same provider
    /// instance instead of constructing a second one.
    pub async fn current_provider(&self) -> Option<Arc<dyn EmbeddingProvider>> {
        self.provider.read().await.clone()
    }
}

impl Default for EmbeddingState {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// Response Types
// =============================================================================

/// Code search result for frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct CodeSearchResultResponse {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
    pub language: Option<String>,
    pub symbol_name: Option<String>,
    pub score: f32,
}

// =============================================================================
// Commands
// =============================================================================

/// Initialize embedding provider with OpenAI API key
#[tauri::command]
pub async fn embedding_init(
    api_key: String,
    model: Option<String>,
    state: State<'_, EmbeddingState>,
) -> Result<(), String> {
    info!("Initializing embedding provider");

    let model = match model.as_deref() {
        Some("text-embedding-3-large") => OpenAIEmbeddingModel::TextEmbedding3Large,
        Some("text-embedding-ada-002") => OpenAIEmbeddingModel::TextEmbeddingAda002,
        _ => OpenAIEmbeddingModel::TextEmbedding3Small,
    };

    // Mirror the key into the process env so the agent-bridge sidecar
    // inherits it on next spawn. The sidecar reads `OPENAI_API_KEY` in
    // vault.ts to embed semantic search queries. Setting this here (in
    // addition to the startup pre-warm) covers the case where the user
    // adds a key mid-session.
    std::env::set_var("OPENAI_API_KEY", &api_key);

    let provider = Arc::new(OpenAIEmbeddingProvider::with_model(api_key, model));

    // Store provider
    *state.provider.write().await = Some(provider.clone() as Arc<dyn EmbeddingProvider>);

    // Create index
    *state.code_index.write().await = Some(CodeIndex::new(provider as Arc<dyn EmbeddingProvider>));

    info!(model = %model.as_str(), "Embedding provider initialized");
    Ok(())
}

/// Add code chunks to the index
#[tauri::command]
pub async fn embedding_index_code(
    chunks: Vec<CodeChunkInput>,
    state: State<'_, EmbeddingState>,
) -> Result<usize, String> {
    let mut index = state.code_index.write().await;
    let index = index.as_mut().ok_or_else(|| {
        "Embedding provider not initialized. Call embedding_init first.".to_string()
    })?;

    debug!(count = chunks.len(), "Indexing code chunks");

    let items: Vec<(CodeChunk, String)> = chunks
        .into_iter()
        .map(|c| {
            let chunk = CodeChunk {
                path: c.path,
                start_line: c.start_line,
                end_line: c.end_line,
                content: c.content,
                language: c.language,
                symbol_name: c.symbol_name,
            };
            let text = chunk.to_embedding_text();
            (chunk, text)
        })
        .collect();

    let count = items.len();

    index.add_many(items).await.map_err(|e| e.to_string())?;

    info!(count = count, total = index.len(), "Code chunks indexed");
    Ok(index.len())
}

/// Search for similar code
#[tauri::command]
pub async fn embedding_search_code(
    query: String,
    limit: Option<usize>,
    state: State<'_, EmbeddingState>,
) -> Result<Vec<CodeSearchResultResponse>, String> {
    let index = state.code_index.read().await;
    let index = index.as_ref().ok_or_else(|| {
        "Embedding provider not initialized. Call embedding_init first.".to_string()
    })?;

    let limit = limit.unwrap_or(10);
    debug!(query = %query, limit = limit, "Searching code");

    let results: Vec<SearchResult<CodeChunk>> = index
        .search(&query, limit)
        .await
        .map_err(|e| e.to_string())?;

    info!(query = %query, results = results.len(), "Code search completed");

    Ok(results
        .into_iter()
        .map(|r| CodeSearchResultResponse {
            path: r.item.path,
            start_line: r.item.start_line,
            end_line: r.item.end_line,
            content: r.item.content,
            language: r.item.language,
            symbol_name: r.item.symbol_name,
            score: r.score,
        })
        .collect())
}

/// Get single embedding for text
#[tauri::command]
pub async fn embedding_embed_text(
    text: String,
    state: State<'_, EmbeddingState>,
) -> Result<Vec<f32>, String> {
    let provider = state.provider.read().await;
    let provider = provider.as_ref().ok_or_else(|| {
        "Embedding provider not initialized. Call embedding_init first.".to_string()
    })?;

    debug!(text_len = text.len(), "Generating embedding");

    let embedding = provider.embed(&text).await.map_err(|e| e.to_string())?;

    info!(dimensions = embedding.dimensions, "Embedding generated");
    Ok(embedding.values)
}

/// Clear the code index
#[tauri::command]
pub async fn embedding_clear_index(state: State<'_, EmbeddingState>) -> Result<(), String> {
    let mut index = state.code_index.write().await;
    if let Some(index) = index.as_mut() {
        index.clear();
        info!("Code index cleared");
    }
    Ok(())
}

/// Get index stats
#[tauri::command]
pub async fn embedding_get_stats(
    state: State<'_, EmbeddingState>,
) -> Result<EmbeddingStatsResponse, String> {
    let index = state.code_index.read().await;
    let provider = state.provider.read().await;

    Ok(EmbeddingStatsResponse {
        initialized: provider.is_some(),
        model_name: provider.as_ref().map(|p| p.model_name().to_string()),
        dimensions: provider.as_ref().map(|p| p.dimensions()),
        indexed_chunks: index.as_ref().map(|i| i.len()).unwrap_or(0),
    })
}

// =============================================================================
// Input Types
// =============================================================================

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CodeChunkInput {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
    pub language: Option<String>,
    pub symbol_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct EmbeddingStatsResponse {
    pub initialized: bool,
    pub model_name: Option<String>,
    pub dimensions: Option<usize>,
    pub indexed_chunks: usize,
}
