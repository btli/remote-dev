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
}

impl ServerConfig {
    /// Build config from environment variables.
    ///
    /// Priority:
    /// 1. `RDV_TERMINAL_SOCKET` -> Unix socket
    /// 2. `RDV_TERMINAL_PORT`   -> localhost:<port>
    /// 3. Fallback: `~/.remote-dev/run/terminal.sock` (if exists) or `localhost:6002`
    pub fn from_env() -> Self {
        let session_id = env::var("RDV_SESSION_ID").ok();

        let method = if let Ok(sock) = env::var("RDV_TERMINAL_SOCKET") {
            ConnectionMethod::UnixSocket(PathBuf::from(sock))
        } else if let Ok(port) = env::var("RDV_TERMINAL_PORT") {
            ConnectionMethod::Tcp(format!("localhost:{port}"))
        } else {
            let default_sock = dirs_fallback().join("run/terminal.sock");
            if default_sock.exists() {
                ConnectionMethod::UnixSocket(default_sock)
            } else {
                ConnectionMethod::Tcp("localhost:6002".into())
            }
        };

        Self { method, session_id }
    }

    /// HTTP base URL used by reqwest.
    ///
    /// For Unix sockets this returns a placeholder authority; actual socket
    /// transport is a TODO (requires hyper-unix-connector or similar).
    pub fn base_url(&self) -> String {
        match &self.method {
            // TODO: Unix socket transport – for now we fall back to localhost.
            ConnectionMethod::UnixSocket(_) => "http://localhost:6002".into(),
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
