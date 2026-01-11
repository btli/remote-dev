//! rdv-server - Remote Dev backend server
//!
//! REST API and WebSocket server over unix sockets.
//! Also supports MCP (Model Context Protocol) over stdio.

use anyhow::Context;
use hyper::server::conn::http1;
use hyper_util::rt::TokioIo;
use rdv_core::{auth::ServiceToken, Database};
use std::fs::{self, Permissions};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;
use tokio::net::UnixListener;
use tokio::signal;
use tower::ServiceExt;
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

mod config;
mod mcp;
mod middleware;
mod routes;
mod services;
mod state;

use config::Config;
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Check for MCP mode
    let args: Vec<String> = std::env::args().collect();
    let mcp_mode = args.iter().any(|a| a == "--mcp" || a == "-m");

    // Initialize logging (to stderr in MCP mode to keep stdout clean)
    if mcp_mode {
        tracing_subscriber::registry()
            .with(fmt::layer().with_writer(std::io::stderr))
            .with(EnvFilter::from_default_env().add_directive("rdv_server=info".parse()?))
            .init();
    } else {
        tracing_subscriber::registry()
            .with(fmt::layer())
            .with(EnvFilter::from_default_env().add_directive("rdv_server=info".parse()?))
            .init();
    }

    info!("rdv-server v{}", env!("CARGO_PKG_VERSION"));

    // Run MCP mode if requested
    if mcp_mode {
        return run_mcp_server().await;
    }

    // Load configuration
    let config = Config::load()?;
    info!("Config loaded from {:?}", config.config_path);

    // Check for existing server
    check_existing_server(&config)?;

    // Initialize database
    let db = Database::open_path(&config.database_path)
        .context("Failed to open database")?;
    info!("Database opened at {:?}", config.database_path);

    // Generate or load service token
    let service_token = if config.service_token_file.exists() {
        ServiceToken::read_from_file(&config.service_token_file)
            .context("Failed to read service token")?
    } else {
        let token = ServiceToken::generate();
        token
            .write_to_file(&config.service_token_file)
            .context("Failed to write service token")?;
        info!("Generated new service token");
        token
    };

    // Create application state
    let state = AppState::new(config.clone(), db, service_token);

    // Register SDK tools
    if let Err(e) = mcp::register_sdk_tools(
        state.extension_router(),
        Arc::clone(&state.db),
    ).await {
        warn!("Failed to register SDK tools: {}", e);
    }

    // Load CLI tokens from database
    load_cli_tokens(&state).await?;

    // Create router
    let app = routes::create_router(state.clone());

    // Create Unix socket for API
    let api_listener = create_unix_socket(&config.api_socket)
        .context("Failed to create API socket")?;
    info!("API socket listening at {:?}", config.api_socket);

    // Write PID file
    let pid = std::process::id();
    fs::write(&config.pid_file, pid.to_string())
        .context("Failed to write PID file")?;
    info!("PID file written: {} (PID: {})", config.pid_file.display(), pid);

    info!("Server ready - accepting connections");

    // Run server with graceful shutdown
    let server = tokio::spawn(async move {
        loop {
            match api_listener.accept().await {
                Ok((stream, _)) => {
                    let app = app.clone();
                    tokio::spawn(async move {
                        let io = TokioIo::new(stream);
                        let service = hyper::service::service_fn(move |req| {
                            let app = app.clone();
                            async move {
                                app.oneshot(req).await.map_err(|e| {
                                    error!("Request error: {}", e);
                                    std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
                                })
                            }
                        });

                        if let Err(e) = http1::Builder::new()
                            .serve_connection(io, service)
                            .await
                        {
                            error!("Connection error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Accept error: {}", e);
                }
            }
        }
    });

    // Wait for shutdown signal
    shutdown_signal().await;
    info!("Shutdown signal received");

    // Cleanup
    server.abort();
    cleanup(&config);

    info!("Shutdown complete");
    Ok(())
}

/// Check for existing server and handle crash recovery
fn check_existing_server(config: &Config) -> anyhow::Result<()> {
    if !config.pid_file.exists() {
        return Ok(());
    }

    let pid_str = fs::read_to_string(&config.pid_file)?;
    let pid: i32 = pid_str.trim().parse()?;

    // Check if process is still running
    if process_exists(pid) {
        anyhow::bail!("Server already running with PID {}", pid);
    }

    // Previous instance crashed - clean up
    warn!("Detected crash of previous instance (PID {})", pid);
    cleanup(config);

    Ok(())
}

/// Check if a process exists
fn process_exists(pid: i32) -> bool {
    // Use kill with signal 0 to check if process exists
    unsafe { libc::kill(pid, 0) == 0 }
}

/// Create a Unix socket with proper permissions
fn create_unix_socket(path: &Path) -> anyhow::Result<UnixListener> {
    // Remove existing socket if present
    if path.exists() {
        fs::remove_file(path)?;
    }

    // Create parent directory with restricted permissions
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        fs::set_permissions(parent, Permissions::from_mode(0o700))?;
    }

    // Bind socket
    let listener = UnixListener::bind(path)?;

    // Set socket permissions (owner read/write only)
    fs::set_permissions(path, Permissions::from_mode(0o600))?;

    Ok(listener)
}

/// Clean up server files
fn cleanup(config: &Config) {
    let _ = fs::remove_file(&config.pid_file);
    let _ = fs::remove_file(&config.api_socket);
    let _ = fs::remove_file(&config.terminal_socket);
    info!("Cleaned up server files");
}

/// Load CLI tokens from database into memory for fast validation
async fn load_cli_tokens(state: &std::sync::Arc<AppState>) -> anyhow::Result<()> {
    let tokens = state
        .db
        .get_all_cli_tokens_for_validation()
        .context("Failed to load CLI tokens")?;

    let count = tokens.len();
    let entries: Vec<state::CLITokenEntry> = tokens
        .into_iter()
        .map(|t| {
            // Decode hex hash to bytes for in-memory comparison
            let hash_bytes = hex::decode(&t.key_hash).unwrap_or_else(|_| vec![0u8; 32]);
            let mut token_hash = [0u8; 32];
            if hash_bytes.len() >= 32 {
                token_hash.copy_from_slice(&hash_bytes[..32]);
            }
            state::CLITokenEntry {
                token_hash,
                user_id: t.user_id,
                token_id: t.id,
                name: t.name,
            }
        })
        .collect();

    state.cli_tokens.load_from_db(entries).await;
    info!("Loaded {} CLI tokens from database", count);
    Ok(())
}

/// Wait for shutdown signal
async fn shutdown_signal() {
    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("Failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("Failed to install SIGTERM handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

/// Run MCP server over stdio
async fn run_mcp_server() -> anyhow::Result<()> {
    use rmcp::transport::io::stdio;
    use rmcp::ServiceExt;

    info!("Starting MCP server over stdio");

    // Open database directly (no full config needed for MCP)
    let db = Database::open().context("Failed to open database")?;

    // Create a minimal service token for MCP mode
    let service_token = ServiceToken::generate();

    // Create minimal config for MCP
    let config = Config::load().unwrap_or_else(|_| Config::default());

    // Create application state
    let state = AppState::new(config, db, service_token);

    // Register SDK tools
    if let Err(e) = mcp::register_sdk_tools(
        state.extension_router(),
        Arc::clone(&state.db),
    ).await {
        warn!("Failed to register SDK tools: {}", e);
    }

    // Create MCP server
    let mcp_server = mcp::McpServer::new(state);

    // Create stdio transport
    let transport = stdio();

    // Serve MCP protocol
    info!("MCP server ready - awaiting client connection");
    let server = mcp_server.serve(transport).await?;

    // Wait for server to complete
    let quit_reason = server.waiting().await?;
    info!("MCP server shutdown: {:?}", quit_reason);

    Ok(())
}
