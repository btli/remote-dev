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
}

pub async fn run(args: HookArgs, client: &Client, _human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        HookCommand::Stop { agent, reason } => {
            let sid = match client.session_id() {
                Some(s) => s,
                None => return Ok(()),
            };

            // Report idle status and check tasks concurrently (same as `task check`)
            let idle_query = [("sessionId", sid), ("status", "idle")];
            let check_query = [("sessionId", sid)];
            let (idle_result, check_result) = tokio::join!(
                client.post_empty_with_query("/internal/agent-status", &idle_query),
                client.post_empty_with_query("/internal/agent-stop-check", &check_query)
            );
            if let Err(e) = idle_result {
                eprintln!("warning: failed to report idle status: {e}");
            }

            // Output task check message first (blocks stop if tasks remain)
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

            // Report ended status
            let query = [("sessionId", sid), ("status", "ended")];
            if let Err(e) = client.post_empty_with_query("/internal/agent-status", &query).await {
                eprintln!("warning: failed to report ended status: {e}");
            }

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
    }
    Ok(())
}
