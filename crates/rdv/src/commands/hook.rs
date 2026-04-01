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
    /// Handle SessionEnd hook: report session ended
    SessionEnd,
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

// ── Bash inspection ─────────────────────────────────────────────────

/// Result of inspecting a Bash tool-use payload for git push to main/master.
struct BashInspection {
    command: String,
    targets_main: bool,
}

/// Inspect a parsed tool-use payload for Bash commands of interest.
/// Returns `None` if the payload is not a Bash tool call or has no command.
fn inspect_bash_payload(payload: &serde_json::Value) -> Option<BashInspection> {
    let tool_name = payload.get("tool_name")?.as_str()?;
    if tool_name != "Bash" {
        return None;
    }
    let command = payload
        .get("tool_input")?
        .get("command")?
        .as_str()?
        .to_string();
    let is_git_push = command.contains("git push") || command.contains("git-push");
    // If no explicit branch (bare `git push` or `git push origin`), assume it may target main
    let targets_main = is_git_push
        && extract_branch_from_push(&command)
            .map_or(true, |b| b == "main" || b == "master");
    Some(BashInspection {
        command,
        targets_main,
    })
}

// ── Auto-title ──────────────────────────────────────────────────────

/// Try to apply an auto-title to the agent session from its .jsonl file.
/// Fire-and-forget: never blocks the hook, silently ignores errors.
/// Uses a tmpfile sentinel so it only fires until a title is successfully applied.
/// The sentinel stores an attempt counter; gives up after MAX_ATTEMPTS tries.
async fn try_apply_auto_title(client: &Client) {
    const MAX_ATTEMPTS: u32 = 10;

    let Some(sid) = client.session_id() else {
        return;
    };

    let sentinel = std::path::PathBuf::from(format!("/tmp/rdv-autotitle-{sid}"));

    // Read sentinel: "done" means title was applied; a number tracks attempts
    let sentinel_value = std::fs::read_to_string(&sentinel).unwrap_or_default();
    let trimmed = sentinel_value.trim();

    if trimmed == "done" {
        return;
    }

    let attempts: u32 = trimmed.parse().unwrap_or(0);
    if attempts >= MAX_ATTEMPTS {
        return;
    }

    let _ = std::fs::write(&sentinel, (attempts + 1).to_string());

    let query = [("sessionId", sid)];
    let result: Result<serde_json::Value, _> =
        client.post_empty_with_query("/internal/agent-title", &query).await;

    if let Ok(val) = result {
        if val.get("applied").and_then(|v| v.as_bool()).unwrap_or(false) {
            let _ = std::fs::write(&sentinel, "done");
        }
    }
}

// ── Mention token stripping ─────────────────────────────────────────

/// Replace `@<sid:UUID>` mention tokens with `@<short-id>` for human-readable output.
fn strip_mention_tokens(body: &str) -> String {
    const PREFIX: &str = "@<sid:";
    const SUFFIX: char = '>';
    const UUID_LEN: usize = 36; // e.g. 550e8400-e29b-41d4-a716-446655440000

    let mut result = String::with_capacity(body.len());
    let mut rest = body;

    while let Some(start) = rest.find(PREFIX) {
        result.push_str(&rest[..start]);
        let after_prefix = &rest[start + PREFIX.len()..];
        if after_prefix.len() >= UUID_LEN + 1 && after_prefix.as_bytes()[UUID_LEN] == SUFFIX as u8 {
            // Replace with @<first-8-chars-of-uuid>
            result.push('@');
            result.push_str(&after_prefix[..8]);
            rest = &after_prefix[UUID_LEN + 1..];
        } else {
            // Not a valid token, keep the prefix literal
            result.push_str(PREFIX);
            rest = after_prefix;
        }
    }
    result.push_str(rest);
    result
}

// ── Status reporting ────────────────────────────────────────────────

/// Report an agent activity status to the terminal server.
/// Silently returns if no session ID is available.
async fn report_status(client: &Client, status: &str) {
    let Some(sid) = client.session_id() else {
        return;
    };
    let query = [("sessionId", sid), ("status", status)];
    if let Err(e) = client.post_empty_with_query("/internal/agent-status", &query).await {
        eprintln!("warning: failed to report {status} status: {e}");
    }
}

/// Check if an error is a connection-level failure (worth retrying).
fn is_connection_error(err: &dyn std::error::Error) -> bool {
    let msg = err.to_string().to_lowercase();
    msg.contains("connection refused")
        || msg.contains("connect error")
        || msg.contains("connection reset")
        || msg.contains("broken pipe")
        || msg.contains("timed out")
}

// ── Peer digest ─────────────────────────────────────────────────────

const PEER_HEADER: &str = "\u{2500}\u{2500} Peers \u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}";
const PEER_FOOTER: &str = "\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}";

