//! rdv-server - Remote Dev backend server
//!
//! REST API and WebSocket server over unix sockets.

use std::path::PathBuf;
use tracing::info;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

mod config;
mod state;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::from_default_env().add_directive("rdv_server=info".parse()?))
        .init();

    info!("rdv-server v{}", env!("CARGO_PKG_VERSION"));

    // Load configuration
    let config = config::Config::load()?;
    info!("Config loaded from {:?}", config.config_path);

    // Check for existing server
    if config.pid_file.exists() {
        let pid_str = std::fs::read_to_string(&config.pid_file)?;
        let pid: i32 = pid_str.trim().parse()?;

        // Check if process is still running
        if process_exists(pid) {
            anyhow::bail!("Server already running with PID {}", pid);
        }

        // Clean up stale files
        info!("Cleaning up stale PID file from previous crash");
        let _ = std::fs::remove_file(&config.pid_file);
        let _ = std::fs::remove_file(&config.api_socket);
        let _ = std::fs::remove_file(&config.terminal_socket);
    }

    // TODO: Generate service token
    // TODO: Create unix sockets
    // TODO: Start axum server
    // TODO: Write PID file

    info!("Server ready (stub - not yet implemented)");

    // Keep running
    tokio::signal::ctrl_c().await?;
    info!("Shutting down...");

    Ok(())
}

/// Check if a process exists by PID
fn process_exists(pid: i32) -> bool {
    // On Unix, sending signal 0 checks if process exists
    unsafe { libc::kill(pid, 0) == 0 }
}
