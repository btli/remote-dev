//! Agent profile routes for rdv-server.
//!
//! Provides REST API for managing agent profiles, including:
//! - Profile CRUD operations
//! - Folder-profile linking
//! - Profile git identity
//! - Profile appearance settings
//! - Profile agent configs

use axum::{
    extract::{Path, State},
    routing::get,
    Extension, Json, Router,
};
use rdv_core::types::{
    AgentProfile, AgentProfileConfig, FolderProfileLink, NewAgentProfile,
    NewAgentProfileConfig, NewProfileGitIdentity, ProfileAppearance, ProfileGitIdentity,
    UpdateAgentProfile, UpdateProfileAppearance,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::state::AppState;

// ─────────────────────────────────────────────────────────────────────────────
// Request/Response Types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileListResponse {
    pub profiles: Vec<AgentProfile>,
    pub folder_links: Vec<FolderProfileLink>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProfileRequest {
    pub name: String,
    pub description: Option<String>,
    pub provider: String,
    pub is_default: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProfileRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub provider: Option<String>,
    pub is_default: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkFolderRequest {
    pub profile_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentityRequest {
    pub user_name: String,
    pub user_email: String,
    pub ssh_key_path: Option<String>,
    pub gpg_key_id: Option<String>,
    pub github_username: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceRequest {
    pub appearance_mode: Option<String>,
    pub light_color_scheme: Option<String>,
    pub dark_color_scheme: Option<String>,
    pub terminal_opacity: Option<i32>,
    pub terminal_blur: Option<i32>,
    pub terminal_cursor_style: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigRequest {
    pub config_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessResponse {
    pub success: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const VALID_PROVIDERS: &[&str] = &["claude", "codex", "gemini", "opencode", "all"];
const VALID_APPEARANCE_MODES: &[&str] = &["light", "dark", "system"];
const VALID_CURSOR_STYLES: &[&str] = &["block", "underline", "bar"];
const VALID_AGENT_TYPES: &[&str] = &["claude", "codex", "gemini", "opencode"];

fn validate_provider(provider: &str) -> Result<(), (axum::http::StatusCode, String)> {
    if !VALID_PROVIDERS.contains(&provider) {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            format!("Provider must be one of: {}", VALID_PROVIDERS.join(", ")),
        ));
    }
    Ok(())
}

fn validate_appearance_mode(mode: &str) -> Result<(), (axum::http::StatusCode, String)> {
    if !VALID_APPEARANCE_MODES.contains(&mode) {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            format!(
                "Appearance mode must be one of: {}",
                VALID_APPEARANCE_MODES.join(", ")
            ),
        ));
    }
    Ok(())
}

fn validate_cursor_style(style: &str) -> Result<(), (axum::http::StatusCode, String)> {
    if !VALID_CURSOR_STYLES.contains(&style) {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            format!(
                "Cursor style must be one of: {}",
                VALID_CURSOR_STYLES.join(", ")
            ),
        ));
    }
    Ok(())
}

fn validate_agent_type(agent_type: &str) -> Result<(), (axum::http::StatusCode, String)> {
    if !VALID_AGENT_TYPES.contains(&agent_type) {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            format!(
                "Agent type must be one of: {}",
                VALID_AGENT_TYPES.join(", ")
            ),
        ));
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Routes
// ─────────────────────────────────────────────────────────────────────────────

/// GET /api/profiles - List all profiles for the current user
async fn list_profiles(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<ProfileListResponse>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    let profiles = state
        .db
        .list_profiles(&user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let folder_links = state
        .db
        .get_folder_profile_links(&user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ProfileListResponse {
        profiles,
        folder_links,
    }))
}

/// POST /api/profiles - Create a new profile
async fn create_profile(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<CreateProfileRequest>,
) -> Result<Json<AgentProfile>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Validate provider
    validate_provider(&req.provider)?;

    // Generate config directory
    let profile_id = uuid::Uuid::new_v4().to_string();
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let config_dir = home
        .join(".remote-dev")
        .join("profiles")
        .join(&profile_id)
        .to_string_lossy()
        .to_string();

    let new_profile = NewAgentProfile {
        user_id: user_id.clone(),
        name: req.name,
        description: req.description,
        provider: req.provider,
        config_dir,
        is_default: req.is_default.unwrap_or(false),
    };

    let id = state
        .db
        .create_profile(&new_profile)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch the created profile
    let profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to retrieve created profile".to_string(),
        ))?;

    Ok(Json(profile))
}

