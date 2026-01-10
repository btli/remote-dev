//! Authentication module for rdv-core.
//!
//! Provides token-based authentication for:
//! - Service tokens (Next.js → Rust backend)
//! - CLI tokens (rdv CLI → Rust backend)

use base64::{engine::general_purpose::STANDARD, Engine as _};
use crate::error::Result;
use std::fs::{self, Permissions};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::SystemTime;

/// Service token for Next.js to Rust backend communication
#[derive(Debug, Clone)]
pub struct ServiceToken {
    /// Random 256-bit token
    pub token: [u8; 32],
    /// Creation timestamp (for rotation)
    pub created_at: SystemTime,
    /// Token ID for logging/revocation
    pub token_id: uuid::Uuid,
}

impl ServiceToken {
    /// Generate a new service token
    pub fn generate() -> Self {
        let mut token = [0u8; 32];
        for byte in &mut token {
            *byte = rand::random();
        }

        Self {
            token,
            created_at: SystemTime::now(),
            token_id: uuid::Uuid::new_v4(),
        }
    }

    /// Write token to file with restricted permissions (0600)
    pub fn write_to_file(&self, path: &Path) -> Result<()> {
        let encoded = STANDARD.encode(&self.token);
        fs::write(path, &encoded)?;
        fs::set_permissions(path, Permissions::from_mode(0o600))?;
        Ok(())
    }

    /// Read token from file
    pub fn read_from_file(path: &Path) -> Result<Self> {
        let encoded = fs::read_to_string(path)?;
        let decoded = STANDARD.decode(encoded.trim())
            .map_err(|e| crate::error::Error::Other(format!("Invalid token encoding: {}", e)))?;

        if decoded.len() != 32 {
            return Err(crate::error::Error::InvalidToken);
        }

        let mut token = [0u8; 32];
        token.copy_from_slice(&decoded);

        Ok(Self {
            token,
            created_at: SystemTime::now(),
            token_id: uuid::Uuid::new_v4(),
        })
    }

    /// Verify a token matches
    pub fn verify(&self, candidate: &[u8]) -> bool {
        candidate == self.token
    }
}

/// CLI token for rdv CLI authentication
#[derive(Debug, Clone)]
pub struct CLIToken {
    /// Random 256-bit token
    pub token: [u8; 32],
    /// Associated user ID
    pub user_id: uuid::Uuid,
    /// Token name/description
    pub name: String,
    /// Creation timestamp
    pub created_at: SystemTime,
    /// Last used timestamp
    pub last_used_at: Option<SystemTime>,
    /// Expiration (optional)
    pub expires_at: Option<SystemTime>,
}

impl CLIToken {
    /// Generate a new CLI token for a user
    pub fn generate(user_id: uuid::Uuid, name: impl Into<String>) -> Self {
        let mut token = [0u8; 32];
        for byte in &mut token {
            *byte = rand::random();
        }

        Self {
            token,
            user_id,
            name: name.into(),
            created_at: SystemTime::now(),
            last_used_at: None,
            expires_at: None,
        }
    }

    /// Check if token is expired
    pub fn is_expired(&self) -> bool {
        if let Some(expires_at) = self.expires_at {
            SystemTime::now() > expires_at
        } else {
            false
        }
    }
}

/// Authentication context extracted from a request
#[derive(Debug, Clone)]
pub enum AuthContext {
    /// Authenticated via service token (from Next.js)
    Service { user_id: uuid::Uuid },
    /// Authenticated via CLI token
    CLI {
        user_id: uuid::Uuid,
        token_id: uuid::Uuid,
    },
}

