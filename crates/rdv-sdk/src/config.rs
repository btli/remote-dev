//! SDK Configuration
//!
//! Defines configuration options for the Remote Dev SDK.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// SDK configuration options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SDKConfig {
    /// Path to the SQLite database file
    pub database_path: PathBuf,

    /// User ID for scoping operations
    pub user_id: String,

    /// Folder ID for scoping operations (optional)
    pub folder_id: Option<String>,

    /// Project path for context (optional)
    pub project_path: Option<PathBuf>,

    /// Memory configuration
    pub memory: MemoryConfig,

    /// Meta-agent configuration
    pub meta_agent: MetaAgentConfig,

    /// Orchestrator configuration
    pub orchestrator: OrchestratorConfig,
}

impl Default for SDKConfig {
    fn default() -> Self {
        Self {
            database_path: PathBuf::from("sqlite.db"),
            user_id: String::new(),
            folder_id: None,
            project_path: None,
            memory: MemoryConfig::default(),
            meta_agent: MetaAgentConfig::default(),
            orchestrator: OrchestratorConfig::default(),
        }
    }
}

/// Memory system configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryConfig {
    /// Short-term memory TTL in seconds (default: 3600 = 1 hour)
    pub short_term_ttl: u64,

    /// Maximum number of working memory entries (default: 100)
    pub max_working_entries: usize,

    /// Consolidation interval in seconds (default: 300 = 5 minutes)
    pub consolidation_interval: u64,

    /// Minimum access count for promotion to working memory (default: 3)
    pub promotion_threshold: usize,

    /// Minimum confidence for long-term consolidation (default: 0.7)
    pub consolidation_confidence: f64,

    /// Enable automatic consolidation (default: true)
    pub auto_consolidate: bool,

    /// Enable automatic pruning of expired entries (default: true)
    pub auto_prune: bool,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            short_term_ttl: 3600, // 1 hour
            max_working_entries: 100,
            consolidation_interval: 300, // 5 minutes
            promotion_threshold: 3,
            consolidation_confidence: 0.7,
            auto_consolidate: true,
            auto_prune: true,
        }
    }
}

/// Meta-agent configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaAgentConfig {
    /// Maximum optimization iterations (default: 3)
    pub max_iterations: usize,

    /// Target benchmark score (default: 0.9)
    pub target_score: f64,

    /// Minimum score improvement to continue (default: 0.05)
    pub min_improvement: f64,

    /// Optimization timeout in seconds (default: 600)
    pub timeout_seconds: u64,

    /// Enable auto-optimization on task start (default: false)
    pub auto_optimize: bool,

    /// Enable verbose logging (default: false)
    pub verbose: bool,
}

impl Default for MetaAgentConfig {
    fn default() -> Self {
        Self {
            max_iterations: 3,
            target_score: 0.9,
            min_improvement: 0.05,
            timeout_seconds: 600,
            auto_optimize: false,
            verbose: false,
        }
    }
}

/// Orchestrator configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorConfig {
    /// Monitoring interval in seconds (default: 30)
    pub monitoring_interval: u64,

    /// Stall threshold in seconds (default: 300 = 5 minutes)
    pub stall_threshold: u64,

    /// Enable auto-intervention on stalled sessions (default: false)
    pub auto_intervention: bool,

    /// Maximum insight age in hours before cleanup (default: 168 = 1 week)
    pub max_insight_age_hours: u64,
}

impl Default for OrchestratorConfig {
    fn default() -> Self {
        Self {
            monitoring_interval: 30,
            stall_threshold: 300, // 5 minutes
            auto_intervention: false,
            max_insight_age_hours: 168, // 1 week
        }
    }
}

impl SDKConfig {
    /// Create a new SDK config with the given database path and user ID
    pub fn new(database_path: impl Into<PathBuf>, user_id: impl Into<String>) -> Self {
        Self {
            database_path: database_path.into(),
            user_id: user_id.into(),
            ..Default::default()
        }
    }

    /// Set the folder ID
    pub fn with_folder(mut self, folder_id: impl Into<String>) -> Self {
        self.folder_id = Some(folder_id.into());
        self
    }

    /// Set the project path
    pub fn with_project(mut self, project_path: impl Into<PathBuf>) -> Self {
        self.project_path = Some(project_path.into());
        self
    }

    /// Set memory configuration
    pub fn with_memory(mut self, memory: MemoryConfig) -> Self {
        self.memory = memory;
        self
    }

    /// Set meta-agent configuration
    pub fn with_meta_agent(mut self, meta_agent: MetaAgentConfig) -> Self {
        self.meta_agent = meta_agent;
        self
    }

    /// Set orchestrator configuration
    pub fn with_orchestrator(mut self, orchestrator: OrchestratorConfig) -> Self {
        self.orchestrator = orchestrator;
        self
    }

    /// Validate the configuration
    pub fn validate(&self) -> Result<(), ConfigValidationError> {
        if self.user_id.is_empty() {
            return Err(ConfigValidationError::MissingUserId);
        }

        if self.memory.short_term_ttl == 0 {
            return Err(ConfigValidationError::InvalidValue {
                field: "memory.short_term_ttl".into(),
                message: "must be greater than 0".into(),
            });
        }

        if self.meta_agent.target_score <= 0.0 || self.meta_agent.target_score > 1.0 {
            return Err(ConfigValidationError::InvalidValue {
                field: "meta_agent.target_score".into(),
                message: "must be between 0 and 1".into(),
            });
        }

        Ok(())
    }
}

/// Configuration validation errors
#[derive(Debug, thiserror::Error)]
pub enum ConfigValidationError {
    #[error("user_id is required")]
    MissingUserId,

    #[error("invalid value for {field}: {message}")]
    InvalidValue { field: String, message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = SDKConfig::default();
        assert_eq!(config.memory.short_term_ttl, 3600);
        assert_eq!(config.meta_agent.max_iterations, 3);
        assert_eq!(config.orchestrator.monitoring_interval, 30);
    }

    #[test]
    fn test_config_builder() {
        let config = SDKConfig::new("test.db", "user-123")
            .with_folder("folder-456")
            .with_project("/path/to/project");

        assert_eq!(config.database_path, PathBuf::from("test.db"));
        assert_eq!(config.user_id, "user-123");
        assert_eq!(config.folder_id, Some("folder-456".into()));
        assert_eq!(config.project_path, Some(PathBuf::from("/path/to/project")));
    }

    #[test]
    fn test_config_validation() {
        let mut config = SDKConfig::default();
        assert!(config.validate().is_err()); // Missing user_id

        config.user_id = "user-123".into();
        assert!(config.validate().is_ok());

        config.memory.short_term_ttl = 0;
        assert!(config.validate().is_err());
    }
}
