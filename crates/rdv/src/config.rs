//! Configuration management for rdv.
//!
//! Configuration is loaded from multiple sources with precedence:
//! 1. Environment variables (RDV_*)
//! 2. Config file (~/.remote-dev/config.toml)
//! 3. Default values

use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Main configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Remote Dev API settings
    pub api: ApiConfig,

    /// Master Control settings
    pub master: MasterConfig,

    /// Monitoring settings
    pub monitoring: MonitoringConfig,

    /// Agent settings
    pub agents: AgentsConfig,

    /// Paths
    pub paths: PathsConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConfig {
    /// Base URL for Remote Dev API
    #[serde(default = "default_api_url")]
    pub url: String,

    /// API key for authentication
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterConfig {
    /// tmux session name prefix for Master Control
    #[serde(default = "default_master_prefix")]
    pub session_prefix: String,

    /// Enable auto-start on first command
    #[serde(default = "default_true")]
    pub auto_start: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringConfig {
    /// Monitoring interval in seconds
    #[serde(default = "default_monitoring_interval")]
    pub interval_secs: u64,

    /// Stall detection threshold in seconds
    #[serde(default = "default_stall_threshold")]
    pub stall_threshold_secs: u64,

    /// Maximum scrollback lines to capture
    #[serde(default = "default_scrollback_lines")]
    pub scrollback_lines: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentsConfig {
    /// Default agent to use
    #[serde(default = "default_agent")]
    pub default: String,

    /// Available agents and their CLI commands
    #[serde(default = "default_agent_commands")]
    pub commands: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathsConfig {
    /// Base directory for rdv data
    #[serde(default = "default_data_dir")]
    pub data_dir: PathBuf,

    /// Master Control state directory
    #[serde(default = "default_master_dir")]
    pub master_dir: PathBuf,

    /// Transcripts directory
    #[serde(default = "default_transcripts_dir")]
    pub transcripts_dir: PathBuf,
}

/// API connection mode - either HTTP URL or Unix socket
#[derive(Debug, Clone)]
pub enum ApiEndpoint {
    Http(String),
    UnixSocket(PathBuf),
}

impl ApiEndpoint {
    /// Detect the best API endpoint based on environment
    pub fn detect() -> Self {
        // 1. Explicit override via environment variable
        if let Ok(url) = std::env::var("RDV_API_URL") {
            if url.starts_with("unix:") {
                return ApiEndpoint::UnixSocket(PathBuf::from(url.trim_start_matches("unix:")));
            }
            return ApiEndpoint::Http(url);
        }

        // 2. Check for prod mode Unix socket
        let socket_path = PathBuf::from("/tmp/rdv/next.sock");
        if socket_path.exists() {
            return ApiEndpoint::UnixSocket(socket_path);
        }

        // 3. Try to read PORT from .env.local in current directory or parent dirs
        if let Some(port) = Self::find_env_port() {
            return ApiEndpoint::Http(format!("http://localhost:{}", port));
        }

        // 4. Default fallback
        ApiEndpoint::Http("http://localhost:3000".to_string())
    }

    /// Search for PORT in .env.local files walking up the directory tree
    fn find_env_port() -> Option<u16> {
        let mut current = std::env::current_dir().ok()?;

        loop {
            let env_file = current.join(".env.local");
            if env_file.exists() {
                if let Ok(content) = std::fs::read_to_string(&env_file) {
                    for line in content.lines() {
                        if let Some(port_str) = line.strip_prefix("PORT=") {
                            if let Ok(port) = port_str.trim().parse::<u16>() {
                                return Some(port);
                            }
                        }
                    }
                }
            }

            if !current.pop() {
                break;
            }
        }

        None
    }

    /// Get the URL for HTTP requests (for Unix sockets, this is used for Host header)
    #[cfg(feature = "http-api")]
    pub fn base_url(&self) -> String {
        match self {
            ApiEndpoint::Http(url) => url.clone(),
            ApiEndpoint::UnixSocket(_) => "http://localhost".to_string(),
        }
    }

    /// Check if this is a Unix socket endpoint
    #[cfg(feature = "http-api")]
    pub fn is_unix_socket(&self) -> bool {
        matches!(self, ApiEndpoint::UnixSocket(_))
    }

    /// Get the Unix socket path if applicable
    #[cfg(feature = "http-api")]
    pub fn socket_path(&self) -> Option<&PathBuf> {
        match self {
            ApiEndpoint::UnixSocket(path) => Some(path),
            ApiEndpoint::Http(_) => None,
        }
    }
}

// Default value functions
fn default_api_url() -> String {
    match ApiEndpoint::detect() {
        ApiEndpoint::Http(url) => url,
        ApiEndpoint::UnixSocket(path) => format!("unix:{}", path.display()),
    }
}

fn default_master_prefix() -> String {
    "rdv-master".to_string()
}

fn default_true() -> bool {
    true
}

fn default_monitoring_interval() -> u64 {
    30
}

fn default_stall_threshold() -> u64 {
    300 // 5 minutes
}

fn default_scrollback_lines() -> u32 {
    200
}

fn default_agent() -> String {
    "claude".to_string()
}

fn default_agent_commands() -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    map.insert("claude".to_string(), "claude".to_string());
    map.insert("codex".to_string(), "codex".to_string());
    map.insert("gemini".to_string(), "gemini".to_string());
    map.insert("opencode".to_string(), "opencode".to_string());
    map
}

fn default_data_dir() -> PathBuf {
    if let Some(proj_dirs) = ProjectDirs::from("dev", "remote-dev", "rdv") {
        proj_dirs.data_dir().to_path_buf()
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".remote-dev")
    }
}

fn default_master_dir() -> PathBuf {
    default_data_dir().join("master-control")
}

fn default_transcripts_dir() -> PathBuf {
    default_data_dir().join("transcripts")
}

impl Default for Config {
    fn default() -> Self {
        Self {
            api: ApiConfig {
                url: default_api_url(),
                api_key: std::env::var("RDV_API_KEY").ok(),
            },
            master: MasterConfig {
                session_prefix: default_master_prefix(),
                auto_start: default_true(),
            },
            monitoring: MonitoringConfig {
                interval_secs: default_monitoring_interval(),
                stall_threshold_secs: default_stall_threshold(),
                scrollback_lines: default_scrollback_lines(),
            },
            agents: AgentsConfig {
                default: default_agent(),
                commands: default_agent_commands(),
            },
            paths: PathsConfig {
                data_dir: default_data_dir(),
                master_dir: default_master_dir(),
                transcripts_dir: default_transcripts_dir(),
            },
        }
    }
}

impl Config {
    /// Load configuration from file and environment.
    pub fn load() -> Result<Self> {
        let config_path = Self::config_path();

        let config = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)
                .context("Failed to read config file")?;
            toml::from_str(&content).context("Failed to parse config file")?
        } else {
            Config::default()
        };

        Ok(config)
    }

    /// Save configuration to file.
    #[cfg(feature = "http-api")]
    pub fn save(&self) -> Result<()> {
        let config_path = Self::config_path();

        // Ensure parent directory exists
        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent).context("Failed to create config directory")?;
        }

        let content = toml::to_string_pretty(self).context("Failed to serialize config")?;
        std::fs::write(&config_path, content).context("Failed to write config file")?;

        Ok(())
    }

    /// Get the config file path.
    pub fn config_path() -> PathBuf {
        if let Ok(path) = std::env::var("RDV_CONFIG") {
            PathBuf::from(path)
        } else {
            default_data_dir().join("config.toml")
        }
    }

    /// Get the agent CLI command for a given agent type.
    pub fn agent_command(&self, agent: &str) -> Option<&str> {
        self.agents.commands.get(agent).map(|s| s.as_str())
    }

    /// Get the API endpoint (detects Unix socket vs HTTP)
    #[cfg(feature = "http-api")]
    pub fn api_endpoint(&self) -> ApiEndpoint {
        if self.api.url.starts_with("unix:") {
            ApiEndpoint::UnixSocket(PathBuf::from(self.api.url.trim_start_matches("unix:")))
        } else {
            ApiEndpoint::Http(self.api.url.clone())
        }
    }

    /// Ensure all required directories exist.
    pub fn ensure_dirs(&self) -> Result<()> {
        std::fs::create_dir_all(&self.paths.data_dir)
            .context("Failed to create data directory")?;
        std::fs::create_dir_all(&self.paths.master_dir)
            .context("Failed to create master directory")?;
        std::fs::create_dir_all(&self.paths.transcripts_dir)
            .context("Failed to create transcripts directory")?;
        Ok(())
    }
}

