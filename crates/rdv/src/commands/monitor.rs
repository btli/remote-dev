//! Monitoring service commands.
//!
//! The monitoring service performs periodic health checks on all rdv sessions:
//! - Captures scrollback buffer
//! - Computes MD5 hash
//! - Compares with previous hash to detect stalls
//! - Generates insights for stalled sessions
//!
//! This CLI delegates to rdv-server's monitoring service via API.
//! Server-side monitoring runs continuously and creates insights automatically.
//!
//! The CLI can:
//! - Start/stop server-side monitoring
//! - Check monitoring status
//! - Perform one-off local session checks via tmux
//!
//! Uses rdv-server API for all database operations.

use anyhow::Result;
use chrono::{DateTime, Utc};
use colored::Colorize;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use rdv_core::client::ApiClient;

use crate::cli::{MonitorAction, MonitorCommand};
use crate::config::Config;
use crate::tmux;

/// Monitoring state persisted to disk (for local checks only).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct MonitorState {
    /// Last check timestamp
    last_check: Option<DateTime<Utc>>,
    /// Per-session monitoring data
    sessions: HashMap<String, SessionSnapshot>,
}

/// Snapshot of a session's scrollback state.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionSnapshot {
    /// MD5 hash of scrollback
    hash: String,
    /// Timestamp when this hash was first seen
    first_seen: DateTime<Utc>,
    /// Timestamp of last check
    last_checked: DateTime<Utc>,
    /// Number of lines in scrollback at last check
    line_count: u32,
    /// Whether session was marked stalled
    is_stalled: bool,
}

impl MonitorState {
    fn state_path(config: &Config) -> std::path::PathBuf {
        config.paths.data_dir.join("monitor-state.json")
    }

    fn load(config: &Config) -> Result<Self> {
        let path = Self::state_path(config);
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(Self::default())
        }
    }

    fn save(&self, config: &Config) -> Result<()> {
        std::fs::create_dir_all(&config.paths.data_dir)?;
        let path = Self::state_path(config);
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }
}

pub async fn execute(cmd: MonitorCommand, config: &Config) -> Result<()> {
    match cmd.action {
        MonitorAction::Start {
            interval,
            foreground,
        } => start(interval, foreground, config).await,
        MonitorAction::Stop => stop(config).await,
        MonitorAction::Status => status(config).await,
        MonitorAction::Check { session_id } => check(&session_id, config).await,
    }
}

async fn start(interval: u64, foreground: bool, config: &Config) -> Result<()> {
    println!("{}", "Starting monitoring service...".cyan());
    println!("  Interval: {}s", interval);
    println!(
        "  Stall threshold: {}s",
        config.monitoring.stall_threshold_secs
    );

    // Connect to rdv-server
    let client = match ApiClient::new() {
        Ok(c) => c,
        Err(e) => {
            println!("{}", format!("⚠ rdv-server unavailable: {}", e).yellow());
            println!("  Monitoring requires rdv-server to be running");
            return Ok(());
        }
    };

    // Get master orchestrator
    let orch = match client.get_master_orchestrator().await? {
        Some(o) => o,
        None => {
            println!("{}", "⚠ No Master Control orchestrator found".yellow());
            println!("  Run `rdv master start` first to create Master Control");
            return Ok(());
        }
    };

    println!("  Orchestrator: {}", &orch.id[..8.min(orch.id.len())]);

    // Start server-side monitoring
    let interval_ms = interval * 1000;
    match client.start_monitoring(&orch.id, Some(interval_ms)).await {
        Ok(status) => {
            if status.is_active {
                println!("{}", "✓ Server-side monitoring started".green());
            } else {
                println!("{}", "⚠ Monitoring may not have started".yellow());
            }
        }
        Err(e) => {
            println!("{}", format!("✗ Failed to start monitoring: {}", e).red());
            return Ok(());
        }
    }

    if foreground {
        // Run foreground display loop (polling server for status)
        println!();
        println!("{}", "Running in foreground (Ctrl+C to stop)".yellow());
        println!("{}", "─".repeat(60));
        run_display_loop(&client, &orch.id, interval).await?;
    } else {
        println!();
        println!(
            "  Monitoring is now running on rdv-server"
        );
        println!("  Run `rdv monitor status` to check status");
        println!("  Run `rdv monitor stop` to stop monitoring");
    }

    Ok(())
}