/// GET /api/profiles/:id - Get a specific profile
async fn get_profile(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<AgentProfile>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    let profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    Ok(Json(profile))
}

/// PATCH /api/profiles/:id - Update a profile
async fn update_profile(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(req): Json<UpdateProfileRequest>,
) -> Result<Json<AgentProfile>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Validate provider if provided
    if let Some(ref provider) = req.provider {
        validate_provider(provider)?;
    }

    let update = UpdateAgentProfile {
        name: req.name,
        description: req.description,
        provider: req.provider,
        is_default: req.is_default,
    };

    let updated = state
        .db
        .update_profile(&id, &user_id, &update)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !updated {
        return Err((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()));
    }

    // Fetch the updated profile
    let profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to retrieve updated profile".to_string(),
        ))?;

    Ok(Json(profile))
}

/// DELETE /api/profiles/:id - Delete a profile
async fn delete_profile(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<SuccessResponse>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    let deleted = state
        .db
        .delete_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !deleted {
        return Err((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()));
    }

    Ok(Json(SuccessResponse { success: true }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder-Profile Link Routes
// ─────────────────────────────────────────────────────────────────────────────

/// PUT /api/profiles/folders/:folder_id - Link a folder to a profile
async fn link_folder_profile(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(folder_id): Path<String>,
    Json(req): Json<LinkFolderRequest>,
) -> Result<Json<FolderProfileLink>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&req.profile_id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    // Verify folder ownership
    let _folder = state
        .db
        .get_folder(&folder_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Folder not found".to_string()))?;

    let id = state
        .db
        .link_folder_profile(&folder_id, &req.profile_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(FolderProfileLink {
        id,
        folder_id,
        profile_id: req.profile_id,
        created_at: chrono::Utc::now().timestamp_millis(),
    }))
}

/// DELETE /api/profiles/folders/:folder_id - Unlink a folder from its profile
async fn unlink_folder_profile(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(folder_id): Path<String>,
) -> Result<Json<SuccessResponse>, (axum::http::StatusCode, String)> {
    let unlinked = state
        .db
        .unlink_folder_profile(&folder_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !unlinked {
        return Err((axum::http::StatusCode::NOT_FOUND, "Link not found".to_string()));
    }

    Ok(Json(SuccessResponse { success: true }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Git Identity Routes
// ─────────────────────────────────────────────────────────────────────────────

/// GET /api/profiles/:id/git-identity - Get git identity for a profile
async fn get_git_identity(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<Option<ProfileGitIdentity>>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    let identity = state
        .db
        .get_profile_git_identity(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(identity))
}

/// PUT /api/profiles/:id/git-identity - Create or update git identity
async fn upsert_git_identity(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(req): Json<GitIdentityRequest>,
) -> Result<Json<ProfileGitIdentity>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    let identity = NewProfileGitIdentity {
        profile_id: id.clone(),
        user_name: req.user_name,
        user_email: req.user_email,
        ssh_key_path: req.ssh_key_path,
        gpg_key_id: req.gpg_key_id,
        github_username: req.github_username,
    };

    let identity_id = state
        .db
        .upsert_profile_git_identity(&identity)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch the identity
    let result = state
        .db
        .get_profile_git_identity(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to retrieve git identity: {}", identity_id),
        ))?;

    Ok(Json(result))
}

/// DELETE /api/profiles/:id/git-identity - Delete git identity
async fn delete_git_identity(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<SuccessResponse>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    let deleted = state
        .db
        .delete_profile_git_identity(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !deleted {
        return Err((axum::http::StatusCode::NOT_FOUND, "Git identity not found".to_string()));
    }

    Ok(Json(SuccessResponse { success: true }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Appearance Routes
// ─────────────────────────────────────────────────────────────────────────────

/// GET /api/profiles/:id/appearance - Get appearance settings
async fn get_appearance(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<Option<ProfileAppearance>>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    let appearance = state
        .db
        .get_profile_appearance(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(appearance))
}

/// PUT /api/profiles/:id/appearance - Update appearance settings
async fn update_appearance(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(req): Json<AppearanceRequest>,
) -> Result<Json<ProfileAppearance>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    // Validate appearance mode
    if let Some(ref mode) = req.appearance_mode {
        validate_appearance_mode(mode)?;
    }

    // Validate cursor style
    if let Some(ref style) = req.terminal_cursor_style {
        validate_cursor_style(style)?;
    }

    // Validate opacity
    if let Some(opacity) = req.terminal_opacity {
        if !(0..=100).contains(&opacity) {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                "Terminal opacity must be between 0 and 100".to_string(),
            ));
        }
    }

    // Validate blur
    if let Some(blur) = req.terminal_blur {
        if blur < 0 {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                "Terminal blur must be non-negative".to_string(),
            ));
        }
    }

    let update = UpdateProfileAppearance {
        appearance_mode: req.appearance_mode,
        light_color_scheme: req.light_color_scheme,
        dark_color_scheme: req.dark_color_scheme,
        terminal_opacity: req.terminal_opacity,
        terminal_blur: req.terminal_blur,
        terminal_cursor_style: req.terminal_cursor_style,
    };

    let appearance = state
        .db
        .upsert_profile_appearance(&id, &user_id, &update)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(appearance))
}

/// DELETE /api/profiles/:id/appearance - Delete appearance settings
async fn delete_appearance(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<SuccessResponse>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    let deleted = state
        .db
        .delete_profile_appearance(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !deleted {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            "Appearance settings not found".to_string(),
        ));
    }

    Ok(Json(SuccessResponse { success: true }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Config Routes
// ─────────────────────────────────────────────────────────────────────────────

/// GET /api/profiles/:id/configs - List all agent configs for a profile
async fn list_agent_configs(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<Vec<AgentProfileConfig>>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    let configs = state
        .db
        .list_profile_agent_configs(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(configs))
}

/// GET /api/profiles/:id/configs/:agent_type - Get agent config
async fn get_agent_config(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path((id, agent_type)): Path<(String, String)>,
) -> Result<Json<Option<AgentProfileConfig>>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Validate agent type
    validate_agent_type(&agent_type)?;

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    let config = state
        .db
        .get_profile_agent_config(&id, &agent_type)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(config))
}

/// PUT /api/profiles/:id/configs/:agent_type - Create or update agent config
async fn upsert_agent_config(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path((id, agent_type)): Path<(String, String)>,
    Json(req): Json<AgentConfigRequest>,
) -> Result<Json<AgentProfileConfig>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Validate agent type
    validate_agent_type(&agent_type)?;

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    // Validate JSON
    if serde_json::from_str::<serde_json::Value>(&req.config_json).is_err() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "Invalid JSON in config_json".to_string(),
        ));
    }

    let config = NewAgentProfileConfig {
        profile_id: id.clone(),
        user_id: user_id.clone(),
        agent_type: agent_type.clone(),
        config_json: req.config_json,
    };

    let _config_id = state
        .db
        .upsert_profile_agent_config(&config)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Fetch the config
    let result = state
        .db
        .get_profile_agent_config(&id, &agent_type)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to retrieve agent config".to_string(),
        ))?;

    Ok(Json(result))
}

