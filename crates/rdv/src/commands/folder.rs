//! Folder Orchestrator commands.
//!
//! Folder Orchestrators manage tasks within a specific project/folder.
//!
//! Uses rdv-server API for all database operations via ApiClient.

use anyhow::Result;
use colored::Colorize;
use std::path::PathBuf;

use rdv_core::client::{ApiClient, CreateFolderRequest, CreateOrchestratorRequest, CreateSessionRequest};

use crate::cli::{FolderAction, FolderCommand};
use crate::config::{Config, FolderConfig};
use crate::error::RdvError;
use crate::tmux;

/// Memory recall agent - retrieves relevant memories before main agent starts
const MEMORY_RECALL_AGENT: &str = r#"---
name: memory-recall
description: Retrieves relevant memories before the main coding agent begins work. Use this agent at the start of a task to surface historical context, project conventions, patterns, and gotchas from the memory system. Invoke when working on features that may have prior context or when the user's query involves project architecture, conventions, or debugging.
tools: Read, Glob, Grep
---

# Memory Recall Agent

You are a context retrieval specialist. Your job is to search the memory system for relevant information that will help the main coding agent complete the user's task more effectively.

## Your Task

Given a user query or task description, you will:

1. **Analyze the Query**: Extract key technical terms, problem domain, and action type
2. **Search Memories**: Use the `rdv:memory_search` MCP tool to find relevant memories
3. **Search Knowledge**: Use the `rdv:knowledge_get` MCP tool to find project-specific knowledge
4. **Filter and Prioritize**: Rank results by relevance and importance
5. **Format Context**: Return a structured context block for the main agent

## Search Strategy

### Step 1: Extract Keywords
From the user's query, identify:
- Technical terms (languages, frameworks, libraries)
- Problem domain (authentication, database, API, UI)
- Action type (implement, fix, refactor, debug, explain)
- File or component names mentioned

### Step 2: Perform Memory Search

Use the MCP tool:

```
rdv:memory_search({
  query: "<extracted keywords>",
  limit: 10,
  minScore: 0.3
})
```

### Step 3: Prioritize Results

Rank memories by:
1. **Relevance score** from semantic search
2. **Content type priority**:
   - `gotcha` (1.0) - Critical warnings, must include
   - `pattern` (0.9) - Reusable solutions
   - `convention` (0.85) - Project rules
   - `skill` (0.8) - How-to knowledge
   - `observation` (0.6) - General notes
3. **Tier weight**: long_term > working > short_term

### Step 4: Format Output

Return a markdown block with this structure:

```markdown
## Retrieved Context from Memory System

### Project Knowledge
- **[name]** ([content_type]): [brief summary or full content if critical]

### Architecture & Conventions
- [relevant architecture decisions]

### Gotchas & Warnings
- [any gotchas that apply to this task]

### Related Patterns
- [patterns that might help]

### Commands & Skills
- [relevant commands or procedures]
```

## Important Guidelines

- **Be selective**: Only include memories that are directly relevant to the task
- **Prioritize gotchas**: Always surface warnings and gotchas - these prevent mistakes
- **Include architecture**: For implementation tasks, include relevant architecture conventions
- **Summarize when appropriate**: For long memories, provide a summary unless the full content is critical
- **Note gaps**: If you don't find relevant memories, say so explicitly
"#;

/// Claude Code settings.local.json with memory hooks
const CLAUDE_SETTINGS_LOCAL: &str = r#"{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "rdv hook compact"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "rdv hook session-start --agent claude"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "rdv hook post-tool-use \"$TOOL_NAME\" --input \"$TOOL_INPUT\" --output \"$TOOL_OUTPUT\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "rdv hook stop --agent claude --reason \"$STOP_REASON\""
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "rdv hook session-end --agent claude"
          }
        ]
      }
    ]
  }
}
"#;

/// Memory capture agent - captures important context as working memories
const MEMORY_CAPTURE_AGENT: &str = r#"---
name: memory-capture
description: Captures important context as working memories during a coding session. Use this agent after significant discoveries, decisions, or when the user explicitly wants to remember something. Invoke when patterns are discovered, gotchas are encountered, or important context should be preserved for future sessions.
tools: Read, Glob, Grep
---

# Memory Capture Agent

You are a context preservation specialist. Your job is to identify and store important information as memories that will help future coding sessions.

## Your Task

