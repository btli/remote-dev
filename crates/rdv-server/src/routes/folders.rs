//! Folder management routes.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use rdv_core::tmux;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::state::AppState;

/// Create folder router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/folders", get(list_folders).post(create_folder))
        .route("/folders/reorder", post(reorder_folders))
        .route(
            "/folders/{id}",
            get(get_folder).patch(update_folder).delete(delete_folder),
        )
        .route("/folders/{id}/children", get(get_children))
        // Folder orchestrator routes
        .route(
            "/folders/{id}/orchestrator",
            get(get_folder_orchestrator)
                .post(create_folder_orchestrator)
                .delete(delete_folder_orchestrator),
        )
}

#[derive(Debug, Serialize)]
pub struct FolderResponse {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

/// List folders
pub async fn list_folders(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<Vec<FolderResponse>>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let folders = state
        .db
        .list_folders(user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let folders: Vec<FolderResponse> = folders
        .into_iter()
        .map(|f| FolderResponse {
            id: f.id,
            name: f.name,
            path: f.path,
            parent_id: f.parent_id,
            color: f.color,
            icon: f.icon,
            sort_order: f.sort_order,
            created_at: f.created_at,
            updated_at: f.updated_at,
        })
        .collect();

    Ok(Json(folders))
}

#[derive(Debug, Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
    pub path: Option<String>,
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

/// Create a new folder
pub async fn create_folder(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<CreateFolderRequest>,
) -> Result<(StatusCode, Json<FolderResponse>), (StatusCode, String)> {
    let user_id = auth.user_id();

    let folder_id = uuid::Uuid::new_v4().to_string();

    state
        .db
        .create_folder(
            &folder_id,
            user_id,
            &req.name,
            req.path.as_deref(),
            req.parent_id.as_deref(),
            req.color.as_deref(),
            req.icon.as_deref(),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let folder = state
        .db
        .get_folder(&folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    Ok((
        StatusCode::CREATED,
        Json(FolderResponse {
            id: folder.id,
            name: folder.name,
            path: folder.path,
            parent_id: folder.parent_id,
            color: folder.color,
            icon: folder.icon,
            sort_order: folder.sort_order,
            created_at: folder.created_at,
            updated_at: folder.updated_at,
        }),
    ))
}

/// Get a folder by ID
pub async fn get_folder(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<FolderResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let folder = state
        .db
        .get_folder(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    // Verify ownership
    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    Ok(Json(FolderResponse {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        parent_id: folder.parent_id,
        color: folder.color,
        icon: folder.icon,
        sort_order: folder.sort_order,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateFolderRequest {
    pub name: Option<String>,
    pub path: Option<String>,
    pub parent_id: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
}

/// Update a folder
pub async fn update_folder(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(req): Json<UpdateFolderRequest>,
) -> Result<Json<FolderResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get folder and verify ownership
    let folder = state
        .db
        .get_folder(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Update folder
    state
        .db
        .update_folder(
            &id,
            req.name.as_deref(),
            req.path.as_deref(),
            req.parent_id.as_deref(),
            req.color.as_deref(),
            req.icon.as_deref(),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch updated folder
    let folder = state
        .db
        .get_folder(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    Ok(Json(FolderResponse {
        id: folder.id,
        name: folder.name,
        path: folder.path,
        parent_id: folder.parent_id,
        color: folder.color,
        icon: folder.icon,
        sort_order: folder.sort_order,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
    }))
}

/// Delete a folder
pub async fn delete_folder(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get folder and verify ownership
    let folder = state
        .db
        .get_folder(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Delete folder
    state
        .db
        .delete_folder(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Get child folders
pub async fn get_children(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<Vec<FolderResponse>>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Verify parent folder exists and belongs to user
    let folder = state
        .db
        .get_folder(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Get child folders
    let children = state
        .db
        .get_child_folders(&id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let children: Vec<FolderResponse> = children
        .into_iter()
        .map(|f| FolderResponse {
            id: f.id,
            name: f.name,
            path: f.path,
            parent_id: f.parent_id,
            color: f.color,
            icon: f.icon,
            sort_order: f.sort_order,
            created_at: f.created_at,
            updated_at: f.updated_at,
        })
        .collect();

    Ok(Json(children))
}

#[derive(Debug, Deserialize)]
pub struct ReorderFoldersRequest {
    pub folder_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct ReorderFoldersResponse {
    pub success: bool,
}

/// Reorder folders (update sort order)
pub async fn reorder_folders(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<ReorderFoldersRequest>,
) -> Result<Json<ReorderFoldersResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    state
        .db
        .reorder_folders(user_id, &req.folder_ids)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;

    Ok(Json(ReorderFoldersResponse { success: true }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder Orchestrator Routes
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct FolderOrchestratorResponse {
    pub id: String,
    pub session_id: Option<String>,
    #[serde(rename = "type")]
    pub orchestrator_type: String,
    pub status: String,
    pub scope_type: Option<String>,
    pub scope_id: Option<String>,
    pub monitoring_interval: i32,
    pub stall_threshold: i32,
    pub auto_intervention: bool,
    pub is_monitoring_active: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Get folder's sub-orchestrator
pub async fn get_folder_orchestrator(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(folder_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Verify folder ownership
    let folder = state
        .db
        .get_folder(&folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Get orchestrator for this folder
    let orchestrator = state
        .db
        .get_folder_orchestrator(user_id, &folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    match orchestrator {
        Some(orch) => {
            let is_active = state.monitoring.is_stall_checking_active(&orch.id).await;
            Ok(Json(serde_json::json!({
                "orchestrator": {
                    "id": orch.id,
                    "sessionId": orch.session_id,
                    "type": orch.orchestrator_type,
                    "status": orch.status,
                    "scopeType": orch.scope_type,
                    "scopeId": orch.scope_id,
                    "monitoringInterval": orch.monitoring_interval,
                    "stallThreshold": orch.stall_threshold,
                    "autoIntervention": orch.auto_intervention,
                    "isMonitoringActive": is_active,
                    "lastActivityAt": orch.last_activity_at,
                    "createdAt": orch.created_at,
                    "updatedAt": orch.updated_at
                }
            })))
        }
        None => Ok(Json(serde_json::json!({ "orchestrator": null }))),
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateFolderOrchestratorRequest {
    pub custom_instructions: Option<String>,
    pub monitoring_interval: Option<i32>,
    pub stall_threshold: Option<i32>,
    pub auto_intervention: Option<bool>,
    pub start_monitoring: Option<bool>,
}

/// Create or get folder sub-orchestrator
pub async fn create_folder_orchestrator(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(folder_id): Path<String>,
    Json(req): Json<CreateFolderOrchestratorRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, String)> {
    let user_id = auth.user_id();

    // Verify folder ownership
    let folder = state
        .db
        .get_folder(&folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Check if orchestrator already exists
    let existing = state
        .db
        .get_folder_orchestrator(user_id, &folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if let Some(orch) = existing {
        let is_active = state.monitoring.is_stall_checking_active(&orch.id).await;
        return Ok((
            StatusCode::OK,
            Json(serde_json::json!({
                "orchestrator": {
                    "id": orch.id,
                    "sessionId": orch.session_id,
                    "type": orch.orchestrator_type,
                    "status": orch.status,
                    "scopeType": orch.scope_type,
                    "scopeId": orch.scope_id,
                    "monitoringInterval": orch.monitoring_interval,
                    "stallThreshold": orch.stall_threshold,
                    "autoIntervention": orch.auto_intervention,
                    "isMonitoringActive": is_active,
                    "lastActivityAt": orch.last_activity_at,
                    "createdAt": orch.created_at,
                    "updatedAt": orch.updated_at
                },
                "created": false,
                "sessionId": orch.session_id
            })),
        ));
    }

    // Create the orchestrator session (terminal session for the orchestrator)
    let session_id = uuid::Uuid::new_v4().to_string();
    let tmux_session_name = format!("rdv-orch-{}", &session_id[..8]);
    let orchestrator_session_name = format!("{} Control", folder.name);

    // Create tmux session
    let config = tmux::CreateSessionConfig {
        session_name: tmux_session_name.clone(),
        working_directory: folder.path.clone(),
        command: None,
        auto_respawn: false,
        env: None,
    };
    tmux::create_session(&config)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Create terminal session record
    let session = rdv_core::db::NewSession {
        user_id: user_id.to_string(),
        name: orchestrator_session_name,
        tmux_session_name: tmux_session_name.clone(),
        project_path: folder.path.clone(),
        folder_id: Some(folder_id.clone()),
        worktree_branch: None,
        agent_provider: Some("claude".to_string()), // Default to Claude for orchestrators
        is_orchestrator_session: true,
    };

    let created_session_id = state
        .db
        .create_session(&session)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Create orchestrator
    let orchestrator_id = uuid::Uuid::new_v4().to_string();
    let monitoring_interval = req.monitoring_interval.unwrap_or(30);
    let stall_threshold = req.stall_threshold.unwrap_or(300);

    state
        .db
        .create_orchestrator_simple(
            &orchestrator_id,
            user_id,
            Some(&folder_id),
            Some(&created_session_id),
            "sub_orchestrator",
            monitoring_interval,
            stall_threshold,
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Start monitoring if requested (default: true)
    if req.start_monitoring.unwrap_or(true) {
        let interval_ms = (monitoring_interval as u64) * 1000;
        state
            .monitoring
            .clone()
            .start_stall_checking(orchestrator_id.clone(), user_id.to_string(), interval_ms)
            .await;
    }

    // Get the created orchestrator
    let orch = state
        .db
        .get_folder_orchestrator(user_id, &folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to retrieve created orchestrator".to_string(),
        ))?;

    let is_active = state.monitoring.is_stall_checking_active(&orch.id).await;

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "orchestrator": {
                "id": orch.id,
                "sessionId": orch.session_id,
                "type": orch.orchestrator_type,
                "status": orch.status,
                "scopeType": orch.scope_type,
                "scopeId": orch.scope_id,
                "monitoringInterval": orch.monitoring_interval,
                "stallThreshold": orch.stall_threshold,
                "autoIntervention": orch.auto_intervention,
                "isMonitoringActive": is_active,
                "lastActivityAt": orch.last_activity_at,
                "createdAt": orch.created_at,
                "updatedAt": orch.updated_at
            },
            "created": true,
            "sessionId": created_session_id
        })),
    ))
}

/// Delete folder's sub-orchestrator
pub async fn delete_folder_orchestrator(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(folder_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Verify folder ownership
    let folder = state
        .db
        .get_folder(&folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Get orchestrator for this folder
    let orchestrator = state
        .db
        .get_folder_orchestrator(user_id, &folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            StatusCode::NOT_FOUND,
            "Folder orchestrator not found".to_string(),
        ))?;

    // Stop monitoring
    state.monitoring.stop_stall_checking(&orchestrator.id).await;

    // Kill the tmux session if it exists
    if tmux::session_exists(&orchestrator.tmux_session_name).unwrap_or(false) {
        let _ = tmux::kill_session(&orchestrator.tmux_session_name);
    }

    // Close the terminal session
    state
        .db
        .update_session_status(&orchestrator.session_id, "closed")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Delete the orchestrator
    state
        .db
        .delete_orchestrator(&orchestrator.id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true })))
}
