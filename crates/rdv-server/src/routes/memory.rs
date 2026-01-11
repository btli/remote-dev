//! Memory management routes.
//!
//! Provides REST API endpoints for the hierarchical memory system:
//! - GET/POST /memory - Query and store memories
//! - GET /memory/search - Semantic search across memories
//! - POST /memory/consolidate - Trigger memory consolidation
//! - GET /memory/stats - Memory usage statistics

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use rdv_core::memory::MemoryStats;
use rdv_core::types::{MemoryEntry, MemoryQueryFilter, NewMemoryEntry};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::state::AppState;

/// Create memory router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/memory", get(list_memories).post(store_memory))
        .route("/memory/{id}", get(get_memory).delete(delete_memory))
        .route("/memory/search", get(search_memories))
        .route("/memory/consolidate", post(consolidate_memories))
        .route("/memory/stats", get(get_stats))
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
    pub ttl: Option<i32>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidateRequest {
    pub folder_id: Option<String>,
    pub auto_promotion: Option<bool>,
    pub auto_demotion: Option<bool>,
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
pub async fn list_memories(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListMemoriesQuery>,
) -> Result<Json<ListMemoriesResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let filter = MemoryQueryFilter {
        user_id: user_id.to_string(),
        session_id: query.session_id,
        folder_id: query.folder_id,
        tier: query.tier,
        content_type: query.content_type,
        task_id: query.task_id,
        min_relevance: query.min_relevance,
        min_confidence: query.min_confidence,
        limit: query.limit,
    };

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
pub async fn store_memory(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<StoreMemoryRequest>,
) -> Result<(StatusCode, Json<MemoryResponse>), (StatusCode, String)> {
    let user_id = auth.user_id();

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
    let filter = MemoryQueryFilter {
        user_id: user_id.to_string(),
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

    let entry = NewMemoryEntry {
        user_id: user_id.to_string(),
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
        ttl_seconds: req.ttl,
        metadata_json: req.metadata.map(|m| m.to_string()),
    };

    let id = state
        .db
        .create_memory_entry(&entry)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch the created entry
    let created = state
        .db
        .get_memory_entry(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "Failed to retrieve created memory".to_string()))?;

    Ok((StatusCode::CREATED, Json(created.into())))
}

/// Get a single memory entry
pub async fn get_memory(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<MemoryResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let entry = state
        .db
        .get_memory_entry(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Memory not found".to_string()))?;

    // Verify ownership
    if entry.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Touch the entry to update access count
    let _ = state.db.touch_memory_entry(&id);

    Ok(Json(entry.into()))
}

/// Delete a memory entry
pub async fn delete_memory(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Verify ownership first
    let entry = state
        .db
        .get_memory_entry(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Memory not found".to_string()))?;

    if entry.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    state
        .db
        .delete_memory_entry(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Search memories with semantic matching
pub async fn search_memories(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<SearchMemoriesQuery>,
) -> Result<Json<SearchResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let filter = MemoryQueryFilter {
        user_id: user_id.to_string(),
        session_id: query.session_id,
        folder_id: query.folder_id,
        tier: query.tier,
        content_type: query.content_type,
        min_relevance: query.min_score,
        limit: query.limit,
        ..Default::default()
    };

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

/// Trigger memory consolidation
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

    // Run cleanup and promotion manually
    // The full consolidation service requires the MemoryStore trait implementation
    // For now, just run basic cleanup
    let pruned = state
        .db
        .cleanup_expired_memory()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Manual promotion based on access patterns
    let filter = MemoryQueryFilter {
        user_id: user_id.to_string(),
        folder_id: req.folder_id,
        ..Default::default()
    };

    let entries = state
        .db
        .list_memory_entries(&filter)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let mut promoted = 0;
    let mut demoted = 0;

    for entry in entries {
        let tier = entry.tier.as_str();
        let access_count = entry.access_count;
        let confidence = entry.confidence.unwrap_or(0.5);
        let relevance = entry.relevance.unwrap_or(0.5);

        // Promotion logic
        if req.auto_promotion.unwrap_or(true) {
            let new_tier = match tier {
                "short_term" if access_count >= 3 || confidence >= 0.7 => Some("working"),
                "working" if access_count >= 5 && confidence >= 0.8 && relevance >= 0.7 => Some("long_term"),
                _ => None,
            };

            if let Some(t) = new_tier {
                if state.db.update_memory_entry(&entry.id, Some(t), None, None, None).is_ok() {
                    promoted += 1;
                }
            }
        }

        // Demotion logic
        if req.auto_demotion.unwrap_or(true) && relevance < 0.2 && confidence < 0.3 {
            let new_tier = match tier {
                "long_term" => Some("working"),
                "working" => Some("short_term"),
                _ => None,
            };

            if let Some(t) = new_tier {
                if state.db.update_memory_entry(&entry.id, Some(t), None, None, None).is_ok() {
                    demoted += 1;
                }
            }
        }
    }

    Ok(Json(ConsolidateResponse {
        pruned_expired: pruned,
        promoted,
        demoted,
        total_affected: pruned + promoted + demoted,
    }))
}

/// Get memory statistics
pub async fn get_stats(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<StatsResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let stats_map = state
        .db
        .get_memory_stats(user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let stats = MemoryStats {
        total: stats_map.get("total").copied().unwrap_or(0),
        short_term: stats_map.get("short_term").copied().unwrap_or(0),
        working: stats_map.get("working").copied().unwrap_or(0),
        long_term: stats_map.get("long_term").copied().unwrap_or(0),
    };

    Ok(Json(stats.into()))
}
