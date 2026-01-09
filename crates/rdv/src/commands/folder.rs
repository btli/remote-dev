//! Folder Orchestrator commands.
//!
//! Folder Orchestrators manage tasks within a specific project/folder.
//!
//! Integration with Remote Dev API:
//! - Creates folder in database if not exists
//! - Creates folder orchestrator record on start
//! - Persists state locally and syncs with API
//! - Updates status on lifecycle events

use anyhow::{Context, Result};
use colored::Colorize;
use std::path::PathBuf;

use crate::api::ApiClient;
use crate::cli::{FolderAction, FolderCommand};
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

async fn init(path: &str, config: &Config) -> Result<()> {
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

    // Try to register with Remote Dev API
    let api = ApiClient::new(config)?;
    if api.health_check().await.unwrap_or(false) {
        // Check if folder exists in API
        let folder_path_str = folder_path.to_string_lossy().to_string();
        if let Ok(Some(folder)) = api.get_folder_by_path(&folder_path_str).await {
            println!("  {} Found existing folder: {}", "→".cyan(), folder.name);
        } else {
            println!("  {} Folder not registered in API yet", "→".cyan());
            println!("    (Will register when orchestrator starts)");
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

    // Try to integrate with Remote Dev API
    let api = ApiClient::new(config)?;
    let api_available = api.health_check().await.unwrap_or(false);

    if api_available {
        // Find or get folder from API
        let folder = api.get_folder_by_path(&folder_path_str).await?;

        if let Some(folder) = folder {
            // Check if orchestrator exists for this folder
            let orchestrator = api.get_folder_orchestrator(&folder.id).await?;

            if let Some(orch) = orchestrator {
                // Reuse existing orchestrator
                folder_config.orchestrator_id = Some(orch.id.clone());
                println!("  {} Existing orchestrator: {}", "→".cyan(), &orch.id[..8]);

                // Update status to running
                api.update_orchestrator_status(&orch.id, "running").await?;
            } else {
                // Create session first
                let session = api
                    .create_session(crate::api::CreateSessionRequest {
                        name: format!(
                            "Folder Orchestrator: {}",
                            folder_path.file_name().unwrap_or_default().to_string_lossy()
                        ),
                        folder_id: Some(folder.id.clone()),
                        working_directory: Some(folder_path_str.clone()),
                        agent_provider: Some(agent_name.clone()),
                        worktree_id: None,
                    })
                    .await
                    .context("Failed to create folder orchestrator session")?;

                // Create folder orchestrator
                let orchestrator = api
                    .create_folder_orchestrator(&folder.id, &session.id)
                    .await
                    .context("Failed to create folder orchestrator")?;

                folder_config.orchestrator_id = Some(orchestrator.id.clone());
                println!(
                    "  {} Created orchestrator: {}",
                    "✓".green(),
                    &orchestrator.id[..8]
                );
            }

            folder_config.save(&folder_path)?;
        } else {
            println!(
                "  {}",
                "⚠ Folder not registered in API, running locally".yellow()
            );
        }
    } else {
        println!(
            "  {}",
            "⚠ API unavailable, running in local-only mode".yellow()
        );
    }

    // Create tmux session
    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: session_name.clone(),
        working_directory: Some(folder_path_str),
        command: Some(agent_cmd.to_string()),
    })?;

    println!("{}", "✓ Folder orchestrator started".green());
    println!("  Session: {}", session_name);
    if let Some(ref id) = folder_config.orchestrator_id {
        println!("  Orchestrator ID: {}", &id[..8]);
    }

    if foreground {
        tmux::attach_session(&session_name)?;
    } else {
        println!("  Run `rdv folder attach` to connect");
    }

    Ok(())
}

async fn stop(path: &str, config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);

    if !tmux::session_exists(&session_name)? {
        println!("{}", "Folder orchestrator is not running".yellow());
        return Ok(());
    }

    println!("{}", "Stopping folder orchestrator...".cyan());

    // Update API status
    let folder_config = FolderConfig::load(&folder_path).unwrap_or_default();
    let api = ApiClient::new(config)?;

    if api.health_check().await.unwrap_or(false) {
        if let Some(ref orch_id) = folder_config.orchestrator_id {
            api.update_orchestrator_status(orch_id, "stopped").await?;
            println!("  {} Updated orchestrator status", "✓".green());
        }
    }

    tmux::kill_session(&session_name)?;
    println!("{}", "✓ Folder orchestrator stopped".green());

    Ok(())
}

async fn status(path: &str, config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);
    let folder_path_str = folder_path.to_string_lossy().to_string();

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

    // API status
    println!();
    let api = ApiClient::new(config)?;
    if api.health_check().await.unwrap_or(false) {
        println!("  API: {}", "Connected".green());

        // Check folder registration
        if let Ok(Some(folder)) = api.get_folder_by_path(&folder_path_str).await {
            println!("  Folder ID: {}", &folder.id[..8]);

            // Check orchestrator
            if let Ok(Some(orch)) = api.get_folder_orchestrator(&folder.id).await {
                println!("  Orchestrator ID: {}", &orch.id[..8]);
                println!(
                    "  API Status: {}",
                    match orch.status.as_str() {
                        "running" => "RUNNING".green(),
                        "stopped" => "STOPPED".red(),
                        "paused" => "PAUSED".yellow(),
                        _ => orch.status.normal(),
                    }
                );
                println!(
                    "  Monitoring: {}",
                    if orch.config.monitoring_enabled {
                        "Enabled".green()
                    } else {
                        "Disabled".yellow()
                    }
                );
            } else if let Some(ref id) = folder_config.orchestrator_id {
                println!("  Orchestrator ID: {} (cached)", &id[..8]);
                println!("  API Status: {}", "Not found".yellow());
            } else {
                println!("  Orchestrator: {}", "Not created".yellow());
            }
        } else {
            println!("  Folder: {}", "Not registered in API".yellow());
        }
    } else {
        println!("  API: {}", "Disconnected".red());
        if let Some(ref id) = folder_config.orchestrator_id {
            println!("  Orchestrator ID: {} (cached)", &id[..8]);
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

async fn list(config: &Config) -> Result<()> {
    println!("{}", "Folder Orchestrators".cyan().bold());
    println!("{}", "─".repeat(60));

    // Local tmux sessions
    let sessions = tmux::list_sessions()?;
    let folder_sessions: Vec<_> = sessions
        .iter()
        .filter(|s| s.name.starts_with("rdv-folder-"))
        .collect();

    // API orchestrators
    let api = ApiClient::new(config)?;
    let api_available = api.health_check().await.unwrap_or(false);

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

    if api_available {
        println!();
        println!("  {}", "Remote Dev API:".cyan());

        // Get all folders and check for orchestrators
        if let Ok(folders) = api.list_folders().await {
            let mut found_any = false;
            for folder in folders {
                if let Ok(Some(orch)) = api.get_folder_orchestrator(&folder.id).await {
                    found_any = true;
                    let status = match orch.status.as_str() {
                        "running" => "running".green(),
                        "stopped" => "stopped".red(),
                        "paused" => "paused".yellow(),
                        _ => orch.status.normal(),
                    };
                    println!(
                        "    {} ({}) - {}",
                        folder.name,
                        status,
                        folder.path.as_deref().unwrap_or("no path")
                    );
                }
            }
            if !found_any {
                println!("    No folder orchestrators registered in API");
            }
        }
    } else {
        println!();
        println!("  {}", "API: Disconnected".red());
    }

    Ok(())
}
