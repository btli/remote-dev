//! SDK Insights routes.
//!
//! Provides REST API endpoints for the insight management service:
//! - GET/POST /sdk/insights - List and create insights
//! - GET/PATCH/DELETE /sdk/insights/{id} - Single insight operations
//! - POST /sdk/insights/{id}/apply - Record insight application
//!
//! Insights are extracted knowledge from notes and sessions.
//! They support folder inheritance like notes.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Extension, Json, Router,
};
use rdv_core::types::{
    InsightApplicability, NewSdkInsight, SdkInsight, SdkInsightFilter, SdkInsightType,
    UpdateSdkInsight,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::state::AppState;

/// Create insights router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/sdk/insights", get(list_insights).post(create_insight))
        .route(
            "/sdk/insights/{id}",
            get(get_insight).patch(update_insight).delete(delete_insight),
        )
        .route("/sdk/insights/{id}/apply", axum::routing::post(apply_insight))
}

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListInsightsQuery {
    pub folder_id: Option<String>,
    #[serde(rename = "type")]
    pub insight_type: Option<String>,
    pub applicability: Option<String>,
    pub applicability_context: Option<String>,
    pub search: Option<String>,
    pub min_confidence: Option<f64>,
    pub verified: Option<bool>,
    pub active: Option<bool>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub limit: Option<usize>,
    /// Enable folder inheritance (default: true)
    pub inherit: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInsightRequest {
    pub folder_id: Option<String>,
    #[serde(rename = "type")]
    pub insight_type: String,
    #[serde(default = "default_applicability")]
    pub applicability: String,
    pub title: String,
    pub description: String,
    pub applicability_context: Option<String>,
    #[serde(default)]
    pub source_notes: Vec<String>,
    #[serde(default)]
    pub source_sessions: Vec<String>,
    #[serde(default = "default_confidence")]
    pub confidence: f64,
}

fn default_applicability() -> String {
    "folder".to_string()
}

fn default_confidence() -> f64 {
    0.5
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInsightRequest {
    #[serde(rename = "type")]
    pub insight_type: Option<String>,
    pub applicability: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub applicability_context: Option<String>,
    pub confidence: Option<f64>,
    pub verified: Option<bool>,
    pub active: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightResponse {
    pub id: String,
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(rename = "type")]
    pub insight_type: String,
    pub applicability: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applicability_context: Option<String>,
    pub source_notes: Vec<String>,
    pub source_sessions: Vec<String>,
    pub confidence: f64,
    pub application_count: i32,
    pub feedback_score: f64,
    pub verified: bool,
    pub active: bool,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_applied_at: Option<i64>,
    /// Whether this insight is inherited from an ancestor folder
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub inherited: bool,
}

impl InsightResponse {
    fn from_insight(insight: SdkInsight, inherited: bool) -> Self {
        let source_notes = insight.source_notes();
        let source_sessions = insight.source_sessions();

        Self {
            id: insight.id,
            user_id: insight.user_id,
            folder_id: insight.folder_id,
            insight_type: insight.insight_type.to_string(),
            applicability: insight.applicability.to_string(),
            title: insight.title,
            description: insight.description,
            applicability_context: insight.applicability_context,
            source_notes,
            source_sessions,
            confidence: insight.confidence,
            application_count: insight.application_count,
            feedback_score: insight.feedback_score,
            verified: insight.verified,
            active: insight.active,
            created_at: insight.created_at,
            updated_at: insight.updated_at,
            last_applied_at: insight.last_applied_at,
            inherited,
        }
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /sdk/insights - Create a new insight
pub async fn create_insight(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<CreateInsightRequest>,
) -> Result<(StatusCode, Json<InsightResponse>), (StatusCode, Json<serde_json::Value>)> {
    // Validate insight type
    let insight_type = parse_insight_type(&req.insight_type).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        )
    })?;

    // Validate applicability
    let applicability = parse_applicability(&req.applicability).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        )
    })?;

    // Validate confidence
    if req.confidence < 0.0 || req.confidence > 1.0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "confidence must be between 0.0 and 1.0" })),
        ));
    }

    let new_insight = NewSdkInsight {
        user_id: auth.user_id().to_string(),
        folder_id: req.folder_id,
        insight_type,
        applicability,
        title: req.title,
        description: req.description,
        applicability_context: req.applicability_context,
        source_notes: req.source_notes,
        source_sessions: req.source_sessions,
        confidence: req.confidence,
    };

    // Create the insight
    let id = state.db.create_sdk_insight(&new_insight).map_err(|e| {
        tracing::error!("Failed to create insight: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Failed to create insight" })),
        )
    })?;

    // Fetch the created insight
    let insight = state
        .db
        .get_sdk_insight(&id)
        .map_err(|e| {
            tracing::error!("Failed to fetch created insight: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to fetch created insight" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Insight not found after creation" })),
            )
        })?;

    Ok((StatusCode::CREATED, Json(InsightResponse::from_insight(insight, false))))
}

