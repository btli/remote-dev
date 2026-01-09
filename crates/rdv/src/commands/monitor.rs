//! Monitoring service commands.

use anyhow::Result;
use colored::Colorize;

use crate::cli::{MonitorCommand, MonitorAction};
use crate::config::Config;
use crate::tmux;

pub async fn execute(cmd: MonitorCommand, config: &Config) -> Result<()> {
    match cmd.action {
        MonitorAction::Start { interval, foreground } => {
            start(interval, foreground, config).await
        }
        MonitorAction::Stop => stop(config).await,
        MonitorAction::Status => status(config).await,
        MonitorAction::Check { session_id } => check(&session_id, config).await,
    }
}

async fn start(interval: u64, foreground: bool, config: &Config) -> Result<()> {
    println!("{}", "Starting monitoring service...".cyan());
    println!("  Interval: {}s", interval);
    println!("  Stall threshold: {}s", config.monitoring.stall_threshold_secs);

    if foreground {
        // Run monitoring loop in foreground
        println!("{}", "Running in foreground (Ctrl+C to stop)".yellow());
        run_monitoring_loop(interval, config).await?;
    } else {
        // TODO: Daemonize
        println!("{}", "⚠ Daemon mode not yet implemented".yellow());
    }

    Ok(())
}

async fn run_monitoring_loop(interval: u64, config: &Config) -> Result<()> {
    loop {
        // Get all rdv sessions
        let sessions = tmux::list_sessions()?;
        let rdv_sessions: Vec<_> = sessions
            .iter()
            .filter(|s| s.name.starts_with("rdv-session-"))
            .collect();

        for session in rdv_sessions {
            // Check session health
            match check_session_health(&session.name, config).await {
                Ok(health) => {
                    if health.is_stalled {
                        println!(
                            "{}: {} (stalled for {}s)",
                            session.name,
                            "STALLED".red(),
                            health.stall_duration_secs
                        );
                    }
                }
                Err(e) => {
                    println!("{}: Error checking health: {}", session.name, e);
                }
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;
    }
}

struct SessionHealth {
    is_stalled: bool,
    stall_duration_secs: u64,
    last_hash: String,
}

async fn check_session_health(session_name: &str, config: &Config) -> Result<SessionHealth> {
    let hash = tmux::scrollback_hash(session_name, config.monitoring.scrollback_lines)?;

    // TODO: Compare with stored hash and calculate stall duration
    // For now, just return not stalled

    Ok(SessionHealth {
        is_stalled: false,
        stall_duration_secs: 0,
        last_hash: hash,
    })
}

async fn stop(_config: &Config) -> Result<()> {
    println!("{}", "Stopping monitoring service...".cyan());
    // TODO: Signal daemon to stop
    println!("{}", "⚠ Daemon stop not yet implemented".yellow());
    Ok(())
}

async fn status(_config: &Config) -> Result<()> {
    println!("{}", "Monitoring Service Status".cyan().bold());
    println!("{}", "─".repeat(40));
    // TODO: Check daemon status
    println!("{}", "⚠ Status check not yet implemented".yellow());
    Ok(())
}

async fn check(session_id: &str, config: &Config) -> Result<()> {
    println!("{}", format!("Checking session {}...", session_id).cyan());

    let health = check_session_health(session_id, config).await?;

    println!("  Hash: {}", health.last_hash);
    println!(
        "  Status: {}",
        if health.is_stalled {
            "STALLED".red()
        } else {
            "HEALTHY".green()
        }
    );

    Ok(())
}
