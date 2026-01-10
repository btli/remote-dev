//! Session management commands.
//!
//! Sessions are task-level work units that run in isolated tmux sessions.
//!
//! Direct database integration (direct SQLite):
//! - Reads session records from SQLite
//! - Uses tmux directly for session control
//! - No HTTP API needed for most operations

use anyhow::Result;
use colored::Colorize;
use std::path::PathBuf;

use crate::cli::{SessionAction, SessionCommand};
use crate::config::Config;
use crate::db::Database;
use crate::tmux;

pub async fn execute(cmd: SessionCommand, config: &Config) -> Result<()> {
    match cmd.action {
        SessionAction::Spawn {
            folder,
            agent,
            shell,
            worktree,
            branch,
            name,
        } => spawn(&folder, &agent, shell, worktree, branch.as_deref(), name.as_deref(), config).await,
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
    shell: bool,
    worktree: bool,
    branch: Option<&str>,
    name: Option<&str>,
    config: &Config,
) -> Result<()> {
    let folder_path = resolve_folder_path(folder);
    let folder_path_str = folder_path.to_string_lossy().to_string();

    // Determine if this is a shell or agent session
    let is_shell = shell || agent == "none";
    let agent_provider = if is_shell { "none" } else { agent };

    println!("{}", "Spawning session...".cyan());
    println!("  Folder: {:?}", folder_path);
    if is_shell {
        println!("  Type: {} (shell)", "🖥️".cyan());
    } else {
        println!("  Type: {} (agent: {})", "🤖".blue(), agent);
    }
    if worktree {
        println!("  Worktree: yes");
        if let Some(b) = branch {
            println!("  Branch: {}", b);
        }
    }

    // Generate session name
    let session_id = uuid::Uuid::new_v4().to_string();
    let short_id = &session_id[..8];
    let session_display_name = name.unwrap_or_else(|| {
        folder_path
            .file_name()
            .map(|n| n.to_str().unwrap_or("session"))
            .unwrap_or("session")
    });
    let tmux_session_name = format!("rdv-session-{}", &session_id);

    // Determine command to run
    let command = if is_shell {
        None // Shell session - just spawn a shell
    } else {
        let agent_cmd = config.agent_command(agent).unwrap_or(agent);
        Some(agent_cmd.to_string())
    };

    // TODO: Create worktree if requested
    if worktree {
        println!(
            "  {}",
            "⚠ Worktree support not yet implemented".yellow()
        );
    }

    // Create tmux session
    // Task sessions close on exit - user can respawn via UI if needed
    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: tmux_session_name.clone(),
        working_directory: Some(folder_path_str.clone()),
        command,
        auto_respawn: false,
    })?;

    // Create session in database
    if let Ok(db) = Database::open() {
        if let Ok(Some(user)) = db.get_default_user() {
            // Find or create folder for the project path
            let folder_id = db.list_folders(&user.id).ok()
                .and_then(|folders| {
                    folders.iter()
                        .find(|f| f.name == folder_path_str || f.name.ends_with(session_display_name))
                        .map(|f| f.id.clone())
                });

            let new_session = crate::db::NewSession {
                user_id: user.id.clone(),
                name: session_display_name.to_string(),
                tmux_session_name: tmux_session_name.clone(),
                project_path: Some(folder_path_str.clone()),
                folder_id,
                agent_provider: Some(agent_provider.to_string()),
                is_orchestrator_session: false,
            };

            match db.create_session(&new_session) {
                Ok(id) => {
                    println!("  {} Session registered in database", "✓".green());
                    println!("  ID: {}", &id[..8]);
                }
                Err(e) => {
                    println!("  {} Database: {}", "⚠".yellow(), e);
                }
            }
        }
    }

    let session_type = if is_shell { "shell" } else { "agent" };
    println!("{}", format!("✓ {} session spawned", session_type).green());
    println!("  tmux: {}", tmux_session_name);
    println!("  name: {}", session_display_name);
    println!();
    println!(
        "  Run `rdv session attach {}` to connect",
        short_id
    );

    Ok(())
}