Monitor the conversation and capture:

1. **Discoveries**: New information learned about the codebase
2. **Decisions**: Architectural or implementation decisions made
3. **Gotchas**: Problems encountered and their solutions
4. **Patterns**: Reusable patterns identified
5. **Context**: Important context that would be lost after the session

## When to Capture

Capture memories when:
- A bug is fixed (capture the gotcha)
- A pattern is discovered or explained
- An architectural decision is made
- The user explicitly asks to remember something
- Important codebase knowledge is revealed
- A workaround or hack is implemented (document why)

## Memory Tiers

Choose the appropriate tier based on importance:

| Tier | TTL | Use For |
|------|-----|---------|
| `short_term` | 1 hour | Temporary notes, current task context |
| `working` | 24 hours | Session context, in-progress work |
| `long_term` | Permanent | Conventions, patterns, gotchas, architecture |

## Content Types

Use the appropriate content type:

| Type | Description |
|------|-------------|
| `observation` | General discovery or note |
| `convention` | Project rule or standard |
| `pattern` | Reusable solution |
| `gotcha` | Warning, pitfall, or bug fix |
| `skill` | Command or procedure |
| `tool` | Tool usage or integration |

## How to Store

Use the `rdv:memory_store` MCP tool:

```
rdv:memory_store({
  tier: "long_term",
  contentType: "gotcha",
  content: "Description of the issue and solution",
  name: "Short descriptive name",
  confidence: 0.9,
  relevance: 0.8
})
```

## Memory Format Guidelines

### For Gotchas
```
**Problem**: [What went wrong]
**Cause**: [Root cause]
**Solution**: [How to fix]
**Prevention**: [How to avoid in future]
```

### For Patterns
```
**Pattern**: [Name]
**Context**: [When to use]
**Implementation**: [How to implement]
**Example**: [Code or reference]
```

### For Conventions
```
**Rule**: [The convention]
**Rationale**: [Why this convention exists]
**Enforcement**: [How it's enforced]
```

### For Skills
```
**Command**: [The command or procedure]
**Purpose**: [What it does]
**Usage**: [How to use it]
```

## Important Guidelines

- **Be concise**: Memories should be scannable, not essays
- **Be specific**: Include file paths, function names, exact commands
- **Be actionable**: Memories should help someone act, not just inform
- **Avoid duplicates**: Check if similar memory exists before creating
- **Use markdown**: Format for readability with headers, lists, code blocks
"#;

pub async fn execute(cmd: FolderCommand, config: &Config) -> Result<()> {
    match cmd.action {
        FolderAction::Add { path, name } => add(&path, name.as_deref(), config).await,
        FolderAction::Init { path } => init(&path, config).await,
        FolderAction::Start { path, foreground } => start(&path, foreground, config).await,
        FolderAction::Stop { path } => stop(&path, config).await,
        FolderAction::Status { path } => status(&path, config).await,
        FolderAction::Attach { path } => attach(&path, config).await,
        FolderAction::List => list(config).await,
    }
}

fn resolve_path(path: &str) -> PathBuf {
    let p = if path == "." {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from(path)
    };
    // Canonicalize to get absolute path
    p.canonicalize().unwrap_or(p)
}

fn session_name_for_folder(path: &PathBuf) -> String {
    let folder_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    format!("rdv-folder-{}", folder_name)
}

/// Add folder to database (register for orchestration)
async fn add(path: &str, custom_name: Option<&str>, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let folder_name = custom_name
        .map(|s| s.to_string())
        .or_else(|| folder_path.file_name().map(|n| n.to_string_lossy().to_string()))
        .unwrap_or_else(|| "unknown".to_string());

    println!(
        "{}",
        format!("Adding folder '{}' to database...", folder_name).cyan()
    );

    // Connect to rdv-server
    let client = ApiClient::new()?;

    // Check if folder already exists
    if let Some(existing) = client.get_folder_by_name(&folder_name).await? {
        println!(
            "  {} Folder already registered: {}",
            "→".yellow(),
            &existing.id[..8]
        );
        return Ok(());
    }

    // Create folder record
    let folder = client.create_folder(&CreateFolderRequest {
        name: folder_name.clone(),
        parent_id: None, // Top-level folder
        path: Some(folder_path.to_string_lossy().to_string()),
    }).await?;

    println!("{}", "✓ Folder registered".green());
    println!("  Name: {}", folder_name);
    println!("  ID: {}", &folder.id[..8]);
    println!("  Path: {:?}", folder_path);
    println!();
    println!("  Next steps:");
    println!("    rdv folder init {}   # Initialize orchestrator config", path);
    println!("    rdv folder start {}  # Start folder orchestrator", path);

    Ok(())
}

