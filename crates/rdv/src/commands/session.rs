//! Session management commands.
//!
//! Sessions are task-level work units that run in isolated tmux sessions.
//!
//! Integration with Remote Dev API:
//! - Creates session records in database
//! - Associates sessions with folders
//! - Tracks session status and history
//! - Supports scrollback capture via API

use anyhow::{Context, Result};
use colored::Colorize;
use std::path::PathBuf;

use crate::api::{ApiClient, CreateSessionRequest};
use crate::cli::{SessionAction, SessionCommand};
use crate::config::Config;
use crate::tmux;

pub async fn execute(cmd: SessionCommand, config: &Config) -> Result<()> {
    match cmd.action {
        SessionAction::Spawn {
            folder,
            agent,
            worktree,
            branch,
            name,
        } => spawn(&folder, &agent, worktree, branch.as_deref(), name.as_deref(), config).await,
        SessionAction::List { folder, all } => list(folder.as_deref(), all, config).await,
        SessionAction::Attach { session_id } => attach(&session_id, config).await,
        SessionAction::Inject { session_id, context } => {
            inject(&session_id, &context, config).await
        }
        SessionAction::Close { session_id, force } => close(&session_id, force, config).await,
        SessionAction::Scrollback { session_id, lines } => {
            scrollback(&session_id, lines, config).await
        }
    }
}

fn resolve_folder_path(folder: &str) -> PathBuf {
    let p = if folder == "." {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from(folder)
    };
    p.canonicalize().unwrap_or(p)
}

async fn spawn(
    folder: &str,
    agent: &str,
    worktree: bool,
    branch: Option<&str>,
    name: Option<&str>,
    config: &Config,
) -> Result<()> {
    let folder_path = resolve_folder_path(folder);
    let folder_path_str = folder_path.to_string_lossy().to_string();

    println!("{}", "Spawning task session...".cyan());
    println!("  Folder: {:?}", folder_path);
    println!("  Agent: {}", agent);
    if worktree {
        println!("  Worktree: yes");
        if let Some(b) = branch {
            println!("  Branch: {}", b);
        }
    }

    // Generate session name
    let short_id = &uuid::Uuid::new_v4().to_string()[..8];
    let session_display_name = name.unwrap_or_else(|| {
        folder_path
            .file_name()
            .map(|n| n.to_str().unwrap_or("session"))
            .unwrap_or("session")
    });
    let tmux_session_name = format!("rdv-task-{}-{}", session_display_name, short_id);

    let agent_cmd = config.agent_command(agent).unwrap_or(agent);

    // Track API session ID
    let mut api_session_id: Option<String> = None;

    // Try to integrate with Remote Dev API
    let api = ApiClient::new(config)?;
    let api_available = api.health_check().await.unwrap_or(false);

    if api_available {
        // Find folder in API
        let folder_record = api.get_folder_by_path(&folder_path_str).await?;
        let folder_id = folder_record.map(|f| f.id);

        // Create session in API
        let session = api
            .create_session(CreateSessionRequest {
                name: name.unwrap_or(session_display_name).to_string(),
                folder_id,
                working_directory: Some(folder_path_str.clone()),
                agent_provider: Some(agent.to_string()),
                worktree_id: None, // TODO: Handle worktree creation
            })
            .await
            .context("Failed to create session in API")?;

        api_session_id = Some(session.id.clone());
        println!("  {} Created API session: {}", "✓".green(), &session.id[..8]);
    } else {
        println!(
            "  {}",
            "⚠ API unavailable, creating local-only session".yellow()
        );
    }

    // TODO: Create worktree if requested
    if worktree {
        println!(
            "  {}",
            "⚠ Worktree support not yet implemented".yellow()
        );
    }

    // Create tmux session
    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: tmux_session_name.clone(),
        working_directory: Some(folder_path_str),
        command: Some(agent_cmd.to_string()),
    })?;

    println!("{}", "✓ Session spawned".green());
    println!("  tmux Session: {}", tmux_session_name);
    if let Some(id) = api_session_id {
        println!("  API Session ID: {}", &id[..8]);
    }
    println!();
    println!(
        "  Run `rdv session attach {}` to connect",
        tmux_session_name
    );

    Ok(())
}

