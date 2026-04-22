use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct AgentArgs {
    #[command(subcommand)]
    command: AgentCommand,
}

#[derive(Subcommand)]
enum AgentCommand {
    /// Start an agent session in a project
    Start {
        /// Project ID to start the agent in (alias: --folder-id for transition)
        #[arg(long, alias = "folder-id")]
        project_id: String,
        /// Optional worktree branch to use
        #[arg(long)]
        worktree: Option<String>,
    },
    /// List active agent sessions
    List,
    /// Stop (suspend) an agent session
    Stop {
        /// Session ID
        id: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct AgentSession {
    id: String,
    name: Option<String>,
    status: Option<String>,
    #[serde(rename = "agentExitState")]
    agent_exit_state: Option<String>,
    #[serde(rename = "workingDirectory")]
    working_directory: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SessionsResponse {
    sessions: Vec<AgentSession>,
}

#[derive(Tabled)]
struct AgentRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Status")]
    status: String,
    #[tabled(rename = "Agent State")]
    agent_exit_state: String,
    #[tabled(rename = "Directory")]
    working_directory: String,
}

impl From<&AgentSession> for AgentRow {
    fn from(s: &AgentSession) -> Self {
        Self {
            id: s.id.clone(),
            name: s.name.clone().unwrap_or_default(),
            status: s.status.clone().unwrap_or_default(),
            agent_exit_state: s.agent_exit_state.clone().unwrap_or_else(|| "running".into()),
            working_directory: s.working_directory.clone().unwrap_or_default(),
        }
    }
}

pub async fn run(args: AgentArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        AgentCommand::Start { project_id, worktree } => {
            let mut body = json!({
                "projectId": project_id,
                "folderId": project_id,
                "terminalType": "agent",
            });
            if let Some(branch) = worktree {
                body["worktreeBranch"] = json!(branch);
            }
            let result: serde_json::Value = client.post_json("/api/sessions", &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        AgentCommand::List => {
            let resp: SessionsResponse =
                client.get_with_query("/api/sessions", &[("type", "agent")]).await?;
            let sessions = resp.sessions;
            if human {
                let rows: Vec<AgentRow> = sessions.iter().map(AgentRow::from).collect();
                println!("{}", Table::new(rows));
            } else {
                println!("{}", serde_json::to_string_pretty(&json!(sessions))?);
            }
        }
        AgentCommand::Stop { id } => {
            let result = client.post_empty(&format!("/api/sessions/{id}/suspend")).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}
