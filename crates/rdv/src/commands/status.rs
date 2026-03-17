use clap::{Args, Subcommand};
use colored::Colorize;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::client::Client;

#[derive(Args)]
pub struct StatusArgs {
    #[command(subcommand)]
    command: Option<StatusCommand>,
}

#[derive(Subcommand)]
enum StatusCommand {
    /// Report agent status (used by hooks)
    Report {
        /// Status string to report (e.g. "idle", "working", "error")
        status: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
struct SessionSummary {
    id: String,
    name: Option<String>,
    status: Option<String>,
    #[serde(rename = "terminalType")]
    terminal_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SessionsResponse {
    sessions: Vec<SessionSummary>,
}

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
struct TaskSummary {
    id: String,
    title: String,
    status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct DeployState {
    #[serde(rename = "activeSlot")]
    active_slot: String,
    #[serde(rename = "activeCommit")]
    active_commit: String,
    #[serde(rename = "deployedAt")]
    deployed_at: String,
    #[serde(rename = "previousSlot")]
    previous_slot: String,
    #[serde(rename = "previousCommit")]
    previous_commit: String,
}

fn read_deploy_state() -> Option<DeployState> {
    let base_dir = std::env::var("RDV_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"))
                .join(".remote-dev")
        });
    let state_file = base_dir.join("deploy/state.json");
    let contents = std::fs::read_to_string(state_file).ok()?;
    serde_json::from_str(&contents).ok()
}

fn read_server_mode() -> Option<String> {
    let base_dir = std::env::var("RDV_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("/tmp"))
                .join(".remote-dev")
        });
    let mode_file = base_dir.join("server/mode");
    std::fs::read_to_string(mode_file).ok().map(|s| s.trim().to_string())
}

fn format_relative_time(iso_time: &str) -> String {
    // Parse ISO 8601 timestamp and compute relative time
    let Ok(deployed) = chrono::DateTime::parse_from_rfc3339(iso_time) else {
        return iso_time.to_string();
    };
    let now = chrono::Utc::now();
    let duration = now.signed_duration_since(deployed);

    let secs = duration.num_seconds();
    if secs < 60 {
        format!("{}s ago", secs)
    } else if secs < 3600 {
        format!("{}m ago", secs / 60)
    } else if secs < 86400 {
        let hours = secs / 3600;
        let mins = (secs % 3600) / 60;
        if mins > 0 {
            format!("{}h {}m ago", hours, mins)
        } else {
            format!("{}h ago", hours)
        }
    } else {
        let days = secs / 86400;
        format!("{}d ago", days)
    }
}

pub async fn run(args: StatusArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        Some(StatusCommand::Report { status }) => {
            let sid = match client.session_id() {
                Some(s) => s,
                None => return Ok(()), // No session context — skip silently.
            };
            let query = [("sessionId", sid), ("status", status.as_str())];
            let result = client.post_empty_with_query("/internal/agent-status", &query).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        None => {
            // Dashboard: show sessions + tasks summary
            if human {
                println!("{}", "Remote Dev Status".bold().underline());
                println!();
            }

            // Server info
            let mode = read_server_mode();
            let deploy = read_deploy_state();

            // Sessions
            let resp: SessionsResponse = client.get("/api/sessions").await?;
            let sessions = resp.sessions;
            let active = sessions.iter().filter(|s| s.status.as_deref() == Some("active")).count();
            let agents = sessions
                .iter()
                .filter(|s| s.terminal_type.as_deref() == Some("agent"))
                .count();

            // Fetch tasks once (only when running inside a session)
            let task_counts = if let Some(sid) = client.session_id() {
                let tasks: Vec<TaskSummary> = client
                    .get_with_query("/api/tasks", &[("sessionId", &sid)])
                    .await
                    .unwrap_or_default();
                let done = tasks.iter().filter(|t| t.status.as_deref() == Some("done")).count();
                Some((tasks.len(), tasks.len() - done, done))
            } else {
                None
            };

            if human {
                // Server section
                if let Some(ref m) = mode {
                    println!("{}: {}", "Mode".bold(), m.to_uppercase());
                }
                if let Some(ref d) = deploy {
                    let short_commit = if d.active_commit.len() >= 7 {
                        &d.active_commit[..7]
                    } else {
                        &d.active_commit
                    };
                    println!(
                        "{}: {} ({})",
                        "Deploy".bold(),
                        short_commit.yellow(),
                        format_relative_time(&d.deployed_at).dimmed(),
                    );
                    println!(
                        "{}: {} (slot: {})",
                        "Build".bold(),
                        d.deployed_at.dimmed(),
                        d.active_slot.cyan(),
                    );
                }
                println!(
                    "{}: {} total, {} active, {} agents",
                    "Sessions".bold(),
                    sessions.len(),
                    active,
                    agents,
                );
                if let Some((total, pending, done)) = task_counts {
                    println!(
                        "{}: {} total, {} pending, {} done",
                        "Tasks".bold(),
                        total,
                        pending,
                        done,
                    );
                }
            } else {
                let mut dashboard = json!({
                    "sessions": {
                        "total": sessions.len(),
                        "active": active,
                        "agents": agents,
                    },
                });
                if let Some((total, pending, done)) = task_counts {
                    dashboard["tasks"] = json!({
                        "total": total,
                        "pending": pending,
                        "done": done,
                    });
                }
                if let Some(ref m) = mode {
                    dashboard["server"] = json!({ "mode": m });
                }
                if let Some(ref d) = deploy {
                    dashboard["deploy"] = json!({
                        "commit": d.active_commit,
                        "deployedAt": d.deployed_at,
                        "activeSlot": d.active_slot,
                        "previousCommit": d.previous_commit,
                        "previousSlot": d.previous_slot,
                    });
                }
                println!("{}", serde_json::to_string_pretty(&dashboard)?);
            }
        }
    }
    Ok(())
}