/// Print a compact peer status table and any new messages to stderr.
async fn print_peer_digest(client: &Client) {
    let Some(sid) = client.session_id() else {
        return;
    };

    // Fetch peers
    let peer_query = [("sessionId", sid)];
    let peers_result: Result<serde_json::Value, _> = client
        .get_with_query("/internal/peers/list", &peer_query)
        .await;

    // Fetch new messages using timestamp sentinel
    let ts_file = format!("/tmp/rdv-peer-poll-{sid}");
    let since = std::fs::read_to_string(&ts_file)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());
    let now = chrono::Utc::now().to_rfc3339();

    let msg_query = [("sessionId", sid), ("since", since.as_str())];
    let messages_result: Result<serde_json::Value, _> = client
        .get_with_query("/internal/peers/messages/poll", &msg_query)
        .await;

    // Always update timestamp to avoid re-processing on failure
    let _ = std::fs::write(&ts_file, &now);

    // Print peers section if there are peers
    if let Ok(resp) = &peers_result {
        if let Some(peers) = resp.get("peers").and_then(|v| v.as_array()) {
            if !peers.is_empty() {
                eprintln!("{PEER_HEADER}");
                for peer in peers {
                    let name = peer.get("name").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let status = peer
                        .get("agentActivityStatus")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let summary = peer
                        .get("peerSummary")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if summary.is_empty() {
                        eprintln!("  {name} [{status}]");
                    } else {
                        eprintln!("  {name} [{status}]: {summary}");
                    }
                }
                eprintln!("{PEER_FOOTER}");
            }
        }
    }

    // Print new messages if any
    if let Ok(resp) = messages_result {
        if let Some(messages) = resp.get("messages").and_then(|v| v.as_array()) {
            for msg in messages {
                let from = msg
                    .get("fromSessionName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let raw_body = msg.get("body").and_then(|v| v.as_str()).unwrap_or("");
                let body = strip_mention_tokens(raw_body);
                let is_broadcast = msg.get("toSessionId").map_or(true, |v| v.is_null());
                let target = if is_broadcast { " (broadcast)" } else { "" };
                eprintln!("\u{1f4e8} Peer message from {from}{target}: {body}");
            }
        }
    }
}

// ── Peer broadcasts ─────────────────────────────────────────────────

/// Extract the branch name from a `git push` command string.
/// Returns the remote-tracking branch if present, otherwise None.
fn extract_branch_from_push(command: &str) -> Option<String> {
    // Parse patterns like: git push origin main, git push origin feature/foo
    let parts: Vec<&str> = command.split_whitespace().collect();
    // Find "push" in the args, then look for remote and branch
    let push_idx = parts.iter().position(|&w| w == "push")?;
    // Skip flags (starting with -)
    let mut args_after_push = parts[push_idx + 1..]
        .iter()
        .filter(|w| !w.starts_with('-'));
    let _remote = args_after_push.next()?; // e.g. "origin"
    let branch = args_after_push.next()?; // e.g. "main"
    // Handle refspec like "local:remote"
    let branch_name = if let Some((_local, remote)) = branch.split_once(':') {
        remote
    } else {
        branch
    };
    Some(branch_name.to_string())
}

/// Fire-and-forget broadcast when git push to main/master detected.
async fn broadcast_git_push_to_peers(client: &Client, command: &str) {
    let Some(sid) = client.session_id() else {
        return;
    };
    let body = match extract_branch_from_push(command) {
        Some(branch) => format!("pushed to {branch} \u{2014} you may need to rebase"),
        None => "pushed (branch unspecified) \u{2014} you may need to rebase".to_string(),
    };
    let payload = json!({ "fromSessionId": sid, "body": body });
    let _ = client.post_json("/internal/peers/messages/send", &payload).await;
}

/// Broadcast session start once per session (sentinel at /tmp/rdv-peer-start-{sid}).
async fn broadcast_session_start(client: &Client) {
    let Some(sid) = client.session_id() else {
        return;
    };
    let sentinel = format!("/tmp/rdv-peer-start-{sid}");
    if std::fs::metadata(&sentinel).is_ok() {
        return;
    }
    let _ = std::fs::write(&sentinel, "1");
    let payload = json!({ "fromSessionId": sid, "body": "session started" });
    let _ = client.post_json("/internal/peers/messages/send", &payload).await;
}

// ── Git identity guard ──────────────────────────────────────────────

