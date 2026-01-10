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
use crate::db::{Database, NewFolder, NewOrchestrator, NewSession};
use crate::error::RdvError;
use crate::tmux;

pub async fn execute(cmd: FolderCommand, config: &Config) -> Result<()> {
    match cmd.action {
        FolderAction::Add { path, name } => add(&path, name.as_deref(), config).await,
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

/// Add folder to database (register for orchestration)
async fn add(path: &str, custom_name: Option<&str>, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let folder_name = custom_name
        .map(|s| s.to_string())
        .or_else(|| folder_path.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "unknown".to_string());

    println!(
        "{}",
        format!("Adding folder '{}' to database...", folder_name).cyan()
    );

    // Open database
    let db = Database::open()?;
    let user = db
        .get_default_user()?
        .ok_or_else(|| anyhow::anyhow!("No user found in database. Start the web UI first."))?;

    // Check if folder already exists
    if let Some(existing) = db.get_folder_by_name(&user.id, &folder_name)? {
        println!(
            "  {} Folder already registered: {}",
            "→".yellow(),
            &existing.id[..8]
        );
        return Ok(());
    }

    // Create folder record
    let folder_id = db.create_folder(&NewFolder {
        user_id: user.id.clone(),
        name: folder_name.clone(),
        parent_id: None, // Top-level folder
    })?;

    println!("{}", "✓ Folder registered".green());
    println!("  Name: {}", folder_name);
    println!("  ID: {}", &folder_id[..8]);
    println!("  Path: {:?}", folder_path);
    println!();
    println!("  Next steps:");
    println!("    rdv folder init {}   # Initialize orchestrator config", path);
    println!("    rdv folder start {}  # Start folder orchestrator", path);

    Ok(())
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
    let mut folder_config = FolderConfig::load(&folder_path).unwrap_or_default();

    // Determine agent to use
    let agent_name = folder_config
        .preferred_agent
        .clone()
        .unwrap_or_else(|| config.agents.default.clone());
    let agent_cmd = config.agent_command(&agent_name).unwrap_or("claude");

    // Check database for existing orchestrator
    let db = Database::open()?;
    let user = db
        .get_default_user()?
        .ok_or_else(|| anyhow::anyhow!("No user found in database. Start the web UI first."))?;

    // Find folder by name in database
    let folders = db.list_folders(&user.id)?;
    let folder_name = folder_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let db_folder = folders.iter().find(|f| f.name == folder_name).cloned();

    // Auto-add folder to database if not exists
    let folder = if let Some(existing) = db_folder {
        existing
    } else {
        println!(
            "  {} Folder not in database, auto-registering...",
            "→".cyan()
        );
        let folder_id = db.create_folder(&NewFolder {
            user_id: user.id.clone(),
            name: folder_name.clone(),
            parent_id: None,
        })?;
        println!("  {} Registered folder: {}", "✓".green(), &folder_id[..8]);

        // Fetch the created folder
        db.get_folder(&folder_id)?
            .ok_or_else(|| anyhow::anyhow!("Failed to fetch created folder"))?
    };

    // Check for existing orchestrator or create new one
    let orchestrator_id = if let Ok(Some(orch)) = db.get_folder_orchestrator(&user.id, &folder.id) {
        println!("  {} Existing orchestrator: {}", "→".cyan(), &orch.id[..8]);

        // Reactivate if suspended
        db.update_session_status(&orch.session_id, "active")?;
        db.update_orchestrator_status(&orch.id, "idle")?;

        orch.id.clone()
    } else {
        // No orchestrator - create session and orchestrator
        println!(
            "  {} Creating Folder Control in database...",
            "→".cyan()
        );

        // Create terminal session record
        let new_session_id = db.create_session(&NewSession {
            user_id: user.id.clone(),
            name: format!("{} Control", folder_name),
            tmux_session_name: session_name.clone(),
            project_path: Some(folder_path_str.clone()),
            folder_id: Some(folder.id.clone()),
            agent_provider: Some(agent_name.clone()),
            is_orchestrator_session: true,
        })?;
        println!("  {} Created session: {}", "✓".green(), &new_session_id[..8]);

        // Create orchestrator record
        let new_orch_id = db.create_orchestrator(&NewOrchestrator {
            session_id: new_session_id,
            user_id: user.id.clone(),
            orchestrator_type: "sub_orchestrator".to_string(),
            scope_type: Some("folder".to_string()),
            scope_id: Some(folder.id.clone()),
            custom_instructions: None,
            monitoring_interval: 30,
            stall_threshold: 300,
            auto_intervention: false,
        })?;
        println!(
            "  {} Created orchestrator: {}",
            "✓".green(),
            &new_orch_id[..8]
        );

        new_orch_id
    };

    // Save orchestrator ID to local config for future reference
    folder_config.orchestrator_id = Some(orchestrator_id.clone());
    folder_config.save(&folder_path)?;

    // Create tmux session with agent
    // Enable auto_respawn so agent restarts immediately if it exits
    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: session_name.clone(),
        working_directory: Some(folder_path_str),
        command: Some(agent_cmd.to_string()),
        auto_respawn: true, // Restart agent on exit via pane-died hook
        env: None,
    })?;

    println!("{}", "✓ Folder orchestrator started".green());
    println!("  Session: {}", session_name);
    println!("  Orchestrator ID: {}", &orchestrator_id[..8]);

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
        return Err(RdvError::OrchestratorNotFound(
            format!("Folder orchestrator for '{}' is not running. Run `rdv folder start` first.",
                    folder_path.display())
        ).into());
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
