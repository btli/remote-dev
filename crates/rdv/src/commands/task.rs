//! Task lifecycle commands.
//!
//! Tasks represent work items that are parsed, planned, executed, and monitored.
//! Integration with beads (`bd`) provides persistent issue tracking.
//!
//! Beads Integration:
//! - `rdv task create` can link to or create beads issues
//! - `rdv task list` shows both rdv tasks and beads issues
//! - Task completion updates beads status via `bd close`
//! - Priorities and dependencies flow from beads

use anyhow::{Context, Result};
use colored::Colorize;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

use crate::cli::{TaskAction, TaskCommand};
use crate::config::Config;
use crate::db::Database;
use crate::tmux;

/// A beads issue parsed from `bd show` output.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BeadsIssue {
    id: String,
    title: String,
    issue_type: String,
    priority: String,
    status: String,
    assignee: Option<String>,
    blocked_by: Vec<String>,
    blocks: Vec<String>,
}

/// Check if beads (bd) is available.
fn beads_available() -> bool {
    which::which("bd").is_ok()
}

/// Run a beads command and return stdout.
fn run_beads(args: &[&str]) -> Result<String> {
    let output = Command::new("bd")
        .args(args)
        .output()
        .context("Failed to execute bd command")?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("bd command failed: {}", stderr)
    }
}

/// Parse beads issue from `bd show` output (JSON format if available).
fn parse_beads_issue(output: &str) -> Option<BeadsIssue> {
    // Try JSON parse first
    if let Ok(issue) = serde_json::from_str::<BeadsIssue>(output) {
        return Some(issue);
    }

    // Fallback to text parsing
    let mut issue = BeadsIssue {
        id: String::new(),
        title: String::new(),
        issue_type: String::new(),
        priority: String::new(),
        status: String::new(),
        assignee: None,
        blocked_by: Vec::new(),
        blocks: Vec::new(),
    };

    for line in output.lines() {
        if let Some(id) = line.strip_prefix("ID: ") {
            issue.id = id.trim().to_string();
        } else if let Some(title) = line.strip_prefix("Title: ") {
            issue.title = title.trim().to_string();
        } else if let Some(t) = line.strip_prefix("Type: ") {
            issue.issue_type = t.trim().to_string();
        } else if let Some(p) = line.strip_prefix("Priority: ") {
            issue.priority = p.trim().to_string();
        } else if let Some(s) = line.strip_prefix("Status: ") {
            issue.status = s.trim().to_string();
        }
    }

    if !issue.id.is_empty() {
        Some(issue)
    } else {
        None
    }
}

pub async fn execute(cmd: TaskCommand, config: &Config) -> Result<()> {
    match cmd.action {
        TaskAction::Create {
            description,
            folder,
            beads,
        } => create(&description, folder.as_deref(), beads.as_deref(), config).await,
        TaskAction::Plan { task_id, agent } => plan(&task_id, agent.as_deref(), config).await,
        TaskAction::Execute { task_id } => execute_task(&task_id, config).await,
        TaskAction::Cancel { task_id, reason } => {
            cancel(&task_id, reason.as_deref(), config).await
        }
        TaskAction::List { status, folder, all } => {
            list(status.as_deref(), folder.as_deref(), all, config).await
        }
        TaskAction::Show { task_id } => show(&task_id, config).await,
    }
}

fn resolve_path(path: &str) -> PathBuf {
    let p = if path == "." {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from(path)
    };
    p.canonicalize().unwrap_or(p)
}

