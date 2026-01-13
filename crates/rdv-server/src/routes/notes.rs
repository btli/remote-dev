//! SDK Notes routes.
//!
//! Provides REST API endpoints for the note-taking service:
//! - GET/POST /sdk/notes - List and create notes
//! - GET/PATCH/DELETE /sdk/notes/{id} - Single note operations
//!
//! Notes support folder inheritance - when querying a subfolder,
//! notes from all ancestor folders are included by default.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Extension, Json, Router,
};
use rdv_core::types::{NewNote, Note, NoteFilter, NoteType, UpdateNote};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::state::AppState;

/// Create notes router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/sdk/notes", get(list_notes).post(create_note))
        .route(
            "/sdk/notes/{id}",
            get(get_note).patch(update_note).delete(delete_note),
        )
        .route("/sdk/notes/search", get(search_notes))
}

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNotesQuery {
    pub folder_id: Option<String>,
    pub session_id: Option<String>,
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    pub tag: Option<String>,
    pub search: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub limit: Option<usize>,
    /// Enable folder inheritance (default: true)
    pub inherit: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteRequest {
    pub session_id: Option<String>,
    pub folder_id: Option<String>,
    #[serde(rename = "type", default)]
    pub note_type: String,
    pub title: Option<String>,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub context: Option<serde_json::Value>,
    #[serde(default = "default_priority")]
    pub priority: f64,
    #[serde(default)]
    pub pinned: bool,
}

fn default_priority() -> f64 {
    0.5
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteRequest {
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    pub title: Option<String>,
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub context: Option<serde_json::Value>,
    pub priority: Option<f64>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchNotesQuery {
    pub query: String,
    pub folder_id: Option<String>,
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteResponse {
    pub id: String,
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
    #[serde(rename = "type")]
    pub note_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub content: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
    pub priority: f64,
    pub pinned: bool,
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    /// Whether this note is inherited from an ancestor folder
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub inherited: bool,
}

impl NoteResponse {
    fn from_note(note: Note, inherited: bool) -> Self {
        let tags: Vec<String> = serde_json::from_str(&note.tags_json).unwrap_or_default();
        let context: Option<serde_json::Value> = serde_json::from_str(&note.context_json).ok();

        Self {
            id: note.id,
            user_id: note.user_id,
            session_id: note.session_id,
            folder_id: note.folder_id,
            note_type: note.note_type.to_string(),
            title: note.title,
            content: note.content,
            tags,
            context,
            priority: note.priority,
            pinned: note.pinned,
            archived: note.archived,
            created_at: note.created_at,
            updated_at: note.updated_at,
            inherited,
        }
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// POST /sdk/notes - Create a new note
pub async fn create_note(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<CreateNoteRequest>,
) -> Result<(StatusCode, Json<NoteResponse>), (StatusCode, Json<serde_json::Value>)> {
    // Validate note type
    let note_type = parse_note_type(&req.note_type).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        )
    })?;

    // Validate priority
    if req.priority < 0.0 || req.priority > 1.0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "priority must be between 0.0 and 1.0" })),
        ));
    }

    let new_note = NewNote {
        user_id: auth.user_id().to_string(),
        session_id: req.session_id,
        folder_id: req.folder_id,
        note_type,
        title: req.title,
        content: req.content,
        tags: req.tags,
        context: req.context,
        priority: req.priority,
    };

    // Create the note
    let id = state.db.create_note(&new_note).map_err(|e| {
        tracing::error!("Failed to create note: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Failed to create note" })),
        )
    })?;

    // Fetch the created note
    let note = state
        .db
        .get_note(&id)
        .map_err(|e| {
            tracing::error!("Failed to fetch created note: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to fetch created note" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Note not found after creation" })),
            )
        })?;

    Ok((StatusCode::CREATED, Json(NoteResponse::from_note(note, false))))
}