async fn init(path: &str, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    println!(
        "{}",
        format!("Initializing folder orchestrator in {:?}...", folder_path).cyan()
    );

    // Create .remote-dev directory structure
    let rdv_dir = folder_path.join(".remote-dev");
    let orch_dir = rdv_dir.join("orchestrator");
    let knowledge_dir = rdv_dir.join("knowledge");

    std::fs::create_dir_all(&orch_dir)?;
    std::fs::create_dir_all(&knowledge_dir)?;

    // Create .claude/agents directory for subagents
    let agents_dir = folder_path.join(".claude").join("agents");
    std::fs::create_dir_all(&agents_dir)?;

    // Create memory-recall subagent
    let memory_recall_path = agents_dir.join("memory-recall.md");
    if !memory_recall_path.exists() {
        std::fs::write(&memory_recall_path, MEMORY_RECALL_AGENT)?;
        println!("  {} Created memory-recall agent", "✓".green());
    }

    // Create memory-capture subagent
    let memory_capture_path = agents_dir.join("memory-capture.md");
    if !memory_capture_path.exists() {
        std::fs::write(&memory_capture_path, MEMORY_CAPTURE_AGENT)?;
        println!("  {} Created memory-capture agent", "✓".green());
    }

    // Create Claude Code settings.local.json with memory hooks
    let claude_dir = folder_path.join(".claude");
    std::fs::create_dir_all(&claude_dir)?;
    let settings_local_path = claude_dir.join("settings.local.json");
    if !settings_local_path.exists() {
        std::fs::write(&settings_local_path, CLAUDE_SETTINGS_LOCAL)?;
        println!("  {} Created Claude Code hooks (settings.local.json)", "✓".green());
    } else {
        println!("  {} Claude Code hooks already exist", "→".yellow());
    }

    // Create default config
    let folder_config = FolderConfig::default();

    // Check database for existing folder via API
    if let Ok(client) = ApiClient::new() {
        let folder_name = folder_path.file_name().map(|n| n.to_string_lossy().to_string());
        if let Some(name) = folder_name {
            if let Ok(Some(folder)) = client.get_folder_by_name(&name).await {
                println!("  {} Found existing folder: {}", "→".cyan(), folder.name);
            } else {
                println!("  {} Folder not registered in database yet", "→".cyan());
                println!("    (Will register when orchestrator starts via web UI)");
            }
        }
    }

    folder_config.save(&folder_path)?;

    println!("{}", "✓ Folder orchestrator initialized".green());
    println!("  Config: {:?}", orch_dir.join("config.toml"));
    println!("  Agents: {:?}", agents_dir);

    Ok(())
}

