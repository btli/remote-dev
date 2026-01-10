//! Server configuration.

use std::path::PathBuf;

/// Server configuration
#[derive(Debug, Clone)]
pub struct Config {
    /// Path to configuration file
    pub config_path: PathBuf,
    /// Unix socket for REST API
    pub api_socket: PathBuf,
    /// Unix socket for WebSocket connections
    pub terminal_socket: PathBuf,
    /// PID file path
    pub pid_file: PathBuf,
    /// Log file path
    pub log_file: PathBuf,
    /// Database path
    pub database_path: PathBuf,
    /// Service token file path
    pub service_token_file: PathBuf,
}

impl Config {
    /// Load configuration from file or defaults
    pub fn load() -> anyhow::Result<Self> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let rdv_dir = home.join(".rdv");
        let server_dir = rdv_dir.join("server");

        // Create directories if they don't exist
        std::fs::create_dir_all(&server_dir)?;

        Ok(Self {
            config_path: server_dir.join("config.toml"),
            api_socket: rdv_dir.join("api.sock"),
            terminal_socket: rdv_dir.join("terminal.sock"),
            pid_file: server_dir.join("server.pid"),
            log_file: server_dir.join("server.log"),
            database_path: rdv_dir.join("sqlite.db"),
            service_token_file: server_dir.join("service-token"),
        })
    }
}
