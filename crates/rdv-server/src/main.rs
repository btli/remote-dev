//! rdv-server - Remote Dev backend server
//!
//! REST API and WebSocket server over unix sockets.

use anyhow::Context;
use hyper::server::conn::http1;
use hyper_util::rt::TokioIo;
use rdv_core::{auth::ServiceToken, Database};
use std::fs::{self, Permissions};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use tokio::net::UnixListener;
use tokio::signal;
use tower::ServiceExt;
use tracing::{error, info, warn};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

mod config;
mod middleware;
mod routes;
mod services;
mod state;

use config::Config;
use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::from_default_env().add_directive("rdv_server=info".parse()?))
        .init();

    info!("rdv-server v{}", env!("CARGO_PKG_VERSION"));

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
