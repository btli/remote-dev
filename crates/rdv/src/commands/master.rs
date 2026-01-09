//! Master Control commands.
//!
//! Master Control is the system-wide orchestrator that coordinates
//! across all projects and manages the agent pool.

use anyhow::Result;
use colored::Colorize;

use crate::cli::{MasterCommand, MasterAction};
use crate::config::Config;
use crate::tmux;

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

    println!("{}", "✓ Master Control initialized".green());
    println!("  Data directory: {:?}", config.paths.data_dir);
    println!("  Config file: {:?}", Config::config_path());

    Ok(())
}

async fn start(foreground: bool, config: &Config) -> Result<()> {
    let session_name = format!("{}-{}", config.master.session_prefix, "control");

    // Check if already running
    if tmux::session_exists(&session_name)? {
        println!("{}", "Master Control is already running".yellow());
        return Ok(());
    }

    println!("{}", "Starting Master Control...".cyan());

    // Create session with claude agent
    let agent_cmd = config.agent_command(&config.agents.default)
        .unwrap_or("claude");

    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: session_name.clone(),
        working_directory: Some(config.paths.master_dir.to_string_lossy().to_string()),
        command: Some(agent_cmd.to_string()),
    })?;

    println!("{}", "✓ Master Control started".green());
    println!("  Session: {}", session_name);

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
    tmux::kill_session(&session_name)?;
    println!("{}", "✓ Master Control stopped".green());

    Ok(())
}

async fn status(config: &Config) -> Result<()> {
    let session_name = format!("{}-{}", config.master.session_prefix, "control");

    println!("{}", "Master Control Status".cyan().bold());
    println!("{}", "─".repeat(40));

    if tmux::session_exists(&session_name)? {
        if let Some(info) = tmux::get_session_info(&session_name)? {
            println!("  Status: {}", "RUNNING".green());
            println!("  Session: {}", info.name);
            println!("  Attached: {}", if info.attached { "Yes" } else { "No" });
        }
    } else {
        println!("  Status: {}", "STOPPED".red());
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
