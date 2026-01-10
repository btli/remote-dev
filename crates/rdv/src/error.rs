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
    #[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rdv_error_display_messages() {
        // Test that error messages are formatted correctly
        let err = RdvError::Config("bad config".to_string());
        assert_eq!(err.to_string(), "Configuration error: bad config");

        let err = RdvError::SessionNotFound("sess-123".to_string());
        assert_eq!(err.to_string(), "Session not found: sess-123");

        let err = RdvError::TaskNotFound("task-456".to_string());
        assert_eq!(err.to_string(), "Task not found: task-456");

        let err = RdvError::OrchestratorNotFound("orch-789".to_string());
        assert_eq!(err.to_string(), "Orchestrator not found: orch-789");

        let err = RdvError::InvalidStateTransition("cannot close".to_string());
        assert_eq!(err.to_string(), "Invalid state transition: cannot close");

        let err = RdvError::AgentNotAvailable("claude not found".to_string());
        assert_eq!(err.to_string(), "Agent not available: claude not found");

        let err = RdvError::Beads("bd failed".to_string());
        assert_eq!(err.to_string(), "Beads error: bd failed");

        let err = RdvError::Serialization("json error".to_string());
        assert_eq!(err.to_string(), "Serialization error: json error");

        let err = RdvError::EscalationRequired("needs attention".to_string());
        assert_eq!(err.to_string(), "Escalation required: needs attention");

        let err = RdvError::Other("something went wrong".to_string());
        assert_eq!(err.to_string(), "something went wrong");

        let err = RdvError::Api("connection failed".to_string());
        assert_eq!(err.to_string(), "API error: connection failed");
    }

    #[test]
    fn test_tmux_error_display_messages() {
        let err = TmuxError::NotFound;
        assert_eq!(err.to_string(), "tmux not found. Please install tmux.");

        let err = TmuxError::SessionNotFound("my-session".to_string());
        assert_eq!(err.to_string(), "tmux session not found: my-session");

        let err = TmuxError::SessionExists("my-session".to_string());
        assert_eq!(err.to_string(), "tmux session already exists: my-session");

        let err = TmuxError::CommandFailed("exit 1".to_string());
        assert_eq!(err.to_string(), "Failed to execute tmux command: exit 1");

        let err = TmuxError::CaptureFailied("no pane".to_string());
        assert_eq!(err.to_string(), "Failed to capture pane content: no pane");

        let err = TmuxError::SendKeysFailed("timeout".to_string());
        assert_eq!(err.to_string(), "Failed to send keys: timeout");
    }

    #[test]
    fn test_tmux_error_converts_to_rdv_error() {
        let tmux_err = TmuxError::NotFound;
        let rdv_err: RdvError = tmux_err.into();

        match rdv_err {
            RdvError::Tmux(TmuxError::NotFound) => {}
            _ => panic!("Expected RdvError::Tmux(TmuxError::NotFound)"),
        }
    }

    #[test]
    fn test_io_error_converts_to_rdv_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let rdv_err: RdvError = io_err.into();

        match rdv_err {
            RdvError::Io(_) => {}
            _ => panic!("Expected RdvError::Io"),
        }
    }

    #[test]
    fn test_serde_json_error_converts_to_rdv_error() {
        // Create a serde_json error by parsing invalid JSON
        let json_err = serde_json::from_str::<serde_json::Value>("not valid json")
            .err()
            .expect("Should fail");
        let rdv_err: RdvError = json_err.into();

        match rdv_err {
            RdvError::Serialization(msg) => {
                assert!(msg.contains("expected"));
            }
            _ => panic!("Expected RdvError::Serialization"),
        }
    }

    #[test]
    fn test_rdv_result_type_alias() {
        fn returns_ok() -> RdvResult<i32> {
            Ok(42)
        }

        fn returns_err() -> RdvResult<i32> {
            Err(RdvError::Other("test error".to_string()))
        }

        assert_eq!(returns_ok().unwrap(), 42);
        assert!(returns_err().is_err());
    }

    #[test]
    fn test_toml_de_error_converts_to_rdv_error() {
        // Create a toml deserialization error by parsing invalid TOML
        let toml_err = toml::from_str::<toml::Value>("invalid = = = toml")
            .err()
            .expect("Should fail");
        let rdv_err: RdvError = toml_err.into();

        match rdv_err {
            RdvError::Config(msg) => {
                assert!(msg.contains("expected") || msg.len() > 0);
            }
            _ => panic!("Expected RdvError::Config"),
        }
    }

    #[test]
    fn test_toml_ser_error_converts_to_rdv_error() {
        use serde::Serialize;

        // Create a value that can't be serialized as TOML key
        #[derive(Serialize)]
        struct BadKey {
            #[serde(flatten)]
            map: std::collections::HashMap<i32, String>, // i32 keys not allowed in TOML
        }

        let mut map = std::collections::HashMap::new();
        map.insert(123, "value".to_string());
        let bad = BadKey { map };

        let toml_err = toml::to_string(&bad).err().expect("Should fail");
        let rdv_err: RdvError = toml_err.into();

        match rdv_err {
            RdvError::Serialization(msg) => {
                assert!(msg.len() > 0);
            }
            _ => panic!("Expected RdvError::Serialization"),
        }
    }

    #[test]
    fn test_error_debug_formatting() {
        let err = RdvError::SessionNotFound("test-sess".to_string());
        let debug_str = format!("{:?}", err);
        assert!(debug_str.contains("SessionNotFound"));
        assert!(debug_str.contains("test-sess"));
    }

    #[test]
    fn test_tmux_error_debug_formatting() {
        let err = TmuxError::SessionExists("my-session".to_string());
        let debug_str = format!("{:?}", err);
        assert!(debug_str.contains("SessionExists"));
        assert!(debug_str.contains("my-session"));
    }
}
