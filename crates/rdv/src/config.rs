use std::env;
use std::path::PathBuf;

/// How the CLI connects to the terminal server.
#[derive(Debug, Clone)]
pub enum ConnectionMethod {
    /// Unix domain socket path.
    UnixSocket(PathBuf),
    /// TCP host:port.
    Tcp(String),
}

/// Resolved server connection configuration.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub method: ConnectionMethod,
    pub session_id: Option<String>,
    /// TCP port used as fallback when reqwest can't use Unix sockets directly.
    tcp_port: u16,
}

impl ServerConfig {
    /// Build config from environment variables.
    ///
    /// Priority:
    /// 1. `RDV_TERMINAL_SOCKET` -> Unix socket (explicit override)
    /// 2. `RDV_TERMINAL_PORT`   -> TCP localhost:<port> (explicit override)
    /// 3. No env vars (auto-detect):
    ///    - Production: prefer Unix socket at `~/.remote-dev/run/terminal.sock`
    ///    - Dev fallback: TCP localhost:6002
    pub fn from_env() -> Self {
        let session_id = env::var("RDV_SESSION_ID").ok();
        let env_port = env::var("RDV_TERMINAL_PORT")
            .ok()
            .and_then(|p| p.parse::<u16>().ok());
        let tcp_port = env_port.unwrap_or(6002);

        let method = if let Ok(sock) = env::var("RDV_TERMINAL_SOCKET") {
            ConnectionMethod::UnixSocket(PathBuf::from(sock))
        } else if let Some(port) = env_port {
            ConnectionMethod::Tcp(format!("localhost:{port}"))
        } else {
            // Auto-detect: production prefers Unix socket, dev falls back to TCP
            let default_sock = dirs_fallback().join("run/terminal.sock");
            if default_sock.exists() {
                ConnectionMethod::UnixSocket(default_sock)
            } else {
                ConnectionMethod::Tcp(format!("localhost:{tcp_port}"))
            }
        };

        Self { method, session_id, tcp_port }
    }

    /// HTTP base URL used by reqwest.
    ///
    /// Unix socket transport requires hyper-unix-connector (future improvement).
    /// For now, Unix socket connections fall back to TCP on the configured port.
    pub fn base_url(&self) -> String {
        match &self.method {
            ConnectionMethod::UnixSocket(_) => format!("http://localhost:{}", self.tcp_port),
            ConnectionMethod::Tcp(addr) => format!("http://{addr}"),
        }
    }
}

/// Return `~/.remote-dev` without pulling in the `dirs` crate.
fn dirs_fallback() -> PathBuf {
    env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
        .join(".remote-dev")
}
