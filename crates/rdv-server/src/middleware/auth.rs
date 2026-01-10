//! Authentication middleware for rdv-server.

use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;

use crate::state::AppState;

/// Authentication context extracted from request
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum AuthContext {
    /// Authenticated via service token (from Next.js)
    Service { user_id: String },
    /// Authenticated via CLI token
    CLI { user_id: String, token_id: String },
}

impl AuthContext {
    /// Get the user ID from any auth context
    pub fn user_id(&self) -> &str {
        match self {
            AuthContext::Service { user_id } => user_id,
            AuthContext::CLI { user_id, .. } => user_id,
        }
    }
}

/// Authentication error
#[derive(Debug)]
#[allow(dead_code)]
pub enum AuthError {
    MissingToken,
    InvalidToken,
    MissingUserId,
    ExpiredToken,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    code: String,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, error, code) = match self {
            AuthError::MissingToken => (
                StatusCode::UNAUTHORIZED,
                "Missing authentication token",
                "MISSING_TOKEN",
            ),
            AuthError::InvalidToken => (
                StatusCode::UNAUTHORIZED,
                "Invalid authentication token",
                "INVALID_TOKEN",
            ),
            AuthError::MissingUserId => (
                StatusCode::UNAUTHORIZED,
                "Missing user ID header",
                "MISSING_USER_ID",
            ),
            AuthError::ExpiredToken => (
                StatusCode::UNAUTHORIZED,
                "Token has expired",
                "EXPIRED_TOKEN",
            ),
        };

        let body = Json(ErrorResponse {
            error: error.to_string(),
            code: code.to_string(),
        });

        (status, body).into_response()
    }
}

/// Authentication middleware for axum
pub async fn auth_middleware(
    State(state): State<Arc<AppState>>,
    mut request: Request<Body>,
    next: Next,
) -> Result<Response, AuthError> {
    // Extract token from header
    let token_header = request
        .headers()
        .get("X-RDV-Service-Token")
        .or_else(|| request.headers().get("Authorization"));

    let token_str = match token_header {
        Some(value) => value.to_str().map_err(|_| AuthError::InvalidToken)?,
        None => return Err(AuthError::MissingToken),
    };

    // Remove "Bearer " prefix if present
    let token_str = token_str.trim_start_matches("Bearer ").trim();

    // Decode token (base64)
    let token_bytes = STANDARD
        .decode(token_str)
        .map_err(|_| AuthError::InvalidToken)?;

    // Check against service token first (raw bytes comparison)
    let auth_context = if state.service_token.verify(&token_bytes) {
        // Service token - extract user from header
        let user_id = request
            .headers()
            .get("X-RDV-User-ID")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
            .ok_or(AuthError::MissingUserId)?;

        AuthContext::Service { user_id }
    } else {
        // CLI token - hash the token and validate
        // The stored hash is SHA-256 of the raw key string (not the bytes)
        let token_hash = hash_token(token_str);

        if let Some(cli_token) = state.cli_tokens.validate(&token_hash).await {
            AuthContext::CLI {
                user_id: cli_token.user_id,
                token_id: cli_token.token_id,
            }
        } else {
            return Err(AuthError::InvalidToken);
        }
    };

    // Add auth context to request extensions
    request.extensions_mut().insert(auth_context);

    Ok(next.run(request).await)
}

/// Hash a CLI token using SHA-256
fn hash_token(token_str: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(token_str.as_bytes());
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Extract auth context from request extensions
#[allow(dead_code)]
pub fn extract_auth(request: &Request<Body>) -> Option<&AuthContext> {
    request.extensions().get::<AuthContext>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_context_user_id_from_service() {
        let ctx = AuthContext::Service {
            user_id: "user-123".to_string(),
        };
        assert_eq!(ctx.user_id(), "user-123");
    }

    #[test]
    fn test_auth_context_user_id_from_cli() {
        let ctx = AuthContext::CLI {
            user_id: "user-456".to_string(),
            token_id: "token-abc".to_string(),
        };
        assert_eq!(ctx.user_id(), "user-456");
    }

    #[test]
    fn test_auth_context_clone() {
        let ctx = AuthContext::Service {
            user_id: "user-789".to_string(),
        };
        let cloned = ctx.clone();
        assert_eq!(ctx.user_id(), cloned.user_id());
    }

    #[test]
    fn test_hash_token_deterministic() {
        let token = "test-token-123";
        let hash1 = hash_token(token);
        let hash2 = hash_token(token);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_hash_token_different_inputs() {
        let hash1 = hash_token("token-a");
        let hash2 = hash_token("token-b");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_hash_token_length() {
        let hash = hash_token("any-token");
        assert_eq!(hash.len(), 32); // SHA-256 produces 32 bytes
    }

    #[test]
    fn test_hash_token_empty_string() {
        let hash = hash_token("");
        assert_eq!(hash.len(), 32);
        // Empty string SHA-256 should produce a consistent hash
        let hash2 = hash_token("");
        assert_eq!(hash, hash2);
    }

    #[test]
    fn test_auth_error_status_codes() {
        // Test that each error variant produces the expected status code
        let missing_token_response = AuthError::MissingToken.into_response();
        assert_eq!(missing_token_response.status(), StatusCode::UNAUTHORIZED);

        let invalid_token_response = AuthError::InvalidToken.into_response();
        assert_eq!(invalid_token_response.status(), StatusCode::UNAUTHORIZED);

        let missing_user_response = AuthError::MissingUserId.into_response();
        assert_eq!(missing_user_response.status(), StatusCode::UNAUTHORIZED);

        let expired_token_response = AuthError::ExpiredToken.into_response();
        assert_eq!(expired_token_response.status(), StatusCode::UNAUTHORIZED);
    }
}