async fn run_display_loop(client: &ApiClient, orchestrator_id: &str, interval: u64) -> Result<()> {
    loop {
        let now = Utc::now();

        // Get stalled sessions from server
        match client.get_stalled_sessions(orchestrator_id).await {
            Ok(result) => {
                if result.stalled_sessions.is_empty() {
                    println!(
                        "[{}] No stalled sessions",
                        now.format("%H:%M:%S")
                    );
                } else {
                    println!(
                        "[{}] {} stalled session(s):",
                        now.format("%H:%M:%S"),
                        result.stalled_sessions.len()
                    );
                    for session in &result.stalled_sessions {
                        println!(
                            "  {} {} (stalled {}m)",
                            "⚠".yellow(),
                            session.session_name,
                            session.stalled_minutes
                        );
                    }
                }
            }
            Err(e) => {
                println!(
                    "[{}] {} Error checking stalled sessions: {}",
                    now.format("%H:%M:%S"),
                    "✗".red(),
                    e
                );
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;
    }
}

async fn stop(_config: &Config) -> Result<()> {
    println!("{}", "Stopping monitoring service...".cyan());

    // Connect to rdv-server
    let client = match ApiClient::new() {
        Ok(c) => c,
        Err(e) => {
            println!("{}", format!("⚠ rdv-server unavailable: {}", e).yellow());
            return Ok(());
        }
    };

    // Get master orchestrator
    let orch = match client.get_master_orchestrator().await? {
        Some(o) => o,
        None => {
            println!("{}", "⚠ No Master Control orchestrator found".yellow());
            return Ok(());
        }
    };

    // Stop server-side monitoring
    match client.stop_monitoring(&orch.id).await {
        Ok(status) => {
            if !status.is_active {
                println!("{}", "✓ Monitoring stopped".green());
            } else {
                println!("{}", "⚠ Monitoring may still be running".yellow());
            }
        }
        Err(e) => {
            println!("{}", format!("✗ Failed to stop monitoring: {}", e).red());
        }
    }

    Ok(())
}

async fn status(config: &Config) -> Result<()> {
    println!("{}", "Monitoring Service Status".cyan().bold());
    println!("{}", "─".repeat(60));

    // Connect to rdv-server
    let client = match ApiClient::new() {
        Ok(c) => c,
        Err(e) => {
            println!("  rdv-server: {} ({})", "Unavailable".red(), e);

            // Fall back to local state
            let state = MonitorState::load(config).unwrap_or_default();
            if let Some(last) = state.last_check {
                let ago = Utc::now().signed_duration_since(last);
                println!("  Last local check: {} ({}s ago)", last.format("%H:%M:%S"), ago.num_seconds());
            }
            return Ok(());
        }
    };

    // Get master orchestrator
    match client.get_master_orchestrator().await? {
        Some(orch) => {
            println!("  Orchestrator: {} ({})", &orch.id[..8.min(orch.id.len())], orch.orchestrator_type);
            println!("  Status: {}", orch.status);

            // Get monitoring status
            match client.get_monitoring_status(&orch.id).await {
                Ok(status) => {
                    let status_text = if status.is_active {
                        "ACTIVE".green()
                    } else {
                        "INACTIVE".yellow()
                    };
                    println!("  Monitoring: {}", status_text);
                }
                Err(e) => {
                    println!("  Monitoring: {} ({})", "Unknown".yellow(), e);
                }
            }

            // Get stalled sessions
            println!();
            println!("  {}", "Stalled Sessions:".cyan());
            match client.get_stalled_sessions(&orch.id).await {
                Ok(result) => {
                    if result.stalled_sessions.is_empty() {
                        println!("    None");
                    } else {
                        for session in &result.stalled_sessions {
                            println!(
                                "    {} {} ({}m)",
                                "⚠".yellow(),
                                session.session_name,
                                session.stalled_minutes
                            );
                        }
                    }
                }
                Err(e) => {
                    println!("    {} Error: {}", "✗".red(), e);
                }
            }
        }
        None => {
            println!("  Orchestrator: {}", "Not found".yellow());
            println!("  Run `rdv master start` to create Master Control");
        }
    }

    // Config
    println!();
    println!("  {}", "Configuration:".cyan());
    println!(
        "    Stall threshold: {}s",
        config.monitoring.stall_threshold_secs
    );
    println!(
        "    Scrollback lines: {}",
        config.monitoring.scrollback_lines
    );
    println!(
        "    Default interval: {}s",
        config.monitoring.interval_secs
    );

    Ok(())
}

/// Local session health check via tmux (doesn't require rdv-server).
async fn check(session_id: &str, config: &Config) -> Result<()> {
    println!(
        "{}",
        format!("Checking session {}...", session_id).cyan()
    );

    // Verify session exists in tmux
    if !tmux::session_exists(session_id)? {
        println!("{}", format!("Session '{}' not found", session_id).red());
        return Ok(());
    }

    // Load local state
    let mut state = MonitorState::load(config).unwrap_or_default();

    // Check session locally via tmux
    let health = check_and_update_session(session_id, &mut state, config).await?;
    state.save(config)?;

    println!();
    println!("  {}", "Session Health:".cyan());
    println!("  Hash: {}", health.hash);
    println!("  Line count: {}", health.line_count);
    println!(
        "  Status: {}",
        if health.is_stalled {
            format!(
                "STALLED ({}s, {:.0}% confidence)",
                health.stall_duration_secs,
                health.confidence * 100.0
            )
            .red()
            .to_string()
        } else {
            "HEALTHY".green().to_string()
        }
    );

    if health.hash_changed {
        println!("  Note: Hash changed since last check (session is active)");
    } else if health.stall_duration_secs > 0 {
        println!(
            "  Note: Hash unchanged for {}s",
            health.stall_duration_secs
        );
    }

    Ok(())
}

#[derive(Debug)]
struct SessionHealth {
    is_stalled: bool,
    stall_duration_secs: u64,
    confidence: f64,
    hash: String,
    hash_changed: bool,
    line_count: u32,
}

async fn check_and_update_session(
    session_name: &str,
    state: &mut MonitorState,
    config: &Config,
) -> Result<SessionHealth> {
    let now = Utc::now();

    // Capture scrollback and compute hash
    let scrollback = tmux::capture_pane(session_name, Some(config.monitoring.scrollback_lines))?;
    let line_count = scrollback.lines().count() as u32;
    let hash = format!("{:x}", md5::compute(&scrollback));

    // Get or create session snapshot
    let (is_stalled, stall_duration_secs, confidence, hash_changed) =
        if let Some(snapshot) = state.sessions.get_mut(session_name) {
            let hash_changed = snapshot.hash != hash;

            if hash_changed {
                // Hash changed - reset tracking
                snapshot.hash = hash.clone();
                snapshot.first_seen = now;
                snapshot.last_checked = now;
                snapshot.line_count = line_count;
                snapshot.is_stalled = false;
                (false, 0, 1.0, true)
            } else {
                // Hash unchanged - calculate stall duration
                let duration = now
                    .signed_duration_since(snapshot.first_seen)
                    .num_seconds() as u64;

                let threshold = config.monitoring.stall_threshold_secs;
                let is_stalled = duration >= threshold;

                // Calculate confidence
                // Base: 0.7, +0.05 per extra minute beyond threshold
                let extra_minutes = if duration > threshold {
                    (duration - threshold) / 60
                } else {
                    0
                };
                let mut confidence = 0.7 + (0.05 * extra_minutes as f64);

                // Reduce confidence by 50% if buffer has < 5 lines
                if line_count < 5 {
                    confidence *= 0.5;
                }

                // Cap at 0.99
                confidence = confidence.min(0.99);

                snapshot.last_checked = now;
                snapshot.is_stalled = is_stalled;

                (is_stalled, duration, confidence, false)
            }
        } else {
            // New session - create initial snapshot
            state.sessions.insert(
                session_name.to_string(),
                SessionSnapshot {
                    hash: hash.clone(),
                    first_seen: now,
                    last_checked: now,
                    line_count,
                    is_stalled: false,
                },
            );
            (false, 0, 1.0, true)
        };

    Ok(SessionHealth {
        is_stalled,
        stall_duration_secs,
        confidence,
        hash,
        hash_changed,
        line_count,
    })
}
