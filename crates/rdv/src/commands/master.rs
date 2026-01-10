//! Master Control commands.
//!
//! Master Control is the system-wide orchestrator that coordinates
//! across all projects and manages the agent pool.
//!
//! Direct database integration:
//! - Reads orchestrator records from SQLite
//! - Uses tmux directly for session control
//! - No HTTP API needed for most operations

use anyhow::Result;
use colored::Colorize;
use serde::{Deserialize, Serialize};

use crate::cli::{MasterAction, MasterCommand};
use crate::config::Config;
use crate::db::Database;
use crate::tmux;

/// Local state file for Master Control.
/// Persists orchestrator ID and session ID across restarts.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct MasterState {
    /// Orchestrator ID from Remote Dev API
    orchestrator_id: Option<String>,
    /// Session ID from Remote Dev API
    session_id: Option<String>,
    /// tmux session name
    tmux_session: Option<String>,
}

impl MasterState {
    fn load(config: &Config) -> Result<Self> {
        let state_path = config.paths.master_dir.join("state.json");
        if state_path.exists() {
            let content = std::fs::read_to_string(&state_path)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(Self::default())
        }
    }

    fn save(&self, config: &Config) -> Result<()> {
        std::fs::create_dir_all(&config.paths.master_dir)?;
        let state_path = config.paths.master_dir.join("state.json");
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(state_path, content)?;
        Ok(())
    }
}

pub async fn execute(cmd: MasterCommand, config: &Config) -> Result<()> {
    match cmd.action {
        MasterAction::Init => init(config).await,
        MasterAction::Start { foreground } => start(foreground, config).await,
        MasterAction::Stop => stop(config).await,
        MasterAction::Status => status(config).await,
        MasterAction::Attach => attach(config).await,
    }
}

async fn init(config: &Config) -> Result<()> {
    println!("{}", "Initializing Master Control...".cyan());

    // Ensure directories exist
    config.ensure_dirs()?;

    // Check tmux
    tmux::check_tmux()?;

    // Check database connectivity (direct SQLite)
    match Database::open() {
        Ok(_) => {
            println!("  {}", "✓ Database connection verified".green());
        }
        Err(e) => {
            println!(
                "{}",
                format!("⚠ Warning: Cannot access database: {}", e).yellow()
            );
            println!("  Master Control will work with tmux only");
        }
    }

    println!("{}", "✓ Master Control initialized".green());
    println!("  Data directory: {:?}", config.paths.data_dir);
    println!("  Config file: {:?}", Config::config_path());

    Ok(())
}

async fn start(foreground: bool, config: &Config) -> Result<()> {
    let session_name = format!("{}-{}", config.master.session_prefix, "control");

    // Check if already running (tmux)
    if tmux::session_exists(&session_name)? {
        println!("{}", "Master Control is already running".yellow());
        return Ok(());
    }

    println!("{}", "Starting Master Control...".cyan());

    // Load existing state
    let mut state = MasterState::load(config).unwrap_or_default();

    // Check database for existing orchestrator (direct SQLite)
    if let Ok(db) = Database::open() {
        if let Ok(Some(user)) = db.get_default_user() {
            if let Ok(Some(orch)) = db.get_master_orchestrator(&user.id) {
                state.orchestrator_id = Some(orch.id.clone());
                state.session_id = Some(orch.session_id.clone());
                println!("  {} Existing orchestrator: {}", "→".cyan(), &orch.id[..8]);
            }
        }
    }

    // Create tmux session with agent
    let agent_cmd = config.agent_command(&config.agents.default).unwrap_or("claude");

    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: session_name.clone(),
        working_directory: Some(config.paths.master_dir.to_string_lossy().to_string()),
        command: Some(agent_cmd.to_string()),
    })?;

    state.tmux_session = Some(session_name.clone());
    state.save(config)?;

    println!("{}", "✓ Master Control started".green());
    println!("  Session: {}", session_name);
    if let Some(ref id) = state.orchestrator_id {
        println!("  Orchestrator ID: {}", &id[..8]);
    }

    if foreground {
        println!("{}", "Attaching to session...".cyan());
        tmux::attach_session(&session_name)?;
    } else {
        println!("  Run `rdv master attach` to connect");
    }

    Ok(())
}

async fn stop(config: &Config) -> Result<()> {
    let session_name = format!("{}-{}", config.master.session_prefix, "control");

    if !tmux::session_exists(&session_name)? {
        println!("{}", "Master Control is not running".yellow());
        return Ok(());
    }

    println!("{}", "Stopping Master Control...".cyan());

    // Stop tmux session directly
    tmux::kill_session(&session_name)?;
    println!("{}", "✓ Master Control stopped".green());

    Ok(())
}

async fn status(config: &Config) -> Result<()> {
    let session_name = format!("{}-{}", config.master.session_prefix, "control");
    let state = MasterState::load(config).unwrap_or_default();

    println!("{}", "Master Control Status".cyan().bold());
    println!("{}", "─".repeat(50));

    // Local tmux status
    let tmux_running = tmux::session_exists(&session_name)?;
    if tmux_running {
        if let Some(info) = tmux::get_session_info(&session_name)? {
            println!("  tmux Status: {}", "RUNNING".green());
            println!("  tmux Session: {}", info.name);
            println!("  Attached: {}", if info.attached { "Yes" } else { "No" });
        }
    } else {
        println!("  tmux Status: {}", "STOPPED".red());
    }

    // Database status (direct SQLite)
    println!();
    match Database::open() {
        Ok(db) => {
            println!("  Database: {}", "Connected".green());

            if let Ok(Some(user)) = db.get_default_user() {
                if let Ok(Some(orch)) = db.get_master_orchestrator(&user.id) {
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
                    println!("  Session ID: {}", &orch.session_id[..8]);
                    println!(
                        "  Auto Intervention: {}",
                        if orch.auto_intervention {
                            "Enabled".green()
                        } else {
                            "Disabled".yellow()
                        }
                    );
                    println!("  Monitoring Interval: {}s", orch.monitoring_interval);
                    println!("  Stall Threshold: {}s", orch.stall_threshold);
                } else if let Some(ref id) = state.orchestrator_id {
                    println!("  Orchestrator ID: {} (cached)", &id[..8]);
                    println!("  DB Status: {}", "Not found".yellow());
                } else {
                    println!("  Orchestrator: {}", "Not registered".yellow());
                }
            }
        }
        Err(_) => {
            println!("  Database: {}", "Unavailable".red());
            if let Some(ref id) = state.orchestrator_id {
                println!("  Orchestrator ID: {} (cached)", &id[..8]);
            }
        }
    }

    println!();
    println!("  Config: {:?}", Config::config_path());
    println!("  Data: {:?}", config.paths.data_dir);

    Ok(())
}

async fn attach(config: &Config) -> Result<()> {
    let session_name = format!("{}-{}", config.master.session_prefix, "control");

    if !tmux::session_exists(&session_name)? {
        println!("{}", "Master Control is not running".yellow());
        println!("Run `rdv master start` to start it first");
        return Ok(());
    }

    tmux::attach_session(&session_name)?;
    Ok(())
}
