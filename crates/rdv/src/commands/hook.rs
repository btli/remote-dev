use std::io::Read;

use clap::{Args, Subcommand};
use serde_json::json;

use crate::client::Client;

#[derive(Args)]
pub struct HookArgs {
    #[command(subcommand)]
    command: HookCommand,
}

#[derive(Subcommand)]
enum HookCommand {
    /// Handle PreToolUse hook: report "running" status
    PreToolUse,
    /// Handle PostToolUse hook: sync task/todo data from stdin
    PostToolUse,
    /// Handle PreCompact hook: report "compacting" status
    PreCompact,
    /// Handle Notification hook: report "waiting" status
    Notification,
    /// Handle Stop hook: report idle status, check tasks, create notification
    Stop {
        /// Agent provider name (e.g. "claude", "codex")
        #[arg(long)]
        agent: Option<String>,
        /// Reason the agent stopped
        #[arg(long)]
        reason: Option<String>,
    },
    /// Send a notification for a lifecycle event
    Notify {
        /// Event name (e.g. "task_complete", "error", "stalled")
        event: String,
        /// Optional message body
        #[arg(long)]
        body: Option<String>,
    },
    /// Handle SessionEnd hook: report session ended, optionally trigger learning
    SessionEnd {
        /// Skip learning/analysis extraction
        #[arg(long)]
        skip_learn: bool,
    },
    /// Validate that all hooks can reach the server and are functional
    Validate,
}

/// Report an agent activity status to the terminal server.
/// Silently returns if no session ID is available.
async fn report_status(client: &Client, status: &str) {
    let sid = match client.session_id() {
        Some(s) => s,
        None => return,
    };
    let query = [("sessionId", sid), ("status", status)];
    if let Err(e) = client.post_empty_with_query("/internal/agent-status", &query).await {
        eprintln!("warning: failed to report {status} status: {e}");
    }
}

pub async fn run(args: HookArgs, client: &Client, _human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        HookCommand::PreToolUse => {
            report_status(client, "running").await;
        }
        HookCommand::PostToolUse => {
            let sid = match client.session_id() {
                Some(s) => s,
                None => {
                    let _ = std::io::stdin().read_to_end(&mut Vec::new());
                    return Ok(());
                }
            };
            let mut buf = Vec::new();
            std::io::stdin().read_to_end(&mut buf)?;
            if let Err(e) = client
                .post_raw_bytes(&format!("/internal/agent-todos?sessionId={sid}"), buf)
                .await
            {
                eprintln!("warning: failed to sync tasks: {e}");
            }
        }
        HookCommand::PreCompact => {
            report_status(client, "compacting").await;
        }
        HookCommand::Notification => {
            report_status(client, "waiting").await;
        }
        HookCommand::Stop { agent, reason } => {
            let sid = match client.session_id() {
                Some(s) => s,
                None => return Ok(()),
            };

            // Report idle status and check tasks concurrently
            let idle_query = [("sessionId", sid), ("status", "idle")];
            let check_query = [("sessionId", sid)];
            let (idle_result, check_result) = tokio::join!(
                client.post_empty_with_query("/internal/agent-status", &idle_query),
                client.post_empty_with_query("/internal/agent-stop-check", &check_query)
            );
            if let Err(e) = idle_result {
                eprintln!("warning: failed to report idle status: {e}");
            }

            // Output task check message (blocks stop if tasks remain)
            let stop_blocked = match &check_result {
                Ok(val) => {
                    let msg = val.get("message").and_then(|v| v.as_str()).unwrap_or("");
                    if !msg.is_empty() {
                        println!("{msg}");
                        true
                    } else {
                        false
                    }
                }
                Err(e) => {
                    eprintln!("warning: failed to check tasks: {e}");
                    println!("Unable to verify task completion — please check your rdv task list before stopping.");
                    true
                }
            };

            // Only send "Agent stopped" notification if the stop is actually proceeding
            if !stop_blocked {
                let title = match &agent {
                    Some(a) => format!("Agent stopped: {a}"),
                    None => "Agent stopped".to_string(),
                };
                let payload = json!({
                    "sessionId": sid,
                    "type": "agent_complete",
                    "title": title,
                    "body": reason.unwrap_or_else(|| "Session ended normally".to_string()),
                });
                let _ = client.post_json("/internal/notify", &payload).await;
            }
        }
        HookCommand::Notify { event, body } => {
            let sid = match client.session_id() {
                Some(s) => s,
                None => return Ok(()),
            };

            let payload = json!({
                "sessionId": sid,
                "type": "info",
                "title": event,
                "body": body.unwrap_or_default(),
            });
            let _ = client.post_json("/internal/notify", &payload).await;
        }
        HookCommand::SessionEnd { skip_learn } => {
            let sid = match client.session_id() {
                Some(s) => s,
                None => return Ok(()),
            };

            report_status(client, "ended").await;

            if !skip_learn {
                let payload = json!({
                    "sessionId": sid,
                    "type": "info",
                    "title": "Session ended",
                    "body": "Consider running `rdv learn analyze` to extract learnings.",
                });
                let _ = client.post_json("/internal/notify", &payload).await;
            }
        }
        HookCommand::Validate => {
            let mut results: Vec<serde_json::Value> = Vec::new();
            let mut all_ok = true;
            let sid = client.session_id();

            // Check 1: RDV_SESSION_ID available
            let has_sid = sid.is_some();
            if !has_sid {
                all_ok = false;
            }
            results.push(if has_sid {
                json!({ "check": "session_id", "status": "ok" })
            } else {
                json!({ "check": "session_id", "status": "fail", "error": "RDV_SESSION_ID not set" })
            });

            // Check 2: Terminal server reachable (agent-status endpoint)
            let terminal_check = if let Some(s) = sid {
                let query = [("sessionId", s), ("status", "running")];
                match client.post_empty_with_query("/internal/agent-status", &query).await {
                    Ok(_) => json!({ "check": "terminal_server", "status": "ok" }),
                    Err(e) => {
                        all_ok = false;
                        json!({ "check": "terminal_server", "status": "fail", "error": e.to_string() })
                    }
                }
            } else {
                all_ok = false;
                json!({ "check": "terminal_server", "status": "skip", "reason": "no session ID" })
            };
            results.push(terminal_check);

            // Check 3: API server reachable (sessions endpoint)
            let api_check = match client.get::<serde_json::Value>("/api/sessions").await {
                Ok(_) => json!({ "check": "api_server", "status": "ok" }),
                Err(e) => {
                    all_ok = false;
                    json!({ "check": "api_server", "status": "fail", "error": e.to_string() })
                }
            };
            results.push(api_check);

            let output = json!({
                "valid": all_ok,
                "checks": results,
            });
            println!("{}", serde_json::to_string_pretty(&output)?);

            if !all_ok {
                std::process::exit(1);
            }
        }
    }
    Ok(())
}
