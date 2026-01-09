//! Folder Orchestrator commands.
//!
//! Folder Orchestrators manage tasks within a specific project/folder.

use anyhow::Result;
use colored::Colorize;
use std::path::PathBuf;

use crate::cli::{FolderCommand, FolderAction};
use crate::config::{Config, FolderConfig};
use crate::tmux;

pub async fn execute(cmd: FolderCommand, config: &Config) -> Result<()> {
    match cmd.action {
        FolderAction::Init { path } => init(&path, config).await,
        FolderAction::Start { path, foreground } => start(&path, foreground, config).await,
        FolderAction::Stop { path } => stop(&path, config).await,
        FolderAction::Status { path } => status(&path, config).await,
        FolderAction::Attach { path } => attach(&path, config).await,
        FolderAction::List => list(config).await,
    }
}

fn resolve_path(path: &str) -> PathBuf {
    if path == "." {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from(path)
    }
}

fn session_name_for_folder(path: &PathBuf) -> String {
    let folder_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    format!("rdv-folder-{}", folder_name)
}

async fn init(path: &str, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    println!("{}", format!("Initializing folder orchestrator in {:?}...", folder_path).cyan());

    // Create .remote-dev directory structure
    let rdv_dir = folder_path.join(".remote-dev");
    let orch_dir = rdv_dir.join("orchestrator");
    let knowledge_dir = rdv_dir.join("knowledge");

    std::fs::create_dir_all(&orch_dir)?;
    std::fs::create_dir_all(&knowledge_dir)?;

    // Create default config
    let folder_config = FolderConfig::default();
    folder_config.save(&folder_path)?;

    println!("{}", "✓ Folder orchestrator initialized".green());
    println!("  Config: {:?}", orch_dir.join("config.toml"));

    Ok(())
}

async fn start(path: &str, foreground: bool, config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);

    // Check if .remote-dev exists
    if !folder_path.join(".remote-dev").exists() {
        println!("{}", "Folder orchestrator not initialized".yellow());
        println!("Run `rdv folder init` first");
        return Ok(());
    }

    // Check if already running
    if tmux::session_exists(&session_name)? {
        println!("{}", "Folder orchestrator is already running".yellow());
        return Ok(());
    }

    println!("{}", format!("Starting folder orchestrator for {:?}...", folder_path).cyan());

    // Create session with agent
    let agent_cmd = config.agent_command(&config.agents.default)
        .unwrap_or("claude");

    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: session_name.clone(),
        working_directory: Some(folder_path.to_string_lossy().to_string()),
        command: Some(agent_cmd.to_string()),
    })?;

    println!("{}", "✓ Folder orchestrator started".green());
    println!("  Session: {}", session_name);

    if foreground {
        tmux::attach_session(&session_name)?;
    } else {
        println!("  Run `rdv folder attach` to connect");
    }

    Ok(())
}

async fn stop(path: &str, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);

    if !tmux::session_exists(&session_name)? {
        println!("{}", "Folder orchestrator is not running".yellow());
        return Ok(());
    }

    println!("{}", "Stopping folder orchestrator...".cyan());
    tmux::kill_session(&session_name)?;
    println!("{}", "✓ Folder orchestrator stopped".green());

    Ok(())
}

async fn status(path: &str, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);

    println!("{}", format!("Folder Orchestrator Status: {:?}", folder_path).cyan().bold());
    println!("{}", "─".repeat(50));

    // Check initialization
    let initialized = folder_path.join(".remote-dev").exists();
    println!("  Initialized: {}", if initialized { "Yes".green() } else { "No".red() });

    if !initialized {
        println!("\n  Run `rdv folder init` to initialize");
        return Ok(());
    }

    // Check running status
    if tmux::session_exists(&session_name)? {
        if let Some(info) = tmux::get_session_info(&session_name)? {
            println!("  Status: {}", "RUNNING".green());
            println!("  Session: {}", info.name);
            println!("  Attached: {}", if info.attached { "Yes" } else { "No" });
        }
    } else {
        println!("  Status: {}", "STOPPED".yellow());
    }

    // Load folder config
    if let Ok(folder_config) = FolderConfig::load(&folder_path) {
        if let Some(agent) = folder_config.preferred_agent {
            println!("  Preferred Agent: {}", agent);
        }
    }

    Ok(())
}

async fn attach(path: &str, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);

    if !tmux::session_exists(&session_name)? {
        println!("{}", "Folder orchestrator is not running".yellow());
        println!("Run `rdv folder start` to start it first");
        return Ok(());
    }

    tmux::attach_session(&session_name)?;
    Ok(())
}

async fn list(_config: &Config) -> Result<()> {
    println!("{}", "Folder Orchestrators".cyan().bold());
    println!("{}", "─".repeat(50));

    let sessions = tmux::list_sessions()?;
    let folder_sessions: Vec<_> = sessions
        .iter()
        .filter(|s| s.name.starts_with("rdv-folder-"))
        .collect();

    if folder_sessions.is_empty() {
        println!("  No folder orchestrators running");
    } else {
        for session in folder_sessions {
            let status = if session.attached { "attached" } else { "detached" };
            println!("  {} ({})", session.name, status);
        }
    }

    Ok(())
}