/// Configuration for a specific folder orchestrator.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FolderConfig {
    /// Orchestrator ID
    pub orchestrator_id: Option<String>,

    /// Preferred agent for this folder
    pub preferred_agent: Option<String>,

    /// Custom monitoring interval
    pub monitoring_interval_secs: Option<u64>,

    /// Custom stall threshold
    pub stall_threshold_secs: Option<u64>,

    /// Auto-start orchestrator when entering folder
    pub auto_start: bool,
}

impl FolderConfig {
    /// Load folder config from .remote-dev/orchestrator/config.toml
    pub fn load(folder_path: &std::path::Path) -> Result<Self> {
        let config_path = folder_path
            .join(".remote-dev")
            .join("orchestrator")
            .join("config.toml");

        if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            Ok(toml::from_str(&content)?)
        } else {
            Ok(Self::default())
        }
    }

    /// Save folder config.
    pub fn save(&self, folder_path: &std::path::Path) -> Result<()> {
        let config_dir = folder_path.join(".remote-dev").join("orchestrator");
        std::fs::create_dir_all(&config_dir)?;

        let config_path = config_dir.join("config.toml");
        let content = toml::to_string_pretty(self)?;
        std::fs::write(config_path, content)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_default_config() {
        let config = Config::default();

        // Check default agent is set
        assert_eq!(config.agents.default, "claude");

        // Check default agents are registered
        assert!(config.agents.commands.contains_key("claude"));
        assert!(config.agents.commands.contains_key("codex"));
        assert!(config.agents.commands.contains_key("gemini"));
        assert!(config.agents.commands.contains_key("opencode"));

        // Check default monitoring values
        assert_eq!(config.monitoring.interval_secs, 30);
        assert_eq!(config.monitoring.stall_threshold_secs, 300);
        assert_eq!(config.monitoring.scrollback_lines, 200);

        // Check auto_start is enabled by default
        assert!(config.master.auto_start);
    }

    #[test]
    fn test_agent_command_lookup() {
        let config = Config::default();

        assert_eq!(config.agent_command("claude"), Some("claude"));
        assert_eq!(config.agent_command("codex"), Some("codex"));
        assert_eq!(config.agent_command("unknown"), None);
    }

    #[test]
    fn test_ensure_dirs_creates_directories() {
        let temp = tempdir().expect("Failed to create temp dir");
        let config = Config {
            paths: PathsConfig {
                data_dir: temp.path().join("data"),
                master_dir: temp.path().join("master"),
                transcripts_dir: temp.path().join("transcripts"),
            },
            ..Config::default()
        };

        // Directories shouldn't exist yet
        assert!(!config.paths.data_dir.exists());
        assert!(!config.paths.master_dir.exists());
        assert!(!config.paths.transcripts_dir.exists());

        // Create them
        config.ensure_dirs().expect("Failed to create directories");

        // Now they should exist
        assert!(config.paths.data_dir.exists());
        assert!(config.paths.master_dir.exists());
        assert!(config.paths.transcripts_dir.exists());
    }

    #[test]
    fn test_api_endpoint_detect_default() {
        // Without env vars or socket, should default to HTTP localhost:3000
        let endpoint = ApiEndpoint::detect();
        match endpoint {
            ApiEndpoint::Http(url) => {
                // Should contain localhost
                assert!(url.contains("localhost"));
            }
            ApiEndpoint::UnixSocket(_) => {
                // This is also valid if socket exists
            }
        }
    }

    #[test]
    fn test_folder_config_default() {
        let folder_config = FolderConfig::default();

        assert!(folder_config.orchestrator_id.is_none());
        assert!(folder_config.preferred_agent.is_none());
        assert!(folder_config.monitoring_interval_secs.is_none());
        assert!(folder_config.stall_threshold_secs.is_none());
        assert!(!folder_config.auto_start);
    }

    #[test]
    fn test_folder_config_save_and_load() {
        let temp = tempdir().expect("Failed to create temp dir");

        let config = FolderConfig {
            orchestrator_id: Some("test-orch-id".to_string()),
            preferred_agent: Some("claude".to_string()),
            monitoring_interval_secs: Some(60),
            stall_threshold_secs: Some(600),
            auto_start: true,
        };

        // Save config
        config.save(temp.path()).expect("Failed to save config");

        // Verify file was created
        let config_path = temp
            .path()
            .join(".remote-dev")
            .join("orchestrator")
            .join("config.toml");
        assert!(config_path.exists());

        // Load config back
        let loaded = FolderConfig::load(temp.path()).expect("Failed to load config");

        assert_eq!(loaded.orchestrator_id, Some("test-orch-id".to_string()));
        assert_eq!(loaded.preferred_agent, Some("claude".to_string()));
        assert_eq!(loaded.monitoring_interval_secs, Some(60));
        assert_eq!(loaded.stall_threshold_secs, Some(600));
        assert!(loaded.auto_start);
    }

    #[test]
    fn test_folder_config_load_nonexistent() {
        let temp = tempdir().expect("Failed to create temp dir");

        // Loading from a path without config should return defaults
        let loaded = FolderConfig::load(temp.path()).expect("Failed to load default config");

        assert!(loaded.orchestrator_id.is_none());
        assert!(!loaded.auto_start);
    }
}