async fn start(path: &str, foreground: bool, config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);
    let folder_path_str = folder_path.to_string_lossy().to_string();

    // Check if .remote-dev exists
    if !folder_path.join(".remote-dev").exists() {
        println!("{}", "Folder orchestrator not initialized".yellow());
        println!("Run `rdv folder init` first");
        return Ok(());
    }

    // Check if already running
    if tmux::session_exists(&session_name)? {
        println!("{}", "Folder orchestrator is already running".yellow());
        return Ok(());
    }

    println!(
        "{}",
        format!("Starting folder orchestrator for {:?}...", folder_path).cyan()
    );

    // Load folder config
    let mut folder_config = FolderConfig::load(&folder_path).unwrap_or_default();

    // Determine agent to use
    let agent_name = folder_config
        .preferred_agent
        .clone()
        .unwrap_or_else(|| config.agents.default.clone());
    let agent_cmd = config.agent_command(&agent_name).unwrap_or("claude");

    // Connect to rdv-server
    let client = ApiClient::new()?;

    // Find folder by name in database
    let folder_name = folder_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let db_folder = client.get_folder_by_name(&folder_name).await?;

    // Auto-add folder to database if not exists
    let folder = if let Some(existing) = db_folder {
        existing
    } else {
        println!(
            "  {} Folder not in database, auto-registering...",
            "→".cyan()
        );
        let created = client.create_folder(&CreateFolderRequest {
            name: folder_name.clone(),
            parent_id: None,
            path: Some(folder_path_str.clone()),
        }).await?;
        println!("  {} Registered folder: {}", "✓".green(), &created.id[..8]);
        created
    };

    // Check for existing orchestrator or create new one
    let orchestrator_id = if let Some(orch) = client.get_folder_orchestrator(&folder.id).await? {
        println!("  {} Existing orchestrator: {}", "→".cyan(), &orch.id[..8]);

        // Reactivate if suspended
        if let Some(ref session_id) = orch.session_id {
            client.update_session_status(session_id, "active").await?;
        }
        client.update_orchestrator_status(&orch.id, "idle").await?;

        orch.id.clone()
    } else {
        // No orchestrator - create session and orchestrator via API
        println!(
            "  {} Creating Folder Control via API...",
            "→".cyan()
        );

        // Create terminal session record
        let session = client.create_session(&CreateSessionRequest {
            name: format!("{} Control", folder_name),
            project_path: Some(folder_path_str.clone()),
            folder_id: Some(folder.id.clone()),
            worktree_branch: None,
            agent_provider: Some(agent_name.clone()),
            is_orchestrator_session: Some(true),
            shell_command: None,
            environment: None,
        }).await?;
        println!("  {} Created session: {}", "✓".green(), &session.id[..8]);

        // Create orchestrator record
        let orch = client.create_orchestrator(&CreateOrchestratorRequest {
            session_id: session.id,
            orchestrator_type: "sub_orchestrator".to_string(),
            scope_type: Some("folder".to_string()),
            scope_id: Some(folder.id.clone()),
            custom_instructions: None,
            monitoring_interval: Some(30),
            stall_threshold: Some(300),
            auto_intervention: Some(false),
        }).await?;
        println!(
            "  {} Created orchestrator: {}",
            "✓".green(),
            &orch.id[..8]
        );

        orch.id
    };

    // Save orchestrator ID to local config for future reference
    folder_config.orchestrator_id = Some(orchestrator_id.clone());
    folder_config.save(&folder_path)?;

    // Create tmux session with agent
    // Enable auto_respawn so agent restarts immediately if it exits
    tmux::create_session(&tmux::CreateSessionConfig {
        session_name: session_name.clone(),
        working_directory: Some(folder_path_str),
        command: Some(agent_cmd.to_string()),
        auto_respawn: true, // Restart agent on exit via pane-died hook
        env: None,
    })?;

    println!("{}", "✓ Folder orchestrator started".green());
    println!("  Session: {}", session_name);
    println!("  Orchestrator ID: {}", &orchestrator_id[..8]);

    if foreground {
        tmux::attach_session(&session_name)?;
    } else {
        println!("  Run `rdv folder attach` to connect");
    }

    Ok(())
}

async fn stop(path: &str, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);

    if !tmux::session_exists(&session_name)? {
        println!("{}", "Folder orchestrator is not running".yellow());
        return Ok(());
    }

    println!("{}", "Stopping folder orchestrator...".cyan());

    // Stop tmux session directly
    tmux::kill_session(&session_name)?;
    println!("{}", "✓ Folder orchestrator stopped".green());

    Ok(())
}

