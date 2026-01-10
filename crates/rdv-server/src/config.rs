//! Server configuration.

use std::path::PathBuf;

/// Server configuration
#[derive(Debug, Clone)]
#[allow(dead_code)]
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
    ///
    /// Standard directory structure:
    /// ```
    /// ~/.remote-dev/
    /// ├── config.toml           # Main configuration
    /// ├── sqlite.db             # Database
    /// ├── cli-token             # CLI authentication token
    /// ├── run/                  # Runtime files (sockets)
    /// │   ├── api.sock          # rdv-server REST API
    /// │   ├── terminal.sock     # Node.js terminal server
    /// │   └── nextjs.sock       # Next.js (for cloudflared)
    /// └── server/
    ///     ├── service-token     # Service token for Next.js → rdv-server
    ///     ├── server.pid        # PID file
    ///     └── server.log        # Logs
    /// ```
    pub fn load() -> anyhow::Result<Self> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

        // Use REMOTE_DEV_DIR env var if set, otherwise ~/.remote-dev
        let remote_dev_dir = std::env::var("REMOTE_DEV_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home.join(".remote-dev"));

        let run_dir = remote_dev_dir.join("run");
        let server_dir = remote_dev_dir.join("server");

        // Create directories if they don't exist
        std::fs::create_dir_all(&run_dir)?;
        std::fs::create_dir_all(&server_dir)?;

        Ok(Self {
            config_path: remote_dev_dir.join("config.toml"),
            api_socket: run_dir.join("api.sock"),
            terminal_socket: run_dir.join("terminal.sock"),
            pid_file: server_dir.join("server.pid"),
            log_file: server_dir.join("server.log"),
            database_path: remote_dev_dir.join("sqlite.db"),
            service_token_file: server_dir.join("service-token"),
        })
    }
}