async fn create(
    description: &str,
    folder: Option<&str>,
    beads_id: Option<&str>,
    _config: &Config,
) -> Result<()> {
    println!("{}", "Creating task...".cyan());
    println!("  Description: {}", description);

    let folder_path = folder.map(|f| resolve_path(f));

    if let Some(ref fp) = folder_path {
        println!("  Folder: {:?}", fp);
    }

    // Handle beads integration
    let linked_beads_id = if let Some(id) = beads_id {
        // Link to existing beads issue
        println!("  {} Linking to beads issue: {}", "→".cyan(), id);

        if beads_available() {
            // Verify issue exists
            match run_beads(&["show", id]) {
                Ok(output) => {
                    if let Some(issue) = parse_beads_issue(&output) {
                        println!(
                            "    {} Found: [{}] {}",
                            "✓".green(),
                            issue.priority,
                            issue.title
                        );
                        Some(issue.id)
                    } else {
                        println!("    {} Could not parse beads issue", "⚠".yellow());
                        Some(id.to_string())
                    }
                }
                Err(e) => {
                    println!("    {} Beads lookup failed: {}", "⚠".yellow(), e);
                    None
                }
            }
        } else {
            println!("    {} beads (bd) not available", "⚠".yellow());
            None
        }
    } else if beads_available() {
        // Offer to create beads issue
        println!();
        println!("  {} Creating beads issue for tracking...", "→".cyan());

        // Determine issue type from description
        let issue_type = if description.to_lowercase().contains("bug")
            || description.to_lowercase().contains("fix")
        {
            "bug"
        } else if description.to_lowercase().contains("feature")
            || description.to_lowercase().contains("add")
        {
            "feature"
        } else {
            "task"
        };

        // Create beads issue
        match run_beads(&[
            "create",
            "--title",
            description,
            "--type",
            issue_type,
            "--priority",
            "2",
        ]) {
            Ok(output) => {
                // Extract created issue ID
                let id = output
                    .lines()
                    .find(|l| l.contains("Created") || l.starts_with("beads-"))
                    .and_then(|l| {
                        l.split_whitespace()
                            .find(|w| w.starts_with("beads-"))
                            .map(|s| s.to_string())
                    });

                if let Some(ref issue_id) = id {
                    println!(
                        "    {} Created beads issue: {}",
                        "✓".green(),
                        issue_id
                    );
                }
                id
            }
            Err(e) => {
                println!("    {} Failed to create beads issue: {}", "⚠".yellow(), e);
                None
            }
        }
    } else {
        None
    };

    // Look up folder via database (direct SQLite)
    if let Ok(db) = Database::open() {
        if let Ok(Some(user)) = db.get_default_user() {
            // Get folder ID if path provided
            let folder_id = if let Some(ref fp) = folder_path {
                // Match folder by name (last component of path)
                let folder_name = fp.file_name()
                    .map(|n| n.to_string_lossy().to_string());
                if let Some(name) = folder_name {
                    let folders = db.list_folders(&user.id)?;
                    folders.iter()
                        .find(|f| f.name == name)
                        .map(|f| f.id.clone())
                } else {
                    None
                }
            } else {
                None
            };

            // For now, tasks are tracked via beads
            // The database task table will be used for orchestrator-managed tasks
            println!();
            println!("  {} Task registered", "→".cyan());
            println!("    Folder ID: {:?}", folder_id);
            println!("    Beads ID: {:?}", linked_beads_id);
        }
    } else {
        println!("  {} Database unavailable", "⚠".yellow());
    }

    println!();
    println!("{}", "✓ Task created".green());

    Ok(())
}

async fn plan(task_id: &str, agent: Option<&str>, config: &Config) -> Result<()> {
    println!("{}", format!("Planning task {}...", task_id).cyan());

    // Check if task_id is a beads issue
    let is_beads = task_id.starts_with("beads-");

    if is_beads && beads_available() {
        // Get beads issue details
        println!("  {} Loading beads issue...", "→".cyan());
        match run_beads(&["show", task_id]) {
            Ok(output) => {
                if let Some(issue) = parse_beads_issue(&output) {
                    println!("    Title: {}", issue.title);
                    println!("    Type: {}", issue.issue_type);
                    println!("    Priority: {}", issue.priority);
                    println!("    Status: {}", issue.status);

                    if !issue.blocked_by.is_empty() {
                        println!(
                            "    {} Blocked by: {}",
                            "⚠".yellow(),
                            issue.blocked_by.join(", ")
                        );
                    }
                }
            }
            Err(e) => {
                println!("    {} Failed to load: {}", "⚠".yellow(), e);
            }
        }
    }

    // Determine agent
    let selected_agent = agent.unwrap_or(&config.agents.default);
    println!();
    println!("  {}", "Planning:".cyan());
    println!("    Agent: {}", selected_agent);
    println!("    Isolation: worktree (recommended)");

    // Check agent availability
    if let Some(cmd) = config.agent_command(selected_agent) {
        if which::which(cmd).is_ok() {
            println!("    Agent status: {} installed", "✓".green());
        } else {
            println!(
                "    Agent status: {} not found",
                "✗".red()
            );
        }
    }

    // Generate context
    println!();
    println!("  {}", "Suggested context injection:".cyan());
    println!("    Work on task: {}", task_id);
    if is_beads {
        println!("    Update beads when done: `bd close {}`", task_id);
    }

    Ok(())
}

async fn execute_task(task_id: &str, config: &Config) -> Result<()> {
    println!("{}", format!("Executing task {}...", task_id).cyan());

    let is_beads = task_id.starts_with("beads-");

    // Update beads status
    if is_beads && beads_available() {
        println!("  {} Updating beads status to in_progress...", "→".cyan());
        match run_beads(&["update", task_id, "--status=in_progress"]) {
            Ok(_) => println!("    {} Beads updated", "✓".green()),
            Err(e) => println!("    {} Failed: {}", "⚠".yellow(), e),
        }
    }

    // Get working directory
    let working_dir = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| ".".to_string());

    // Create session
    let session_name = format!(
        "rdv-task-{}-{}",
        task_id,
        &uuid::Uuid::new_v4().to_string()[..8]
    );
    let agent_cmd = config
        .agent_command(&config.agents.default)
        .unwrap_or("claude");

    println!("  {} Spawning session...", "→".cyan());

    // Task sessions close on exit - user can respawn via UI if needed
    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: session_name.clone(),
        working_directory: Some(working_dir),
        command: Some(agent_cmd.to_string()),
        auto_respawn: false,
        env: None,
    })?;

    // Inject context
    let context = if is_beads {
        format!(
            "You are working on task {}. When complete, run `bd close {}` to mark it done.",
            task_id, task_id
        )
    } else {
        format!("You are working on task {}.", task_id)
    };

    println!("  {} Injecting context...", "→".cyan());
    tmux::send_keys(&session_name, &context, true)?;

    println!();
    println!("{}", "✓ Task execution started".green());
    println!("  Session: {}", session_name);
    println!();
    println!(
        "  Run `rdv session attach {}` to connect",
        session_name
    );

    Ok(())
}