impl AuthContext {
    /// Get the user ID from any auth context
    pub fn user_id(&self) -> uuid::Uuid {
        match self {
            AuthContext::Service { user_id } => *user_id,
            AuthContext::CLI { user_id, .. } => *user_id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_service_token_generate() {
        let token1 = ServiceToken::generate();
        let token2 = ServiceToken::generate();

        // Tokens should be different
        assert_ne!(token1.token, token2.token);
        // Token IDs should be different
        assert_ne!(token1.token_id, token2.token_id);
        // Token should be 32 bytes
        assert_eq!(token1.token.len(), 32);
    }

    #[test]
    fn test_service_token_verify() {
        let token = ServiceToken::generate();

        // Correct token should verify
        assert!(token.verify(&token.token));

        // Wrong token should not verify
        let wrong_token = [0u8; 32];
        assert!(!token.verify(&wrong_token));

        // Empty token should not verify
        assert!(!token.verify(&[]));
    }

    #[test]
    fn test_service_token_file_roundtrip() {
        let temp_dir = tempfile::tempdir().unwrap();
        let token_path = temp_dir.path().join("test-token");

        let original = ServiceToken::generate();
        original.write_to_file(&token_path).unwrap();

        let loaded = ServiceToken::read_from_file(&token_path).unwrap();

        // Token bytes should match
        assert_eq!(original.token, loaded.token);
    }

    #[test]
    fn test_service_token_file_permissions() {
        let temp_dir = tempfile::tempdir().unwrap();
        let token_path = temp_dir.path().join("test-token");

        let token = ServiceToken::generate();
        token.write_to_file(&token_path).unwrap();

        // Check file permissions (0600 = owner read/write only)
        let metadata = std::fs::metadata(&token_path).unwrap();
        let permissions = metadata.permissions();
        assert_eq!(permissions.mode() & 0o777, 0o600);
    }

    #[test]
    fn test_cli_token_generate() {
        let user_id = uuid::Uuid::new_v4();
        let token = CLIToken::generate(user_id, "test-token");

        assert_eq!(token.user_id, user_id);
        assert_eq!(token.name, "test-token");
        assert!(token.last_used_at.is_none());
        assert!(token.expires_at.is_none());
        assert_eq!(token.token.len(), 32);
    }

    #[test]
    fn test_cli_token_is_expired_no_expiry() {
        let user_id = uuid::Uuid::new_v4();
        let token = CLIToken::generate(user_id, "test");

        // Token with no expiry should never be expired
        assert!(!token.is_expired());
    }

    #[test]
    fn test_cli_token_is_expired_future() {
        let user_id = uuid::Uuid::new_v4();
        let mut token = CLIToken::generate(user_id, "test");
        token.expires_at = Some(SystemTime::now() + Duration::from_secs(3600));

        // Token expiring in the future should not be expired
        assert!(!token.is_expired());
    }

    #[test]
    fn test_cli_token_is_expired_past() {
        let user_id = uuid::Uuid::new_v4();
        let mut token = CLIToken::generate(user_id, "test");
        // Set expiry to 1 hour ago
        token.expires_at = Some(SystemTime::now() - Duration::from_secs(3600));

        // Token that expired in the past should be expired
        assert!(token.is_expired());
    }

    #[test]
    fn test_auth_context_user_id_service() {
        let user_id = uuid::Uuid::new_v4();
        let ctx = AuthContext::Service { user_id };

        assert_eq!(ctx.user_id(), user_id);
    }

    #[test]
    fn test_auth_context_user_id_cli() {
        let user_id = uuid::Uuid::new_v4();
        let token_id = uuid::Uuid::new_v4();
        let ctx = AuthContext::CLI { user_id, token_id };

        assert_eq!(ctx.user_id(), user_id);
    }

    #[test]
    fn test_auth_context_clone() {
        let user_id = uuid::Uuid::new_v4();
        let ctx = AuthContext::Service { user_id };
        let cloned = ctx.clone();

        assert_eq!(ctx.user_id(), cloned.user_id());
    }

    #[test]
    fn test_service_token_clone() {
        let token = ServiceToken::generate();
        let cloned = token.clone();

        assert_eq!(token.token, cloned.token);
        assert_eq!(token.token_id, cloned.token_id);
    }

    #[test]
    fn test_cli_token_clone() {
        let user_id = uuid::Uuid::new_v4();
        let token = CLIToken::generate(user_id, "test");
        let cloned = token.clone();

        assert_eq!(token.token, cloned.token);
        assert_eq!(token.user_id, cloned.user_id);
        assert_eq!(token.name, cloned.name);
    }
}
