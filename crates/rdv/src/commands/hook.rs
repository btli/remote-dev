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
        message: Option<String>,
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

            // Create a notification about the stop event
            let title = match &agent {
                Some(a) => format!("Agent stopped: {a}"),
                None => "Agent stopped".to_string(),
            };
            let message = reason.unwrap_or_else(|| "Session ended normally".to_string());
            let body = json!({
                "sessionId": sid,
                "type": "agent_stop",
                "title": title,
                "message": message,
            });
            // Best-effort notification — don't fail the hook if this errors
            let _ = client.post_json("/api/notifications", &body).await;

            // Output task check message (blocks stop if tasks remain)
            match check_result {
                Ok(val) => {
                    if let Some(msg) = val.get("message").and_then(|v| v.as_str()) {
                        if !msg.is_empty() {
                            println!("{msg}");
                        }
                    }
                }
                Err(e) => {
                    eprintln!("warning: failed to check tasks: {e}");
                    println!("Unable to verify task completion — please check your rdv task list before stopping.");
                }
            }
        }
        HookCommand::Notify { event, message } => {
            let sid = match client.session_id() {
                Some(s) => s,
                None => return Ok(()),
            };

            let body = json!({
                "sessionId": sid,
                "type": format!("hook_{event}"),
                "title": event,
                "message": message.unwrap_or_default(),
            });
            let _ = client.post_json("/api/notifications", &body).await;
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
                // Create a notification suggesting learning extraction
                let body = json!({
                    "sessionId": sid,
                    "type": "session_end",
                    "title": "Session ended",
                    "message": "Consider running `rdv learn analyze` to extract learnings.",
                });
                let _ = client.post_json("/api/notifications", &body).await;
            }
        }
    }
    Ok(())
}