/// GET /sdk/notes - List notes with optional filtering
pub async fn list_notes(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListNotesQuery>,
) -> Result<Json<Vec<NoteResponse>>, (StatusCode, Json<serde_json::Value>)> {
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

    // Parse note type if provided
    let note_type = if let Some(ref t) = query.note_type {
        Some(parse_note_type(t).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": e })),
            )
        })?)
    } else {
        None
    };

    // Build filter and fetch notes
    // Note: We need to handle inheritance by fetching for each folder
    let mut all_notes = Vec::new();

    if folder_ids.is_empty() && query.folder_id.is_none() {
        // No folder filter - get all user notes
        let filter = NoteFilter {
            user_id: auth.user_id().to_string(),
            session_id: query.session_id.clone(),
            folder_id: None,
            note_type,
            archived: query.archived,
            pinned: query.pinned,
            limit: query.limit,
        };

        let notes = state.db.list_notes_filtered(&filter).map_err(|e| {
            tracing::error!("Failed to list notes: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to list notes" })),
            )
        })?;

        all_notes.extend(notes.into_iter().map(|n| (n, false)));
    } else if !folder_ids.is_empty() {
        // Fetch notes from each folder in the hierarchy
        for folder_id in &folder_ids {
            let filter = NoteFilter {
                user_id: auth.user_id().to_string(),
                session_id: query.session_id.clone(),
                folder_id: Some(folder_id.clone()),
                note_type,
                archived: query.archived,
                pinned: query.pinned,
                limit: None, // We'll apply limit after merging
            };

            let notes = state.db.list_notes_filtered(&filter).map_err(|e| {
                tracing::error!("Failed to list notes for folder {}: {}", folder_id, e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({ "error": "Failed to list notes" })),
                )
            })?;

            let inherited = requested_folder_id.as_ref() != Some(folder_id);
            all_notes.extend(notes.into_iter().map(|n| (n, inherited)));
        }

        // Also include user-level notes (no folder)
        let filter = NoteFilter {
            user_id: auth.user_id().to_string(),
            session_id: query.session_id.clone(),
            folder_id: None,
            note_type,
            archived: query.archived,
            pinned: query.pinned,
            limit: None,
        };

        // For user-level notes, we need to query where folder_id IS NULL
        // The current filter doesn't support this, so we'll handle it specially
        // For now, skip this - TODO: Add proper support
    }

    // Apply tag filter if provided
    if let Some(ref tag) = query.tag {
        all_notes.retain(|(note, _)| {
            let tags: Vec<String> = serde_json::from_str(&note.tags_json).unwrap_or_default();
            tags.iter().any(|t| t.eq_ignore_ascii_case(tag))
        });
    }

    // Apply search filter if provided
    if let Some(ref search) = query.search {
        let search_lower = search.to_lowercase();
        all_notes.retain(|(note, _)| note.content.to_lowercase().contains(&search_lower));
    }

    // Sort notes
    let sort_by = query.sort_by.as_deref().unwrap_or("createdAt");
    let sort_desc = query.sort_order.as_deref() != Some("asc");

    all_notes.sort_by(|(a, _), (b, _)| {
        let cmp = match sort_by {
            "updatedAt" => a.updated_at.cmp(&b.updated_at),
            "priority" => a.priority.partial_cmp(&b.priority).unwrap_or(std::cmp::Ordering::Equal),
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
    all_notes.truncate(limit);

    // Convert to response
    let response: Vec<NoteResponse> = all_notes
        .into_iter()
        .map(|(note, inherited)| NoteResponse::from_note(note, inherited))
        .collect();

    Ok(Json(response))
}

/// GET /sdk/notes/{id} - Get a single note
pub async fn get_note(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<NoteResponse>, (StatusCode, Json<serde_json::Value>)> {
    let note = state
        .db
        .get_note(&id)
        .map_err(|e| {
            tracing::error!("Failed to get note: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to get note" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Note not found" })),
            )
        })?;

    // Verify ownership
    if note.user_id != auth.user_id() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Note not found" })),
        ));
    }

    Ok(Json(NoteResponse::from_note(note, false)))
}

