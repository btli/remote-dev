//! Master Control commands.
//!
//! Master Control is the system-wide orchestrator that coordinates
//! across all projects and manages the agent pool.
//!
//! Integration with Remote Dev API:
//! - Creates orchestrator record on first start
//! - Persists orchestrator state in database
//! - Creates session record for the Master Control tmux session
//! - Updates status on lifecycle events

use anyhow::{Context, Result};
use colored::Colorize;
use serde::{Deserialize, Serialize};

use crate::api::ApiClient;
use crate::cli::{MasterAction, MasterCommand};
use crate::config::Config;
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

    // Check API connectivity
    let api = ApiClient::new(config)?;
    if !api.health_check().await? {
        println!(
            "{}",
            "⚠ Warning: Cannot reach Remote Dev API".yellow()
        );
        println!("  Master Control will work locally, but state won't be synchronized");
    } else {
        println!("  {}", "✓ API connection verified".green());
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

    // Try to integrate with Remote Dev API
    let api = ApiClient::new(config)?;
    let api_available = api.health_check().await.unwrap_or(false);

    if api_available {
        // Check if orchestrator exists
        let orchestrator = api.get_master_control().await?;

        if let Some(orch) = orchestrator {
            // Orchestrator exists, reuse it
            state.orchestrator_id = Some(orch.id.clone());
            state.session_id = Some(orch.session_id.clone());
            println!("  {} Existing orchestrator: {}", "→".cyan(), &orch.id[..8]);
        } else {
            // Create session in Remote Dev first
            let session = api
                .create_session(crate::api::CreateSessionRequest {
                    name: "Master Control".to_string(),
                    folder_id: None,
                    working_directory: Some(config.paths.master_dir.to_string_lossy().to_string()),
                    agent_provider: Some(config.agents.default.clone()),
                    worktree_id: None,
                })
                .await
                .context("Failed to create Master Control session in API")?;

            // Create orchestrator
            let orchestrator = api
                .create_master_control(&session.id)
                .await
                .context("Failed to create Master Control orchestrator")?;

            state.orchestrator_id = Some(orchestrator.id.clone());
            state.session_id = Some(session.id.clone());
            println!(
                "  {} Created orchestrator: {}",
                "✓".green(),
                &orchestrator.id[..8]
            );
        }

        // Update orchestrator status to running
        if let Some(ref orch_id) = state.orchestrator_id {
            api.update_orchestrator_status(orch_id, "running").await?;
        }
    } else {
        println!(
            "  {}",
            "⚠ API unavailable, running in local-only mode".yellow()
        );
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

    // Update API status
    let state = MasterState::load(config).unwrap_or_default();
    let api = ApiClient::new(config)?;

    if api.health_check().await.unwrap_or(false) {
        if let Some(ref orch_id) = state.orchestrator_id {
            api.update_orchestrator_status(orch_id, "stopped").await?;
            println!("  {} Updated orchestrator status", "✓".green());
        }
    }

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

    // API status
    println!();
    let api = ApiClient::new(config)?;
    if api.health_check().await.unwrap_or(false) {
        println!("  API: {}", "Connected".green());

        if let Ok(Some(orch)) = api.get_master_control().await {
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
            println!("  Session ID: {}", &orch.session_id[..8]);
            println!(
                "  Monitoring: {}",
                if orch.config.monitoring_enabled {
                    "Enabled".green()
                } else {
                    "Disabled".yellow()
                }
            );
            println!(
                "  Monitoring Interval: {}s",
                orch.config.monitoring_interval_secs
            );
            println!(
                "  Stall Threshold: {}s",
                orch.config.stall_threshold_secs
            );
        } else if let Some(ref id) = state.orchestrator_id {
            println!("  Orchestrator ID: {} (cached)", &id[..8]);
            println!("  API Status: {}", "Unknown".yellow());
        } else {
            println!("  Orchestrator: {}", "Not registered".yellow());
        }
    } else {
        println!("  API: {}", "Disconnected".red());
        if let Some(ref id) = state.orchestrator_id {
            println!("  Orchestrator ID: {} (cached)", &id[..8]);
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
