//! Embedding Service for Semantic Search
//!
//! Provides local vector embeddings using `fastembed` for context-aware
//! memory retrieval. Uses the all-MiniLM-L6-v2 model (384 dimensions).
//!
//! # Features
//!
//! - Local inference (no API calls)
//! - Lazy model loading
//! - Cosine similarity computation
//! - Batch embedding support
//!
//! # Usage
//!
//! ```ignore
//! use rdv_sdk::memory::embeddings::{embedding_service, EmbeddingService};
//!
//! let service = embedding_service();
//! let result = service.embed("hello world").await?;
//! let similarity = EmbeddingService::cosine_similarity(&result.vector, &other_vector);
//! ```

use crate::{SDKError, SDKResult};

/// Embedding dimensions for all-MiniLM-L6-v2
pub const EMBEDDING_DIMENSIONS: usize = 384;

/// Embedding result with vector and metadata
#[derive(Debug, Clone)]
pub struct EmbeddingResult {
    /// Embedding vector
    pub vector: Vec<f32>,
    /// Number of dimensions
    pub dimensions: usize,
}

/// Embedding service for generating text embeddings
#[cfg(feature = "embeddings")]
pub struct EmbeddingService {
    model: std::sync::Arc<tokio::sync::RwLock<Option<fastembed::TextEmbedding>>>,
}

#[cfg(not(feature = "embeddings"))]
pub struct EmbeddingService {
    _phantom: std::marker::PhantomData<()>,
}

impl Default for EmbeddingService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(feature = "embeddings")]
impl EmbeddingService {
    /// Create a new embedding service
    pub fn new() -> Self {
        Self {
            model: std::sync::Arc::new(tokio::sync::RwLock::new(None)),
        }
    }

    /// Initialize the embedding model (lazy loading)
    async fn ensure_model(&self) -> SDKResult<()> {
        use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};

        let model_guard = self.model.read().await;
        if model_guard.is_some() {
            return Ok(());
        }
        drop(model_guard);

        let mut model_guard = self.model.write().await;
        if model_guard.is_some() {
            return Ok(());
        }

        tracing::info!("Loading embedding model: all-MiniLM-L6-v2");
        let start = std::time::Instant::now();

        let mut init_options = InitOptions::default();
        init_options.model_name = EmbeddingModel::AllMiniLML6V2;
        init_options.show_download_progress = false;

        let model = TextEmbedding::try_new(init_options)
        .map_err(|e| SDKError::memory(format!("Failed to load embedding model: {}", e)))?;

        let elapsed = start.elapsed();
        tracing::info!("Embedding model loaded in {:?}", elapsed);

        *model_guard = Some(model);
        Ok(())
    }

    /// Generate embedding for a single text
    pub async fn embed(&self, text: &str) -> SDKResult<EmbeddingResult> {
        self.ensure_model().await?;

        let model_guard = self.model.read().await;
        let model = model_guard
            .as_ref()
            .ok_or_else(|| SDKError::memory("Embedding model not initialized"))?;

        let embeddings = model
            .embed(vec![text], None)
            .map_err(|e| SDKError::memory(format!("Failed to generate embedding: {}", e)))?;

        let vector = embeddings
            .into_iter()
            .next()
            .ok_or_else(|| SDKError::memory("No embedding generated"))?;

        Ok(EmbeddingResult {
            vector,
            dimensions: EMBEDDING_DIMENSIONS,
        })
    }

    /// Generate embeddings for multiple texts
    pub async fn embed_batch(&self, texts: Vec<&str>) -> SDKResult<Vec<EmbeddingResult>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        self.ensure_model().await?;

        let model_guard = self.model.read().await;
        let model = model_guard
            .as_ref()
            .ok_or_else(|| SDKError::memory("Embedding model not initialized"))?;

        let embeddings = model
            .embed(texts, None)
            .map_err(|e| SDKError::memory(format!("Failed to generate embeddings: {}", e)))?;

        Ok(embeddings
            .into_iter()
            .map(|vector| EmbeddingResult {
                vector,
                dimensions: EMBEDDING_DIMENSIONS,
            })
            .collect())
    }

    /// Check if the model is loaded
    pub async fn is_loaded(&self) -> bool {
        self.model.read().await.is_some()
    }

    /// Get embedding dimensions
    pub fn dimensions(&self) -> usize {
        EMBEDDING_DIMENSIONS
    }
}