/// PATCH /sdk/notes/{id} - Update a note
pub async fn update_note(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(req): Json<UpdateNoteRequest>,
) -> Result<Json<NoteResponse>, (StatusCode, Json<serde_json::Value>)> {
    // First verify the note exists and belongs to user
    let existing = state
        .db
        .get_note(&id)
        .map_err(|e| {
            tracing::error!("Failed to get note: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to get note" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Note not found" })),
            )
        })?;

    if existing.user_id != auth.user_id() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Note not found" })),
        ));
    }

    // Parse note type if provided
    let note_type = if let Some(ref t) = req.note_type {
        Some(parse_note_type(t).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": e })),
            )
        })?)
    } else {
        None
    };

    // Validate priority if provided
    if let Some(p) = req.priority {
        if p < 0.0 || p > 1.0 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "priority must be between 0.0 and 1.0" })),
            ));
        }
    }

    let update = UpdateNote {
        note_type,
        title: req.title,
        content: req.content,
        tags: req.tags,
        context: req.context,
        priority: req.priority,
        pinned: req.pinned,
        archived: req.archived,
    };

    state.db.update_note(&id, &update).map_err(|e| {
        tracing::error!("Failed to update note: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Failed to update note" })),
        )
    })?;

    // Fetch updated note
    let note = state
        .db
        .get_note(&id)
        .map_err(|e| {
            tracing::error!("Failed to fetch updated note: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to fetch updated note" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Note not found after update" })),
            )
        })?;

    Ok(Json(NoteResponse::from_note(note, false)))
}

/// DELETE /sdk/notes/{id} - Delete a note
pub async fn delete_note(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    // First verify the note exists and belongs to user
    let existing = state
        .db
        .get_note(&id)
        .map_err(|e| {
            tracing::error!("Failed to get note: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to get note" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({ "error": "Note not found" })),
            )
        })?;

    if existing.user_id != auth.user_id() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Note not found" })),
        ));
    }

    state.db.delete_note(&id).map_err(|e| {
        tracing::error!("Failed to delete note: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": "Failed to delete note" })),
        )
    })?;

    Ok(Json(serde_json::json!({ "success": true })))
}

/// GET /sdk/notes/search - Search notes by content
pub async fn search_notes(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<SearchNotesQuery>,
) -> Result<Json<Vec<NoteResponse>>, (StatusCode, Json<serde_json::Value>)> {
    let limit = query.limit.unwrap_or(50);

    let notes = state
        .db
        .search_notes_by_content(auth.user_id(), &query.query, Some(limit))
        .map_err(|e| {
            tracing::error!("Failed to search notes: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": "Failed to search notes" })),
            )
        })?;

    // Apply additional filters
    let mut filtered: Vec<Note> = notes;

    if let Some(ref folder_id) = query.folder_id {
        filtered.retain(|n| n.folder_id.as_ref() == Some(folder_id));
    }

    if let Some(ref note_type_str) = query.note_type {
        if let Ok(note_type) = parse_note_type(note_type_str) {
            filtered.retain(|n| n.note_type == note_type);
        }
    }

    let response: Vec<NoteResponse> = filtered
        .into_iter()
        .map(|n| NoteResponse::from_note(n, false))
        .collect();

    Ok(Json(response))
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse note type string to enum
fn parse_note_type(s: &str) -> Result<NoteType, String> {
    match s.to_lowercase().as_str() {
        "observation" | "" => Ok(NoteType::Observation),
        "decision" => Ok(NoteType::Decision),
        "gotcha" => Ok(NoteType::Gotcha),
        "pattern" => Ok(NoteType::Pattern),
        "question" => Ok(NoteType::Question),
        "todo" => Ok(NoteType::Todo),
        "reference" => Ok(NoteType::Reference),
        _ => Err(format!(
            "Invalid type. Must be one of: observation, decision, gotcha, pattern, question, todo, reference"
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