async fn cancel(task_id: &str, reason: Option<&str>, _config: &Config) -> Result<()> {
    println!("{}", format!("Cancelling task {}...", task_id).cyan());

    let is_beads = task_id.starts_with("beads-");

    // Kill any running session for this task
    let sessions = tmux::list_sessions()?;
    for session in sessions {
        if session.name.contains(task_id) {
            println!("  {} Killing session {}...", "→".cyan(), session.name);
            tmux::kill_session(&session.name)?;
        }
    }

    // Update beads if applicable
    if is_beads && beads_available() {
        let reason_msg = reason.unwrap_or("Cancelled via rdv");
        println!("  {} Updating beads...", "→".cyan());
        match run_beads(&["close", task_id, "--reason", reason_msg]) {
            Ok(_) => println!("    {} Beads closed", "✓".green()),
            Err(e) => println!("    {} Failed: {}", "⚠".yellow(), e),
        }
    }

    println!();
    println!("{}", "✓ Task cancelled".green());

    Ok(())
}

async fn list(
    status: Option<&str>,
    folder: Option<&str>,
    all: bool,
    _config: &Config,
) -> Result<()> {
    println!("{}", "Tasks".cyan().bold());
    println!("{}", "─".repeat(70));

    // List running rdv task sessions
    println!("  {}", "Running Sessions:".cyan());

    let sessions = tmux::list_sessions()?;
    let task_sessions: Vec<_> = sessions
        .iter()
        .filter(|s| s.name.starts_with("rdv-task-"))
        .filter(|s| {
            if let Some(f) = folder {
                s.name.contains(f)
            } else {
                true
            }
        })
        .collect();

    if task_sessions.is_empty() {
        println!("    No task sessions running");
    } else {
        for session in task_sessions {
            let attached = if session.attached {
                "attached".green()
            } else {
                "detached".yellow()
            };
            println!("    {} ({})", session.name, attached);
        }
    }

    // List beads issues
    if beads_available() {
        println!();
        println!("  {}", "Beads Issues:".cyan());

        let bd_args: Vec<&str> = match (status, all) {
            (Some(s), _) => vec!["list", "--status", s],
            (None, true) => vec!["list"],
            (None, false) => vec!["list", "--status=open"],
        };

        match run_beads(&bd_args) {
            Ok(output) => {
                if output.trim().is_empty() {
                    println!("    No matching beads issues");
                } else {
                    for line in output.lines().take(15) {
                        println!("    {}", line);
                    }
                    let total_lines = output.lines().count();
                    if total_lines > 15 {
                        println!("    ... and {} more", total_lines - 15);
                    }
                }
            }
            Err(e) => {
                println!("    {} Failed to list: {}", "⚠".yellow(), e);
            }
        }

        // Show ready work
        println!();
        println!("  {}", "Ready to Work:".cyan());
        match run_beads(&["ready"]) {
            Ok(output) => {
                let lines: Vec<_> = output.lines().take(5).collect();
                if lines.is_empty() {
                    println!("    No issues ready (all blocked or none available)");
                } else {
                    for line in lines {
                        println!("    {}", line);
                    }
                }
            }
            Err(_) => {
                println!("    Unable to check ready issues");
            }
        }
    } else {
        println!();
        println!("  {} beads (bd) not available", "⚠".yellow());
    }

    Ok(())
}

async fn show(task_id: &str, _config: &Config) -> Result<()> {
    println!("{}", format!("Task: {}", task_id).cyan().bold());
    println!("{}", "─".repeat(60));

    let is_beads = task_id.starts_with("beads-");

    if is_beads && beads_available() {
        // Show beads issue details
        match run_beads(&["show", task_id]) {
            Ok(output) => {
                println!("{}", output);
            }
            Err(e) => {
                println!("  {} Failed to load beads issue: {}", "⚠".yellow(), e);
            }
        }
    }

    // Check for running sessions
    let sessions = tmux::list_sessions()?;
    let task_sessions: Vec<_> = sessions
        .iter()
        .filter(|s| s.name.contains(task_id))
        .collect();

    if !task_sessions.is_empty() {
        println!();
        println!("  {}", "Active Sessions:".cyan());
        for session in task_sessions {
            let status = if session.attached {
                "attached".green()
            } else {
                "detached".yellow()
            };
            println!("    {} ({})", session.name, status);
        }
    }

    Ok(())
}
