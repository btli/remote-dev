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

impl Default for Config {
    fn default() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let remote_dev_dir = home.join(".remote-dev");
        let run_dir = remote_dev_dir.join("run");
        let server_dir = remote_dev_dir.join("server");

        Self {
            config_path: remote_dev_dir.join("config.toml"),
            api_socket: run_dir.join("api.sock"),
            terminal_socket: run_dir.join("terminal.sock"),
            pid_file: server_dir.join("server.pid"),
            log_file: server_dir.join("server.log"),
            database_path: remote_dev_dir.join("sqlite.db"),
            service_token_file: server_dir.join("service-token"),
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_default_config() {
        let config = Config::default();

        // Should have all paths set correctly
        assert!(config.config_path.ends_with("config.toml"));
        assert!(config.api_socket.ends_with("api.sock"));
        assert!(config.terminal_socket.ends_with("terminal.sock"));
        assert!(config.pid_file.ends_with("server.pid"));
        assert!(config.log_file.ends_with("server.log"));
        assert!(config.database_path.ends_with("sqlite.db"));
        assert!(config.service_token_file.ends_with("service-token"));
    }

    #[test]
    fn test_default_config_directory_structure() {
        let config = Config::default();

        // All paths should be under ~/.remote-dev
        let home = dirs::home_dir().unwrap();
        let remote_dev_dir = home.join(".remote-dev");

        assert!(config.config_path.starts_with(&remote_dev_dir));
        assert!(config.database_path.starts_with(&remote_dev_dir));
    }

    #[test]
    fn test_config_load_with_custom_dir() {
        // Set custom directory
        let temp_dir = tempfile::tempdir().unwrap();
        let custom_path = temp_dir.path().to_path_buf();

        // Save current value to restore later
        let old_val = env::var("REMOTE_DEV_DIR").ok();
        // SAFETY: This test runs in isolation and we restore the env var afterward
        unsafe { env::set_var("REMOTE_DEV_DIR", &custom_path) };

        let config = Config::load().unwrap();

        // Should use custom directory
        assert!(config.config_path.starts_with(&custom_path));
        assert!(config.api_socket.starts_with(&custom_path));
        assert!(config.database_path.starts_with(&custom_path));

        // Cleanup
        // SAFETY: Restoring environment to previous state
        unsafe {
            if let Some(val) = old_val {
                env::set_var("REMOTE_DEV_DIR", val);
            } else {
                env::remove_var("REMOTE_DEV_DIR");
            }
        }
    }

    #[test]
    fn test_config_load_creates_directories() {
        let temp_dir = tempfile::tempdir().unwrap();
        let custom_path = temp_dir.path().to_path_buf();

        // Save current value to restore later
        let old_val = env::var("REMOTE_DEV_DIR").ok();
        // SAFETY: This test runs in isolation and we restore the env var afterward
        unsafe { env::set_var("REMOTE_DEV_DIR", &custom_path) };

        let _config = Config::load().unwrap();

        // Should have created run/ and server/ directories
        let run_dir = custom_path.join("run");
        let server_dir = custom_path.join("server");

        assert!(run_dir.exists());
        assert!(server_dir.exists());

        // Cleanup
        // SAFETY: Restoring environment to previous state
        unsafe {
            if let Some(val) = old_val {
                env::set_var("REMOTE_DEV_DIR", val);
            } else {
                env::remove_var("REMOTE_DEV_DIR");
            }
        }
    }

    #[test]
    fn test_config_paths_are_absolute() {
        let config = Config::default();

        // All paths should be absolute (unless home dir not found)
        if dirs::home_dir().is_some() {
            assert!(config.config_path.is_absolute());
            assert!(config.api_socket.is_absolute());
            assert!(config.terminal_socket.is_absolute());
            assert!(config.pid_file.is_absolute());
            assert!(config.log_file.is_absolute());
            assert!(config.database_path.is_absolute());
            assert!(config.service_token_file.is_absolute());
        }
    }

    #[test]
    fn test_config_clone() {
        let config1 = Config::default();
        let config2 = config1.clone();

        assert_eq!(config1.config_path, config2.config_path);
        assert_eq!(config1.api_socket, config2.api_socket);
        assert_eq!(config1.database_path, config2.database_path);
    }
}
