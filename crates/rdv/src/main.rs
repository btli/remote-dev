//! rdv - Remote Dev Orchestration CLI
//!
//! Multi-agent coordination with self-improvement capabilities.
//! Inspired by Gastown, adapted for Remote Dev's terminal-first architecture.

use anyhow::Result;
use clap::Parser;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

mod cli;
mod commands;
mod config;
mod error;
mod tmux;

use cli::{Cli, Commands};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::from_default_env().add_directive("rdv=info".parse()?))
        .init();

    let cli = Cli::parse();

    // Load configuration
    let config = config::Config::load()?;

    // Execute command
    match cli.command {
        Commands::Master(cmd) => commands::master::execute(cmd, &config).await,
        Commands::Folder(cmd) => commands::folder::execute(cmd, &config).await,
        Commands::Task(cmd) => commands::task::execute(cmd, &config).await,
        Commands::Session(cmd) => commands::session::execute(cmd, &config).await,
        Commands::Monitor(cmd) => commands::monitor::execute(cmd, &config).await,
        Commands::Learn(cmd) => commands::learn::execute(cmd, &config).await,
        Commands::Mail(cmd) => commands::mail::execute(cmd, &config).await,
        Commands::Nudge { session_id, message } => {
            commands::nudge::execute(&session_id, &message, &config).await
        }
        Commands::Escalate(cmd) => commands::escalate::execute(cmd, &config).await,
        Commands::Peek { session_id } => commands::peek::execute(&session_id, &config).await,
        Commands::Doctor => commands::doctor::execute(&config).await,
        Commands::Version => {
            println!("rdv {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
    }
}
