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
    /// Unified handler for Claude Code lifecycle hooks (cmux-compatible)
    Claude {
        /// Hook event: session-start, stop, notification, compacting, prompt-submit, post-tool-use, session-end
        event: String,
        /// Agent provider name
        #[arg(long)]
        agent: Option<String>,
        /// Reason for stop
        #[arg(long)]
        reason: Option<String>,
    },
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

/// Handle agent stop: report idle, check incomplete tasks, notify if proceeding.
/// Returns Ok(()) early if no session ID is available.
async fn handle_stop(client: &Client, agent: Option<String>, reason: Option<String>) -> Result<(), Box<dyn std::error::Error>> {
    let sid = match client.session_id() {
        Some(s) => s,
        None => return Ok(()),
    };

    let idle_query = [("sessionId", sid), ("status", "idle")];
    let check_query = [("sessionId", sid)];
    let (idle_result, check_result) = tokio::join!(
        client.post_empty_with_query("/internal/agent-status", &idle_query),
        client.post_empty_with_query("/internal/agent-stop-check", &check_query)
    );
    if let Err(e) = idle_result {
        eprintln!("warning: failed to report idle status: {e}");
    }

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

    if !stop_blocked {
        let title = match &agent {
            Some(a) => format!("Agent stopped: {a}"),
            None => "Agent stopped".to_string(),
        };
        let payload = json!({
            "sessionId": sid,
            "type": "agent_exited",
            "title": title,
            "body": reason.unwrap_or_else(|| "Session ended normally".to_string()),
        });
        let _ = client.post_json("/internal/notify", &payload).await;
    }

    Ok(())
}

/// Check if a git command in a sensitive folder would leak identity.
/// Reads the PreToolUse payload from stdin, inspects for git commit/push commands,
/// and calls the git-guard API to evaluate identity risk.
/// Returns true if the tool use should be blocked.
async fn check_git_identity_guard(client: &Client) -> bool {
    // Read stdin to get the tool payload
    let mut buf = Vec::new();
    if std::io::stdin().read_to_end(&mut buf).is_err() {
        return false;
    }

    let payload: serde_json::Value = match serde_json::from_slice(&buf) {
        Ok(v) => v,
        Err(_) => return false,
    };

    // Only check Bash tool calls
    let tool_name = payload.get("tool_name").and_then(|v| v.as_str()).unwrap_or("");
    if tool_name != "Bash" {
        return false;
    }

    let command = payload
        .get("tool_input")
        .and_then(|v| v.get("command"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Check if the command is a git commit or git push
    let is_git_commit = command.contains("git commit") || command.contains("git-commit");
    let is_git_push = command.contains("git push") || command.contains("git-push");
    if !is_git_commit && !is_git_push {
        return false;
    }

    let operation = if is_git_push { "push" } else { "commit" };

    // Need session ID to look up folder
    let sid = match client.session_id() {
        Some(s) => s,
        None => return false,
    };

    // Get the session's folder ID
    #[derive(serde::Deserialize)]
    struct SessionInfo {
        #[serde(rename = "folderId")]
        folder_id: Option<String>,
    }

    let session: SessionInfo = match client.get(&format!("/api/sessions/{sid}")).await {
        Ok(s) => s,
        Err(_) => return false,
    };

    let folder_id = match &session.folder_id {
        Some(id) => id,
        None => return false,
    };

    // Read git identity from environment (set by session-service)
    let proposed_name = std::env::var("GIT_AUTHOR_NAME")
        .or_else(|_| std::env::var("GIT_COMMITTER_NAME"))
        .unwrap_or_default();
    let proposed_email = std::env::var("GIT_AUTHOR_EMAIL")
        .or_else(|_| std::env::var("GIT_COMMITTER_EMAIL"))
        .unwrap_or_default();

    // Always call the guard API — the server determines if the folder is sensitive
    // even when no identity env vars are set (which is the most dangerous case)

    // Call the git-guard API
    let guard_payload = json!({
        "proposedName": proposed_name,
        "proposedEmail": proposed_email,
        "operation": operation,
    });

    #[derive(serde::Deserialize)]
    struct GuardResult {
        risk: String,
        reason: Option<String>,
    }

    let result: GuardResult = match client
        .post_json(&format!("/api/folders/{folder_id}/git-guard"), &guard_payload)
        .await
    {
        Ok(val) => match serde_json::from_value(val) {
            Ok(r) => r,
            Err(_) => return false,
        },
        Err(_) => return false,
    };

    match result.risk.as_str() {
        "block" => {
            if let Some(reason) = &result.reason {
                eprintln!("🛡️  Git identity guard: {reason}");
            }
            true
        }
        "warn" => {
            if let Some(reason) = &result.reason {
                eprintln!("⚠️  Git identity warning: {reason}");
            }
            false
        }
        _ => false,
    }
}

/// Sync task/todo data from stdin to the terminal server.
/// Drains stdin even if no session ID is available to prevent blocking the caller.
async fn sync_todos_from_stdin(client: &Client) -> Result<(), Box<dyn std::error::Error>> {
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
    Ok(())
}

pub async fn run(args: HookArgs, client: &Client, _human: bool) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        HookCommand::PreToolUse => {
            report_status(client, "running").await;
            if check_git_identity_guard(client).await {
                std::process::exit(2);
            }
        }
        HookCommand::PostToolUse => {
            sync_todos_from_stdin(client).await?;
        }
        HookCommand::PreCompact => {
            report_status(client, "compacting").await;
        }
        HookCommand::Notification => {
            report_status(client, "waiting").await;
        }
        HookCommand::Stop { agent, reason } => {
            handle_stop(client, agent, reason).await?;
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
        HookCommand::Claude { event, agent, reason } => {
            match event.as_str() {
                "session-start" | "active" | "prompt-submit" => {
                    report_status(client, "running").await;
                }
                "stop" | "idle" => {
                    handle_stop(client, agent, reason).await?;
                }
                "notification" | "notify" => {
                    report_status(client, "waiting").await;
                }
                "compacting" => {
                    report_status(client, "compacting").await;
                }
                "post-tool-use" | "task-sync" => {
                    sync_todos_from_stdin(client).await?;
                }
                "session-end" => {
                    report_status(client, "ended").await;
                }
                unknown => {
                    eprintln!("error: unknown claude hook event: {unknown}");
                    std::process::exit(1);
                }
            }
        }
    }
    Ok(())
}