async fn list(folder: Option<&str>, all: bool, _config: &Config) -> Result<()> {
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
            // Determine session type from tmux name pattern
            let (icon, session_type) = if session.name.contains("-master-") {
                ("🧠", "master")
            } else if session.name.contains("-folder-") {
                ("🧠", "folder")
            } else if session.name.contains("-task-") || session.name.contains("-session-") {
                // Could be agent or shell - check database for more info
                ("📦", "task")
            } else {
                ("🖥️ ", "shell")
            };
            println!("    {} {} ({}) [{}]", icon, session.name, status, session_type);
        }
    }

    // Get database sessions (direct SQLite, direct SQLite)
    match Database::open() {
        Ok(db) => {
            println!();
            println!("  {}", "Database Sessions:".cyan());

            // Get default user
            let user = match db.get_default_user()? {
                Some(u) => u,
                None => {
                    println!("    No user found in database");
                    return Ok(());
                }
            };

            // Get folder_id if folder path is specified
            let folder_id = if let Some(f) = folder {
                let folder_path = resolve_folder_path(f);
                // Find folder by path in database
                let folders = db.list_folders(&user.id)?;
                folders.iter().find(|fl| fl.name == folder_path.to_string_lossy()).map(|fl| fl.id.clone())
            } else {
                None
            };

            let sessions = db.list_sessions(&user.id, folder_id.as_deref())?;
            let filtered: Vec<_> = if all {
                sessions
            } else {
                sessions.into_iter().filter(|s| s.status != "closed").collect()
            };

            if filtered.is_empty() {
                println!("    No sessions found");
            } else {
                for session in filtered {
                    let status = match session.status.as_str() {
                        "active" => "active".green(),
                        "suspended" => "suspended".yellow(),
                        "closed" => "closed".red(),
                        _ => session.status.normal(),
                    };

                    // Determine session type icon
                    let (icon, type_label) = if session.is_orchestrator_session {
                        ("🧠", "orch")
                    } else {
                        match session.agent_provider.as_deref() {
                            Some("none") | None => ("🖥️ ", "shell"),
                            Some(agent) => ("🤖", agent),
                        }
                    };

                    let id_short = if session.id.len() >= 8 {
                        &session.id[..8]
                    } else {
                        &session.id
                    };
                    println!(
                        "    {} {} ({}) [{}] - {}",
                        icon,
                        id_short,
                        status,
                        type_label,
                        session.name
                    );
                }
            }
        }
        Err(e) => {
            println!();
            println!("  {} Database: {}", "⚠".yellow(), e);
        }
    }

    Ok(())
}

async fn attach(session_id: &str, _config: &Config) -> Result<()> {
    // Try to find session - could be tmux name or database session ID
    let tmux_name = if session_id.starts_with("rdv-") {
        // Already a tmux session name
        session_id.to_string()
    } else {
        // Might be a database session ID - try to look up tmux name
        if let Ok(db) = Database::open() {
            if let Ok(Some(session)) = db.get_session(session_id) {
                session.tmux_session_name
            } else {
                // Not found in DB, try as tmux name directly
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

async fn inject(session_id: &str, context: &str, _config: &Config) -> Result<()> {
    // Resolve session name
    let tmux_name = resolve_tmux_name(session_id).await?;

    println!(
        "{}",
        format!("Injecting context into {}...", tmux_name).cyan()
    );

    // Direct tmux injection (direct SQLite)
    tmux::send_keys(&tmux_name, context, true)?;

    println!("{}", "✓ Context injected".green());
    Ok(())
}

async fn close(session_id: &str, force: bool, _config: &Config) -> Result<()> {
    let tmux_name = resolve_tmux_name(session_id).await?;

    println!("{}", format!("Closing session {}...", tmux_name).cyan());

    // Close tmux session (direct, direct SQLite)
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
        println!("  {} tmux session terminated", "✓".green());
    } else {
        println!("  {} tmux session not found", "⚠".yellow());
    }

    println!("{}", "✓ Session closed".green());
    Ok(())
}

async fn scrollback(session_id: &str, lines: u32, _config: &Config) -> Result<()> {
    let tmux_name = resolve_tmux_name(session_id).await?;

    // Direct tmux capture (direct SQLite)
    let content = tmux::capture_pane(&tmux_name, Some(lines))?;
    println!("{}", content);
    Ok(())
}

/// Resolve a session identifier to a tmux session name.
/// Handles both direct tmux names (rdv-*) and database session IDs.
async fn resolve_tmux_name(session_id: &str) -> Result<String> {
    if session_id.starts_with("rdv-") {
        return Ok(session_id.to_string());
    }

    // Try to look up in database (direct SQLite, direct SQLite)
    if let Ok(db) = Database::open() {
        if let Ok(Some(session)) = db.get_session(session_id) {
            return Ok(session.tmux_session_name);
        }
        // Also try looking up by tmux name
        if let Ok(Some(session)) = db.get_session_by_tmux_name(session_id) {
            return Ok(session.tmux_session_name);
        }
    }

    // Fall back to using the ID as-is
    Ok(session_id.to_string())
}
