//! Orchestrator management routes.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use rdv_core::tmux;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::state::AppState;

/// Create orchestrator router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/orchestrators",
            get(list_orchestrators).post(create_orchestrator),
        )
        .route(
            "/orchestrators/:id",
            get(get_orchestrator)
                .patch(update_orchestrator)
                .delete(delete_orchestrator),
        )
        .route("/orchestrators/:id/insights", get(get_insights))
        .route("/orchestrators/:id/insights/counts", get(get_insight_counts))
        .route("/orchestrators/:id/inject", post(inject_command))
        .route("/orchestrators/:id/pause", post(pause_orchestrator))
        .route("/orchestrators/:id/resume", post(resume_orchestrator))
        // Monitoring routes
        .route("/orchestrators/:id/monitoring/start", post(start_monitoring))
        .route("/orchestrators/:id/monitoring/stop", post(stop_monitoring))
        .route("/orchestrators/:id/monitoring/status", get(get_monitoring_status))
        .route("/orchestrators/:id/stalled-sessions", get(get_stalled_sessions))
        // Insight routes
        .route("/insights/:insight_id", get(get_insight).delete(delete_insight))
        .route("/insights/:insight_id/resolve", post(resolve_insight))
        .route("/insights/cleanup", post(cleanup_insights))
        .route("/sessions/:session_id/insights/resolve", post(resolve_session_insights))
}

