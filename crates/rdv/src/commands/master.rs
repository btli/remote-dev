//! Master Control commands.
//!
//! Master Control is the system-wide orchestrator that coordinates
//! across all projects and manages the agent pool.
//!
//! Uses rdv-server API for all database operations via ApiClient.

use anyhow::Result;
use colored::Colorize;
use serde::{Deserialize, Serialize};

use rdv_core::client::{ApiClient, CreateOrchestratorRequest, CreateSessionRequest};

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

    // Check rdv-server connectivity
    match ApiClient::new() {
        Ok(client) => {
            match client.health().await {
                Ok(_) => {
                    println!("  {}", "✓ rdv-server connection verified".green());
                }
                Err(e) => {
                    println!(
                        "{}",
                        format!("⚠ Warning: rdv-server not responding: {}", e).yellow()
                    );
                    println!("  Master Control will work with tmux only");
                }
            }
        }
        Err(e) => {
            println!(
                "{}",
                format!("⚠ Warning: Cannot connect to rdv-server: {}", e).yellow()
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

    // Connect to rdv-server
    let client = ApiClient::new()?;

    // Check for existing master orchestrator
    if let Some(orch) = client.get_master_orchestrator().await? {
        state.orchestrator_id = Some(orch.id.clone());
        state.session_id = orch.session_id.clone();
        println!("  {} Existing orchestrator: {}", "→".cyan(), &orch.id[..8]);

        // Reactivate the session if it was suspended/closed
        if let Some(ref session_id) = orch.session_id {
            client.update_session_status(session_id, "active").await?;
        }
        client.update_orchestrator_status(&orch.id, "idle").await?;
    } else {
        // No orchestrator - create session and orchestrator via API
        println!("  {} Creating new Master Control via API...", "→".cyan());

        // Create terminal session record
        let session = client.create_session(&CreateSessionRequest {
            name: "Master Control".to_string(),
            project_path: Some(config.paths.master_dir.to_string_lossy().to_string()),
            folder_id: None,
            worktree_branch: None,
            agent_provider: Some(config.agents.default.clone()),
            is_orchestrator_session: Some(true),
            shell_command: None,
            environment: None,
        }).await?;
        println!("  {} Created session: {}", "✓".green(), &session.id[..8]);

        // Create orchestrator record
        let orch = client.create_orchestrator(&CreateOrchestratorRequest {
            session_id: session.id.clone(),
            orchestrator_type: "master".to_string(),
            scope_type: None,
            scope_id: None,
            custom_instructions: None,
            monitoring_interval: Some(30),
            stall_threshold: Some(300),
            auto_intervention: Some(false),
        }).await?;
        println!(
            "  {} Created orchestrator: {}",
            "✓".green(),
            &orch.id[..8]
        );

        state.orchestrator_id = Some(orch.id);
        state.session_id = Some(session.id);
    }

    // Create tmux session with agent
    // Enable auto_respawn so agent restarts immediately if it exits
    let agent_cmd = config.agent_command(&config.agents.default).unwrap_or("claude");

    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: session_name.clone(),
        working_directory: Some(config.paths.master_dir.to_string_lossy().to_string()),
        command: Some(agent_cmd.to_string()),
        auto_respawn: true, // Restart agent on exit via pane-died hook
        env: None,
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

    // Database status via API
    println!();
    match ApiClient::new() {
        Ok(client) => {
            println!("  rdv-server: {}", "Connected".green());

            if let Ok(Some(orch)) = client.get_master_orchestrator().await {
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
                if let Some(ref session_id) = orch.session_id {
                    let id_short = if session_id.len() >= 8 { &session_id[..8] } else { session_id };
                    println!("  Session ID: {}", id_short);
                }
                println!("  Monitoring Interval: {}s", orch.monitoring_interval_secs);
                println!("  Stall Threshold: {}s", orch.stall_threshold_secs);
            } else if let Some(ref id) = state.orchestrator_id {
                println!("  Orchestrator ID: {} (cached)", &id[..8]);
                println!("  DB Status: {}", "Not found".yellow());
            } else {
                println!("  Orchestrator: {}", "Not registered".yellow());
            }
        }
        Err(e) => {
            println!("  rdv-server: {} ({})", "Unavailable".red(), e);
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
