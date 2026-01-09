//! Session management commands.

use anyhow::Result;
use colored::Colorize;

use crate::cli::{SessionCommand, SessionAction};
use crate::config::Config;
use crate::tmux;

pub async fn execute(cmd: SessionCommand, config: &Config) -> Result<()> {
    match cmd.action {
        SessionAction::Spawn { folder, agent, worktree, branch, name } => {
            spawn(&folder, &agent, worktree, branch.as_deref(), name.as_deref(), config).await
        }
        SessionAction::List { folder, all } => {
            list(folder.as_deref(), all, config).await
        }
        SessionAction::Attach { session_id } => {
            attach(&session_id, config).await
        }
        SessionAction::Inject { session_id, context } => {
            inject(&session_id, &context, config).await
        }
        SessionAction::Close { session_id, force } => {
            close(&session_id, force, config).await
        }
        SessionAction::Scrollback { session_id, lines } => {
            scrollback(&session_id, lines, config).await
        }
    }
}

async fn spawn(
    folder: &str,
    agent: &str,
    worktree: bool,
    branch: Option<&str>,
    name: Option<&str>,
    config: &Config,
) -> Result<()> {
    println!("{}", "Spawning task session...".cyan());
    println!("  Folder: {}", folder);
    println!("  Agent: {}", agent);
    if worktree {
        println!("  Worktree: yes");
        if let Some(b) = branch {
            println!("  Branch: {}", b);
        }
    }

    let session_name = name
        .map(|n| format!("rdv-session-{}", n))
        .unwrap_or_else(|| format!("rdv-session-{}", uuid::Uuid::new_v4()));

    let agent_cmd = config.agent_command(agent).unwrap_or(agent);

    // TODO: Create worktree if requested

    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: session_name.clone(),
        working_directory: Some(folder.to_string()),
        command: Some(agent_cmd.to_string()),
    })?;

    println!("{}", "✓ Session spawned".green());
    println!("  Session: {}", session_name);

    Ok(())
}

async fn list(folder: Option<&str>, _all: bool, _config: &Config) -> Result<()> {
    println!("{}", "Sessions".cyan().bold());
    println!("{}", "─".repeat(50));

    let sessions = tmux::list_sessions()?;
    let rdv_sessions: Vec<_> = sessions
        .iter()
        .filter(|s| s.name.starts_with("rdv-"))
        .filter(|s| {
            if let Some(f) = folder {
                s.name.contains(f)
            } else {
                true
            }
        })
        .collect();

    if rdv_sessions.is_empty() {
        println!("  No sessions found");
    } else {
        for session in rdv_sessions {
            let status = if session.attached { "attached".green() } else { "detached".yellow() };
            println!("  {} ({})", session.name, status);
        }
    }

    Ok(())
}

async fn attach(session_id: &str, _config: &Config) -> Result<()> {
    tmux::attach_session(session_id)?;
    Ok(())
}

async fn inject(session_id: &str, context: &str, _config: &Config) -> Result<()> {
    println!("{}", format!("Injecting context into {}...", session_id).cyan());
    tmux::send_keys(session_id, context, true)?;
    println!("{}", "✓ Context injected".green());
    Ok(())
}

async fn close(session_id: &str, force: bool, _config: &Config) -> Result<()> {
    println!("{}", format!("Closing session {}...", session_id).cyan());

    if force {
        tmux::kill_session(session_id)?;
    } else {
        // Send exit command first, then kill if still alive
        let _ = tmux::send_keys(session_id, "exit", true);
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        if tmux::session_exists(session_id)? {
            tmux::kill_session(session_id)?;
        }
    }

    println!("{}", "✓ Session closed".green());
    Ok(())
}

async fn scrollback(session_id: &str, lines: u32, _config: &Config) -> Result<()> {
    let content = tmux::capture_pane(session_id, Some(lines))?;
    println!("{}", content);
    Ok(())
}