async fn list(folder: Option<&str>, all: bool, config: &Config) -> Result<()> {
    println!("{}", "Sessions".cyan().bold());
    println!("{}", "─".repeat(70));

    // Get local tmux sessions
    let tmux_sessions = tmux::list_sessions()?;
    let rdv_tmux_sessions: Vec<_> = tmux_sessions
        .iter()
        .filter(|s| {
            s.name.starts_with("rdv-task-")
                || s.name.starts_with("rdv-session-")
                || s.name.starts_with("rdv-master-")
                || s.name.starts_with("rdv-folder-")
        })
        .filter(|s| {
            if let Some(f) = folder {
                s.name.contains(f)
            } else {
                true
            }
        })
        .collect();

    println!("  {}", "Local (tmux):".cyan());
    if rdv_tmux_sessions.is_empty() {
        println!("    No local sessions found");
    } else {
        for session in &rdv_tmux_sessions {
            let status = if session.attached {
                "attached".green()
            } else {
                "detached".yellow()
            };
            let session_type = if session.name.contains("-master-") {
                "master"
            } else if session.name.contains("-folder-") {
                "folder"
            } else {
                "task"
            };
            println!("    {} ({}) [{}]", session.name, status, session_type);
        }
    }

    // Get API sessions
    let api = ApiClient::new(config)?;
    if api.health_check().await.unwrap_or(false) {
        println!();
        println!("  {}", "Remote Dev API:".cyan());

        // Get folder_id if folder path is specified
        let folder_id = if let Some(f) = folder {
            let folder_path = resolve_folder_path(f);
            api.get_folder_by_path(&folder_path.to_string_lossy())
                .await?
                .map(|f| f.id)
        } else {
            None
        };

        match api.list_sessions(folder_id.as_deref()).await {
            Ok(sessions) => {
                let filtered: Vec<_> = if all {
                    sessions
                } else {
                    sessions
                        .into_iter()
                        .filter(|s| s.status != "closed")
                        .collect()
                };

                if filtered.is_empty() {
                    println!("    No API sessions found");
                } else {
                    for session in filtered {
                        let status = match session.status.as_str() {
                            "active" => "active".green(),
                            "suspended" => "suspended".yellow(),
                            "closed" => "closed".red(),
                            _ => session.status.normal(),
                        };
                        let agent = session.agent_provider.as_deref().unwrap_or("unknown");
                        println!(
                            "    {} ({}) [{}] - {}",
                            &session.id[..8],
                            status,
                            agent,
                            session.name
                        );
                    }
                }
            }
            Err(e) => {
                println!("    Failed to fetch sessions: {}", e);
            }
        }
    } else {
        println!();
        println!("  {}", "API: Disconnected".red());
    }

    Ok(())
}

async fn attach(session_id: &str, config: &Config) -> Result<()> {
    // Try to find session - could be tmux name or API session ID
    let tmux_name = if session_id.starts_with("rdv-") {
        // Already a tmux session name
        session_id.to_string()
    } else {
        // Might be an API session ID - try to look up tmux name
        let api = ApiClient::new(config)?;
        if api.health_check().await.unwrap_or(false) {
            if let Ok(Some(session)) = api.get_session(session_id).await {
                session
                    .tmux_session_name
                    .unwrap_or_else(|| session_id.to_string())
            } else {
                // Not found in API, try as tmux name directly
                session_id.to_string()
            }
        } else {
            session_id.to_string()
        }
    };

    if !tmux::session_exists(&tmux_name)? {
        println!("{}", format!("Session '{}' not found", session_id).red());
        return Ok(());
    }

    tmux::attach_session(&tmux_name)?;
    Ok(())
}

async fn inject(session_id: &str, context: &str, config: &Config) -> Result<()> {
    // Resolve session name
    let tmux_name = resolve_tmux_name(session_id, config).await?;

    println!(
        "{}",
        format!("Injecting context into {}...", tmux_name).cyan()
    );

    // Try API first for proper audit logging
    let api = ApiClient::new(config)?;
    if api.health_check().await.unwrap_or(false) {
        // API inject_context sends the command
        if let Err(e) = api.inject_context(session_id, context).await {
            println!(
                "  {} API injection failed ({}), using tmux directly",
                "⚠".yellow(),
                e
            );
            tmux::send_keys(&tmux_name, context, true)?;
        } else {
            println!("  {} Injected via API", "✓".green());
        }
    } else {
        // Fallback to direct tmux
        tmux::send_keys(&tmux_name, context, true)?;
    }

    println!("{}", "✓ Context injected".green());
    Ok(())
}

async fn close(session_id: &str, force: bool, config: &Config) -> Result<()> {
    let tmux_name = resolve_tmux_name(session_id, config).await?;

    println!("{}", format!("Closing session {}...", tmux_name).cyan());

    // Update API status
    let api = ApiClient::new(config)?;
    if api.health_check().await.unwrap_or(false) {
        // Try to close via API
        if let Err(e) = api.close_session(session_id).await {
            println!("  {} API close failed: {}", "⚠".yellow(), e);
        } else {
            println!("  {} Updated API status", "✓".green());
        }
    }

    // Close tmux session
    if tmux::session_exists(&tmux_name)? {
        if force {
            tmux::kill_session(&tmux_name)?;
        } else {
            // Send exit command first, then kill if still alive
            let _ = tmux::send_keys(&tmux_name, "exit", true);
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            if tmux::session_exists(&tmux_name)? {
                tmux::kill_session(&tmux_name)?;
            }
        }
    }

    println!("{}", "✓ Session closed".green());
    Ok(())
}

async fn scrollback(session_id: &str, lines: u32, config: &Config) -> Result<()> {
    let tmux_name = resolve_tmux_name(session_id, config).await?;

    // Try API first (captures and stores scrollback)
    let api = ApiClient::new(config)?;
    if api.health_check().await.unwrap_or(false) {
        match api.get_scrollback(session_id, lines).await {
            Ok(content) => {
                println!("{}", content);
                return Ok(());
            }
            Err(_) => {
                // Fallback to local tmux capture
            }
        }
    }

    // Local tmux capture
    let content = tmux::capture_pane(&tmux_name, Some(lines))?;
    println!("{}", content);
    Ok(())
}

/// Resolve a session identifier to a tmux session name.
/// Handles both direct tmux names (rdv-*) and API session IDs.
async fn resolve_tmux_name(session_id: &str, config: &Config) -> Result<String> {
    if session_id.starts_with("rdv-") {
        return Ok(session_id.to_string());
    }

    // Try to look up in API
    let api = ApiClient::new(config)?;
    if api.health_check().await.unwrap_or(false) {
        if let Ok(Some(session)) = api.get_session(session_id).await {
            if let Some(tmux_name) = session.tmux_session_name {
                return Ok(tmux_name);
            }
        }
    }

    // Fall back to using the ID as-is
    Ok(session_id.to_string())
}
