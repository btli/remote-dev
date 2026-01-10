//! Folder Orchestrator commands.
//!
//! Folder Orchestrators manage tasks within a specific project/folder.
//!
//! Direct database integration (direct SQLite):
//! - Reads folder and orchestrator records from SQLite
//! - Uses tmux directly for session control
//! - No HTTP API needed for most operations

use anyhow::Result;
use colored::Colorize;
use std::path::PathBuf;

use crate::cli::{FolderAction, FolderCommand};
use crate::config::{Config, FolderConfig};
use crate::db::Database;
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
    let p = if path == "." {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from(path)
    };
    // Canonicalize to get absolute path
    p.canonicalize().unwrap_or(p)
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
    println!(
        "{}",
        format!("Initializing folder orchestrator in {:?}...", folder_path).cyan()
    );

    // Create .remote-dev directory structure
    let rdv_dir = folder_path.join(".remote-dev");
    let orch_dir = rdv_dir.join("orchestrator");
    let knowledge_dir = rdv_dir.join("knowledge");

    std::fs::create_dir_all(&orch_dir)?;
    std::fs::create_dir_all(&knowledge_dir)?;

    // Create default config
    let folder_config = FolderConfig::default();

    // Check database for existing folder (direct SQLite, direct SQLite)
    if let Ok(db) = Database::open() {
        if let Ok(Some(user)) = db.get_default_user() {
            let folders = db.list_folders(&user.id)?;
            let folder_name = folder_path.file_name().map(|n| n.to_string_lossy().to_string());
            if let Some(name) = folder_name {
                if let Some(folder) = folders.iter().find(|f| f.name == name) {
                    println!("  {} Found existing folder: {}", "→".cyan(), folder.name);
                } else {
                    println!("  {} Folder not registered in database yet", "→".cyan());
                    println!("    (Will register when orchestrator starts via web UI)");
                }
            }
        }
    }

    folder_config.save(&folder_path)?;

    println!("{}", "✓ Folder orchestrator initialized".green());
    println!("  Config: {:?}", orch_dir.join("config.toml"));

    Ok(())
}

async fn start(path: &str, foreground: bool, config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);
    let folder_path_str = folder_path.to_string_lossy().to_string();

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

    println!(
        "{}",
        format!("Starting folder orchestrator for {:?}...", folder_path).cyan()
    );

    // Load folder config
    let folder_config = FolderConfig::load(&folder_path).unwrap_or_default();

    // Determine agent to use
    let agent_name = folder_config
        .preferred_agent
        .clone()
        .unwrap_or_else(|| config.agents.default.clone());
    let agent_cmd = config.agent_command(&agent_name).unwrap_or("claude");

    // Check database for existing orchestrator (direct SQLite, direct SQLite)
    if let Ok(db) = Database::open() {
        if let Ok(Some(user)) = db.get_default_user() {
            // Find folder by name
            let folders = db.list_folders(&user.id)?;
            let folder_name = folder_path.file_name().map(|n| n.to_string_lossy().to_string());
            if let Some(name) = folder_name {
                if let Some(folder) = folders.iter().find(|f| f.name == name) {
                    if let Ok(Some(orch)) = db.get_folder_orchestrator(&user.id, &folder.id) {
                        println!("  {} Existing orchestrator: {}", "→".cyan(), &orch.id[..8]);
                    }
                }
            }
        }
    }

    // Create tmux session directly (direct SQLite)
    // The web app will detect and track the session
    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: session_name.clone(),
        working_directory: Some(folder_path_str),
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

    // Stop tmux session directly (direct SQLite)
    tmux::kill_session(&session_name)?;
    println!("{}", "✓ Folder orchestrator stopped".green());

    Ok(())
}

