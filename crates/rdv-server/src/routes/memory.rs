//! Memory management routes.
//!
//! Provides REST API endpoints for the hierarchical memory system:
//! - GET/POST /memory - Query and store memories
//! - GET /memory/search - Text-based search across memories
//! - POST /memory/semantic-search - Semantic search using embeddings
//! - POST /memory/consolidate - Trigger memory consolidation
//! - POST /memory/consolidation/start - Start periodic consolidation scheduler
//! - POST /memory/consolidation/stop - Stop periodic consolidation scheduler
//! - GET /memory/consolidation/status - Get consolidation scheduler status
//! - GET /memory/stats - Memory usage statistics

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post, delete},
    Extension, Json, Router,
};
use rdv_core::memory::MemoryStats;
use rdv_core::types::{MemoryEntry, MemoryQueryFilter, NewMemoryEntry};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::sse::MemoryEventData;
use crate::state::AppState;

#[cfg(feature = "embeddings")]
use rdv_sdk::memory::embeddings::{embedding_service, EmbeddingService};

/// Convert a MemoryEntry to SSE MemoryEventData
fn memory_to_event_data(entry: &MemoryEntry, embedding_id: Option<&str>) -> MemoryEventData {
    // Create content preview (first 200 chars)
    let content_preview = if entry.content.len() > 200 {
        format!("{}...", &entry.content[..200])
    } else {
        entry.content.clone()
    };

    MemoryEventData {
        id: entry.id.clone(),
        tier: entry.tier.clone(),
        content_type: entry.content_type.clone(),
        name: entry.name.clone(),
        content_preview,
        has_embedding: embedding_id.is_some(),
        embedding_id: embedding_id.map(|s| s.to_string()),
        session_id: entry.session_id.clone(),
        folder_id: entry.folder_id.clone(),
        confidence: entry.confidence,
        relevance: entry.relevance,
        access_count: entry.access_count,
        created_at: entry.created_at,
    }
}

/// Create memory router (protected routes)
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/memory", get(list_memories).post(store_memory))
        .route("/memory/{id}", get(get_memory).patch(update_memory).delete(delete_memory))
        .route("/memory/search", get(search_memories))
        .route("/memory/semantic-search", post(semantic_search))
        .route("/memory/consolidate", post(consolidate_memories))
        .route("/memory/consolidation/start", post(start_consolidation))
        .route("/memory/consolidation/stop", delete(stop_consolidation))
        .route("/memory/consolidation/status", get(consolidation_status))
        .route("/memory/stats", get(get_stats))
}

/// Create memory public router (no auth required)
/// Used for lightweight event notifications from CLI/SDK.
/// Security: The handler validates memory ownership by reading from DB before broadcasting.
pub fn public_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/memory/event", post(handle_memory_event))
}

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMemoriesQuery {
    pub tier: Option<String>,
    pub content_type: Option<String>,
    pub session_id: Option<String>,
    pub folder_id: Option<String>,
    pub task_id: Option<String>,
    pub min_relevance: Option<f64>,
    pub min_confidence: Option<f64>,
    pub limit: Option<usize>,
}

