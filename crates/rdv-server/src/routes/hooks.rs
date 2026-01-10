//! Agent hooks management routes.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Extension, Json, Router,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::state::AppState;

/// Create hooks router
pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/folders/:id/hooks", get(get_hooks_status))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatusResponse {
    pub folder_id: String,
    pub folder_name: String,
    pub project_path: Option<String>,
    pub hooks: Option<HooksStatus>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    pub claude: bool,
    pub codex: bool,
    pub gemini: bool,
    pub opencode: bool,
}

/// Check if hooks are installed for an agent provider
fn check_hooks_installed(provider: &str, project_path: &str) -> bool {
    let path = PathBuf::from(project_path);

    match provider {
        "claude" => {
            let config_path = path.join(".claude").join("settings.local.json");
            if !config_path.exists() {
                return false;
            }
            match std::fs::read_to_string(&config_path) {
                Ok(content) => content.contains("orchestrators/agent-event"),
                Err(_) => false,
            }
        }
        "gemini" => {
            let config_path = path.join(".gemini").join("settings.json");
            if !config_path.exists() {
                return false;
            }
            match std::fs::read_to_string(&config_path) {
                Ok(content) => content.contains("orchestrators/agent-event"),
                Err(_) => false,
            }
        }
        "codex" => {
            let script_path = path.join(".codex").join("orchestrator-notify.py");
            script_path.exists()
        }
        "opencode" => {
            let plugin_path = path
                .join(".opencode")
                .join("plugin")
                .join("orchestrator-notifier.ts");
            plugin_path.exists()
        }
        _ => false,
    }
}

/// GET /api/folders/:id/hooks - Check hook installation status
pub async fn get_hooks_status(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(folder_id): Path<String>,
) -> Result<Json<HooksStatusResponse>, (StatusCode, String)> {
    let user_id = auth.user_id();

    // Get folder
    let folder = state
        .db
        .get_folder(&folder_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    // Verify ownership
    if folder.user_id != user_id {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Get project path from folder's sessions
    let sessions = state
        .db
        .list_sessions(user_id, None)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let project_path = sessions
        .iter()
        .filter(|s| s.folder_id.as_deref() == Some(&folder_id))
        .find_map(|s| s.project_path.clone());

    match project_path {
        None => Ok(Json(HooksStatusResponse {
            folder_id,
            folder_name: folder.name,
            project_path: None,
            hooks: None,
            message: Some("No project path found for this folder".to_string()),
        })),
        Some(path) => {
            let hooks = HooksStatus {
                claude: check_hooks_installed("claude", &path),
                codex: check_hooks_installed("codex", &path),
                gemini: check_hooks_installed("gemini", &path),
                opencode: check_hooks_installed("opencode", &path),
            };

            Ok(Json(HooksStatusResponse {
                folder_id,
                folder_name: folder.name,
                project_path: Some(path),
                hooks: Some(hooks),
                message: None,
            }))
        }
    }
}