/// DELETE /api/profiles/:id/configs/:agent_type - Delete agent config
async fn delete_agent_config(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path((id, agent_type)): Path<(String, String)>,
) -> Result<Json<SuccessResponse>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Validate agent type
    validate_agent_type(&agent_type)?;

    // Verify profile ownership
    let _profile = state
        .db
        .get_profile(&id, &user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Profile not found".to_string()))?;

    let deleted = state
        .db
        .delete_profile_agent_config(&id, &agent_type)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !deleted {
        return Err((
            axum::http::StatusCode::NOT_FOUND,
            "Agent config not found".to_string(),
        ));
    }

    Ok(Json(SuccessResponse { success: true }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

/// Create the profiles router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        // Profile CRUD
        .route("/profiles", get(list_profiles).post(create_profile))
        .route(
            "/profiles/{id}",
            get(get_profile).patch(update_profile).delete(delete_profile),
        )
        // Folder-Profile linking
        .route(
            "/profiles/folders/{folder_id}",
            axum::routing::put(link_folder_profile).delete(unlink_folder_profile),
        )
        // Git identity
        .route(
            "/profiles/{id}/git-identity",
            get(get_git_identity)
                .put(upsert_git_identity)
                .delete(delete_git_identity),
        )
        // Appearance
        .route(
            "/profiles/{id}/appearance",
            get(get_appearance)
                .put(update_appearance)
                .delete(delete_appearance),
        )
        // Agent configs
        .route("/profiles/{id}/configs", get(list_agent_configs))
        .route(
            "/profiles/{id}/configs/{agent_type}",
            get(get_agent_config)
                .put(upsert_agent_config)
                .delete(delete_agent_config),
        )
}
