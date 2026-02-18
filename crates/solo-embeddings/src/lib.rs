#![warn(clippy::all, clippy::pedantic)]
#![allow(
    clippy::module_name_repetitions,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::wildcard_imports,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::cast_possible_wrap,
    clippy::uninlined_format_args,
    clippy::doc_markdown,
    clippy::return_self_not_must_use,
    clippy::redundant_closure_for_method_calls,
    clippy::single_match_else,
    clippy::if_not_else,
    clippy::match_same_arms,
    clippy::map_unwrap_or,
    clippy::similar_names,
    clippy::struct_excessive_bools
)]

//! Solo Embeddings - Vector embedding provider for semantic search
//!
//! This crate provides embedding functionality for semantic code search and RAG.
//! It supports multiple embedding providers (OpenAI, local models) and includes
//! utilities for vector similarity calculations.

use async_trait::async_trait;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use tracing::{debug, error, info};

// =============================================================================
// Error Types
// =============================================================================

#[derive(Error, Debug)]
pub enum EmbeddingError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("API error: {0}")]
    ApiError(String),

    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    #[error("Rate limited: retry after {0} seconds")]
    RateLimited(u32),

    #[error("Credentials not configured")]
    CredentialsNotFound,

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

pub type EmbeddingResult<T> = Result<T, EmbeddingError>;

// =============================================================================
// Embedding Types
// =============================================================================

/// A vector embedding
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Embedding {
    /// The embedding vector
    pub values: Vec<f32>,
    /// Dimension of the embedding
    pub dimensions: usize,
}

impl Embedding {
    /// Create a new embedding from values
    pub fn new(values: Vec<f32>) -> Self {
        let dimensions = values.len();
        Self { values, dimensions }
    }

    /// Calculate cosine similarity with another embedding
    pub fn cosine_similarity(&self, other: &Embedding) -> f32 {
        cosine_similarity(&self.values, &other.values)
    }

    /// Calculate dot product with another embedding
    pub fn dot_product(&self, other: &Embedding) -> f32 {
        dot_product(&self.values, &other.values)
    }

    /// Calculate euclidean distance to another embedding
    pub fn euclidean_distance(&self, other: &Embedding) -> f32 {
        euclidean_distance(&self.values, &other.values)
    }
}

/// An indexed item with its embedding
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedItem<T> {
    /// The item data
    pub data: T,
    /// The embedding for this item
    pub embedding: Embedding,
}

/// Search result with similarity score
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult<T> {
    /// The matched item
    pub item: T,
    /// Similarity score (0.0 to 1.0)
    pub score: f32,
}

// =============================================================================
// Similarity Functions
// =============================================================================

/// Calculate cosine similarity between two vectors
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot = dot_product(a, b);
    let norm_a = magnitude(a);
    let norm_b = magnitude(b);

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot / (norm_a * norm_b)
}

/// Calculate dot product of two vectors
pub fn dot_product(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

/// Calculate magnitude (L2 norm) of a vector
pub fn magnitude(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt()
}

/// Calculate euclidean distance between two vectors
pub fn euclidean_distance(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f32>()
        .sqrt()
}

// =============================================================================
// Embedding Provider Trait
// =============================================================================

/// Trait for embedding providers
#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    /// Get a single embedding
    async fn embed(&self, text: &str) -> EmbeddingResult<Embedding>;

    /// Get embeddings for multiple texts
    async fn embed_many(&self, texts: &[String]) -> EmbeddingResult<Vec<Embedding>>;

    /// Get the model dimensions
    fn dimensions(&self) -> usize;

    /// Get the model name
    fn model_name(&self) -> &str;
}

// =============================================================================
// OpenAI Embedding Provider
// =============================================================================

const OPENAI_EMBEDDING_URL: &str = "https://api.openai.com/v1/embeddings";

/// OpenAI embedding models
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenAIEmbeddingModel {
    /// text-embedding-3-small (1536 dimensions)
    TextEmbedding3Small,
    /// text-embedding-3-large (3072 dimensions)
    TextEmbedding3Large,
    /// text-embedding-ada-002 (1536 dimensions, legacy)
    TextEmbeddingAda002,
}

