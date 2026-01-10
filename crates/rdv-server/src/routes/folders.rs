//! Folder management routes.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
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
            "/folders/:id",
            get(get_folder).patch(update_folder).delete(delete_folder),
        )
        .route("/folders/:id/children", get(get_children))
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