/// GET /sdk/insights - List insights with optional filtering
pub async fn list_insights(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListInsightsQuery>,
) -> Result<Json<Vec<InsightResponse>>, (StatusCode, Json<serde_json::Value>)> {
    let inherit = query.inherit.unwrap_or(true);
    let requested_folder_id = query.folder_id.clone();

    // Get folder IDs to query (with inheritance)
    let folder_ids = if inherit {
        if let Some(ref folder_id) = query.folder_id {
            get_folder_with_ancestors(&state, folder_id)?
        } else {
            vec![]
        }
    } else {
        query.folder_id.clone().map(|f| vec![f]).unwrap_or_default()
    };

    // Parse insight type if provided
    let insight_type = if let Some(ref t) = query.insight_type {
        Some(parse_insight_type(t).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": e })),
            )
        })?)
    } else {
        None
    };

    // Parse applicability if provided
    let applicability = if let Some(ref a) = query.applicability {
        Some(parse_applicability(a).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": e })),
            )
        })?)
    } else {
        None
    };

    // Build filter and fetch insights
    let mut all_insights = Vec::new();

    if folder_ids.is_empty() && query.folder_id.is_none() {
        // No folder filter - get all user insights
        let filter = SdkInsightFilter {
            user_id: auth.user_id().to_string(),
            folder_id: None,
            insight_type,
            applicability,
            applicability_context: query.applicability_context.clone(),
            active: query.active,
            verified: query.verified,
            min_confidence: query.min_confidence,
            limit: query.limit,
        };

        let insights = state.db.list_sdk_insights(&filter).map_err(|e| {
            tracing::error!("Failed to list insights: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to list insights" })),
            )
        })?;

        all_insights.extend(insights.into_iter().map(|i| (i, false)));
    } else if !folder_ids.is_empty() {
        // Fetch insights from each folder in the hierarchy
        for folder_id in &folder_ids {
            let filter = SdkInsightFilter {
                user_id: auth.user_id().to_string(),
                folder_id: Some(folder_id.clone()),
                insight_type,
                applicability,
                applicability_context: query.applicability_context.clone(),
                active: query.active,
                verified: query.verified,
                min_confidence: query.min_confidence,
                limit: None, // We'll apply limit after merging
            };

            let insights = state.db.list_sdk_insights(&filter).map_err(|e| {
                tracing::error!("Failed to list insights for folder {}: {}", folder_id, e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "Failed to list insights" })),
                )
            })?;

            let inherited = requested_folder_id.as_ref() != Some(folder_id);
            all_insights.extend(insights.into_iter().map(|i| (i, inherited)));
        }
    }

    // Apply search filter if provided
    if let Some(ref search) = query.search {
        let search_lower = search.to_lowercase();
        all_insights.retain(|(insight, _)| {
            insight.title.to_lowercase().contains(&search_lower)
                || insight.description.to_lowercase().contains(&search_lower)
        });
    }

    // Sort insights
    let sort_by = query.sort_by.as_deref().unwrap_or("createdAt");
    let sort_desc = query.sort_order.as_deref() != Some("asc");

    all_insights.sort_by(|(a, _), (b, _)| {
        let cmp = match sort_by {
            "confidence" => a.confidence.partial_cmp(&b.confidence).unwrap_or(std::cmp::Ordering::Equal),
            "applicationCount" => a.application_count.cmp(&b.application_count),
            "feedbackScore" => a.feedback_score.partial_cmp(&b.feedback_score).unwrap_or(std::cmp::Ordering::Equal),
            _ => a.created_at.cmp(&b.created_at),
        };
        if sort_desc {
            cmp.reverse()
        } else {
            cmp
        }
    });

    // Apply limit
    let limit = query.limit.unwrap_or(50);
    all_insights.truncate(limit);

    // Convert to response
    let response: Vec<InsightResponse> = all_insights
        .into_iter()
        .map(|(insight, inherited)| InsightResponse::from_insight(insight, inherited))
        .collect();

    Ok(Json(response))
}

/// GET /sdk/insights/{id} - Get a single insight
pub async fn get_insight(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<InsightResponse>, (StatusCode, Json<serde_json::Value>)> {
    let insight = state
        .db
        .get_sdk_insight(&id)
        .map_err(|e| {
            tracing::error!("Failed to get insight: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to get insight" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Insight not found" })),
            )
        })?;

    // Verify ownership
    if insight.user_id != auth.user_id() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Insight not found" })),
        ));
    }

    Ok(Json(InsightResponse::from_insight(insight, false)))
}

