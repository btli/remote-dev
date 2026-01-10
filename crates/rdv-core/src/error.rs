//! Error types for rdv-core.

use thiserror::Error;

/// Result type alias using rdv-core Error
pub type Result<T> = std::result::Result<T, Error>;

/// Core error types for rdv operations
#[derive(Error, Debug)]
pub enum Error {
    // Database errors
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Database not found. Set RDV_DATABASE_PATH or run from project directory.")]
    DatabaseNotFound,

    #[error("Database lock poisoned")]
    LockPoisoned,

    #[error("No user found in database")]
    NoUser,

    // tmux errors
    #[error("tmux not found. Install tmux to use Remote Dev.")]
    TmuxNotFound,

    #[error("tmux error: {0}")]
    Tmux(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    // Git/Worktree errors
    #[error("Not a git repository: {0}")]
    NotGitRepo(String),

    #[error("Worktree path already exists: {0}")]
    WorktreePathExists(String),

    #[error("Branch already checked out: {0}")]
    BranchInUse(String),

    #[error("Worktree has uncommitted changes")]
    WorktreeHasChanges,

    #[error("Worktree error: {0}")]
    Worktree(String),

    // Auth errors
    #[error("Invalid token")]
    InvalidToken,

    #[error("Token expired")]
    TokenExpired,

    #[error("Missing authentication")]
    MissingAuth,

    #[error("Permission denied")]
    PermissionDenied,

    // IO errors
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    // Command execution errors
    #[error("Command failed: {cmd}\n{stderr}")]
    CommandFailed { cmd: String, stderr: String },

    // Serialization errors
    #[error("Serialization error: {0}")]
    Serialization(String),

    // Generic errors
    #[error("{0}")]
    Other(String),
}

impl Error {
    /// Create an error from a command failure
    pub fn command_failed(cmd: impl Into<String>, stderr: impl Into<String>) -> Self {
        Self::CommandFailed {
            cmd: cmd.into(),
            stderr: stderr.into(),
        }
    }
}
