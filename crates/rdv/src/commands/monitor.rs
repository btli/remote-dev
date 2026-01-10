//! Monitoring service commands.
//!
//! The monitoring service performs periodic health checks on all rdv sessions:
//! - Captures scrollback buffer
//! - Computes MD5 hash
//! - Compares with previous hash to detect stalls
//! - Generates insights for stalled sessions
//! - Updates session activity in database (heartbeats)
//!
//! Integration with Next.js MonitoringService:
//! - Uses direct SQLite database access for state persistence
//! - Creates insights directly in orchestrator_insight table
//! - Updates terminal_session.last_activity_at for heartbeat tracking
//!
//! Stall detection logic:
//! - If hash unchanged for > stall_threshold_secs, session is considered stalled
//! - Confidence score: 0.7 + (0.05 × extra_minutes_beyond_threshold)
//! - Confidence reduced by 50% if buffer has < 5 lines
//!
//! Note: Orchestrator auto-respawn is handled by tmux pane-died hook,
//! not by this monitor. See tmux::CreateSessionConfig::auto_respawn.

use anyhow::Result;
use chrono::{DateTime, Utc};
use colored::Colorize;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::cli::{MonitorAction, MonitorCommand};
use crate::config::Config;
use crate::db::{Database, NewInsight};
use crate::tmux;

/// Monitoring state persisted to disk.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct MonitorState {
    /// PID of running monitor daemon (if any)
    daemon_pid: Option<u32>,
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
    println!(
        "  Scrollback lines: {}",
        config.monitoring.scrollback_lines
    );

    if foreground {
        // Run monitoring loop in foreground
        println!();
        println!("{}", "Running in foreground (Ctrl+C to stop)".yellow());
        println!("{}", "─".repeat(60));
        run_monitoring_loop(interval, config).await?;
    } else {
        // Update state to indicate we're attempting to start
        let mut state = MonitorState::load(config).unwrap_or_default();
        state.daemon_pid = Some(std::process::id());
        state.save(config)?;

        println!();
        println!(
            "  {}",
            "⚠ Background daemon mode: run with --foreground for now".yellow()
        );
        println!(
            "  Recommended: use `rdv monitor start --foreground` in a dedicated terminal"
        );
    }

    Ok(())
}