async fn status(path: &str, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);

    println!(
        "{}",
        format!("Folder Orchestrator Status: {:?}", folder_path)
            .cyan()
            .bold()
    );
    println!("{}", "─".repeat(60));

    // Check initialization
    let initialized = folder_path.join(".remote-dev").exists();
    println!(
        "  Initialized: {}",
        if initialized {
            "Yes".green()
        } else {
            "No".red()
        }
    );

    if !initialized {
        println!("\n  Run `rdv folder init` to initialize");
        return Ok(());
    }

    // Load folder config
    let folder_config = FolderConfig::load(&folder_path).unwrap_or_default();

    // tmux status
    let tmux_running = tmux::session_exists(&session_name)?;
    if tmux_running {
        if let Some(info) = tmux::get_session_info(&session_name)? {
            println!("  tmux Status: {}", "RUNNING".green());
            println!("  tmux Session: {}", info.name);
            println!(
                "  Attached: {}",
                if info.attached { "Yes" } else { "No" }
            );
        }
    } else {
        println!("  tmux Status: {}", "STOPPED".yellow());
    }

    // Local config
    if let Some(ref agent) = folder_config.preferred_agent {
        println!("  Preferred Agent: {}", agent);
    }

    // Database status (direct SQLite, direct SQLite)
    println!();
    match Database::open() {
        Ok(db) => {
            println!("  Database: {}", "Connected".green());

            if let Ok(Some(user)) = db.get_default_user() {
                // Find folder by name
                let folders = db.list_folders(&user.id)?;
                let folder_name = folder_path.file_name().map(|n| n.to_string_lossy().to_string());
                if let Some(name) = folder_name {
                    if let Some(folder) = folders.iter().find(|f| f.name == name) {
                        println!("  Folder ID: {}", &folder.id[..8]);

                        // Check orchestrator
                        if let Ok(Some(orch)) = db.get_folder_orchestrator(&user.id, &folder.id) {
                            println!("  Orchestrator ID: {}", &orch.id[..8]);
                            println!(
                                "  DB Status: {}",
                                match orch.status.as_str() {
                                    "running" => "RUNNING".green(),
                                    "stopped" => "STOPPED".red(),
                                    "paused" => "PAUSED".yellow(),
                                    _ => orch.status.normal(),
                                }
                            );
                            println!(
                                "  Auto Intervention: {}",
                                if orch.auto_intervention {
                                    "Enabled".green()
                                } else {
                                    "Disabled".yellow()
                                }
                            );
                        } else if let Some(ref id) = folder_config.orchestrator_id {
                            println!("  Orchestrator ID: {} (cached)", &id[..8]);
                            println!("  DB Status: {}", "Not found".yellow());
                        } else {
                            println!("  Orchestrator: {}", "Not created".yellow());
                        }
                    } else {
                        println!("  Folder: {}", "Not registered in database".yellow());
                    }
                }
            }
        }
        Err(e) => {
            println!("  Database: {} ({})", "Unavailable".red(), e);
            if let Some(ref id) = folder_config.orchestrator_id {
                println!("  Orchestrator ID: {} (cached)", &id[..8]);
            }
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
    println!("{}", "─".repeat(60));

    // Local tmux sessions
    let sessions = tmux::list_sessions()?;
    let folder_sessions: Vec<_> = sessions
        .iter()
        .filter(|s| s.name.starts_with("rdv-folder-"))
        .collect();

    println!("  {}", "Local (tmux):".cyan());
    if folder_sessions.is_empty() {
        println!("    No folder orchestrators running locally");
    } else {
        for session in &folder_sessions {
            let status = if session.attached {
                "attached".green()
            } else {
                "detached".yellow()
            };
            println!("    {} ({})", session.name, status);
        }
    }

    // Database orchestrators (direct SQLite)
    match Database::open() {
        Ok(db) => {
            println!();
            println!("  {}", "Database:".cyan());

            if let Ok(Some(user)) = db.get_default_user() {
                let orchestrators = db.list_orchestrators(&user.id)?;
                let folder_orchestrators: Vec<_> = orchestrators
                    .iter()
                    .filter(|o| o.scope_type.as_deref() == Some("folder"))
                    .collect();

                if folder_orchestrators.is_empty() {
                    println!("    No folder orchestrators registered");
                } else {
                    for orch in folder_orchestrators {
                        let status = match orch.status.as_str() {
                            "running" => "running".green(),
                            "stopped" => "stopped".red(),
                            "paused" => "paused".yellow(),
                            _ => orch.status.normal(),
                        };
                        let scope = orch.scope_id.as_deref().unwrap_or("unknown");
                        let id_short = if orch.id.len() >= 8 { &orch.id[..8] } else { &orch.id };
                        println!("    {} ({}) - scope: {}", id_short, status, scope);
                    }
                }
            }
        }
        Err(_) => {
            println!();
            println!("  {}", "Database: Unavailable".red());
        }
    }

    Ok(())
}
