use clap::Args;
use serde_json::json;

use crate::client::Client;

#[derive(Args)]
pub struct TmuxCompatArgs {
    /// tmux subcommand and arguments
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    args: Vec<String>,
}

pub async fn run(args: TmuxCompatArgs, client: &Client, human: bool) -> Result<(), Box<dyn std::error::Error>> {
    if args.args.is_empty() {
        return passthrough_tmux(&[]);
    }

    let subcmd = args.args[0].as_str();
    let rest = &args.args[1..];

    match subcmd {
        "send-keys" => handle_send_keys(rest, client).await,
        "capture-pane" => handle_capture_pane(rest, client, human).await,
        _ => passthrough_tmux(&args.args),
    }
}

fn passthrough_tmux(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use std::os::unix::process::CommandExt;
    let err = std::process::Command::new("tmux").args(args).exec();
    Err(format!("Failed to exec tmux: {err}").into())
}

/// Resolve a tmux target to an rdv session ID if it matches rdv patterns.
fn resolve_session_id(target: &str) -> Option<String> {
    if let Some(uuid) = target.strip_prefix("rdv-") {
        Some(uuid.to_string())
    } else if target.len() > 8 && target.chars().all(|c| c.is_alphanumeric() || c == '-') {
        // Looks like a bare UUID
        Some(target.to_string())
    } else {
        None
    }
}

/// Find the value of `-t <target>` in a slice of args.
/// Returns (target_value, remaining_args_without_t_flag).
fn extract_target(args: &[String]) -> (Option<String>, Vec<String>) {
    let mut target = None;
    let mut remaining = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "-t" && i + 1 < args.len() {
            target = Some(args[i + 1].clone());
            i += 2;
            continue;
        }
        remaining.push(args[i].clone());
        i += 1;
    }
    (target, remaining)
}

async fn handle_send_keys(args: &[String], client: &Client) -> Result<(), Box<dyn std::error::Error>> {
    let (target, remaining) = extract_target(args);

    let target = match target {
        Some(t) => t,
        None => {
            // No target specified, pass through to real tmux
            let mut full_args = vec!["send-keys".to_string()];
            full_args.extend_from_slice(args);
            return passthrough_tmux(&full_args);
        }
    };

    let session_id = match resolve_session_id(&target) {
        Some(id) => id,
        None => {
            // Not an rdv session, pass through to real tmux
            let mut full_args = vec!["send-keys".to_string()];
            full_args.extend_from_slice(args);
            return passthrough_tmux(&full_args);
        }
    };

    // Check for -l (literal) flag
    let has_literal = remaining.iter().any(|a| a == "-l");
    let key_args: Vec<&String> = remaining.iter().filter(|a| *a != "-l").collect();

    if has_literal {
        // Literal text mode: POST /internal/pty-write
        let text = key_args.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" ");
        let body = json!({
            "sessionId": session_id,
            "text": text,
        });
        client.post_json("/internal/pty-write", &body).await?;
    } else {
        // Key mode: POST /internal/pty-key for each key argument
        for key in &key_args {
            let body = json!({
                "sessionId": session_id,
                "key": key,
            });
            client.post_json("/internal/pty-key", &body).await?;
        }
    }

    Ok(())
}

async fn handle_capture_pane(args: &[String], client: &Client, _human: bool) -> Result<(), Box<dyn std::error::Error>> {
    let (target, remaining) = extract_target(args);
    let has_print = remaining.iter().any(|a| a == "-p");

    let target = match target {
        Some(t) => t,
        None => {
            let mut full_args = vec!["capture-pane".to_string()];
            full_args.extend_from_slice(args);
            return passthrough_tmux(&full_args);
        }
    };

    let session_id = match resolve_session_id(&target) {
        Some(id) => id,
        None => {
            let mut full_args = vec!["capture-pane".to_string()];
            full_args.extend_from_slice(args);
            return passthrough_tmux(&full_args);
        }
    };

    if has_print {
        let query = [("sessionId", session_id.as_str())];
        let result: serde_json::Value = client.get_with_query("/internal/screen", &query).await?;
        let content = result
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        println!("{content}");
    } else {
        // Without -p, pass through to real tmux (capture-pane without -p stores in buffer)
        let mut full_args = vec!["capture-pane".to_string()];
        full_args.extend_from_slice(args);
        return passthrough_tmux(&full_args);
    }

    Ok(())
}
