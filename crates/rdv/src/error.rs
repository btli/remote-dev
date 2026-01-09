//! Error types for rdv.

use thiserror::Error;

/// Main error type for rdv operations.
#[derive(Error, Debug)]
pub enum RdvError {
    #[error("Configuration error: {0}")]
    Config(String),

    #[error("tmux error: {0}")]
    Tmux(#[from] TmuxError),

    #[error("API error: {0}")]
    Api(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("Orchestrator not found: {0}")]
    OrchestratorNotFound(String),

    #[error("Invalid state transition: {0}")]
    InvalidStateTransition(String),

    #[error("Agent not available: {0}")]
    AgentNotAvailable(String),

    #[error("Beads error: {0}")]
    Beads(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Escalation required: {0}")]
    EscalationRequired(String),

    #[error("{0}")]
    Other(String),
}

/// tmux-specific errors.
#[derive(Error, Debug)]
pub enum TmuxError {
    #[error("tmux not found. Please install tmux.")]
    NotFound,

    #[error("tmux session not found: {0}")]
    SessionNotFound(String),

    #[error("tmux session already exists: {0}")]
    SessionExists(String),

    #[error("Failed to execute tmux command: {0}")]
    CommandFailed(String),

    #[error("Failed to capture pane content: {0}")]
    CaptureFailied(String),

    #[error("Failed to send keys: {0}")]
    SendKeysFailed(String),
}

impl From<reqwest::Error> for RdvError {
    fn from(e: reqwest::Error) -> Self {
        RdvError::Api(e.to_string())
    }
}

impl From<serde_json::Error> for RdvError {
    fn from(e: serde_json::Error) -> Self {
        RdvError::Serialization(e.to_string())
    }
}

impl From<toml::de::Error> for RdvError {
    fn from(e: toml::de::Error) -> Self {
        RdvError::Config(e.to_string())
    }
}

impl From<toml::ser::Error> for RdvError {
    fn from(e: toml::ser::Error) -> Self {
        RdvError::Serialization(e.to_string())
    }
}

/// Result type alias for rdv operations.
pub type RdvResult<T> = Result<T, RdvError>;
