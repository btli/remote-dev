//! System status dashboard command.
//!
//! Provides a comprehensive view of the rdv orchestration system:
//! - Master Control status
//! - Folder orchestrators
//! - Active sessions
//! - Pending tasks (from beads)
//! - Recent escalations
//! - System health
//!
//! Supports JSON output for programmatic use.

use anyhow::{Context, Result};
use chrono::Utc;
use colored::Colorize;
use serde::{Deserialize, Serialize};
use std::process::Command;

use crate::config::Config;
use crate::db::Database;
use crate::tmux;

/// Full system status for JSON output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatus {
    pub timestamp: String,
    pub master_control: MasterStatus,
    pub folder_orchestrators: Vec<FolderOrchestratorStatus>,
    pub sessions: Vec<SessionStatus>,
    pub database: DatabaseStats,
    pub beads: BeadsStatus,
    pub health: HealthStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasterStatus {
    pub running: bool,
    pub session_name: Option<String>,
    pub attached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderOrchestratorStatus {
    pub name: String,
    pub path: String,
    pub running: bool,
    pub attached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStatus {
    pub name: String,
    pub session_type: String,
    pub attached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseStats {
    pub active_sessions: u32,
    pub total_tasks: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeadsStatus {
    pub available: bool,
    pub open_tasks: u32,
    pub in_progress: u32,
    pub ready: u32,
    pub escalations: u32,
    pub unread_messages: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub tmux: bool,
    pub api: bool,
    pub beads: bool,
    pub issues: Vec<String>,
}

/// Check if beads (bd) is available.
fn beads_available() -> bool {
    which::which("bd").is_ok()
}

/// Run a beads command and return stdout.
fn run_beads(args: &[&str]) -> Result<String> {
    let output = Command::new("bd")
        .args(args)
        .output()
        .context("Failed to execute bd command")?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("bd command failed: {}", stderr)
    }
}

/// Count lines matching a pattern in beads output.
fn count_beads_issues(args: &[&str]) -> u32 {
    run_beads(args)
        .map(|output| output.lines().filter(|l| l.starts_with("beads-") || l.contains("[")).count() as u32)
        .unwrap_or(0)
}

pub async fn execute(json: bool, config: &Config) -> Result<()> {
    let status = gather_status(config).await?;

    if json {
        println!("{}", serde_json::to_string_pretty(&status)?);
    } else {
        print_dashboard(&status, config);
    }

    Ok(())
}

async fn gather_status(_config: &Config) -> Result<SystemStatus> {
    // Get tmux sessions
    let tmux_sessions = tmux::list_sessions().unwrap_or_default();

    // Master Control status
    let master_session = tmux_sessions.iter().find(|s| s.name == "rdv-master-control");
    let master_control = MasterStatus {
        running: master_session.is_some(),
        session_name: master_session.map(|s| s.name.clone()),
        attached: master_session.map(|s| s.attached).unwrap_or(false),
    };

    // Folder orchestrators
    let folder_orchestrators: Vec<FolderOrchestratorStatus> = tmux_sessions
        .iter()
        .filter(|s| s.name.starts_with("rdv-folder-"))
        .map(|s| {
            let folder_name = s.name.strip_prefix("rdv-folder-").unwrap_or(&s.name);
            FolderOrchestratorStatus {
                name: folder_name.to_string(),
                path: String::new(), // Would need to look up from config
                running: true,
                attached: s.attached,
            }
        })
        .collect();

    // Sessions
    let sessions: Vec<SessionStatus> = tmux_sessions
        .iter()
        .filter(|s| s.name.starts_with("rdv-task-") || s.name.starts_with("rdv-session-"))
        .map(|s| {
            let session_type = if s.name.contains("-task-") {
                "task"
            } else {
                "session"
            };
            SessionStatus {
                name: s.name.clone(),
                session_type: session_type.to_string(),
                attached: s.attached,
            }
        })
        .collect();

    // Database stats
    let database = if let Ok(db) = Database::open() {
        if let Ok(Some(user)) = db.get_default_user() {
            let active = db.get_active_session_count(&user.id).unwrap_or(0);
            let tasks = db.list_tasks(&user.id, None).map(|t| t.len() as u32).unwrap_or(0);
            DatabaseStats {
                active_sessions: active,
                total_tasks: tasks,
            }
        } else {
            DatabaseStats { active_sessions: 0, total_tasks: 0 }
        }
    } else {
        DatabaseStats { active_sessions: 0, total_tasks: 0 }
    };

    // Beads status
    let beads = if beads_available() {
        BeadsStatus {
            available: true,
            open_tasks: count_beads_issues(&["list", "--status=open"]),
            in_progress: count_beads_issues(&["list", "--status=in_progress"]),
            ready: count_beads_issues(&["ready"]),
            escalations: count_beads_issues(&["list", "--type=escalation", "--status=open"]),
            unread_messages: count_beads_issues(&["list", "--type=message", "--status=open"]),
        }
    } else {
        BeadsStatus {
            available: false,
            open_tasks: 0,
            in_progress: 0,
            ready: 0,
            escalations: 0,
            unread_messages: 0,
        }
    };

    // Health status
    let mut issues = Vec::new();

    let tmux_ok = tmux::check_tmux().is_ok();
    if !tmux_ok {
        issues.push("tmux not installed".to_string());
    }

    // Check database connectivity (replaces API health check)
    let db_ok = Database::open().is_ok();
    if !db_ok {
        issues.push("Database not accessible".to_string());
    }

    let beads_ok = beads_available();
    if !beads_ok {
        issues.push("beads (bd) not installed".to_string());
    }

    let health = HealthStatus {
        tmux: tmux_ok,
        api: db_ok, // Now represents database connectivity
        beads: beads_ok,
        issues,
    };

    Ok(SystemStatus {
        timestamp: Utc::now().to_rfc3339(),
        master_control,
        folder_orchestrators,
        sessions,
        database,
        beads,
        health,
    })
}

fn print_dashboard(status: &SystemStatus, _config: &Config) {
    // Header
    println!();
    println!("{}", "╔══════════════════════════════════════════════════════════════════╗".cyan());
    println!("{}", "║                    rdv System Status                             ║".cyan().bold());
    println!("{}", "╚══════════════════════════════════════════════════════════════════╝".cyan());
    println!();

    // Master Control
    print!("  {} ", "Master Control:".cyan().bold());
    if status.master_control.running {
        let attach_status = if status.master_control.attached {
            "(attached)".green()
        } else {
            "(detached)".yellow()
        };
        println!("{} {}", "RUNNING".green().bold(), attach_status);
    } else {
        println!("{}", "STOPPED".red());
        println!("    Start with: rdv master start");
    }

    // Folder Orchestrators
    println!();
    println!("  {} ({})", "Folder Orchestrators:".cyan().bold(), status.folder_orchestrators.len());
    if status.folder_orchestrators.is_empty() {
        println!("    None running");
    } else {
        for orch in &status.folder_orchestrators {
            let attach = if orch.attached { "(attached)" } else { "" };
            println!("    {} {} {}", "•".green(), orch.name, attach.yellow());
        }
    }

    // Active Sessions
    println!();
    println!("  {} ({})", "Active Sessions:".cyan().bold(), status.sessions.len());
    if status.sessions.is_empty() {
        println!("    None");
    } else {
        for session in &status.sessions {
            let type_icon = if session.session_type == "task" { "⚙" } else { "▶" };
            let attach = if session.attached {
                "(attached)".green()
            } else {
                "(detached)".normal()
            };
            println!("    {} {} {}", type_icon, session.name, attach);
        }
    }

    // Database Stats
    println!();
    println!("  {}", "Database:".cyan().bold());
    println!("    Active sessions: {}", status.database.active_sessions);
    println!("    Total tasks:     {}", status.database.total_tasks);

    // Beads Status
    println!();
    println!("  {}", "Beads Work Queue:".cyan().bold());
    if status.beads.available {
        println!("    Open tasks:    {}", status.beads.open_tasks);
        println!("    In progress:   {}", status.beads.in_progress.to_string().yellow());
        println!("    Ready to work: {}", status.beads.ready.to_string().green());

        if status.beads.escalations > 0 {
            println!("    {} Escalations:   {}", "⚠".red(), status.beads.escalations.to_string().red().bold());
        }
        if status.beads.unread_messages > 0 {
            println!("    {} Messages:      {}", "✉".cyan(), status.beads.unread_messages);
        }
    } else {
        println!("    {} beads not available", "⚠".yellow());
    }

    // Health
    println!();
    println!("  {}", "System Health:".cyan().bold());

    let tmux_status = if status.health.tmux { "✓".green() } else { "✗".red() };
    let db_status = if status.health.api { "✓".green() } else { "✗".red() };
    let beads_status = if status.health.beads { "✓".green() } else { "✗".red() };

    println!("    {} tmux   {} DB   {} beads", tmux_status, db_status, beads_status);

    if !status.health.issues.is_empty() {
        println!();
        println!("    {}", "Issues:".red());
        for issue in &status.health.issues {
            println!("      • {}", issue);
        }
    }

    // Quick actions
    println!();
    println!("{}", "─".repeat(70));
    println!("  {}", "Quick Actions:".cyan());
    println!("    rdv task list      - See tasks");
    println!("    rdv mail inbox     - Check messages");
    println!("    bd ready           - See ready work");
    println!("    rdv doctor         - Full diagnostics");
    println!();
}
