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
                println!("{}", serde_json::to_string_pretty(&dashboard)?);
            }
        }
    }
    Ok(())
}
