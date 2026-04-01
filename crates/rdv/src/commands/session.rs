use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tabled::{Table, Tabled};

use crate::client::Client;

#[derive(Args)]
pub struct SessionArgs {
    #[command(subcommand)]
    command: SessionCommand,
}

#[derive(Subcommand)]
enum SessionCommand {
    /// List all sessions
    List,
    /// Create a new session
    Create {
        /// Session name
        #[arg(long)]
        name: Option<String>,
        /// Folder ID to place session in
        #[arg(long)]
        folder_id: Option<String>,
        /// Working directory for the session
        #[arg(long)]
        working_dir: Option<String>,
        /// Terminal type (shell, agent, browser)
        #[arg(long)]
        r#type: Option<String>,
    },
    /// Close (delete) a session
    Close {
        /// Session ID
        id: String,
    },
    /// Suspend a session
    Suspend {
        /// Session ID
        id: String,
    },
    /// Resume a suspended session
    Resume {
        /// Session ID
        id: String,
    },
    /// Execute a command in a session (fire-and-forget)
    Exec {
        /// Session ID
        id: String,
        /// Command to execute
        cmd: String,
    },
    /// Get git status for a session's working directory
    GitStatus {
        /// Session ID
        id: String,
    },
    /// Set session title (kebab-case, 3-5 words)
    Title {
        /// Kebab-case title (e.g. "fix-oauth-token-refresh")
        title: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct Session {
    id: String,
    name: Option<String>,
    status: Option<String>,
    #[serde(rename = "folderId")]
    folder_id: Option<String>,
    #[serde(rename = "workingDirectory")]
    working_directory: Option<String>,
    #[serde(rename = "terminalType")]
    terminal_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SessionsResponse {
    sessions: Vec<Session>,
}

#[derive(Tabled)]
struct SessionRow {
    #[tabled(rename = "ID")]
    id: String,
    #[tabled(rename = "Name")]
    name: String,
    #[tabled(rename = "Status")]
    status: String,
    #[tabled(rename = "Type")]
    terminal_type: String,
    #[tabled(rename = "Directory")]
    working_directory: String,
}

impl From<&Session> for SessionRow {
    fn from(s: &Session) -> Self {
        Self {
            id: s.id.clone(),
            name: s.name.clone().unwrap_or_default(),
            status: s.status.clone().unwrap_or_default(),
            terminal_type: s.terminal_type.clone().unwrap_or_else(|| "shell".into()),
            working_directory: s.working_directory.clone().unwrap_or_default(),
        }
    }
}

pub async fn run(args: SessionArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        SessionCommand::List => {
            let resp: SessionsResponse = client.get("/api/sessions").await?;
            let sessions = resp.sessions;
            if human {
                let rows: Vec<SessionRow> = sessions.iter().map(SessionRow::from).collect();
                println!("{}", Table::new(rows));
            } else {
                println!("{}", serde_json::to_string_pretty(&json!(sessions))?);
            }
        }
        SessionCommand::Create {
            name,
            folder_id,
            working_dir,
            r#type,
        } => {
            let mut body = json!({});
            if let Some(n) = name {
                body["name"] = json!(n);
            }
            if let Some(f) = folder_id {
                body["folderId"] = json!(f);
            }
            if let Some(d) = working_dir {
                body["workingDirectory"] = json!(d);
            }
            if let Some(t) = r#type {
                body["terminalType"] = json!(t);
            }
            let result: serde_json::Value = client.post_json("/api/sessions", &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        SessionCommand::Close { id } => {
            let result = client.delete(&format!("/api/sessions/{id}")).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        SessionCommand::Suspend { id } => {
            let result = client.post_empty(&format!("/api/sessions/{id}/suspend")).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        SessionCommand::Resume { id } => {
            let result = client.post_empty(&format!("/api/sessions/{id}/resume")).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        SessionCommand::Exec { id, cmd } => {
            let body = json!({ "command": cmd });
            let result: serde_json::Value = client.post_json(&format!("/api/sessions/{id}/exec"), &body).await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        SessionCommand::GitStatus { id } => {
            let result: serde_json::Value = client
                .get(&format!("/api/sessions/{id}/git-status"))
                .await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
        SessionCommand::Title { title } => {
            // Validate kebab-case: lowercase ascii, digits, and hyphens only
            if !title.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
                return Err("title must be kebab-case (lowercase letters, digits, and hyphens only)".into());
            }
            // Validate 3-5 hyphen-separated words
            let word_count = title.split('-').count();
            if word_count < 3 || word_count > 5 {
                return Err("title must have 3-5 hyphen-separated words".into());
            }
            // Ensure no empty segments (e.g. leading/trailing/double hyphens)
            if title.split('-').any(|w| w.is_empty()) {
                return Err("title must not have empty segments (no leading, trailing, or double hyphens)".into());
            }

            let sid = client
                .session_id()
                .ok_or("RDV_SESSION_ID not set — run inside an agent session")?;

            let query = [("sessionId", sid), ("title", title.as_str())];
            let result: serde_json::Value = client
                .post_empty_with_query("/internal/agent-title/set", &query)
                .await?;
            println!("{}", serde_json::to_string_pretty(&result)?);
        }
    }
    Ok(())
}
