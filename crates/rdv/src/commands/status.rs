use std::env;

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

#[derive(Debug, Serialize, Deserialize)]
#[allow(dead_code)]
struct TaskSummary {
    id: String,
    title: String,
    status: Option<String>,
}

fn session_id() -> Option<String> {
    env::var("RDV_SESSION_ID").ok()
}

pub async fn run(args: StatusArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        Some(StatusCommand::Report { status }) => {
            let sid = match session_id() {
                Some(s) => s,
                None => return Ok(()), // No session context — skip silently.
            };
            let path = format!("/internal/agent-status?sessionId={sid}&status={status}");
            let result = client.post_empty(&path).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        None => {
            // Dashboard: show sessions + tasks summary
            if human {
                println!("{}", "Remote Dev Status".bold().underline());
                println!();
            }

            // Sessions
            let sessions: Vec<SessionSummary> = client.get("/api/sessions").await?;
            let active = sessions.iter().filter(|s| s.status.as_deref() == Some("active")).count();
            let agents = sessions
                .iter()
                .filter(|s| s.terminal_type.as_deref() == Some("agent"))
                .count();

            if human {
                println!(
                    "{}: {} total, {} active, {} agents",
                    "Sessions".bold(),
                    sessions.len(),
                    active,
                    agents,
                );

                // Tasks (only if we have a session)
                if let Some(sid) = session_id() {
                    let tasks: Vec<TaskSummary> = client
                        .get_with_query("/internal/tasks", &[("sessionId", &sid)])
                        .await
                        .unwrap_or_default();
                    let done = tasks.iter().filter(|t| t.status.as_deref() == Some("done")).count();
                    let pending = tasks.len() - done;
                    println!(
                        "{}: {} total, {} pending, {} done",
                        "Tasks".bold(),
                        tasks.len(),
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

                if let Some(sid) = session_id() {
                    let tasks: Vec<TaskSummary> = client
                        .get_with_query("/internal/tasks", &[("sessionId", &sid)])
                        .await
                        .unwrap_or_default();
                    let done = tasks.iter().filter(|t| t.status.as_deref() == Some("done")).count();
                    dashboard["tasks"] = json!({
                        "total": tasks.len(),
                        "pending": tasks.len() - done,
                        "done": done,
                    });
                }

                println!("{}", serde_json::to_string_pretty(&dashboard)?);
            }
        }
    }
    Ok(())
}
