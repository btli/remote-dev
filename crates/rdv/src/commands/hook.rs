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
    /// Handle PostToolUse hook: post-push peer broadcast
    PostToolUse,
    /// Handle PreCompact hook: report "compacting" status
    PreCompact,
    /// Handle Notification hook: report "waiting" status
    Notification,
    /// Handle Stop hook: report idle status, check beads, create notification
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
        /// Event name (e.g. "error", "stalled", "deployed")
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

// ── Proxy state reporting ───────────────────────────────────────────

/// Report the active ANTHROPIC_BASE_URL and API key prefix to the server.
/// When ANTHROPIC_BASE_URL is unset, reports the default (https://api.anthropic.com)
/// since that is the actual endpoint Claude Code will use.
/// Uses a sentinel file to only report when state changes.
async fn report_proxy_state(client: &Client) {
    let Some(sid) = client.session_id() else {
        return;
    };

    const DEFAULT_ANTHROPIC_URL: &str = "https://api.anthropic.com";

    let has_key = std::env::var("ANTHROPIC_API_KEY").is_ok();
    // Skip entirely if no API key is set (agent won't be calling any API)
    if !has_key {
        return;
    }

    let api_key = std::env::var("ANTHROPIC_API_KEY").unwrap_or_default();
    let base_url = std::env::var("ANTHROPIC_BASE_URL")
        .unwrap_or_else(|_| DEFAULT_ANTHROPIC_URL.to_string());
    let key_prefix: String = api_key.chars().take(12).collect();

    // Sentinel: only report on change
    let sentinel = format!("/tmp/rdv-proxy-state-{sid}");
    let current = format!("{base_url}|{key_prefix}");
    if std::fs::read_to_string(&sentinel).unwrap_or_default() == current {
        return;
    }

    let payload = json!({
        "sessionId": sid,
        "baseUrl": base_url,
        "keyPrefix": key_prefix,
        "apiKey": api_key,
    });

    if client.post_json("/internal/proxy-state", &payload).await.is_ok() {
        let _ = std::fs::write(&sentinel, &current);
    }
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

    // Get the session's project and folder IDs
    #[derive(serde::Deserialize)]
    struct SessionInfo {
        #[serde(rename = "projectId")]
        project_id: Option<String>,
        #[serde(rename = "folderId")]
        folder_id: Option<String>,
    }

    let session: SessionInfo = match client.get(&format!("/api/sessions/{sid}")).await {
        Ok(s) => s,
        Err(_) => return false,
    };

    // Prefer RDV_PROJECT_ID env var, then session.projectId, then fall back to folderId
    let project_id = std::env::var("RDV_PROJECT_ID")
        .ok()
        .or_else(|| session.project_id.clone())
        .or_else(|| session.folder_id.clone());

    let Some(ref folder_id) = project_id else {
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
        "projectId": folder_id,
        "folderId": folder_id,
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

// ── Beads check ────────────────────────────────────────────────────

/// Check if there are in-progress beads issues.
/// Returns Some(message) if unfinished work found, None otherwise.
async fn check_beads_unfinished() -> Option<String> {
    // Check if .beads/ directory exists in current working directory
    if !std::path::Path::new(".beads").exists() {
        return None;
    }

    // Run bd list to check for in-progress issues
    let output = match tokio::process::Command::new("bd")
        .args(["list", "--status=in_progress", "--json", "--quiet"])
        .output()
        .await
    {
        Ok(o) => o,
        Err(_) => return None, // bd not available, skip check
    };

    if !output.status.success() {
        return None; // bd command failed, don't block stop
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stdout = stdout.trim();
    if stdout.is_empty() || stdout == "[]" || stdout == "null" {
        return None;
    }

    // Parse the JSON to get issue titles
    if let Ok(issues) = serde_json::from_str::<Vec<serde_json::Value>>(stdout) {
        if issues.is_empty() {
            return None;
        }
        let mut msg = format!(
            "You have {} in-progress beads issue(s) that should be completed or updated before stopping:\n\n",
            issues.len()
        );
        for issue in &issues {
            let id = issue.get("id").and_then(|v| v.as_str()).unwrap_or("?");
            let title = issue.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
            msg.push_str(&format!("- [{id}] {title}\n"));
        }
        msg.push_str(
            "\nPlease complete or close these issues with `bd close <id>`, then try stopping again.",
        );
        Some(msg)
    } else {
        None
    }
}

// ── Stop handler ────────────────────────────────────────────────────

/// Handle agent stop: report idle, notify, broadcast to peers.
/// Returns Ok(()) early if no session ID is available.
/// If beads has in-progress issues, prints them to stdout (which tells Claude Code
/// to continue working) and returns early without reporting idle.
async fn handle_stop(
    client: &Client,
    agent: Option<String>,
    reason: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let Some(sid) = client.session_id() else {
        return Ok(());
    };

    // Check for unfinished beads work before allowing stop
    if let Some(msg) = check_beads_unfinished().await {
        // Print to stdout — Claude Code will see this and continue instead of stopping
        println!("{msg}");
        // Still report running status since agent should continue
        report_status(client, "running").await;
        return Ok(());
    }

    // Clear peer summary (fire-and-forget)
    let clear_summary_payload = json!({ "sessionId": sid, "summary": "" });
    let _ = client
        .post_json("/internal/peers/summary", &clear_summary_payload)
        .await;

    // Report idle status
    let idle_query = [("sessionId", sid), ("status", "idle")];
    if let Err(e) = client.post_empty_with_query("/internal/agent-status", &idle_query).await {
        eprintln!("warning: failed to report idle status: {e}");
    }

    // Send notification
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

    Ok(())
}

/// Drain stdin to prevent blocking the calling process.
fn drain_stdin() {
    let _ = std::io::stdin().read_to_end(&mut Vec::new());
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
            report_proxy_state(client).await;

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
                    report_proxy_state(client).await;
                    // Peer digest is handled by PreToolUse (Bash matcher) to avoid
                    // duplicate output — the "" matcher fires on ALL tools including Bash.
                    broadcast_session_start(client).await;
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
                "post-tool-use" => {
                    // Drain stdin to prevent blocking the caller (Claude Code pipes data)
                    drain_stdin();
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
