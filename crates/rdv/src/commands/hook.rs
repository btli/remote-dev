//! Hook commands for Claude Code integration.
//!
//! Provides native Rust implementations for Claude Code hooks:
//! - session-start: Context injection at session start
//! - session-end: Learning extraction at session end
//! - compact: Context reconstitution after compaction
//! - notify: Lightweight event notifications

use anyhow::{Context, Result};
use rdv_core::types::{MemoryQueryFilter, NewMemoryEntry};
use serde::Deserialize;
use std::io::{self, Read as IoRead};
use std::process::Command;

use crate::cli::{HookAction, HookCommand};
use crate::config::Config;
use crate::database::get_database;

/// JSON input from Claude Code PostToolUse hook (via stdin).
#[derive(Debug, Deserialize)]
struct ClaudeCodeHookInput {
    tool_name: String,
    tool_input: Option<serde_json::Value>,
    tool_response: Option<serde_json::Value>,
    #[serde(default)]
    cwd: Option<String>,
}

/// Execute hook command.
pub async fn execute(cmd: HookCommand, config: &Config) -> Result<()> {
    match cmd.action {
        HookAction::SessionStart { agent, path } => {
            session_start(&agent, path.as_deref(), config).await
        }
        HookAction::SessionEnd {
            agent,
            path,
            skip_learn,
        } => session_end(&agent, path.as_deref(), skip_learn, config).await,
        HookAction::Compact { path } => compact(path.as_deref(), config),
        HookAction::Notify {
            event,
            agent,
            reason,
        } => notify(&event, &agent, reason.as_deref(), config).await,
        HookAction::PostToolUse {
            tool_name,
            input,
            output,
            path,
        } => post_tool_use(tool_name.as_deref(), input.as_deref(), output.as_deref(), path.as_deref()).await,
        HookAction::Stop {
            agent,
            reason,
            path,
        } => stop(&agent, reason.as_deref(), path.as_deref()).await,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Start Hook
// ─────────────────────────────────────────────────────────────────────────────

/// Handle session start - inject context, retrieve memories.
async fn session_start(agent: &str, path: Option<&str>, _config: &Config) -> Result<()> {
    let project_path = resolve_project_path(path)?;
    let tmux_session = get_tmux_session();
    let git_branch = get_git_branch(&project_path);
    let folder_name = get_folder_name(&project_path);

    // Store initial session context as short-term memory
    let session_info = format!(
        "Session started in {} on branch {}",
        folder_name,
        git_branch.as_deref().unwrap_or("unknown")
    );
    let _ = store_memory(&session_info, "short_term", "observation", None, None);

    // Retrieve memories and knowledge
    let long_term_memories = recall_memories("long_term", 10);
    let working_memories = recall_memories("working", 5);
    let knowledge = get_knowledge(10);

    // Format sections
    let long_term_section = format_memories(&long_term_memories, "Long-term Memories");
    let working_section = format_memories(&working_memories, "Working Memory");
    let knowledge_section = format_knowledge(&knowledge);

    let has_context =
        !long_term_memories.is_empty() || !working_memories.is_empty() || !knowledge.is_empty();

    // Output context injection
    println!(
        r#"
[Session Context Injected]
─────────────────────────────────────────────────
Project: {}
Branch: {}
Session: {}
{}
## Memory System

You have access to a hierarchical memory system. Use it to:
- Store important discoveries, patterns, and gotchas
- Remember decisions and their rationale
- Build up project knowledge over time

**Available Memory Commands (use rdv CLI):**
- `rdv memory remember "content"` - Store observation (short-term, 1hr)
- `rdv memory remember -t working "content"` - Store working context (24hr)
- `rdv memory remember -t long "content"` - Store permanent learning
- `rdv note add "content"` - Quick note capture
- `rdv knowledge add "title" "description"` - Add project knowledge

**Memory Tiers:**
- `short`: Ephemeral observations (auto-expires in 1 hour)
- `working`: Current task context (auto-expires in 24 hours)
- `long`: Permanent learnings (never expires)

**rdv Commands:**
- `rdv insights list` - View orchestrator insights
- `rdv learn analyze <session>` - Extract learnings from session
- `rdv memory recall` - Search memories
- `rdv knowledge list` - View project knowledge base
─────────────────────────────────────────────────
"#,
        project_path,
        git_branch.as_deref().unwrap_or("N/A"),
        tmux_session.as_deref().unwrap_or("N/A"),
        if has_context {
            format!(
                "\n## Retrieved Context from Previous Sessions\n{}{}{}",
                knowledge_section, long_term_section, working_section
            )
        } else {
            String::new()
        }
    );

    // Send notification (non-blocking, ignore errors)
    let _ = send_orchestrator_event("session_start", agent, None).await;

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Session End Hook
// ─────────────────────────────────────────────────────────────────────────────

/// Handle session end - extract learnings, notify orchestrator.
async fn session_end(
    agent: &str,
    path: Option<&str>,
    skip_learn: bool,
    _config: &Config,
) -> Result<()> {
    let project_path = resolve_project_path(path)?;
    let tmux_session = get_tmux_session();

    // Send notification first (fast path)
    let _ = send_orchestrator_event("session_end", agent, Some("Session completed")).await;

    // Extract learnings if not skipped and tmux session available
    if !skip_learn {
        if let Some(ref session) = tmux_session {
            // Run learning extraction in background (don't block exit)
            // This is fire-and-forget to ensure /exit is fast
            let session_clone = session.clone();
            let path_clone = project_path.clone();
            tokio::spawn(async move {
                let _ = extract_learnings(&session_clone, &path_clone);
            });
        }
    }

    // Output summary
    println!(
        r#"
[Session End Summary]
─────────────────────────────────────────────────
Project: {}
Session: {}
Timestamp: {}
{}
─────────────────────────────────────────────────
"#,
        project_path,
        tmux_session.as_deref().unwrap_or("N/A"),
        chrono::Utc::now().to_rfc3339(),
        if skip_learn {
            "Learning extraction skipped."
        } else {
            "Learning extraction started in background."
        }
    );

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact Hook (PreCompact)
// ─────────────────────────────────────────────────────────────────────────────

/// Handle pre-compact - save context to memory and output recovery instructions.
/// This runs BEFORE compaction. Critical context is saved to working memory so
/// it persists through compaction. After compaction, Claude should use the
/// memory-recall subagent to retrieve relevant context.
fn compact(path: Option<&str>, _config: &Config) -> Result<()> {
    let project_path = resolve_project_path(path)?;
    let folder_name = get_folder_name(&project_path);
    let folder_id = get_folder_id_for_path(&project_path);

    // Get current task context
    let task_context = get_task_context(&project_path);

    // Save current task context to working memory (will persist through compaction)
    if !task_context.in_progress.is_empty() {
        let tasks_content = task_context
            .in_progress
            .iter()
            .map(|t| format!("- `{}`: {}", t.id, t.title))
            .collect::<Vec<_>>()
            .join("\n");

        let _ = store_memory(
            &format!("## Tasks In Progress at Compaction\n{}", tasks_content),
            "working",
            "observation",
            Some("Pre-Compaction Task State"),
            folder_id.as_deref(),
        );
    }

    // Retrieve knowledge for context injection
    let knowledge = get_knowledge(10);
    let knowledge_section = format_knowledge(&knowledge);

    // Output instructions that will be part of compacted context
    println!(
        r#"
[PreCompact - Context Preservation]
═════════════════════════════════════════════════
Project: {}
{}
## Post-Compaction Recovery Instructions

**IMPORTANT**: After compaction completes, you MUST invoke the **memory-recall**
subagent to retrieve context that may be missing. Use:

```
Task tool with subagent_type="memory-recall"
```

The memory-recall agent will:
1. Search for relevant memories based on current tasks
2. Retrieve gotchas, patterns, and conventions
3. Filter out information already in context
4. Return only NEW context needed for the current work

This ensures you have full context after compaction without duplicating
information that was preserved in the summary.

═════════════════════════════════════════════════
"#,
        folder_name,
        if !knowledge.is_empty() {
            format!("\n## Project Knowledge (Preserved)\n{}", knowledge_section)
        } else {
            String::new()
        }
    );

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// PostCompact Hook
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Notify Hook
// ─────────────────────────────────────────────────────────────────────────────

/// Send lightweight event notification to orchestrator.
async fn notify(event: &str, agent: &str, reason: Option<&str>, _config: &Config) -> Result<()> {
    send_orchestrator_event(event, agent, reason).await?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// PostToolUse Hook
// ─────────────────────────────────────────────────────────────────────────────

/// Handle post-tool-use - capture tool usage as observation.
/// This creates short-term memories for significant tool operations.
///
/// When called from Claude Code hook (tool_name is None), reads JSON from stdin.
/// When called manually (tool_name provided), uses command-line arguments.
async fn post_tool_use(
    tool_name: Option<&str>,
    input: Option<&str>,
    output: Option<&str>,
    path: Option<&str>,
) -> Result<()> {
    // Determine tool info from stdin (Claude Code hook) or args (manual)
    let (actual_tool_name, actual_input, actual_output, actual_path) = match tool_name {
        Some(name) => {
            // Manual invocation with command-line args
            (
                name.to_string(),
                input.map(String::from),
                output.map(String::from),
                path.map(String::from),
            )
        }
        None => {
            // Claude Code hook - read JSON from stdin
            let mut stdin_content = String::new();
            io::stdin().read_to_string(&mut stdin_content)?;

            let hook_input: ClaudeCodeHookInput = serde_json::from_str(&stdin_content)
                .context("Failed to parse Claude Code hook JSON from stdin")?;

            // Convert JSON values to strings for existing logic
            let input_str = hook_input.tool_input.map(|v| {
                if v.is_string() {
                    v.as_str().unwrap_or_default().to_string()
                } else {
                    serde_json::to_string(&v).unwrap_or_default()
                }
            });

            let output_str = hook_input.tool_response.map(|v| {
                if v.is_string() {
                    v.as_str().unwrap_or_default().to_string()
                } else {
                    serde_json::to_string(&v).unwrap_or_default()
                }
            });

            (
                hook_input.tool_name,
                input_str,
                output_str,
                hook_input.cwd.or_else(|| path.map(String::from)),
            )
        }
    };

    // Skip low-value tool observations to avoid noise
    let skip_tools = ["Read", "Glob", "Grep", "LS", "WebSearch", "ListMcpResourcesTool", "ReadMcpResourceTool"];
    if skip_tools.iter().any(|t| actual_tool_name.eq_ignore_ascii_case(t)) {
        return Ok(());
    }

    let project_path = resolve_project_path(actual_path.as_deref())?;
    let folder_id = get_folder_id_for_path(&project_path);

    // Build observation content based on tool type
    let content = build_tool_observation(&actual_tool_name, actual_input.as_deref(), actual_output.as_deref());

    // Skip if content is too short or empty
    if content.len() < 20 {
        return Ok(());
    }

    // Store as short-term observation (auto-expires in 1 hour)
    let _ = store_memory(
        &content,
        "short_term",
        "observation",
        Some(&format!("Tool: {}", actual_tool_name)),
        folder_id.as_deref(),
    );

    // Special handling for error outputs - also capture as gotcha candidate
    if let Some(ref out) = actual_output {
        if contains_error_indicators(out) {
            let gotcha_content = format!(
                "**Error encountered while using {}:**\n{}\n\n**Input:** {}",
                actual_tool_name,
                truncate_content(out, 500),
                actual_input.as_deref().map(|i| truncate_content(i, 200)).unwrap_or_default()
            );

            // Store error as working memory for potential gotcha extraction
            let _ = store_memory(
                &gotcha_content,
                "working",
                "gotcha",
                Some(&format!("Error: {} failure", actual_tool_name)),
                folder_id.as_deref(),
            );
        }
    }

    Ok(())
}

/// Build observation content from tool usage.
fn build_tool_observation(tool_name: &str, input: Option<&str>, output: Option<&str>) -> String {
    match tool_name.to_lowercase().as_str() {
        "bash" => {
            // Extract command from JSON input if present
            let cmd = extract_bash_command(input.unwrap_or("unknown command"));
            let result = output.map(|o| truncate_content(o, 300)).unwrap_or_default();
            if result.is_empty() {
                format!("Executed: {}", truncate_content(&cmd, 200))
            } else {
                format!("Executed: {}\nResult: {}", truncate_content(&cmd, 200), result)
            }
        }
        "edit" | "write" => {
            let target = input.map(|i| extract_file_path(i)).unwrap_or("unknown file".to_string());
            format!("Modified file: {}", target)
        }
        "task" => {
            // Extract description or prompt from Task input
            let desc = input.map(|i| extract_task_description(i)).unwrap_or("task".to_string());
            format!("Spawned subagent: {}", truncate_content(&desc, 150))
        }
        "todowrite" => {
            // Extract task summary from TodoWrite
            if let Some(inp) = input {
                let summary = extract_todo_summary(inp);
                format!("Updated tasks: {}", truncate_content(&summary, 200))
            } else {
                "Updated task list".to_string()
            }
        }
        _ => {
            // Generic observation for other tools
            let inp = input.map(|i| truncate_content(i, 150)).unwrap_or_default();
            if inp.is_empty() {
                format!("Used {}", tool_name)
            } else {
                format!("Used {} with: {}", tool_name, inp)
            }
        }
    }
}

/// Extract bash command from input (handles JSON format from Claude Code).
fn extract_bash_command(input: &str) -> String {
    // Try to parse as JSON and extract command field
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(input) {
        if let Some(cmd) = json.get("command").and_then(|v| v.as_str()) {
            return cmd.to_string();
        }
    }
    // Fallback: return input as-is
    input.to_string()
}

/// Extract description from Task tool input.
fn extract_task_description(input: &str) -> String {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(input) {
        // Try "description" first, then "prompt"
        if let Some(desc) = json.get("description").and_then(|v| v.as_str()) {
            return desc.to_string();
        }
        if let Some(prompt) = json.get("prompt").and_then(|v| v.as_str()) {
            // Truncate long prompts
            return truncate_content(prompt, 100);
        }
    }
    truncate_content(input, 100)
}

/// Extract todo summary from TodoWrite input.
fn extract_todo_summary(input: &str) -> String {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(input) {
        if let Some(todos) = json.get("todos").and_then(|v| v.as_array()) {
            let in_progress: Vec<&str> = todos
                .iter()
                .filter(|t| t.get("status").and_then(|s| s.as_str()) == Some("in_progress"))
                .filter_map(|t| t.get("content").and_then(|c| c.as_str()))
                .collect();

            if !in_progress.is_empty() {
                return in_progress.join(", ");
            }

            // Fallback: return count
            return format!("{} tasks", todos.len());
        }
    }
    truncate_content(input, 150)
}

/// Check if output contains error indicators.
fn contains_error_indicators(output: &str) -> bool {
    let error_patterns = [
        "error:",
        "Error:",
        "ERROR",
        "failed",
        "Failed",
        "FAILED",
        "panic",
        "Panic",
        "exception",
        "Exception",
        "not found",
        "Not found",
        "Permission denied",
        "cannot",
        "Cannot",
        "invalid",
        "Invalid",
    ];
    error_patterns.iter().any(|p| output.contains(p))
}

/// Extract file path from Edit/Write input.
fn extract_file_path(input: &str) -> String {
    // Try to parse as JSON and extract file_path
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(input) {
        if let Some(path) = json.get("file_path").and_then(|v| v.as_str()) {
            return path.to_string();
        }
    }
    // Fallback: look for path-like string
    input
        .lines()
        .find(|l| l.contains('/') || l.contains('\\'))
        .map(|l| l.trim().to_string())
        .unwrap_or_else(|| truncate_content(input, 100))
}

/// Truncate content to max length with ellipsis.
fn truncate_content(content: &str, max_len: usize) -> String {
    if content.len() <= max_len {
        content.to_string()
    } else {
        format!("{}...", &content[..max_len])
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stop Hook
// ─────────────────────────────────────────────────────────────────────────────

/// Handle stop hook - create session summary as working memory.
/// This captures what was accomplished in the session for future context.
async fn stop(agent: &str, reason: Option<&str>, path: Option<&str>) -> Result<()> {
    let project_path = resolve_project_path(path)?;
    let folder_id = get_folder_id_for_path(&project_path);
    let folder_name = get_folder_name(&project_path);
    let tmux_session = get_tmux_session();
    let git_branch = get_git_branch(&project_path);

    // Gather session context
    let task_context = get_task_context(&project_path);

    // Build session summary
    let mut summary = String::new();
    summary.push_str(&format!("## Session Summary - {}\n\n", folder_name));
    summary.push_str(&format!("**Branch:** {}\n", git_branch.as_deref().unwrap_or("unknown")));
    summary.push_str(&format!("**Agent:** {}\n", agent));

    if let Some(r) = reason {
        summary.push_str(&format!("**Stop reason:** {}\n", r));
    }
    summary.push('\n');

    // Add completed tasks if any
    let completed = get_recently_completed_tasks(&project_path);
    if !completed.is_empty() {
        summary.push_str("### Completed This Session\n");
        for task in &completed {
            summary.push_str(&format!("- `{}`: {}\n", truncate_content(&task.id, 13), task.title));
        }
        summary.push('\n');
    }

    // Add in-progress tasks
    if !task_context.in_progress.is_empty() {
        summary.push_str("### Left In Progress\n");
        for task in &task_context.in_progress {
            let short_id = truncate_content(&task.id, 13);
            summary.push_str(&format!("- `{}`: {}\n", short_id, task.title));
        }
        summary.push('\n');
    }

    // Get recent short-term observations to include in summary
    let recent_observations = recall_memories("short_term", 5);
    if !recent_observations.is_empty() {
        summary.push_str("### Key Actions\n");
        for obs in &recent_observations {
            let content = truncate_content(&obs.content, 100);
            summary.push_str(&format!("- {}\n", content));
        }
    }

    // Store as working memory (24 hour TTL)
    let _ = store_memory(
        &summary,
        "working",
        "observation",
        Some(&format!("Session: {} {}", folder_name, chrono::Utc::now().format("%Y-%m-%d %H:%M"))),
        folder_id.as_deref(),
    );

    // Notify orchestrator
    let _ = send_orchestrator_event("session_stop", agent, reason).await;

    // Output confirmation
    println!(
        r#"
[Session Stop - Memory Captured]
─────────────────────────────────────────────────
Project: {}
Session: {}
Agent: {}
Working memory created for next session context.
─────────────────────────────────────────────────
"#,
        folder_name,
        tmux_session.as_deref().unwrap_or("N/A"),
        agent
    );

    Ok(())
}

/// Get recently completed tasks (closed in last hour).
fn get_recently_completed_tasks(project_path: &str) -> Vec<TaskDisplay> {
    if let Ok(output) = Command::new("bd")
        .args(["list", "--status=closed", "-l", "10", "--json"])
        .current_dir(project_path)
        .output()
    {
        if output.status.success() {
            if let Ok(tasks) = serde_json::from_slice::<Vec<serde_json::Value>>(&output.stdout) {
                return tasks
                    .into_iter()
                    .filter_map(|t| {
                        // Could filter by closed_at timestamp if available
                        Some(TaskDisplay {
                            id: t.get("id")?.as_str()?.to_string(),
                            title: t.get("title")?.as_str()?.to_string(),
                        })
                    })
                    .take(5)
                    .collect();
            }
        }
    }
    Vec::new()
}

/// Get folder ID for a project path by looking up in database.
/// Returns None if folder not found - memories will still work without folder association.
///
/// This function walks up the directory tree to find a matching folder, which handles
/// cases where hooks run from subdirectories (e.g., `crates/` inside `remote-dev/`).
fn get_folder_id_for_path(project_path: &str) -> Option<String> {
    let db = get_database().ok()?;
    let folders = db.list_all_folders().ok()?;

    // Walk up the directory tree to find a matching folder
    let mut current_path = std::path::Path::new(project_path);

    loop {
        let current_str = current_path.to_string_lossy().to_string();
        let folder_name = current_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string());

        // Try to match by path or name
        if let Some(folder) = folders.iter().find(|f| {
            f.path.as_deref() == Some(current_str.as_str())
                || folder_name.as_deref() == Some(f.name.as_str())
        }) {
            return Some(folder.id.clone());
        }

        // Move to parent directory
        match current_path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => {
                current_path = parent;
            }
            _ => break, // Reached root or empty path
        }
    }

    None
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/// Resolve project path (default to current directory).
fn resolve_project_path(path: Option<&str>) -> Result<String> {
    match path {
        Some(p) => Ok(std::path::Path::new(p)
            .canonicalize()
            .context("Invalid path")?
            .to_string_lossy()
            .to_string()),
        None => Ok(std::env::current_dir()
            .context("Failed to get current directory")?
            .to_string_lossy()
            .to_string()),
    }
}

/// Get current tmux session name.
fn get_tmux_session() -> Option<String> {
    if std::env::var("TMUX").is_err() {
        return None;
    }

    Command::new("tmux")
        .args(["display-message", "-p", "#S"])
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                None
            }
        })
}

/// Get current git branch.
fn get_git_branch(project_path: &str) -> Option<String> {
    Command::new("git")
        .args(["branch", "--show-current"])
        .current_dir(project_path)
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if branch.is_empty() {
                    None
                } else {
                    Some(branch)
                }
            } else {
                None
            }
        })
}

/// Get folder name from path.
fn get_folder_name(project_path: &str) -> String {
    std::path::Path::new(project_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| project_path.to_string())
}

/// Store memory entry.
/// Single-user system - no user_id parameter.
fn store_memory(
    content: &str,
    tier: &str,
    content_type: &str,
    name: Option<&str>,
    folder_id: Option<&str>,
) -> Result<String> {
    let db = get_database()?;

    let entry = NewMemoryEntry {
        session_id: None,
        folder_id: folder_id.map(String::from),
        tier: tier.to_string(),
        content_type: content_type.to_string(),
        name: name.map(String::from),
        description: None,
        content: content.to_string(),
        task_id: None,
        priority: None,
        confidence: Some(0.7),
        relevance: Some(0.5),
        metadata_json: None,
    };

    let memory_id = db.create_memory_entry(&entry)?;

    // Send lightweight notification to server for SSE broadcast (fire-and-forget)
    let mid = memory_id.clone();
    tokio::spawn(async move {
        let _ = send_memory_event("created", Some(&mid), None).await;
    });

    Ok(memory_id)
}

/// Memory entry for display.
#[derive(Debug)]
struct MemoryDisplay {
    content: String,
    name: Option<String>,
    content_type: Option<String>,
}

/// Recall memories by tier.
/// Single-user system - no user_id parameter.
fn recall_memories(tier: &str, limit: usize) -> Vec<MemoryDisplay> {
    let db = match get_database() {
        Ok(db) => db,
        Err(_) => return Vec::new(),
    };

    let filter = MemoryQueryFilter {
        session_id: None,
        folder_id: None,
        tier: Some(tier.to_string()),
        content_type: None,
        task_id: None,
        min_relevance: Some(0.3),
        min_confidence: None,
        limit: Some(limit),
    };

    db.list_memory_entries(&filter)
        .unwrap_or_default()
        .into_iter()
        .map(|m| MemoryDisplay {
            content: m.content,
            name: m.name,
            content_type: Some(m.content_type),
        })
        .collect()
}

/// Knowledge entry for display.
#[derive(Debug)]
struct KnowledgeDisplay {
    name: String,
    description: String,
    r#type: String,
}

/// Get project knowledge entries.
/// Single-user system - no user_id parameter.
fn get_knowledge(limit: usize) -> Vec<KnowledgeDisplay> {
    let db = match get_database() {
        Ok(db) => db,
        Err(_) => return Vec::new(),
    };

    // Knowledge entries are stored as long_term memories with specific content types
    let filter = MemoryQueryFilter {
        session_id: None,
        folder_id: None,
        tier: Some("long_term".to_string()),
        content_type: None, // Get all types
        task_id: None,
        min_relevance: Some(0.3),
        min_confidence: None,
        limit: Some(limit),
    };

    db.list_memory_entries(&filter)
        .unwrap_or_default()
        .into_iter()
        .filter(|m| {
            matches!(
                m.content_type.as_str(),
                "convention" | "pattern" | "skill" | "tool" | "gotcha"
            )
        })
        .map(|m| KnowledgeDisplay {
            name: m.name.unwrap_or_else(|| "Untitled".to_string()),
            description: m.description.unwrap_or(m.content),
            r#type: m.content_type,
        })
        .collect()
}

/// Task context from beads.
#[derive(Debug, Default)]
struct TaskContext {
    in_progress: Vec<TaskDisplay>,
    open: Vec<TaskDisplay>,
}

#[derive(Debug)]
struct TaskDisplay {
    id: String,
    title: String,
}

/// Get task context from beads.
fn get_task_context(project_path: &str) -> TaskContext {
    let mut ctx = TaskContext::default();

    // Get in-progress tasks
    if let Ok(output) = Command::new("bd")
        .args(["list", "--status=in_progress", "--json"])
        .current_dir(project_path)
        .output()
    {
        if output.status.success() {
            if let Ok(tasks) = serde_json::from_slice::<Vec<serde_json::Value>>(&output.stdout) {
                ctx.in_progress = tasks
                    .into_iter()
                    .filter_map(|t| {
                        Some(TaskDisplay {
                            id: t.get("id")?.as_str()?.to_string(),
                            title: t.get("title")?.as_str()?.to_string(),
                        })
                    })
                    .collect();
            }
        }
    }

    // Get open tasks
    if let Ok(output) = Command::new("bd")
        .args(["list", "--status=open", "-l", "5", "--json"])
        .current_dir(project_path)
        .output()
    {
        if output.status.success() {
            if let Ok(tasks) = serde_json::from_slice::<Vec<serde_json::Value>>(&output.stdout) {
                ctx.open = tasks
                    .into_iter()
                    .filter_map(|t| {
                        Some(TaskDisplay {
                            id: t.get("id")?.as_str()?.to_string(),
                            title: t.get("title")?.as_str()?.to_string(),
                        })
                    })
                    .collect();
            }
        }
    }

    ctx
}

/// Extract learnings from session (background task).
fn extract_learnings(session_id: &str, project_path: &str) -> Result<()> {
    // Use rdv learn analyze (this is already implemented)
    let output = Command::new("rdv")
        .args(["learn", "analyze", session_id, "--save"])
        .current_dir(project_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!("Learning extraction failed: {}", stderr);
    }

    Ok(())
}

/// Send event notification to orchestrator.
/// Uses short timeouts (1 second) since this is a local server.
async fn send_orchestrator_event(
    event: &str,
    agent: &str,
    reason: Option<&str>,
) -> Result<()> {
    let tmux_session = get_tmux_session();
    let project_path = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let payload = serde_json::json!({
        "event": event,
        "agent": agent,
        "tmuxSessionName": tmux_session,
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "reason": reason.unwrap_or(""),
        "context": {
            "cwd": project_path,
            "projectPath": project_path,
        }
    });

    // Try Unix socket first (production) - 1 second timeout for local server
    let socket_path = dirs::home_dir()
        .map(|h| h.join(".remote-dev/run/api.sock"))
        .filter(|p| p.exists());

    if let Some(socket) = socket_path {
        // Use curl with short timeout for local Unix socket
        let payload_str = payload.to_string();
        let _ = Command::new("curl")
            .args([
                "--unix-socket",
                &socket.to_string_lossy(),
                "-X",
                "POST",
                "-H",
                "Content-Type: application/json",
                "-d",
                &payload_str,
                "--max-time",
                "1",  // 1 second timeout - local server should respond instantly
                "--connect-timeout",
                "1",
                "http://localhost/api/orchestrators/agent-event",
            ])
            .output();
    } else {
        // Fallback to HTTP (development) - 1 second timeout
        let url = std::env::var("ORCHESTRATOR_URL")
            .unwrap_or_else(|_| "http://localhost:6001".to_string());

        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap_or_default();
        let _ = client
            .post(format!("{}/api/orchestrators/agent-event", url))
            .json(&payload)
            .timeout(std::time::Duration::from_secs(1))
            .send()
            .await;
    }

    Ok(())
}

/// Send memory event notification to server for SSE broadcast.
/// Uses short timeouts (1 second) since this is a local server.
/// This allows CLI/SDK memory operations to trigger UI updates without
/// going through the full REST API.
/// Single-user system - no user_id parameter.
async fn send_memory_event(
    event_type: &str,
    memory_id: Option<&str>,
    embedding_id: Option<&str>,
) -> Result<()> {
    let payload = serde_json::json!({
        "event_type": event_type,
        "memory_id": memory_id,
        "embedding_id": embedding_id,
    });

    // Try Unix socket first (production) - 1 second timeout for local server
    let socket_path = dirs::home_dir()
        .map(|h| h.join(".remote-dev/run/api.sock"))
        .filter(|p| p.exists());

    if let Some(socket) = socket_path {
        // Use curl with short timeout for local Unix socket
        let payload_str = payload.to_string();
        let _ = Command::new("curl")
            .args([
                "--unix-socket",
                &socket.to_string_lossy(),
                "-X",
                "POST",
                "-H",
                "Content-Type: application/json",
                "-d",
                &payload_str,
                "--max-time",
                "1",  // 1 second timeout - local server should respond instantly
                "--connect-timeout",
                "1",
                "http://localhost/api/memory/event",
            ])
            .output();
    } else {
        // Fallback to HTTP (development) - 1 second timeout
        let url = std::env::var("ORCHESTRATOR_URL")
            .unwrap_or_else(|_| "http://localhost:6001".to_string());

        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap_or_default();
        let _ = client
            .post(format!("{}/api/memory/event", url))
            .json(&payload)
            .timeout(std::time::Duration::from_secs(1))
            .send()
            .await;
    }

    Ok(())
}

/// Format memories for display.
fn format_memories(memories: &[MemoryDisplay], label: &str) -> String {
    if memories.is_empty() {
        return String::new();
    }

    let mut output = format!("\n### {}\n", label);
    for mem in memories {
        let name = mem
            .name
            .as_ref()
            .map(|n| format!("**{}**: ", n))
            .unwrap_or_default();
        let content_type = mem
            .content_type
            .as_ref()
            .map(|t| format!("[{}] ", t))
            .unwrap_or_default();
        output.push_str(&format!("- {}{}{}\n", content_type, name, mem.content));
    }
    output
}

/// Format knowledge for display.
fn format_knowledge(knowledge: &[KnowledgeDisplay]) -> String {
    if knowledge.is_empty() {
        return String::new();
    }

    let mut output = "\n### Project Knowledge\n".to_string();
    for k in knowledge {
        let icon = match k.r#type.as_str() {
            "convention" => "📐",
            "pattern" => "🔄",
            "skill" => "🛠️",
            "gotcha" => "⚠️",
            "tool" => "🔧",
            _ => "💡",
        };
        output.push_str(&format!("- {} **{}**: {}\n", icon, k.name, k.description));
    }
    output
}

/// Format task context for display.
fn format_task_context(ctx: &TaskContext) -> String {
    if ctx.in_progress.is_empty() && ctx.open.is_empty() {
        return String::new();
    }

    let mut output = "\n### Current Tasks\n".to_string();

    if !ctx.in_progress.is_empty() {
        output.push_str("\n**In Progress:**\n");
        for task in &ctx.in_progress {
            let short_id = if task.id.len() > 13 {
                &task.id[..13]
            } else {
                &task.id
            };
            output.push_str(&format!("- `{}`: {}\n", short_id, task.title));
        }
    }

    if !ctx.open.is_empty() {
        output.push_str("\n**Open (Next Up):**\n");
        for task in ctx.open.iter().take(3) {
            let short_id = if task.id.len() > 13 {
                &task.id[..13]
            } else {
                &task.id
            };
            output.push_str(&format!("- `{}`: {}\n", short_id, task.title));
        }
    }

    output
}
