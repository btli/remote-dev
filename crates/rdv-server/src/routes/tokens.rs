//! CLI token management routes.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
    Extension, Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rdv_core::CLITokenCreateResponse;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tracing::{info, warn};

use crate::middleware::AuthContext;
use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/tokens", get(list_tokens))
        .route("/tokens", post(create_token))
        .route("/tokens/{id}", get(get_token))
        .route("/tokens/{id}", delete(revoke_token))
}

/// List all CLI tokens for the authenticated user
async fn list_tokens(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<Vec<TokenListItem>>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let tokens = state
        .db
        .list_cli_tokens(user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Convert to list items (hide the hash)
    let items: Vec<TokenListItem> = tokens
        .into_iter()
        .map(|t| TokenListItem {
            id: t.id,
            name: t.name,
            key_prefix: t.key_prefix,
            last_used_at: t.last_used_at,
            expires_at: t.expires_at,
            created_at: t.created_at,
        })
        .collect();

    Ok(Json(items))
}

/// Get a specific CLI token
async fn get_token(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<TokenListItem>, (StatusCode, String)> {
    let user_id = auth.user_id();

    let token = state
        .db
        .get_cli_token(&id, user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((StatusCode::NOT_FOUND, "Token not found".to_string()))?;

    Ok(Json(TokenListItem {
        id: token.id,
        name: token.name,
        key_prefix: token.key_prefix,
        last_used_at: token.last_used_at,
        expires_at: token.expires_at,
        created_at: token.created_at,
    }))
}

/// Create a new CLI token
async fn create_token(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<CreateTokenRequest>,
) -> Result<(StatusCode, Json<CLITokenCreateResponse>), (StatusCode, String)> {
    let user_id = auth.user_id();

    // Generate token components
    let id = uuid::Uuid::new_v4().to_string();
    let raw_key = generate_raw_key();
    let key_prefix = format!("rdv_{}", &raw_key[..8]);
    let key_hash = hash_key(&raw_key);
    let now = chrono::Utc::now().timestamp_millis();

    // Store in database
    state
        .db
        .create_cli_token(&id, user_id, &input.name, &key_prefix, &key_hash, input.expires_at)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Add to in-memory registry for immediate validation
    state
        .cli_tokens
        .add(crate::state::CLITokenEntry {
            token_hash: decode_hash(&key_hash),
            user_id: user_id.to_string(),
            token_id: id.clone(),
            name: input.name.clone(),
        })
        .await;

    info!(
        "Created CLI token '{}' (prefix: {}) for user {}",
        input.name,
        key_prefix,
        &user_id[..8]
    );

    Ok((
        StatusCode::CREATED,
        Json(CLITokenCreateResponse {
            id,
            name: input.name,
            key_prefix,
            raw_key,
            expires_at: input.expires_at,
            created_at: now,
        }),
    ))
}

/// Revoke (delete) a CLI token
async fn revoke_token(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let user_id = auth.user_id();

    let deleted = state
        .db
        .revoke_cli_token(&id, user_id)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if deleted {
        // Remove from in-memory registry
        state.cli_tokens.remove(&id).await;

        info!("Revoked CLI token {} for user {}", &id[..8], &user_id[..8]);
        Ok(StatusCode::NO_CONTENT)
    } else {
        warn!(
            "Token {} not found or access denied for user {}",
            &id[..8],
            &user_id[..8]
        );
        Err((StatusCode::NOT_FOUND, "Token not found".to_string()))
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper types and functions
// ─────────────────────────────────────────────────────────────────────────────

/// Token list item (hides sensitive data)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenListItem {
    pub id: String,
    pub name: String,
    pub key_prefix: String,
    pub last_used_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub created_at: i64,
}

/// Request to create a new token
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTokenRequest {
    pub name: String,
    pub expires_at: Option<i64>,
}

/// Generate a random 32-byte key and return as base64
fn generate_raw_key() -> String {
    let mut key = [0u8; 32];
    for byte in &mut key {
        *byte = rand::random();
    }
    STANDARD.encode(key)
}

/// Hash a key using SHA-256 and return as hex
fn hash_key(raw_key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw_key.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

/// Decode a hex hash to bytes (for in-memory comparison)
fn decode_hash(hex_hash: &str) -> [u8; 32] {
    let bytes = hex::decode(hex_hash).unwrap_or_else(|_| vec![0u8; 32]);
    let mut arr = [0u8; 32];
    if bytes.len() >= 32 {
        arr.copy_from_slice(&bytes[..32]);
    }
    arr
}
