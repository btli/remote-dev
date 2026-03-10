use std::env;
use std::io::Read;

use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct TaskArgs {
    #[command(subcommand)]
    command: TaskCommand,
}

#[derive(Subcommand)]
enum TaskCommand {
    /// List tasks for the current session
    List,
    /// Create a new task
    Create {
        /// Task title
        title: String,
        /// Priority (low, medium, high, urgent)
        #[arg(long, default_value = "medium")]
        priority: String,
        /// Task description
        #[arg(long)]
        description: Option<String>,
    },
    /// Update a task
    Update {
        /// Task ID
        id: String,
        /// New status (todo, in_progress, done, cancelled)
        #[arg(long)]
        status: Option<String>,
        /// New title
        #[arg(long)]
        title: Option<String>,
        /// New priority
        #[arg(long)]
        priority: Option<String>,
    },
    /// Mark a task as done
    Complete {
        /// Task ID
        id: String,
    },
    /// Check if agent should stop (used by stop hook)
    Check,
    /// Sync todos from stdin (PostToolUse JSON)
    Sync,
}

#[derive(Debug, Serialize, Deserialize)]
struct Task {
    id: String,
    title: String,
    status: Option<String>,
    priority: Option<String>,
}

#[derive(Tabled)]
struct TaskRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Title")]
    title: String,
    #[tabled(rename = "Status")]
    status: String,
    #[tabled(rename = "Priority")]
    priority: String,
}

impl From<&Task> for TaskRow {
    fn from(t: &Task) -> Self {
        Self {
            id: t.id.clone(),
            title: t.title.clone(),
            status: t.status.clone().unwrap_or_else(|| "todo".into()),
            priority: t.priority.clone().unwrap_or_else(|| "medium".into()),
        }
    }
}

fn session_id() -> Result<String, Box<dyn std::error::Error>> {
    env::var("RDV_SESSION_ID").map_err(|_| "RDV_SESSION_ID not set".into())
}

pub async fn run(args: TaskArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        TaskCommand::List => {
            let sid = session_id()?;
            let tasks: Vec<Task> = client
                .get_with_query("/api/tasks", &[("sessionId", &sid)])
                .await?;
            if human {
                let rows: Vec<TaskRow> = tasks.iter().map(TaskRow::from).collect();
                println!("{}", Table::new(rows));
            } else {
                println!("{}", serde_json::to_string_pretty(&json!(tasks))?);
            }
        }
        TaskCommand::Create {
            title,
            priority,
            description,
        } => {
            let sid = session_id()?;
            let mut body = json!({
                "sessionId": sid,
                "title": title,
                "priority": priority,
            });
            if let Some(desc) = description {
                body["description"] = json!(desc);
            }
            let result: serde_json::Value = client.post_json("/api/tasks", &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        TaskCommand::Update {
            id,
            status,
            title,
            priority,
        } => {
            let mut body = json!({});
            if let Some(s) = status {
                body["status"] = json!(s);
            }
            if let Some(t) = title {
                body["title"] = json!(t);
            }
            if let Some(p) = priority {
                body["priority"] = json!(p);
            }
            let result: serde_json::Value = client.patch(&format!("/api/tasks/{id}"), &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        TaskCommand::Complete { id } => {
            let body = json!({ "status": "done" });
            let result: serde_json::Value = client.patch(&format!("/api/tasks/{id}"), &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        TaskCommand::Check => {
            let sid = match session_id() {
                Ok(s) => s,
                Err(_) => {
                    // No session context (e.g. running outside an agent session) — nothing to check.
                    return Ok(());
                }
            };
            // Report idle status (best-effort, warn on failure) and check tasks concurrently
            let idle_query = [("sessionId", sid.as_str()), ("status", "idle")];
            let check_query = [("sessionId", sid.as_str())];
            let (idle_result, result) = tokio::join!(
                client.post_empty_with_query("/internal/agent-status", &idle_query),
                client.post_empty_with_query("/internal/agent-stop-check", &check_query)
            );
            if let Err(e) = idle_result {
                eprintln!("warning: failed to report idle status: {e}");
            }
            let result = result?;
            // Print the task message if present (tells the agent about incomplete tasks)
            if let Some(msg) = result.get("message").and_then(|v| v.as_str()) {
                if !msg.is_empty() {
                    println!("{msg}");
                }
            }
        }
        TaskCommand::Sync => {
            let sid = match session_id() {
                Ok(s) => s,
                Err(_) => {
                    // No session context — drain stdin and exit silently.
                    let _ = std::io::stdin().read_to_end(&mut Vec::new());
                    return Ok(());
                }
            };
            let mut buf = Vec::new();
            std::io::stdin().read_to_end(&mut buf)?;
            let result = client
                .post_raw_bytes(&format!("/internal/agent-todos?sessionId={sid}"), buf)
                .await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}