/// PATCH /sdk/insights/{id} - Update an insight
pub async fn update_insight(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(req): Json<UpdateInsightRequest>,
) -> Result<Json<InsightResponse>, (StatusCode, Json<serde_json::Value>)> {
    // First verify the insight exists and belongs to user
    let existing = state
        .db
        .get_sdk_insight(&id)
        .map_err(|e| {
            tracing::error!("Failed to get insight: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to get insight" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Insight not found" })),
            )
        })?;

    if existing.user_id != auth.user_id() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Insight not found" })),
        ));
    }

    // Parse and validate fields
    let applicability = if let Some(ref a) = req.applicability {
        Some(parse_applicability(a).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": e })),
            )
        })?)
    } else {
        None
    };

    // Validate confidence if provided
    if let Some(c) = req.confidence {
        if c < 0.0 || c > 1.0 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "confidence must be between 0.0 and 1.0" })),
            ));
        }
    }

    let update = UpdateSdkInsight {
        title: req.title,
        description: req.description,
        applicability,
        applicability_context: req.applicability_context,
        confidence: req.confidence,
        verified: req.verified,
        active: req.active,
    };

    state.db.update_sdk_insight(&id, &update).map_err(|e| {
        tracing::error!("Failed to update insight: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Failed to update insight" })),
        )
    })?;

    // Fetch updated insight
    let insight = state
        .db
        .get_sdk_insight(&id)
        .map_err(|e| {
            tracing::error!("Failed to fetch updated insight: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to fetch updated insight" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Insight not found after update" })),
            )
        })?;

    Ok(Json(InsightResponse::from_insight(insight, false)))
}

/// DELETE /sdk/insights/{id} - Delete an insight
pub async fn delete_insight(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // First verify the insight exists and belongs to user
    let existing = state
        .db
        .get_sdk_insight(&id)
        .map_err(|e| {
            tracing::error!("Failed to get insight: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to get insight" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Insight not found" })),
            )
        })?;

    if existing.user_id != auth.user_id() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Insight not found" })),
        ));
    }

    state.db.delete_sdk_insight(&id).map_err(|e| {
        tracing::error!("Failed to delete insight: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Failed to delete insight" })),
        )
    })?;

    Ok(Json(serde_json::json!({ "success": true })))
}

/// POST /sdk/insights/{id}/apply - Record an insight application
pub async fn apply_insight(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // First verify the insight exists and belongs to user
    let existing = state
        .db
        .get_sdk_insight(&id)
        .map_err(|e| {
            tracing::error!("Failed to get insight: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to get insight" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Insight not found" })),
            )
        })?;

    if existing.user_id != auth.user_id() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Insight not found" })),
        ));
    }

    // Record the application
    state.db.record_sdk_insight_application(&id).map_err(|e| {
        tracing::error!("Failed to record insight application: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Failed to record insight application" })),
        )
    })?;

    // Fetch updated insight to get new application count
    let insight = state
        .db
        .get_sdk_insight(&id)
        .map_err(|e| {
            tracing::error!("Failed to fetch insight: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to fetch insight" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Insight not found" })),
            )
        })?;

    Ok(Json(serde_json::json!({
        "success": true,
        "applicationCount": insight.application_count
    })))
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse insight type string to enum
fn parse_insight_type(s: &str) -> Result<SdkInsightType, String> {
    match s.to_lowercase().as_str() {
        "convention" => Ok(SdkInsightType::Convention),
        "pattern" => Ok(SdkInsightType::Pattern),
        "anti_pattern" => Ok(SdkInsightType::AntiPattern),
        "skill" => Ok(SdkInsightType::Skill),
        "gotcha" => Ok(SdkInsightType::Gotcha),
        "best_practice" => Ok(SdkInsightType::BestPractice),
        "dependency" => Ok(SdkInsightType::Dependency),
        "performance" => Ok(SdkInsightType::Performance),
        _ => Err(format!(
            "Invalid type. Must be one of: convention, pattern, anti_pattern, skill, gotcha, best_practice, dependency, performance"
        )),
    }
}

/// Parse applicability string to enum
fn parse_applicability(s: &str) -> Result<InsightApplicability, String> {
    match s.to_lowercase().as_str() {
        "session" => Ok(InsightApplicability::Session),
        "folder" => Ok(InsightApplicability::Folder),
        "global" => Ok(InsightApplicability::Global),
        "language" => Ok(InsightApplicability::Language),
        "framework" => Ok(InsightApplicability::Framework),
        _ => Err(format!(
            "Invalid applicability. Must be one of: session, folder, global, language, framework"
        )),
    }
}

/// Get folder ID along with all ancestor folder IDs for inheritance
fn get_folder_with_ancestors(
    state: &Arc<AppState>,
    folder_id: &str,
) -> Result<Vec<String>, (StatusCode, Json<serde_json::Value>)> {
    let mut ids = vec![folder_id.to_string()];
    let mut current_id = folder_id.to_string();

    // Walk up the parent chain
    loop {
        let folder = state.db.get_folder(&current_id).map_err(|e| {
            tracing::error!("Failed to get folder {}: {}", current_id, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to resolve folder hierarchy" })),
            )
        })?;

        match folder {
            Some(f) => {
                if let Some(parent_id) = f.parent_id {
                    ids.push(parent_id.clone());
                    current_id = parent_id;
                } else {
                    break;
                }
            }
            None => break,
        }
    }

    Ok(ids)
}
