use std::env;
use std::path::PathBuf;

/// How the CLI connects to a server.
#[derive(Debug, Clone)]
pub enum ConnectionMethod {
    /// Unix domain socket path.
    UnixSocket(PathBuf),
    /// TCP host:port.
    Tcp(String),
}

/// Resolved dual-server connection configuration.
///
/// The CLI talks to two servers:
/// - **API** (Next.js): handles `/api/*` routes (sessions, tasks, notifications, etc.)
/// - **Terminal**: handles `/internal/*` routes (agent status, todo sync, stop check)
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Next.js API server connection.
    pub api: ConnectionMethod,
    /// Terminal server connection.
    pub terminal: ConnectionMethod,
    pub session_id: Option<String>,
    /// Bearer token for API authentication.
    pub api_key: Option<String>,
}

impl ServerConfig {
    /// Build config from environment variables.
    ///
    /// API server priority:
    /// 1. `RDV_API_SOCKET` -> Unix socket (explicit)
    /// 2. `RDV_API_PORT` -> TCP localhost:<port>
    /// 3. Auto-detect `~/.remote-dev/run/nextjs.sock`
    /// 4. Fallback TCP localhost:6001
    ///
    /// Terminal server priority:
    /// 1. `RDV_TERMINAL_SOCKET` -> Unix socket (explicit)
    /// 2. `RDV_TERMINAL_PORT` -> TCP localhost:<port>
    /// 3. Auto-detect `~/.remote-dev/run/terminal.sock`
    /// 4. Fallback TCP localhost:6002
    pub fn from_env() -> Self {
        let session_id = env::var("RDV_SESSION_ID").ok();
        let base_dir = dirs_fallback();

        // API key: env var takes precedence, then file-based local key.
        // The local key file (~/.remote-dev/rdv/.local-key) is written by the
        // server at startup with mode 0600. It shares the same trust boundary
        // as the user's shell -- any process running as this OS user can read it.
        let api_key = env::var("RDV_API_KEY")
            .ok()
            .or_else(|| {
                let key_file = base_dir.join("rdv/.local-key");
                std::fs::read_to_string(key_file)
                    .ok()
                    .map(|s| s.trim().to_string())
            })
            .filter(|k| !k.is_empty());

        let api = resolve_connection(
            "RDV_API_SOCKET",
            "RDV_API_PORT",
            base_dir.join("run/nextjs.sock"),
            6001,
        );

        let terminal = resolve_connection(
            "RDV_TERMINAL_SOCKET",
            "RDV_TERMINAL_PORT",
            base_dir.join("run/terminal.sock"),
            6002,
        );

        Self {
            api,
            terminal,
            session_id,
            api_key,
        }
    }

    /// HTTP base URL for the API (Next.js) server.
    pub fn api_base_url(&self) -> String {
        base_url_for(&self.api)
    }

    /// HTTP base URL for the terminal server.
    pub fn terminal_base_url(&self) -> String {
        base_url_for(&self.terminal)
    }
}

/// Resolve a connection method from env vars with auto-detect fallback.
fn resolve_connection(
    socket_env: &str,
    port_env: &str,
    default_socket: PathBuf,
    default_port: u16,
) -> ConnectionMethod {
    if let Ok(sock) = env::var(socket_env) {
        return ConnectionMethod::UnixSocket(PathBuf::from(sock));
    }
    if let Some(port) = env::var(port_env).ok().and_then(|p| p.parse::<u16>().ok()) {
        return ConnectionMethod::Tcp(format!("localhost:{port}"));
    }
    if default_socket.exists() {
        return ConnectionMethod::UnixSocket(default_socket);
    }
    ConnectionMethod::Tcp(format!("localhost:{default_port}"))
}

/// HTTP base URL for a connection method.
///
/// Unix socket mode uses `http://localhost` (reqwest ignores the hostname
/// when routing through a socket). TCP mode uses `http://{host}:{port}`.
fn base_url_for(method: &ConnectionMethod) -> String {
    match method {
        ConnectionMethod::UnixSocket(_) => "http://localhost".to_string(),
        ConnectionMethod::Tcp(addr) => format!("http://{addr}"),
    }
}

/// Return `~/.remote-dev` without pulling in the `dirs` crate.
fn dirs_fallback() -> PathBuf {
    env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
        .join(".remote-dev")
}