#[cfg(not(feature = "embeddings"))]
impl EmbeddingService {
    /// Create a new embedding service (no-op without embeddings feature)
    pub fn new() -> Self {
        Self {
            _phantom: std::marker::PhantomData,
        }
    }

    /// Generate embedding - returns error without embeddings feature
    pub async fn embed(&self, _text: &str) -> SDKResult<EmbeddingResult> {
        Err(SDKError::memory(
            "Embeddings feature not enabled. Compile with --features embeddings",
        ))
    }

    /// Generate embeddings - returns error without embeddings feature
    pub async fn embed_batch(&self, _texts: Vec<&str>) -> SDKResult<Vec<EmbeddingResult>> {
        Err(SDKError::memory(
            "Embeddings feature not enabled. Compile with --features embeddings",
        ))
    }

    /// Check if the model is loaded
    pub async fn is_loaded(&self) -> bool {
        false
    }

    /// Get embedding dimensions
    pub fn dimensions(&self) -> usize {
        EMBEDDING_DIMENSIONS
    }
}

impl EmbeddingService {
    /// Compute cosine similarity between two vectors
    ///
    /// Returns a value between -1.0 and 1.0, where 1.0 means identical,
    /// 0.0 means orthogonal, and -1.0 means opposite.
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() {
            return 0.0;
        }

        let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }

        dot_product / (norm_a * norm_b)
    }

    /// Normalize a similarity score to 0-1 range
    ///
    /// Converts cosine similarity (-1 to 1) to relevance score (0 to 1)
    pub fn normalize_similarity(similarity: f32) -> f32 {
        (similarity + 1.0) / 2.0
    }
}

/// Global embedding service singleton
static EMBEDDING_SERVICE: std::sync::OnceLock<EmbeddingService> = std::sync::OnceLock::new();

/// Get the global embedding service instance
pub fn embedding_service() -> &'static EmbeddingService {
    EMBEDDING_SERVICE.get_or_init(EmbeddingService::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity_same() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        let sim = EmbeddingService::cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let sim = EmbeddingService::cosine_similarity(&a, &b);
        assert!(sim.abs() < 0.001);
    }

    #[test]
    fn test_cosine_similarity_opposite() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![-1.0, 0.0, 0.0];
        let sim = EmbeddingService::cosine_similarity(&a, &b);
        assert!((sim + 1.0).abs() < 0.001);
    }

    #[test]
    fn test_normalize_similarity() {
        assert!((EmbeddingService::normalize_similarity(1.0) - 1.0).abs() < 0.001);
        assert!((EmbeddingService::normalize_similarity(0.0) - 0.5).abs() < 0.001);
        assert!((EmbeddingService::normalize_similarity(-1.0) - 0.0).abs() < 0.001);
    }

    #[cfg(feature = "embeddings")]
    #[tokio::test]
    #[ignore = "requires model download (~90MB)"]
    async fn test_embed_single() {
        let service = EmbeddingService::new();
        let result = service.embed("hello world").await.unwrap();
        assert_eq!(result.dimensions, EMBEDDING_DIMENSIONS);
        assert_eq!(result.vector.len(), EMBEDDING_DIMENSIONS);
    }

    #[cfg(feature = "embeddings")]
    #[tokio::test]
    #[ignore = "requires model download (~90MB)"]
    async fn test_embed_batch() {
        let service = EmbeddingService::new();
        let results = service
            .embed_batch(vec!["hello", "world", "test"])
            .await
            .unwrap();
        assert_eq!(results.len(), 3);
        for result in results {
            assert_eq!(result.dimensions, EMBEDDING_DIMENSIONS);
            assert_eq!(result.vector.len(), EMBEDDING_DIMENSIONS);
        }
    }
}
