use clap::{Args, Subcommand};
use serde_json::json;

use crate::client::Client;

#[derive(Args)]
pub struct TeamsArgs {
    #[command(subcommand)]
    command: TeamsCommand,
}

#[derive(Subcommand)]
enum TeamsCommand {
    /// Launch coordinated agent sessions
    Launch {
        /// Folder ID to launch sessions in
        #[arg(long)]
        folder_id: Option<String>,
        /// Number of agent sessions to create
        #[arg(long, default_value = "2")]
        count: usize,
        /// Agent provider (claude, codex, gemini)
        #[arg(long, default_value = "claude")]
        provider: String,
        /// Name prefix for sessions
        #[arg(long)]
        name_prefix: Option<String>,
        /// Project path for agent sessions
        #[arg(long)]
        project_path: Option<String>,
    },
    /// List agent sessions grouped by parent
    List {
        /// Parent session ID to filter by
        #[arg(long)]
        parent_id: Option<String>,
    },
    /// Wait for all child sessions to complete
    Wait {
        /// Parent session ID
        parent_id: String,
        /// Timeout in seconds
        #[arg(long, default_value = "300")]
        timeout: u64,
    },
    /// Send text to all child sessions of a parent
    Broadcast {
        /// Parent session ID
        parent_id: String,
        /// Text to send
        #[arg(trailing_var_arg = true, required = true)]
        text: Vec<String>,
    },
}

pub async fn run(args: TeamsArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        TeamsCommand::Launch { folder_id, count, provider, name_prefix, project_path } => {
            let prefix = name_prefix.unwrap_or_else(|| "agent".to_string());
            let mut created_sessions = Vec::new();

            for i in 0..count {
                let name = if count > 1 {
                    format!("{prefix}-{}", i + 1)
                } else {
                    prefix.clone()
                };

                let mut body = json!({
                    "name": name,
                    "terminalType": "agent",
                    "agentProvider": provider,
                });

                if let Some(ref fid) = folder_id {
                    body["folderId"] = json!(fid);
                }
                if let Some(ref path) = project_path {
                    body["workingDirectory"] = json!(path);
                }

                // Set parent session if we're inside an rdv session
                if let Some(parent_id) = client.session_id() {
                    body["parentSessionId"] = json!(parent_id);
                }

                let result: serde_json::Value = client.post_json("/api/sessions", &body).await?;
                let session_id = result["id"].as_str().unwrap_or("unknown");
                let session_name = result["name"].as_str().unwrap_or(&name);

                if human {
                    println!("Created session: {} ({})", session_name, session_id);
                }
                created_sessions.push(result);
            }

            if !human {
                println!("{}", serde_json::to_string_pretty(&created_sessions)?);
            } else {
                println!("\nLaunched {} agent sessions", created_sessions.len());
            }
        }
        TeamsCommand::List { parent_id } => {
            let path = if let Some(ref pid) = parent_id {
                format!("/api/sessions?parentSessionId={pid}")
            } else {
                "/api/sessions".to_string()
            };

            let sessions: serde_json::Value = client.get(&path).await?;

            if human {
                if let Some(arr) = sessions.as_array() {
                    if arr.is_empty() {
                        println!("No sessions found");
                    } else {
                        for s in arr {
                            let id = s["id"].as_str().unwrap_or("?");
                            let name = s["name"].as_str().unwrap_or("unnamed");
                            let status = s["status"].as_str().unwrap_or("unknown");
                            let agent_status = s["agentActivityStatus"].as_str().unwrap_or("-");
                            let parent = s["parentSessionId"].as_str().unwrap_or("-");
                            println!("{id}  {name:<20} status={status:<10} agent={agent_status:<10} parent={parent}");
                        }
                    }
                }
            } else {
                println!("{}", serde_json::to_string_pretty(&sessions)?);
            }
        }
        TeamsCommand::Wait { parent_id, timeout } => {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout);

            loop {
                if std::time::Instant::now() > deadline {
                    eprintln!("Timeout waiting for child sessions to complete");
                    std::process::exit(1);
                }

                let path = format!("/api/sessions?parentSessionId={parent_id}");
                let sessions: serde_json::Value = client.get(&path).await?;

                if let Some(arr) = sessions.as_array() {
                    let all_done = arr.iter().all(|s| {
                        let exit_state = s["agentExitState"].as_str().unwrap_or("");
                        let status = s["status"].as_str().unwrap_or("");
                        exit_state == "exited" || exit_state == "closed" || status == "closed"
                    });

                    if all_done {
                        if human {
                            println!("All {} child sessions completed", arr.len());
                        }
                        break;
                    }

                    if human {
                        let active = arr.iter().filter(|s| {
                            let exit_state = s["agentExitState"].as_str().unwrap_or("");
                            exit_state != "exited" && exit_state != "closed"
                        }).count();
                        eprint!("\rWaiting... {active}/{} sessions still active", arr.len());
                    }
                }

                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
        }
        TeamsCommand::Broadcast { parent_id, text } => {
            let message = text.join(" ");
            let path = format!("/api/sessions?parentSessionId={parent_id}");
            let sessions: serde_json::Value = client.get(&path).await?;

            if let Some(arr) = sessions.as_array() {
                let mut sent = 0;
                for s in arr {
                    let sid = match s["id"].as_str() {
                        Some(id) => id,
                        None => continue,
                    };
                    let status = s["status"].as_str().unwrap_or("");
                    if status == "closed" { continue; }

                    let body = json!({ "sessionId": sid, "text": format!("{message}\n") });
                    if let Err(e) = client.post_json("/internal/pty-write", &body).await {
                        eprintln!("Warning: failed to send to {sid}: {e}");
                    } else {
                        sent += 1;
                    }
                }
                if human {
                    println!("Sent to {sent}/{} sessions", arr.len());
                }
            }
        }
    }
    Ok(())
}