#[derive(Debug, Serialize)]
pub struct OrchestratorResponse {
    pub id: String,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub session_id: Option<String>,
    pub orchestrator_type: String,
    pub status: String,
    pub monitoring_interval_secs: i32,
    pub stall_threshold_secs: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

/// List orchestrators
pub async fn list_orchestrators(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<Vec<OrchestratorResponse>>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let orchestrators = state
        .db
        .list_orchestrators(user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let orchestrators: Vec<OrchestratorResponse> = orchestrators
        .into_iter()
        .map(|o| OrchestratorResponse {
            id: o.id,
            user_id: o.user_id,
            folder_id: o.folder_id,
            session_id: o.session_id,
            orchestrator_type: o.orchestrator_type,
            status: o.status,
            monitoring_interval_secs: o.monitoring_interval_secs,
            stall_threshold_secs: o.stall_threshold_secs,
            created_at: o.created_at,
            updated_at: o.updated_at,
        })
        .collect();

    Ok(Json(orchestrators))
}

#[derive(Debug, Deserialize)]
pub struct CreateOrchestratorRequest {
    pub folder_id: Option<String>,
    pub session_id: Option<String>,
    pub orchestrator_type: String,
    pub monitoring_interval_secs: Option<i32>,
    pub stall_threshold_secs: Option<i32>,
}

/// Create a new orchestrator
pub async fn create_orchestrator(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<CreateOrchestratorRequest>,
) -> Result<(StatusCode, Json<OrchestratorResponse>), (StatusCode, String)> {
    let user_id = auth.user_id();

    let orchestrator_id = uuid::Uuid::new_v4().to_string();

    state
        .db
        .create_orchestrator_simple(
            &orchestrator_id,
            user_id,
            req.folder_id.as_deref(),
            req.session_id.as_deref(),
            &req.orchestrator_type,
            req.monitoring_interval_secs.unwrap_or(30),
            req.stall_threshold_secs.unwrap_or(300),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let orchestrator = state
        .db
        .get_orchestrator(&orchestrator_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    Ok((
        StatusCode::CREATED,
        Json(OrchestratorResponse {
            id: orchestrator.id,
            user_id: orchestrator.user_id,
            folder_id: orchestrator.folder_id,
            session_id: orchestrator.session_id,
            orchestrator_type: orchestrator.orchestrator_type,
            status: orchestrator.status,
            monitoring_interval_secs: orchestrator.monitoring_interval_secs,
            stall_threshold_secs: orchestrator.stall_threshold_secs,
            created_at: orchestrator.created_at,
            updated_at: orchestrator.updated_at,
        }),
    ))
}

/// Get an orchestrator by ID
pub async fn get_orchestrator(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<OrchestratorResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    // Verify ownership
    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    Ok(Json(OrchestratorResponse {
        id: orchestrator.id,
        user_id: orchestrator.user_id,
        folder_id: orchestrator.folder_id,
        session_id: orchestrator.session_id,
        orchestrator_type: orchestrator.orchestrator_type,
        status: orchestrator.status,
        monitoring_interval_secs: orchestrator.monitoring_interval_secs,
        stall_threshold_secs: orchestrator.stall_threshold_secs,
        created_at: orchestrator.created_at,
        updated_at: orchestrator.updated_at,
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateOrchestratorRequest {
    pub monitoring_interval_secs: Option<i32>,
    pub stall_threshold_secs: Option<i32>,
}

/// Update an orchestrator
pub async fn update_orchestrator(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(req): Json<UpdateOrchestratorRequest>,
) -> Result<Json<OrchestratorResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Update orchestrator
    if let Some(interval) = req.monitoring_interval_secs {
        state
            .db
            .update_orchestrator_interval(&id, interval)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    if let Some(threshold) = req.stall_threshold_secs {
        state
            .db
            .update_orchestrator_threshold(&id, threshold)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    // Fetch updated orchestrator
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    Ok(Json(OrchestratorResponse {
        id: orchestrator.id,
        user_id: orchestrator.user_id,
        folder_id: orchestrator.folder_id,
        session_id: orchestrator.session_id,
        orchestrator_type: orchestrator.orchestrator_type,
        status: orchestrator.status,
        monitoring_interval_secs: orchestrator.monitoring_interval_secs,
        stall_threshold_secs: orchestrator.stall_threshold_secs,
        created_at: orchestrator.created_at,
        updated_at: orchestrator.updated_at,
    }))
}

/// Delete an orchestrator
pub async fn delete_orchestrator(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Delete orchestrator
    state
        .db
        .delete_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Pause an orchestrator
pub async fn pause_orchestrator(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<OrchestratorResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Update status
    state
        .db
        .update_orchestrator_status(&id, "paused")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch updated orchestrator
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    Ok(Json(OrchestratorResponse {
        id: orchestrator.id,
        user_id: orchestrator.user_id,
        folder_id: orchestrator.folder_id,
        session_id: orchestrator.session_id,
        orchestrator_type: orchestrator.orchestrator_type,
        status: orchestrator.status,
        monitoring_interval_secs: orchestrator.monitoring_interval_secs,
        stall_threshold_secs: orchestrator.stall_threshold_secs,
        created_at: orchestrator.created_at,
        updated_at: orchestrator.updated_at,
    }))
}

/// Resume an orchestrator
pub async fn resume_orchestrator(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<OrchestratorResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Update status
    state
        .db
        .update_orchestrator_status(&id, "active")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch updated orchestrator
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    Ok(Json(OrchestratorResponse {
        id: orchestrator.id,
        user_id: orchestrator.user_id,
        folder_id: orchestrator.folder_id,
        session_id: orchestrator.session_id,
        orchestrator_type: orchestrator.orchestrator_type,
        status: orchestrator.status,
        monitoring_interval_secs: orchestrator.monitoring_interval_secs,
        stall_threshold_secs: orchestrator.stall_threshold_secs,
        created_at: orchestrator.created_at,
        updated_at: orchestrator.updated_at,
    }))
}

#[derive(Debug, Deserialize)]
pub struct InsightsQuery {
    pub resolved: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct InsightResponse {
    pub id: String,
    pub orchestrator_id: String,
    pub session_id: Option<String>,
    pub insight_type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub context: Option<String>,
    pub suggested_actions: Option<String>,
    pub resolved: bool,
    pub resolved_at: Option<i64>,
    pub resolved_by: Option<String>,
    pub created_at: i64,
}

/// Get insights for an orchestrator
pub async fn get_insights(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Query(query): Query<InsightsQuery>,
) -> Result<Json<Vec<InsightResponse>>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Get insights
    let insights = state
        .db
        .list_insights(&id, query.resolved)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let insights: Vec<InsightResponse> = insights
        .into_iter()
        .map(|i| InsightResponse {
            id: i.id,
            orchestrator_id: i.orchestrator_id,
            session_id: i.session_id,
            insight_type: i.insight_type,
            severity: i.severity,
            title: i.title,
            description: i.description,
            context: i.context,
            suggested_actions: i.suggested_actions,
            resolved: i.resolved,
            resolved_at: i.resolved_at,
            resolved_by: i.resolved_by,
            created_at: i.created_at,
        })
        .collect();

    Ok(Json(insights))
}

#[derive(Debug, Deserialize)]
pub struct InjectCommandRequest {
    pub session_id: String,
    pub command: String,
}

/// Inject a command into a session
pub async fn inject_command(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(req): Json<InjectCommandRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Get session and verify ownership
    let session = state
        .db
        .get_session(&req.session_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    if session.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Validate command for dangerous patterns
    let dangerous_patterns = [
        "rm -rf /",
        ":(){ :|:& };:",
        "> /dev/sda",
        "dd if=/dev/zero",
        "mkfs.",
        "chmod -R 777 /",
        "> /dev/null &",
        "wget.*|.*sh",
    ];

    let command_lower = req.command.to_lowercase();
    for pattern in dangerous_patterns {
        if command_lower.contains(pattern) {
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Command contains dangerous pattern: {}", pattern),
            ));
        }
    }

    // Send command to tmux session
    tmux::send_keys(&session.tmux_session_name, &req.command, true)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Log the injection (audit trail)
    state
        .db
        .create_audit_log(&id, &req.session_id, "command_injection", &req.command)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::ACCEPTED)
}

// ─────────────────────────────────────────────────────────────────────────────
// Monitoring Routes
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StartMonitoringRequest {
    pub interval_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct MonitoringStatusResponse {
    pub is_active: bool,
    pub orchestrator_id: String,
}

/// Start monitoring for an orchestrator
pub async fn start_monitoring(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(req): Json<StartMonitoringRequest>,
) -> Result<Json<MonitoringStatusResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Default interval: use orchestrator's configured interval, or 60 seconds
    let interval_ms = req.interval_ms.unwrap_or_else(|| {
        (orchestrator.monitoring_interval_secs as u64) * 1000
    });

    // Start monitoring
    state
        .monitoring
        .clone()
        .start_stall_checking(id.clone(), user_id.to_string(), interval_ms)
        .await;

    Ok(Json(MonitoringStatusResponse {
        is_active: true,
        orchestrator_id: id,
    }))
}

/// Stop monitoring for an orchestrator
pub async fn stop_monitoring(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<MonitoringStatusResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Stop monitoring
    state.monitoring.stop_stall_checking(&id).await;

    Ok(Json(MonitoringStatusResponse {
        is_active: false,
        orchestrator_id: id,
    }))
}

/// Get monitoring status for an orchestrator
pub async fn get_monitoring_status(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<MonitoringStatusResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    let is_active = state.monitoring.is_stall_checking_active(&id).await;

    Ok(Json(MonitoringStatusResponse {
        is_active,
        orchestrator_id: id,
    }))
}

#[derive(Debug, Serialize)]
pub struct StalledSessionResponse {
    pub session_id: String,
    pub session_name: String,
    pub tmux_session_name: String,
    pub folder_id: Option<String>,
    pub last_activity_at: Option<i64>,
    pub stalled_minutes: i32,
}

#[derive(Debug, Serialize)]
pub struct StalledSessionsResponse {
    pub orchestrator_id: String,
    pub stalled_sessions: Vec<StalledSessionResponse>,
    pub checked_at: i64,
}

/// Get stalled sessions for an orchestrator
pub async fn get_stalled_sessions(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<StalledSessionsResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Check for stalled sessions
    let result = state
        .monitoring
        .check_for_stalled_sessions(&id, user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let stalled_sessions: Vec<StalledSessionResponse> = result
        .stalled_sessions
        .into_iter()
        .map(|s| StalledSessionResponse {
            session_id: s.session_id,
            session_name: s.session_name,
            tmux_session_name: s.tmux_session_name,
            folder_id: s.folder_id,
            last_activity_at: s.last_activity_at,
            stalled_minutes: s.stalled_minutes,
        })
        .collect();

    Ok(Json(StalledSessionsResponse {
        orchestrator_id: id,
        stalled_sessions,
        checked_at: result.checked_at,
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Insight Routes
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct InsightCountsResponse {
    pub total: u32,
    pub unresolved: u32,
    pub critical: u32,
    pub high: u32,
    pub medium: u32,
    pub low: u32,
}

/// Get insight counts for an orchestrator
pub async fn get_insight_counts(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<InsightCountsResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get orchestrator and verify ownership
    let orchestrator = state
        .db
        .get_orchestrator(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Get counts
    let counts = state
        .insights
        .get_insight_counts(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(InsightCountsResponse {
        total: counts.total,
        unresolved: counts.unresolved,
        critical: counts.critical,
        high: counts.high,
        medium: counts.medium,
        low: counts.low,
    }))
}

/// Get a single insight by ID
pub async fn get_insight(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(insight_id): Path<String>,
) -> Result<Json<InsightResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get insight
    let insight = state
        .insights
        .get_insight(&insight_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or((StatusCode::NOT_FOUND, "Insight not found".to_string()))?;

    // Verify ownership via orchestrator
    let orchestrator = state
        .db
        .get_orchestrator(&insight.orchestrator_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    Ok(Json(InsightResponse {
        id: insight.id,
        orchestrator_id: insight.orchestrator_id,
        session_id: insight.session_id,
        insight_type: insight.insight_type,
        severity: insight.severity,
        title: insight.title,
        description: insight.description,
        context: insight.context,
        suggested_actions: insight.suggested_actions,
        resolved: insight.resolved,
        resolved_at: insight.resolved_at,
        resolved_by: insight.resolved_by,
        created_at: insight.created_at,
    }))
}

#[derive(Debug, Deserialize)]
pub struct ResolveInsightRequest {
    pub resolved_by: Option<String>,
}

/// Resolve an insight
pub async fn resolve_insight(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(insight_id): Path<String>,
    Json(req): Json<ResolveInsightRequest>,
) -> Result<Json<InsightResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get insight first to verify ownership
    let insight = state
        .insights
        .get_insight(&insight_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or((StatusCode::NOT_FOUND, "Insight not found".to_string()))?;

    // Verify ownership via orchestrator
    let orchestrator = state
        .db
        .get_orchestrator(&insight.orchestrator_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Resolve the insight
    state
        .insights
        .resolve_insight(&insight_id, req.resolved_by.as_deref())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Get updated insight
    let insight = state
        .insights
        .get_insight(&insight_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or((StatusCode::NOT_FOUND, "Insight not found".to_string()))?;

    Ok(Json(InsightResponse {
        id: insight.id,
        orchestrator_id: insight.orchestrator_id,
        session_id: insight.session_id,
        insight_type: insight.insight_type,
        severity: insight.severity,
        title: insight.title,
        description: insight.description,
        context: insight.context,
        suggested_actions: insight.suggested_actions,
        resolved: insight.resolved,
        resolved_at: insight.resolved_at,
        resolved_by: insight.resolved_by,
        created_at: insight.created_at,
    }))
}

/// Delete an insight
pub async fn delete_insight(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(insight_id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get insight first to verify ownership
    let insight = state
        .insights
        .get_insight(&insight_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
        .ok_or((StatusCode::NOT_FOUND, "Insight not found".to_string()))?;

    // Verify ownership via orchestrator
    let orchestrator = state
        .db
        .get_orchestrator(&insight.orchestrator_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Orchestrator not found".to_string()))?;

    if orchestrator.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Delete the insight
    state
        .insights
        .delete_insight(&insight_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize)]
pub struct ResolveSessionInsightsResponse {
    pub resolved_count: usize,
}

/// Bulk resolve insights for a session
pub async fn resolve_session_insights(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(session_id): Path<String>,
    Json(req): Json<ResolveInsightRequest>,
) -> Result<Json<ResolveSessionInsightsResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Verify session ownership
    let session = state
        .db
        .get_session(&session_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Session not found".to_string()))?;

    if session.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Resolve all session insights
    let count = state
        .insights
        .resolve_session_insights(&session_id, req.resolved_by.as_deref())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(ResolveSessionInsightsResponse {
        resolved_count: count,
    }))
}

#[derive(Debug, Deserialize)]
pub struct CleanupInsightsRequest {
    pub max_age_secs: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CleanupInsightsResponse {
    pub deleted_count: usize,
}

/// Cleanup old resolved insights
pub async fn cleanup_insights(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Json(req): Json<CleanupInsightsRequest>,
) -> Result<Json<CleanupInsightsResponse>, (StatusCode, String)> {
    // Default: 30 days
    let max_age_secs = req.max_age_secs.unwrap_or(30 * 24 * 60 * 60);

    let count = state
        .insights
        .cleanup_old_insights(max_age_secs)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(CleanupInsightsResponse {
        deleted_count: count,
    }))
}