impl OpenAIEmbeddingModel {
    pub fn as_str(&self) -> &'static str {
        match self {
            OpenAIEmbeddingModel::TextEmbedding3Small => "text-embedding-3-small",
            OpenAIEmbeddingModel::TextEmbedding3Large => "text-embedding-3-large",
            OpenAIEmbeddingModel::TextEmbeddingAda002 => "text-embedding-ada-002",
        }
    }

    pub fn dimensions(&self) -> usize {
        match self {
            OpenAIEmbeddingModel::TextEmbedding3Small => 1536,
            OpenAIEmbeddingModel::TextEmbedding3Large => 3072,
            OpenAIEmbeddingModel::TextEmbeddingAda002 => 1536,
        }
    }
}

/// OpenAI embedding provider
pub struct OpenAIEmbeddingProvider {
    api_key: String,
    client: Client,
    model: OpenAIEmbeddingModel,
}

impl OpenAIEmbeddingProvider {
    /// Create a new OpenAI embedding provider
    pub fn new(api_key: String) -> Self {
        Self::with_model(api_key, OpenAIEmbeddingModel::TextEmbedding3Small)
    }

    /// Create with a specific model
    pub fn with_model(api_key: String, model: OpenAIEmbeddingModel) -> Self {
        Self {
            api_key,
            client: Client::new(),
            model,
        }
    }
}

#[derive(Debug, Serialize)]
struct OpenAIEmbeddingRequest {
    input: serde_json::Value, // Can be string or array of strings
    model: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIEmbeddingResponse {
    data: Vec<OpenAIEmbeddingData>,
    model: String,
    usage: OpenAIUsage,
}

#[derive(Debug, Deserialize)]
struct OpenAIEmbeddingData {
    embedding: Vec<f32>,
    index: usize,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct OpenAIUsage {
    prompt_tokens: u32,
    total_tokens: u32,
}

#[async_trait]
impl EmbeddingProvider for OpenAIEmbeddingProvider {
    async fn embed(&self, text: &str) -> EmbeddingResult<Embedding> {
        debug!(model = %self.model.as_str(), text_len = text.len(), "Generating embedding");

        let request = OpenAIEmbeddingRequest {
            input: serde_json::json!(text),
            model: self.model.as_str().to_string(),
        };

        let response = self
            .client
            .post(OPENAI_EMBEDDING_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!(status = %status, error = %error_text, "OpenAI embedding API error");

            if status.as_u16() == 429 {
                return Err(EmbeddingError::RateLimited(60));
            }

            return Err(EmbeddingError::ApiError(format!(
                "HTTP {}: {}",
                status, error_text
            )));
        }

        let result: OpenAIEmbeddingResponse = response.json().await?;

        if result.data.is_empty() {
            return Err(EmbeddingError::InvalidResponse(
                "No embeddings returned".to_string(),
            ));
        }

        info!(
            model = %result.model,
            tokens = result.usage.total_tokens,
            dimensions = result.data[0].embedding.len(),
            "Embedding generated"
        );

        Ok(Embedding::new(
            result.data.into_iter().next().unwrap().embedding,
        ))
    }

    async fn embed_many(&self, texts: &[String]) -> EmbeddingResult<Vec<Embedding>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        debug!(model = %self.model.as_str(), count = texts.len(), "Generating embeddings batch");

        let request = OpenAIEmbeddingRequest {
            input: serde_json::json!(texts),
            model: self.model.as_str().to_string(),
        };

        let response = self
            .client
            .post(OPENAI_EMBEDDING_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            error!(status = %status, error = %error_text, "OpenAI embedding API error");

            if status.as_u16() == 429 {
                return Err(EmbeddingError::RateLimited(60));
            }

            return Err(EmbeddingError::ApiError(format!(
                "HTTP {}: {}",
                status, error_text
            )));
        }

        let result: OpenAIEmbeddingResponse = response.json().await?;

        info!(
            model = %result.model,
            tokens = result.usage.total_tokens,
            count = result.data.len(),
            "Embeddings batch generated"
        );

        // Sort by index to maintain order
        let mut data = result.data;
        data.sort_by_key(|d| d.index);