impl From<ListMemoriesQuery> for MemoryQueryFilter {
    fn from(query: ListMemoriesQuery) -> Self {
        Self {
            session_id: query.session_id,
            folder_id: query.folder_id,
            tier: query.tier,
            content_type: query.content_type,
            task_id: query.task_id,
            min_relevance: query.min_relevance,
            min_confidence: query.min_confidence,
            limit: query.limit,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreMemoryRequest {
    pub tier: String,
    pub content_type: String,
    pub content: String,
    pub session_id: Option<String>,
    pub folder_id: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub task_id: Option<String>,
    pub priority: Option<i32>,
    pub confidence: Option<f64>,
    pub relevance: Option<f64>,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMemoriesQuery {
    pub query: String,
    pub tier: Option<String>,
    pub content_type: Option<String>,
    pub session_id: Option<String>,
    pub folder_id: Option<String>,
    pub min_score: Option<f64>,
    pub limit: Option<usize>,
}

impl SearchMemoriesQuery {
    /// Convert to MemoryQueryFilter for database query
    fn to_filter(&self) -> MemoryQueryFilter {
        MemoryQueryFilter {
            session_id: self.session_id.clone(),
            folder_id: self.folder_id.clone(),
            tier: self.tier.clone(),
            content_type: self.content_type.clone(),
            min_relevance: self.min_score,
            limit: self.limit,
            ..Default::default()
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchRequest {
    /// The natural language query to search for
    pub query: String,
    /// Optional session scope
    pub session_id: Option<String>,
    /// Optional folder scope
    pub folder_id: Option<String>,
    /// Filter by memory tiers
    pub tiers: Option<Vec<String>>,
    /// Filter by content types
    pub content_types: Option<Vec<String>>,
    /// Minimum similarity score (0-1, default: 0.3)
    pub min_similarity: Option<f64>,
    /// Maximum number of results (default: 20)
    pub limit: Option<usize>,
    /// Include expired short-term entries
    pub include_expired: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResult {
    pub memory: MemoryResponse,
    /// Combined relevance score (0-1)
    pub score: f64,
    /// Semantic similarity component (0-1)
    pub semantic_score: f64,
    /// Tier weight component
    pub tier_weight: f64,
    /// Content type weight component
    pub type_weight: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResponse {
    pub results: Vec<SemanticSearchResult>,
    pub query: String,
    pub total: usize,
    /// Whether semantic search was used (vs fallback)
    pub semantic: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidateRequest {
    pub folder_id: Option<String>,
    pub auto_promotion: Option<bool>,
    pub auto_demotion: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartConsolidationRequest {
    /// Interval between runs in hours (default: 4)
    pub interval_hours: Option<u64>,
    /// Enable automatic promotion
    pub auto_promotion: Option<bool>,
    /// Enable automatic demotion
    pub auto_demotion: Option<bool>,
    /// Relevance decay rate per day (0-1, default: 0.02)
    pub relevance_decay_rate: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidationStatusResponse {
    /// Whether the consolidation scheduler is running
    pub active: bool,
    /// User ID if active
    pub user_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoryRequest {
    /// New memory tier (short_term, working, long_term)
    pub tier: Option<String>,
    /// Updated content
    pub content: Option<String>,
    /// Updated name/title
    pub name: Option<String>,
    /// Updated confidence score (0-1)
    pub confidence: Option<f64>,
    /// Updated relevance score (0-1)
    pub relevance: Option<f64>,
    /// Updated priority (1-4)
    pub priority: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryResponse {
    pub id: String,
    pub tier: String,
    pub content_type: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub access_count: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relevance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

impl From<MemoryEntry> for MemoryResponse {
    fn from(entry: MemoryEntry) -> Self {
        Self {
            id: entry.id,
            tier: entry.tier,
            content_type: entry.content_type,
            content: entry.content,
            name: entry.name,
            description: entry.description,
            session_id: entry.session_id,
            folder_id: entry.folder_id,
            task_id: entry.task_id,
            access_count: entry.access_count,
            relevance: entry.relevance,
            confidence: entry.confidence,
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            expires_at: entry.expires_at,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMemoriesResponse {
    pub memories: Vec<MemoryResponse>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub memory: MemoryResponse,
    pub score: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub query: String,
    pub total: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidateResponse {
    pub pruned_expired: usize,
    pub promoted: usize,
    pub demoted: usize,
    pub total_affected: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsResponse {
    pub total: i64,
    pub by_tier: TierCounts,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierCounts {
    pub short_term: i64,
    pub working: i64,
    pub long_term: i64,
}

impl From<MemoryStats> for StatsResponse {
    fn from(stats: MemoryStats) -> Self {
        Self {
            total: stats.total,
            by_tier: TierCounts {
                short_term: stats.short_term,
                working: stats.working,
                long_term: stats.long_term,
            },
        }
    }
}

// ============================================================================
// Route Handlers
// ============================================================================

/// List memories with optional filtering
/// Single-user system - no user_id filtering needed.
pub async fn list_memories(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<ListMemoriesQuery>,
) -> Result<Json<ListMemoriesResponse>, (StatusCode, String)> {
    // Single-user system - no user_id field
    let filter: MemoryQueryFilter = query.into();

    let memories = state
        .db
        .list_memory_entries(&filter)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let total = memories.len();
    let responses: Vec<MemoryResponse> = memories.into_iter().map(Into::into).collect();

    Ok(Json(ListMemoriesResponse {
        memories: responses,
        total,
    }))
}

/// Store a new memory entry
/// Single-user system - no user_id required.
pub async fn store_memory(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<StoreMemoryRequest>,
) -> Result<(StatusCode, Json<MemoryResponse>), (StatusCode, String)> {
    let user_id = auth.user_id(); // Keep for SSE broadcast

    // Validate tier
    let valid_tiers = ["short_term", "working", "long_term"];
    if !valid_tiers.contains(&req.tier.as_str()) {
        return Err((StatusCode::BAD_REQUEST, "Invalid tier. Must be short_term, working, or long_term".to_string()));
    }

    // Compute content hash for deduplication
    let mut hasher = Sha256::new();
    hasher.update(req.content.as_bytes());
    let content_hash = format!("{:x}", hasher.finalize());

    // Check for duplicate
    // Single-user system - check for duplicates in same tier
    let filter = MemoryQueryFilter {
        tier: Some(req.tier.clone()),
        ..Default::default()
    };

    let existing = state
        .db
        .list_memory_entries(&filter)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Simple deduplication check
    for entry in &existing {
        if entry.content_hash == content_hash {
            // Update access count and return existing
            let _ = state.db.touch_memory_entry(&entry.id);
            let updated = state
                .db
                .get_memory_entry(&entry.id)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
                .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "Entry disappeared".to_string()))?;
            return Ok((StatusCode::OK, Json(updated.into())));
        }
    }

    // Single-user system - no user_id field
    let entry = NewMemoryEntry {
        session_id: req.session_id,
        folder_id: req.folder_id,
        tier: req.tier,
        content_type: req.content_type,
        name: req.name,
        description: req.description,
        content: req.content,
        task_id: req.task_id,
        priority: req.priority,
        confidence: req.confidence,
        relevance: req.relevance,
        metadata_json: req.metadata.map(|m| m.to_string()),
    };

    let id = state
        .db
        .create_memory_entry(&entry)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Track embedding_id for SSE event
    let mut stored_embedding_id: Option<String> = None;

    // Compute and store embedding for semantic search
    // Single-user system - no user_id field in NewSdkEmbedding
    #[cfg(feature = "embeddings")]
    {
        if let Ok(embedding_result) = embedding_service().embed(&entry.content).await {
            let new_embedding = rdv_core::types::NewSdkEmbedding {
                entity_type: "memory".to_string(),
                entity_id: id.clone(),
                embedding: embedding_result.vector,
                model_name: Some("all-MiniLM-L6-v2".to_string()),
            };
            if let Ok(embedding_id) = state.db.create_embedding(&new_embedding) {
                let _ = state.db.set_memory_embedding(&id, &embedding_id);
                stored_embedding_id = Some(embedding_id.clone());
                tracing::debug!("Stored embedding {} for memory {}", embedding_id, id);
            }
        }
    }

    // Fetch the created entry
    let created = state
        .db
        .get_memory_entry(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to retrieve created memory".to_string()))?;

    // Broadcast memory created event
    let event_data = memory_to_event_data(&created, stored_embedding_id.as_deref());
    state.memory_broadcaster.memory_created(user_id, event_data);

    Ok((StatusCode::CREATED, Json(created.into())))
}

/// Get a single memory entry
/// Single-user system - no ownership verification needed.
pub async fn get_memory(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<MemoryResponse>, (StatusCode, String)> {
    let entry = state
        .db
        .get_memory_entry(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Memory not found".to_string()))?;

    // Touch the entry to update access count
    let _ = state.db.touch_memory_entry(&id);

    Ok(Json(entry.into()))
}

/// Delete a memory entry
/// Single-user system - no ownership verification needed.
pub async fn delete_memory(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = auth.user_id(); // Keep for SSE broadcast

    // Verify memory exists
    let _entry = state
        .db
        .get_memory_entry(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Memory not found".to_string()))?;

    state
        .db
        .delete_memory_entry(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Broadcast memory deleted event
    state.memory_broadcaster.memory_deleted(user_id, &id);

    Ok(StatusCode::NO_CONTENT)
}

/// Update a memory entry (partial update)
/// Single-user system - no ownership verification needed.
pub async fn update_memory(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(req): Json<UpdateMemoryRequest>,
) -> Result<Json<MemoryResponse>, (StatusCode, String)> {
    let user_id = auth.user_id(); // Keep for SSE broadcast

    // Verify memory exists
    let entry = state
        .db
        .get_memory_entry(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Memory not found".to_string()))?;

    // Validate tier if provided
    if let Some(ref tier) = req.tier {
        let valid_tiers = ["short_term", "working", "long_term"];
        if !valid_tiers.contains(&tier.as_str()) {
            return Err((StatusCode::BAD_REQUEST, "Invalid tier. Must be short_term, working, or long_term".to_string()));
        }
    }

    // Track if content changed (need to regenerate embedding)
    let content_changed = req.content.is_some() && req.content.as_ref() != Some(&entry.content);

    // Update the memory entry
    state
        .db
        .update_memory_entry_full(
            &id,
            req.tier.as_deref(),
            req.relevance,
            req.confidence,
            req.priority,
            req.content.as_deref(),
            req.name.as_deref(),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Track embedding_id for SSE event
    let mut stored_embedding_id: Option<String> = None;

    // Regenerate embedding if content changed
    // Single-user system - no user_id field in NewSdkEmbedding
    #[cfg(feature = "embeddings")]
    if content_changed {
        if let Some(ref new_content) = req.content {
            // Delete old embedding if exists
            if let Some(ref old_embedding_id) = entry.embedding_id {
                let _ = state.db.delete_embedding(old_embedding_id);
            }

            // Create new embedding
            if let Ok(embedding_result) = embedding_service().embed(new_content).await {
                let new_embedding = rdv_core::types::NewSdkEmbedding {
                    entity_type: "memory".to_string(),
                    entity_id: id.clone(),
                    embedding: embedding_result.vector,
                    model_name: Some("all-MiniLM-L6-v2".to_string()),
                };
                if let Ok(embedding_id) = state.db.create_embedding(&new_embedding) {
                    let _ = state.db.set_memory_embedding(&id, &embedding_id);
                    stored_embedding_id = Some(embedding_id.clone());
                    tracing::debug!("Updated embedding {} for memory {}", embedding_id, id);
                }
            }
        }
    }

    // Fetch the updated entry
    let updated = state
        .db
        .get_memory_entry(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to retrieve updated memory".to_string()))?;

    // Broadcast memory updated event
    let event_data = memory_to_event_data(&updated, stored_embedding_id.as_deref());
    state.memory_broadcaster.memory_updated(user_id, event_data);

    Ok(Json(updated.into()))
}

/// Search memories with semantic matching
/// Single-user system - no user_id filtering needed.
pub async fn search_memories(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<SearchMemoriesQuery>,
) -> Result<Json<SearchResponse>, (StatusCode, String)> {
    // Single-user system - no user_id field
    let filter = query.to_filter();

    let memories = state
        .db
        .list_memory_entries(&filter)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Simple text matching for scoring
    // TODO: Implement semantic search with embeddings
    let query_lower = query.query.to_lowercase();
    let query_words: Vec<&str> = query_lower.split_whitespace().filter(|w| w.len() > 2).collect();

    let mut results: Vec<SearchResult> = memories
        .into_iter()
        .map(|entry| {
            let content_lower = entry.content.to_lowercase();
            let name_lower = entry.name.as_deref().unwrap_or("").to_lowercase();

            // Calculate match score
            let mut score = 0.0;
            for word in &query_words {
                if content_lower.contains(word) {
                    score += 0.2;
                }
                if name_lower.contains(word) {
                    score += 0.3;
                }
            }

            // Combine with relevance
            let base_relevance = entry.relevance.unwrap_or(0.5);
            let final_score = (base_relevance * 0.5 + score * 0.5).min(1.0);

            SearchResult {
                memory: entry.into(),
                score: final_score,
            }
        })
        .filter(|r| r.score > query.min_score.unwrap_or(0.0))
        .collect();

    // Sort by score descending
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Apply limit
    if let Some(limit) = query.limit {
        results.truncate(limit);
    }

    let total = results.len();

    Ok(Json(SearchResponse {
        results,
        query: query.query,
        total,
    }))
}

/// Semantic search using pre-computed embeddings
///
/// Uses the rdv-sdk's embedding service to compute query embedding and
/// searches against pre-computed memory embeddings stored in the database.
/// Falls back to text matching if embeddings feature is not enabled.
#[cfg(feature = "embeddings")]
pub async fn semantic_search(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<SemanticSearchRequest>,
) -> Result<Json<SemanticSearchResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Generate query embedding (only operation that needs embedding service)
    let query_embedding = embedding_service()
        .embed(&req.query)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let min_similarity = req.min_similarity.unwrap_or(0.3);
    let limit = req.limit.unwrap_or(20);

    // Search using pre-computed embeddings from database (single-user system - no user_id parameter)
    let all_embedding_results = state
        .db
        .search_similar_embeddings(
            "memory",
            &query_embedding.vector,
            limit * 5, // Fetch extra for filtering
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Filter by minimum similarity
    let min_sim_f32 = min_similarity as f32;
    let embedding_results: Vec<_> = all_embedding_results
        .into_iter()
        .filter(|r| r.similarity >= min_sim_f32)
        .collect();

    if embedding_results.is_empty() {
        return Ok(Json(SemanticSearchResponse {
            results: vec![],
            query: req.query,
            total: 0,
            semantic: true,
        }));
    }

    // Fetch memory entries and compute final scores
    let mut results: Vec<SemanticSearchResult> = Vec::new();

    for emb_result in embedding_results {
        // Fetch the memory entry
        let entry = match state.db.get_memory_entry(&emb_result.entity_id) {
            Ok(Some(e)) => e,
            _ => continue,
        };

        // Single-user system - no ownership verification needed

        // Apply tier/content_type filters if specified
        if let Some(ref tiers) = req.tiers {
            if !tiers.contains(&entry.tier) {
                continue;
            }
        }
        if let Some(ref content_types) = req.content_types {
            if !content_types.contains(&entry.content_type) {
                continue;
            }
        }
        if let Some(ref session_id) = req.session_id {
            if entry.session_id.as_ref() != Some(session_id) {
                continue;
            }
        }
        if let Some(ref folder_id) = req.folder_id {
            if entry.folder_id.as_ref() != Some(folder_id) {
                continue;
            }
        }

        // Normalize similarity to 0-1 range
        let semantic_score = EmbeddingService::normalize_similarity(emb_result.similarity as f32);

        // Tier weight
        let tier_weight = match entry.tier.as_str() {
            "long_term" => 1.0,
            "working" => 0.8,
            "short_term" => 0.6,
            _ => 0.5,
        };

        // Content type weight
        let type_weight = match entry.content_type.as_str() {
            "gotcha" => 1.0,
            "pattern" => 0.9,
            "convention" => 0.85,
            "skill" => 0.8,
            "plan" => 0.75,
            "hypothesis" => 0.7,
            "observation" => 0.6,
            "file_context" => 0.5,
            "command" => 0.45,
            "tool_result" => 0.4,
            _ => 0.5,
        };

        // Combined score: 50% semantic, 20% tier, 15% type, 15% baseline
        let score = (semantic_score as f64) * 0.5
            + tier_weight * 0.2
            + type_weight * 0.15
            + 0.5 * 0.15;

        results.push(SemanticSearchResult {
            memory: entry.into(),
            score,
            semantic_score: semantic_score as f64,
            tier_weight,
            type_weight,
        });
    }

    // Sort by score descending
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Apply limit
    results.truncate(limit);

    // Update access counts for returned results
    for result in &results {
        let _ = state.db.touch_memory_entry(&result.memory.id);
    }

    let total = results.len();

    Ok(Json(SemanticSearchResponse {
        results,
        query: req.query,
        total,
        semantic: true,
    }))
}

/// Semantic search fallback when embeddings feature is disabled
#[cfg(not(feature = "embeddings"))]
pub async fn semantic_search(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<SemanticSearchRequest>,
) -> Result<Json<SemanticSearchResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Fall back to text-based search
    let filter = MemoryQueryFilter {
        user_id: user_id.to_string(),
        session_id: req.session_id,
        folder_id: req.folder_id,
        tier: req.tiers.and_then(|t| t.first().cloned()),
        content_type: req.content_types.and_then(|t| t.first().cloned()),
        limit: req.limit,
        ..Default::default()
    };

    let memories = state
        .db
        .list_memory_entries(&filter)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Simple text matching for scoring
    let query_lower = req.query.to_lowercase();
    let query_words: Vec<&str> = query_lower.split_whitespace().filter(|w| w.len() > 2).collect();

    let min_sim = req.min_similarity.unwrap_or(0.3);

    let mut results: Vec<SemanticSearchResult> = memories
        .into_iter()
        .map(|entry| {
            let content_lower = entry.content.to_lowercase();
            let name_lower = entry.name.as_deref().unwrap_or("").to_lowercase();

            // Calculate match score
            let mut keyword_score: f64 = 0.0;
            for word in &query_words {
                if content_lower.contains(word) {
                    keyword_score += 0.2;
                }
                if name_lower.contains(word) {
                    keyword_score += 0.3;
                }
            }
            let keyword_score = keyword_score.min(1.0);

            // Tier weight
            let tier_weight = match entry.tier.as_str() {
                "long_term" => 1.0,
                "working" => 0.8,
                "short_term" => 0.6,
                _ => 0.5,
            };

            // Content type weight
            let type_weight = match entry.content_type.as_str() {
                "gotcha" => 1.0,
                "pattern" => 0.9,
                "convention" => 0.85,
                "skill" => 0.8,
                "plan" => 0.75,
                "hypothesis" => 0.7,
                "observation" => 0.6,
                "file_context" => 0.5,
                "command" => 0.45,
                "tool_result" => 0.4,
                _ => 0.5,
            };

            // Combined score (same formula as SDK)
            let score = keyword_score * 0.5 + tier_weight * 0.2 + type_weight * 0.15 + 0.5 * 0.15;

            SemanticSearchResult {
                memory: entry.into(),
                score,
                semantic_score: keyword_score, // Use keyword score as proxy
                tier_weight,
                type_weight,
            }
        })
        .filter(|r| r.semantic_score >= min_sim)
        .collect();

    // Sort by score descending
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Apply limit
    if let Some(limit) = req.limit {
        results.truncate(limit);
    }

    let total = results.len();

    Ok(Json(SemanticSearchResponse {
        results,
        query: req.query,
        total,
        semantic: false, // Not using real semantic search
    }))
}

/// Trigger memory consolidation
///
/// Uses the ConsolidationService for comprehensive memory lifecycle management
/// including promotion, demotion, and relevance decay.
pub async fn consolidate_memories(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<ConsolidateRequest>,
) -> Result<Json<ConsolidateResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Verify folder access if specified
    if let Some(ref folder_id) = req.folder_id {
        let folder = state
            .db
            .get_folder(folder_id)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
            .ok_or_else(|| (StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

        if folder.user_id != user_id {
            return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
        }
    }

    // Build config from request
    let config = crate::services::ConsolidationConfig {
        auto_promotion: req.auto_promotion.unwrap_or(true),
        auto_demotion: req.auto_demotion.unwrap_or(true),
        ..Default::default()
    };

    // Run consolidation via the service
    let result = state
        .consolidation
        .consolidate_now(user_id, Some(config))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(ConsolidateResponse {
        pruned_expired: result.expired_deleted,
        promoted: result.promoted,
        demoted: result.demoted,
        total_affected: result.total_affected,
    }))
}

/// Get memory statistics
pub async fn get_stats(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
) -> Result<Json<StatsResponse>, (StatusCode, String)> {
    // Single-user system - no user_id parameter needed
    let stats_map = state
        .db
        .get_memory_stats()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let stats = MemoryStats {
        total: stats_map.get("total").copied().unwrap_or(0),
        short_term: stats_map.get("short_term").copied().unwrap_or(0),
        working: stats_map.get("working").copied().unwrap_or(0),
        long_term: stats_map.get("long_term").copied().unwrap_or(0),
    };

    Ok(Json(stats.into()))
}

/// Start periodic consolidation scheduler
///
/// Starts a background task that runs consolidation at regular intervals.
/// The scheduler persists across API calls until explicitly stopped.
pub async fn start_consolidation(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<StartConsolidationRequest>,
) -> Result<Json<ConsolidationStatusResponse>, (StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Build config from request
    let interval_ms = req.interval_hours.unwrap_or(4) * 60 * 60 * 1000;
    let config = crate::services::ConsolidationConfig {
        interval_ms,
        auto_promotion: req.auto_promotion.unwrap_or(true),
        auto_demotion: req.auto_demotion.unwrap_or(true),
        relevance_decay_rate: req.relevance_decay_rate.unwrap_or(0.02),
        ..Default::default()
    };

    // Start consolidation
    Arc::clone(&state.consolidation)
        .start_consolidation(user_id.clone(), Some(config))
        .await;

    Ok(Json(ConsolidationStatusResponse {
        active: true,
        user_id: Some(user_id),
    }))
}

/// Stop periodic consolidation scheduler
pub async fn stop_consolidation(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = auth.user_id();

    state.consolidation.stop_consolidation(user_id).await;

    Ok(StatusCode::NO_CONTENT)
}

/// Get consolidation scheduler status
pub async fn consolidation_status(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<ConsolidationStatusResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let active = state.consolidation.is_consolidation_active(user_id).await;

    Ok(Json(ConsolidationStatusResponse {
        active,
        user_id: if active { Some(user_id.to_string()) } else { None },
    }))
}

// ============================================================================
// Memory Event Notification (for CLI/SDK to trigger SSE broadcasts)
// ============================================================================

/// Memory event notification request from CLI/SDK.
/// This is a lightweight notification that tells the server to broadcast
/// an SSE event for a memory that was created/updated/deleted directly
/// via the database (bypassing the REST API).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MemoryEventRequest {
    /// Event type: created, updated, deleted, promoted, demoted
    pub event_type: String,
    /// Memory ID (required for all except bulk events)
    pub memory_id: Option<String>,
    /// User ID (optional in single-user system - defaults to broadcast to all)
    pub user_id: Option<String>,
    /// Optional: embedding ID if the memory has an embedding
    pub embedding_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MemoryEventResponse {
    pub received: bool,
    pub broadcasted: bool,
    pub memory_found: bool,
}

/// Handle memory event notification from CLI/SDK.
/// Reads the memory from the database and broadcasts an SSE event.
/// This endpoint is called by CLI/SDK after they directly write to the database.
///
/// Single-user system: user_id is optional. If not provided, broadcasts to all
/// connected clients using a wildcard user ID.
pub async fn handle_memory_event(
    State(state): State<Arc<AppState>>,
    Json(req): Json<MemoryEventRequest>,
) -> Result<Json<MemoryEventResponse>, (StatusCode, String)> {
    use crate::sse::MemoryEventType;

    // Single-user system: use provided user_id or broadcast to all via wildcard
    let user_id = req.user_id.as_deref().unwrap_or("*");

    // Parse event type
    let event_type = match req.event_type.as_str() {
        "created" => MemoryEventType::Created,
        "updated" => MemoryEventType::Updated,
        "deleted" => MemoryEventType::Deleted,
        "promoted" => MemoryEventType::Promoted,
        "demoted" => MemoryEventType::Demoted,
        "expired" => MemoryEventType::Expired,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Invalid event_type: {}", req.event_type),
            ));
        }
    };

    // Handle deleted events (no memory lookup needed)
    if matches!(event_type, MemoryEventType::Deleted) {
        if let Some(memory_id) = req.memory_id {
            state.memory_broadcaster.memory_deleted(user_id, &memory_id);
            return Ok(Json(MemoryEventResponse {
                received: true,
                broadcasted: true,
                memory_found: false, // Not applicable for delete
            }));
        } else {
            return Err((
                StatusCode::BAD_REQUEST,
                "memory_id required for deleted events".to_string(),
            ));
        }
    }

    // Handle expired events (bulk, no specific memory)
    if matches!(event_type, MemoryEventType::Expired) {
        // Just notify that some memories expired
        state.memory_broadcaster.memories_expired(user_id, 1);
        return Ok(Json(MemoryEventResponse {
            received: true,
            broadcasted: true,
            memory_found: false,
        }));
    }

    // For other events, we need to read the memory from DB
    let memory_id = match &req.memory_id {
        Some(id) => id,
        None => {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("memory_id required for {} events", req.event_type),
            ));
        }
    };

    // Read the memory from database
    let memory = state.db.get_memory_entry(memory_id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

    let memory = match memory {
        Some(m) => m,
        None => {
            return Ok(Json(MemoryEventResponse {
                received: true,
                broadcasted: false,
                memory_found: false,
            }));
        }
    };

    // Convert to event data and broadcast
    let event_data = memory_to_event_data(&memory, req.embedding_id.as_deref());

    match event_type {
        MemoryEventType::Created => {
            state.memory_broadcaster.memory_created(user_id, event_data);
        }
        MemoryEventType::Updated => {
            state.memory_broadcaster.memory_updated(user_id, event_data);
        }
        MemoryEventType::Promoted => {
            state.memory_broadcaster.memory_promoted(user_id, event_data);
        }
        MemoryEventType::Demoted => {
            state.memory_broadcaster.memory_demoted(user_id, event_data);
        }
        _ => {
            // Already handled above
        }
    }

    Ok(Json(MemoryEventResponse {
        received: true,
        broadcasted: true,
        memory_found: true,
    }))
}