/// Check if a git command in a sensitive folder would leak identity.
/// Accepts a pre-parsed PreToolUse payload, inspects for git commit/push commands,
/// and calls the git-guard API to evaluate identity risk.
/// Returns true if the tool use should be blocked.
async fn check_git_identity_guard(client: &Client, payload: &serde_json::Value) -> bool {
    // Only check Bash tool calls
    let tool_name = payload
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
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

    let Some(sid) = client.session_id() else {
        return false;
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

    let Some(ref folder_id) = session.folder_id else {
        return false;
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
                eprintln!("\u{1f6e1}\u{fe0f}  Git identity guard: {reason}");
            }
            true
        }
        "warn" => {
            if let Some(reason) = &result.reason {
                eprintln!("\u{26a0}\u{fe0f}  Git identity warning: {reason}");
            }
            false
        }
        _ => false,
    }
}

// ── Stop handler ────────────────────────────────────────────────────

/// Handle agent stop: report idle, check incomplete tasks, notify if proceeding.
/// Returns Ok(()) early if no session ID is available.
async fn handle_stop(
    client: &Client,
    agent: Option<String>,
    reason: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let Some(sid) = client.session_id() else {
        return Ok(());
    };

    // Clear peer summary (fire-and-forget)
    let clear_summary_payload = json!({ "sessionId": sid, "summary": "" });
    let _ = client
        .post_json("/internal/peers/summary", &clear_summary_payload)
        .await;

    // Report idle status (fire-and-forget, don't block on it)
    let idle_query = [("sessionId", sid), ("status", "idle")];
    let idle_future = client.post_empty_with_query("/internal/agent-status", &idle_query);

    // Check tasks with single retry on connection failure
    let check_query = [("sessionId", sid)];
    let check_future = async {
        let result = client
            .post_empty_with_query("/internal/agent-stop-check", &check_query)
            .await;
        match &result {
            Err(e) if is_connection_error(e.as_ref()) => {
                eprintln!("warning: stop-check connection failed, retrying in 500ms...");
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                client
                    .post_empty_with_query("/internal/agent-stop-check", &check_query)
                    .await
            }
            _ => result,
        }
    };

    let (idle_result, check_result) = tokio::join!(idle_future, check_future);
    if let Err(e) = idle_result {
        eprintln!("warning: failed to report idle status: {e}");
    }

    let stop_blocked = match &check_result {
        Ok(val) => {
            let msg = val.get("message").and_then(|v| v.as_str()).unwrap_or("");
            if msg.is_empty() {
                false
            } else {
                println!("{msg}");
                true
            }
        }
        Err(e) => {
            eprintln!("warning: failed to check tasks: {e}");
            println!("Unable to verify task completion. Please run TaskList to check your tasks before stopping.");
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

        // Broadcast "finished work" to peers
        let finished_payload = json!({ "fromSessionId": sid, "body": "finished work" });
        let _ = client
            .post_json("/internal/peers/messages/send", &finished_payload)
            .await;
    }

    Ok(())
}

// ── Todo sync ───────────────────────────────────────────────────────

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

// ── Main handler ────────────────────────────────────────────────────

pub async fn run(
    args: HookArgs,
    client: &Client,
    _human: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    match args.command {
        HookCommand::PreToolUse => {
            report_status(client, "running").await;
            print_peer_digest(client).await;
            broadcast_session_start(client).await;
            try_apply_auto_title(client).await;

            // Read stdin once into a buffer, parse as JSON
            let mut buf = Vec::new();
            let _ = std::io::stdin().read_to_end(&mut buf);
            let payload: serde_json::Value =
                serde_json::from_slice(&buf).unwrap_or(serde_json::Value::Null);

            if check_git_identity_guard(client, &payload).await {
                std::process::exit(2);
            }
        }
        HookCommand::PostToolUse => {
            // Read stdin, parse as JSON to check for Bash git push
            let mut buf = Vec::new();
            let _ = std::io::stdin().read_to_end(&mut buf);
            let payload: serde_json::Value =
                serde_json::from_slice(&buf).unwrap_or(serde_json::Value::Null);

            // Broadcast to peers after successful git push to main/master
            if let Some(inspection) = inspect_bash_payload(&payload) {
                if inspection.targets_main {
                    broadcast_git_push_to_peers(client, &inspection.command).await;
                }
            }
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
            let Some(sid) = client.session_id() else {
                return Ok(());
            };

            let payload = json!({
                "sessionId": sid,
                "type": "info",
                "title": event,
                "body": body.unwrap_or_default(),
            });
            let _ = client.post_json("/internal/notify", &payload).await;
        }
        HookCommand::SessionEnd => {
            report_status(client, "ended").await;
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
                match client
                    .post_empty_with_query("/internal/agent-status", &query)
                    .await
                {
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
        HookCommand::Claude {
            event,
            agent,
            reason,
        } => {
            match event.as_str() {
                "session-start" | "active" | "prompt-submit" => {
                    report_status(client, "running").await;
                    // Peer digest is handled by PreToolUse (Bash matcher) to avoid
                    // duplicate output — the "" matcher fires on ALL tools including Bash.
                    broadcast_session_start(client).await;
                    try_apply_auto_title(client).await;
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