async fn run_monitoring_loop(interval: u64, config: &Config) -> Result<()> {
    let mut state = MonitorState::load(config).unwrap_or_default();
    let mut cycle = 0u64;

    // Open database connection for session activity updates and insights
    let db = Database::open().ok();
    let (_user_id, orchestrator_id) = if let Some(ref db) = db {
        let uid = db.get_default_user().ok().flatten().map(|u| u.id);
        let oid = if let Some(ref u) = uid {
            db.get_master_orchestrator(u).ok().flatten().map(|o| o.id)
        } else {
            None
        };
        (uid, oid)
    } else {
        (None, None)
    };

    if db.is_some() {
        println!("  {} Database connected for activity tracking", "✓".green());
    } else {
        println!("  {} Database unavailable, using local state only", "⚠".yellow());
    }

    loop {
        cycle += 1;
        let now = Utc::now();

        // Get all rdv task sessions (exclude master and folder orchestrators)
        let sessions = tmux::list_sessions()?;
        let task_sessions: Vec<_> = sessions
            .iter()
            .filter(|s| {
                s.name.starts_with("rdv-task-") || s.name.starts_with("rdv-session-")
            })
            .collect();

        let session_count = task_sessions.len();

        if session_count == 0 {
            if cycle % 10 == 1 {
                println!(
                    "[{}] No task sessions to monitor",
                    now.format("%H:%M:%S")
                );
            }
        } else {
            println!(
                "[{}] Monitoring {} session(s)...",
                now.format("%H:%M:%S"),
                session_count
            );

            for session in task_sessions {
                match check_and_update_session(&session.name, &mut state, config).await {
                    Ok(health) => {
                        // Update session activity in database (heartbeat)
                        if let Some(ref db) = db {
                            // Look up session ID from tmux name
                            if let Ok(Some(db_session)) = db.get_session_by_tmux_name(&session.name) {
                                if health.hash_changed {
                                    // Session is active - update activity timestamp
                                    let _ = db.update_session_activity(&db_session.id);
                                }

                                // Create insight if stalled and no existing unresolved stall insight
                                if health.is_stalled {
                                    if let (Some(oid), false) = (
                                        &orchestrator_id,
                                        db.has_unresolved_stall_insight(&db_session.id).unwrap_or(true),
                                    ) {
                                        let stall_mins = health.stall_duration_secs / 60;
                                        let severity = if health.confidence > 0.85 {
                                            "high"
                                        } else if health.confidence > 0.75 {
                                            "medium"
                                        } else {
                                            "low"
                                        };

                                        let insight = NewInsight {
                                            orchestrator_id: oid.clone(),
                                            session_id: Some(db_session.id.clone()),
                                            insight_type: "stall".to_string(),
                                            severity: severity.to_string(),
                                            title: format!("Session stalled for {}m", stall_mins),
                                            description: format!(
                                                "Session '{}' has had no activity for {} minutes. Scrollback hash unchanged.",
                                                session.name, stall_mins
                                            ),
                                            context: Some(format!(
                                                "{{\"tmux_session\":\"{}\",\"line_count\":{},\"hash\":\"{}\"}}",
                                                session.name, health.line_count, health.hash
                                            )),
                                            suggested_actions: Some(
                                                "[\"Send nudge\",\"Check agent status\",\"Review scrollback\"]".to_string()
                                            ),
                                            confidence: health.confidence,
                                            triggered_by: "rdv_monitor".to_string(),
                                        };

                                        if let Ok(insight_id) = db.create_insight(&insight) {
                                            println!(
                                                "  {} Created insight {} for stall",
                                                "→".cyan(),
                                                &insight_id[..8]
                                            );
                                        }
                                    }
                                }
                            }
                        }

                        if health.is_stalled {
                            let stall_mins = health.stall_duration_secs / 60;
                            println!(
                                "  {} {} (stalled {}m, confidence: {:.0}%)",
                                "⚠".yellow(),
                                session.name,
                                stall_mins,
                                health.confidence * 100.0
                            );
                        } else if health.hash_changed {
                            println!(
                                "  {} {} (active)",
                                "✓".green(),
                                session.name
                            );
                        }
                    }
                    Err(e) => {
                        println!(
                            "  {} {}: {}",
                            "✗".red(),
                            session.name,
                            e
                        );
                    }
                }
            }
        }

        // Clean up sessions that no longer exist
        let existing_names: std::collections::HashSet<_> =
            sessions.iter().map(|s| s.name.clone()).collect();
        state.sessions.retain(|name, _| existing_names.contains(name));

        state.last_check = Some(now);
        state.save(config)?;

        tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;
    }
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

async fn stop(config: &Config) -> Result<()> {
    println!("{}", "Stopping monitoring service...".cyan());

    let state = MonitorState::load(config).unwrap_or_default();

    if let Some(pid) = state.daemon_pid {
        // Try to signal the process
        println!("  Found daemon PID: {}", pid);
        println!(
            "  {}",
            "⚠ Manual stop: kill the process or Ctrl+C the foreground monitor".yellow()
        );
    } else {
        println!("  No daemon PID recorded");
    }

    Ok(())
}

async fn status(config: &Config) -> Result<()> {
    println!("{}", "Monitoring Service Status".cyan().bold());
    println!("{}", "─".repeat(60));

    let state = MonitorState::load(config).unwrap_or_default();

    // Daemon status
    if let Some(pid) = state.daemon_pid {
        // Check if process is still running
        let running = std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if running {
            println!("  Daemon: {} (PID {})", "Running".green(), pid);
        } else {
            println!(
                "  Daemon: {} (PID {} not found)",
                "Stopped".red(),
                pid
            );
        }
    } else {
        println!("  Daemon: {}", "Not started".yellow());
    }

    // Last check
    if let Some(last) = state.last_check {
        let ago = Utc::now().signed_duration_since(last);
        println!("  Last check: {} ({}s ago)", last.format("%H:%M:%S"), ago.num_seconds());
    } else {
        println!("  Last check: Never");
    }

    // Session snapshots
    println!();
    println!("  {}", "Tracked Sessions:".cyan());

    if state.sessions.is_empty() {
        println!("    No sessions tracked");
    } else {
        for (name, snapshot) in &state.sessions {
            let status = if snapshot.is_stalled {
                "STALLED".red()
            } else {
                "OK".green()
            };
            let age = Utc::now()
                .signed_duration_since(snapshot.first_seen)
                .num_seconds();
            println!(
                "    {} ({}) - hash age: {}s, {} lines",
                name,
                status,
                age,
                snapshot.line_count
            );
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

async fn check(session_id: &str, config: &Config) -> Result<()> {
    println!(
        "{}",
        format!("Checking session {}...", session_id).cyan()
    );

    // Verify session exists
    if !tmux::session_exists(session_id)? {
        println!("{}", format!("Session '{}' not found", session_id).red());
        return Ok(());
    }

    // Load state
    let mut state = MonitorState::load(config).unwrap_or_default();

    // Check session
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