async fn status(path: &str, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);

    println!(
        "{}",
        format!("Folder Orchestrator Status: {:?}", folder_path)
            .cyan()
            .bold()
    );
    println!("{}", "─".repeat(60));

    // Check initialization
    let initialized = folder_path.join(".remote-dev").exists();
    println!(
        "  Initialized: {}",
        if initialized {
            "Yes".green()
        } else {
            "No".red()
        }
    );

    if !initialized {
        println!("\n  Run `rdv folder init` to initialize");
        return Ok(());
    }

    // Load folder config
    let folder_config = FolderConfig::load(&folder_path).unwrap_or_default();

    // tmux status
    let tmux_running = tmux::session_exists(&session_name)?;
    if tmux_running {
        if let Some(info) = tmux::get_session_info(&session_name)? {
            println!("  tmux Status: {}", "RUNNING".green());
            println!("  tmux Session: {}", info.name);
            println!(
                "  Attached: {}",
                if info.attached { "Yes" } else { "No" }
            );
        }
    } else {
        println!("  tmux Status: {}", "STOPPED".yellow());
    }

    // Local config
    if let Some(ref agent) = folder_config.preferred_agent {
        println!("  Preferred Agent: {}", agent);
    }

    // Database status via API
    println!();
    match ApiClient::new() {
        Ok(client) => {
            println!("  rdv-server: {}", "Connected".green());

            // Find folder by name
            let folder_name = folder_path.file_name().map(|n| n.to_string_lossy().to_string());
            if let Some(name) = folder_name {
                if let Ok(Some(folder)) = client.get_folder_by_name(&name).await {
                    println!("  Folder ID: {}", &folder.id[..8]);

                    // Check orchestrator
                    if let Ok(Some(orch)) = client.get_folder_orchestrator(&folder.id).await {
                        println!("  Orchestrator ID: {}", &orch.id[..8]);
                        println!(
                            "  DB Status: {}",
                            match orch.status.as_str() {
                                "running" => "RUNNING".green(),
                                "stopped" => "STOPPED".red(),
                                "paused" => "PAUSED".yellow(),
                                _ => orch.status.normal(),
                            }
                        );
                        println!(
                            "  Monitoring Interval: {}s",
                            orch.monitoring_interval_secs
                        );
                        println!(
                            "  Stall Threshold: {}s",
                            orch.stall_threshold_secs
                        );
                    } else if let Some(ref id) = folder_config.orchestrator_id {
                        println!("  Orchestrator ID: {} (cached)", &id[..8]);
                        println!("  DB Status: {}", "Not found".yellow());
                    } else {
                        println!("  Orchestrator: {}", "Not created".yellow());
                    }
                } else {
                    println!("  Folder: {}", "Not registered in database".yellow());
                }
            }
        }
        Err(e) => {
            println!("  rdv-server: {} ({})", "Unavailable".red(), e);
            if let Some(ref id) = folder_config.orchestrator_id {
                println!("  Orchestrator ID: {} (cached)", &id[..8]);
            }
        }
    }

    Ok(())
}

async fn attach(path: &str, _config: &Config) -> Result<()> {
    let folder_path = resolve_path(path);
    let session_name = session_name_for_folder(&folder_path);

    if !tmux::session_exists(&session_name)? {
        return Err(RdvError::OrchestratorNotFound(
            format!("Folder orchestrator for '{}' is not running. Run `rdv folder start` first.",
                    folder_path.display())
        ).into());
    }

    tmux::attach_session(&session_name)?;
    Ok(())
}

async fn list(_config: &Config) -> Result<()> {
    println!("{}", "Folder Orchestrators".cyan().bold());
    println!("{}", "─".repeat(60));

    // Local tmux sessions
    let sessions = tmux::list_sessions()?;
    let folder_sessions: Vec<_> = sessions
        .iter()
        .filter(|s| s.name.starts_with("rdv-folder-"))
        .collect();

    println!("  {}", "Local (tmux):".cyan());
    if folder_sessions.is_empty() {
        println!("    No folder orchestrators running locally");
    } else {
        for session in &folder_sessions {
            let status = if session.attached {
                "attached".green()
            } else {
                "detached".yellow()
            };
            println!("    {} ({})", session.name, status);
        }
    }

    // Database orchestrators via API
    match ApiClient::new() {
        Ok(client) => {
            println!();
            println!("  {}", "rdv-server:".cyan());

            match client.list_orchestrators().await {
                Ok(orchestrators) => {
                    let folder_orchestrators: Vec<_> = orchestrators
                        .iter()
                        .filter(|o| o.orchestrator_type == "folder")
                        .collect();

                    if folder_orchestrators.is_empty() {
                        println!("    No folder orchestrators registered");
                    } else {
                        for orch in folder_orchestrators {
                            let status = match orch.status.as_str() {
                                "running" => "running".green(),
                                "stopped" => "stopped".red(),
                                "paused" => "paused".yellow(),
                                _ => orch.status.normal(),
                            };
                            let folder = orch.folder_id.as_deref().unwrap_or("unknown");
                            let id_short = if orch.id.len() >= 8 { &orch.id[..8] } else { &orch.id };
                            println!("    {} ({}) - folder: {}", id_short, status, folder);
                        }
                    }
                }
                Err(e) => {
                    println!("    Failed to list orchestrators: {}", e);
                }
            }
        }
        Err(_) => {
            println!();
            println!("  {}", "rdv-server: Unavailable".red());
        }
    }

    Ok(())
}