        Ok(data
            .into_iter()
            .map(|d| Embedding::new(d.embedding))
            .collect())
    }

    fn dimensions(&self) -> usize {
        self.model.dimensions()
    }

    fn model_name(&self) -> &str {
        self.model.as_str()
    }
}

// =============================================================================
// Embedding Index
// =============================================================================

/// In-memory vector index for semantic search
pub struct EmbeddingIndex<T: Clone + Send + Sync> {
    items: Vec<IndexedItem<T>>,
    provider: Arc<dyn EmbeddingProvider>,
}

impl<T: Clone + Send + Sync> EmbeddingIndex<T> {
    /// Create a new embedding index
    pub fn new(provider: Arc<dyn EmbeddingProvider>) -> Self {
        Self {
            items: Vec::new(),
            provider,
        }
    }

    /// Add an item to the index
    pub async fn add(&mut self, data: T, text: &str) -> EmbeddingResult<()> {
        let embedding = self.provider.embed(text).await?;
        self.items.push(IndexedItem { data, embedding });
        Ok(())
    }

    /// Add multiple items to the index
    pub async fn add_many(&mut self, items: Vec<(T, String)>) -> EmbeddingResult<()> {
        if items.is_empty() {
            return Ok(());
        }

        let texts: Vec<String> = items.iter().map(|(_, t)| t.clone()).collect();
        let embeddings = self.provider.embed_many(&texts).await?;

        for ((data, _), embedding) in items.into_iter().zip(embeddings) {
            self.items.push(IndexedItem { data, embedding });
        }

        Ok(())
    }

    /// Search the index for similar items
    pub async fn search(&self, query: &str, limit: usize) -> EmbeddingResult<Vec<SearchResult<T>>> {
        let query_embedding = self.provider.embed(query).await?;

        let mut results: Vec<SearchResult<T>> = self
            .items
            .iter()
            .map(|item| SearchResult {
                item: item.data.clone(),
                score: item.embedding.cosine_similarity(&query_embedding),
            })
            .collect();

        // Sort by score descending
        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Take top results
        results.truncate(limit);

        Ok(results)
    }

    /// Get the number of items in the index
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// Check if the index is empty
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Clear all items from the index
    pub fn clear(&mut self) {
        self.items.clear();
    }
}

// =============================================================================
// Code-specific Types
// =============================================================================

/// A code chunk for indexing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeChunk {
    /// File path
    pub path: String,
    /// Start line (1-indexed)
    pub start_line: u32,
    /// End line (1-indexed)
    pub end_line: u32,
    /// Code content
    pub content: String,
    /// Language
    pub language: Option<String>,
    /// Symbol name (if this is a function/class)
    pub symbol_name: Option<String>,
}

impl CodeChunk {
    /// Create a text representation for embedding
    pub fn to_embedding_text(&self) -> String {
        let mut text = String::new();

        if let Some(ref lang) = self.language {
            text.push_str(lang);
            text.push_str(": ");
        }

        if let Some(ref symbol) = self.symbol_name {
            text.push_str(symbol);
            text.push_str(" in ");
        }

        text.push_str(&self.path);
        text.push('\n');
        text.push_str(&self.content);

        text
    }
}

/// Create a code embedding index
pub type CodeIndex = EmbeddingIndex<CodeChunk>;

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        assert!((cosine_similarity(&a, &b) - 1.0).abs() < 0.001);

        let c = vec![0.0, 1.0, 0.0];
        assert!((cosine_similarity(&a, &c) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_embedding_similarity() {
        let e1 = Embedding::new(vec![1.0, 2.0, 3.0]);
        let e2 = Embedding::new(vec![1.0, 2.0, 3.0]);
        assert!((e1.cosine_similarity(&e2) - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_code_chunk_to_text() {
        let chunk = CodeChunk {
            path: "src/main.rs".to_string(),
            start_line: 1,
            end_line: 10,
            content: "fn main() {}".to_string(),
            language: Some("rust".to_string()),
            symbol_name: Some("main".to_string()),
        };

        let text = chunk.to_embedding_text();
        assert!(text.contains("rust"));
        assert!(text.contains("main"));
        assert!(text.contains("src/main.rs"));
    }
}
