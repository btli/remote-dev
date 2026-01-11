//! SDK Error Types
//!
//! Defines error types for the Remote Dev SDK.

use thiserror::Error;

/// SDK Result type alias
pub type SDKResult<T> = Result<T, SDKError>;

/// SDK errors
#[derive(Debug, Error)]
pub enum SDKError {
    /// Configuration error
    #[error("configuration error: {0}")]
    Config(#[from] crate::config::ConfigValidationError),

    /// Database error
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    /// Memory operation error
    #[error("memory error: {message}")]
    Memory { message: String },

    /// Meta-agent error
    #[error("meta-agent error: {message}")]
    MetaAgent { message: String },

    /// Extension error
    #[error("extension error: {message}")]
    Extension { message: String },

    /// Entry not found
    #[error("{entity_type} not found: {id}")]
    NotFound { entity_type: String, id: String },

    /// Invalid operation
    #[error("invalid operation: {message}")]
    InvalidOperation { message: String },

    /// Timeout error
    #[error("operation timed out after {duration_ms}ms")]
    Timeout { duration_ms: u64 },

    /// IO error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Serialization error
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// Generic error
    #[error("{0}")]
    Other(#[from] anyhow::Error),
}

impl SDKError {
    /// Create a memory error
    pub fn memory(message: impl Into<String>) -> Self {
        Self::Memory {
            message: message.into(),
        }
    }

    /// Create a meta-agent error
    pub fn meta_agent(message: impl Into<String>) -> Self {
        Self::MetaAgent {
            message: message.into(),
        }
    }

    /// Create an extension error
    pub fn extension(message: impl Into<String>) -> Self {
        Self::Extension {
            message: message.into(),
        }
    }

    /// Create a not found error
    pub fn not_found(entity_type: impl Into<String>, id: impl Into<String>) -> Self {
        Self::NotFound {
            entity_type: entity_type.into(),
            id: id.into(),
        }
    }

    /// Create an invalid operation error
    pub fn invalid_operation(message: impl Into<String>) -> Self {
        Self::InvalidOperation {
            message: message.into(),
        }
    }

    /// Create a timeout error
    pub fn timeout(duration_ms: u64) -> Self {
        Self::Timeout { duration_ms }
    }

    /// Check if this error is a not found error
    pub fn is_not_found(&self) -> bool {
        matches!(self, Self::NotFound { .. })
    }

    /// Check if this error is a timeout error
    pub fn is_timeout(&self) -> bool {
        matches!(self, Self::Timeout { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_creation() {
        let err = SDKError::memory("test error");
        assert!(err.to_string().contains("test error"));

        let err = SDKError::not_found("Session", "123");
        assert!(err.is_not_found());
        assert!(err.to_string().contains("Session"));
        assert!(err.to_string().contains("123"));

        let err = SDKError::timeout(5000);
        assert!(err.is_timeout());
        assert!(err.to_string().contains("5000"));
    }
}
