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
