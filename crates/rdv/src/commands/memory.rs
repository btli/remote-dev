//! Memory commands for the hierarchical working memory system.
//!
//! Uses rdv-core Database directly for local operations.
//! No server required - memory is stored in the local SQLite database.
//!
//! Memory tiers:
//! - Short-term: Ephemeral context, auto-expires (default 1 hour)
//! - Working: Active task context, manually managed
//! - Long-term: Persistent knowledge, cross-session

use anyhow::{bail, Context, Result};
use colored::Colorize;
use rdv_core::types::{MemoryEntry, MemoryQueryFilter, NewMemoryEntry};
use std::process::Command;

use crate::cli::{MemoryCommand, MemoryAction};
use crate::database::get_database;

/// Execute memory command.
pub fn execute(cmd: MemoryCommand) -> Result<()> {
    match cmd.action {
        MemoryAction::Remember {
            content,
            tier,
            tags,
            content_type,
            name,
            description,
            folder,
        } => remember(&content, tier.as_deref(), tags, &content_type, name, description, folder.as_deref()),

        MemoryAction::Recall {
            tier,
            content_type,
            min_relevance,
            limit,
            query,
            json,
        } => recall(tier.as_deref(), content_type.as_deref(), min_relevance, limit, query.as_deref(), json),

        MemoryAction::Forget { id, all, tier, expired } => {
            forget(id.as_deref(), all, tier.as_deref(), expired)
        }

        MemoryAction::List {
            tier,
            content_type,
            limit,
        } => list(tier.as_deref(), content_type.as_deref(), limit),

        MemoryAction::Stats => stats(),

        MemoryAction::Promote { id, tier } => promote(&id, &tier),
    }
}

/// Parse tier string to canonical form
fn parse_tier(tier: Option<&str>) -> Result<String> {
    match tier {
        Some("short") | Some("short_term") | Some("s") => Ok("short_term".to_string()),
        Some("working") | Some("work") | Some("w") => Ok("working".to_string()),
        Some("long") | Some("long_term") | Some("l") => Ok("long_term".to_string()),
        Some(other) => bail!("Invalid tier: {}. Use: short, working, or long", other),
        None => Ok("short_term".to_string()), // Default to short-term
    }
}

/// Resolve folder to folder_id by name, path, or direct ID.
/// Single-user system - no user_id parameter.
fn resolve_folder_id(db: &rdv_core::db::Database, folder: &str) -> Result<Option<String>> {
    // First, check if it's a UUID (direct folder ID)
    if folder.len() == 36 && folder.chars().filter(|c| *c == '-').count() == 4 {
        // Verify it exists
        if let Ok(Some(_)) = db.get_folder(folder) {
            return Ok(Some(folder.to_string()));
        }
    }

    // Try to find by name
    // Single-user system - folder name lookup uses empty user_id placeholder
    if let Ok(Some(f)) = db.get_folder_by_name("", folder) {
        return Ok(Some(f.id));
    }

    // Try to resolve path - canonicalize and match against folder paths
    let path = if folder == "." {
        std::env::current_dir()
            .context("Failed to get current directory")?
            .to_string_lossy()
            .to_string()
    } else {
        std::path::Path::new(folder)
            .canonicalize()
            .unwrap_or_else(|_| std::path::PathBuf::from(folder))
            .to_string_lossy()
            .to_string()
    };

    // List folders and find by path
    // Single-user system - folder list uses empty user_id placeholder
    if let Ok(folders) = db.list_folders("") {
        for f in folders {
            if let Some(ref fp) = f.path {
                if fp == &path || fp.ends_with(&format!("/{}", folder)) {
                    return Ok(Some(f.id));
                }
            }
            // Also check if folder name matches the last component of the path
            let folder_basename = std::path::Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if f.name == folder_basename {
                return Ok(Some(f.id));
            }
        }
    }

    Ok(None)
}

/// Store something in memory.
/// Single-user system - no user_id parameter.
fn remember(
    content: &str,
    tier: Option<&str>,
    tags: Vec<String>,
    content_type: &str,
    name: Option<String>,
    description: Option<String>,
    folder: Option<&str>,
) -> Result<()> {
    let db = get_database()?;
    let tier = parse_tier(tier)?;

    // Resolve folder to folder_id if provided
    let folder_id = if let Some(f) = folder {
        match resolve_folder_id(db, f)? {
            Some(id) => Some(id),
            None => {
                eprintln!("{} Warning: folder '{}' not found, memory will not be associated with a folder", "⚠".yellow(), f);
                None
            }
        }
    } else {
        // Try to auto-detect folder from current directory by walking up the tree
        let cwd = std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().to_string());
        if let Some(path) = cwd {
            // Single-user system - use list_all_folders
            if let Ok(folders) = db.list_all_folders() {
                // Walk up directory tree to find matching folder
                let mut current = std::path::Path::new(&path);
                loop {
                    let current_str = current.to_string_lossy().to_string();
                    let folder_name = current.file_name().map(|n| n.to_string_lossy().to_string());

                    if let Some(folder) = folders.iter().find(|f| {
                        f.path.as_deref() == Some(current_str.as_str())
                            || folder_name.as_deref() == Some(f.name.as_str())
                    }) {
                        break Some(folder.id.clone());
                    }

                    match current.parent() {
                        Some(parent) if !parent.as_os_str().is_empty() => {
                            current = parent;
                        }
                        _ => break None,
                    }
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    // Build metadata JSON if tags provided
    let metadata_json = if tags.is_empty() {
        None
    } else {
        Some(serde_json::json!({ "tags": tags }).to_string())
    };

    // Single-user system - no user_id field
    let entry = NewMemoryEntry {
        session_id: None,
        folder_id: folder_id.clone(),
        tier: tier.clone(),
        content_type: content_type.to_string(),
        name,
        description,
        content: content.to_string(),
        task_id: None,
        priority: None,
        confidence: None,
        relevance: None,
        metadata_json,
    };

    let id = db
        .create_memory_entry(&entry)
        .context("Failed to create memory entry")?;

    // Notify server for SSE broadcast to UI
    send_memory_event("created", &id);

    println!("{} Stored in {} memory", "✓".green(), tier_display(&tier).cyan());
    println!("  ID: {}", id);
    if let Some(ref fid) = folder_id {
        println!("  Folder: {}", fid);
    }
    if !tags.is_empty() {
        println!("  Tags: {}", tags.join(", "));
    }

    Ok(())
}

/// Recall memories matching criteria.
/// Single-user system - no user_id parameter.
fn recall(
    tier: Option<&str>,
    content_type: Option<&str>,
    min_relevance: Option<f64>,
    limit: usize,
    query: Option<&str>,
    json: bool,
) -> Result<()> {
    let db = get_database()?;

    // Single-user system - no user_id field
    let filter = MemoryQueryFilter {
        session_id: None,
        folder_id: None,
        tier: tier.and_then(|t| parse_tier(Some(t)).ok()),
        content_type: content_type.map(String::from),
        task_id: None,
        min_relevance,
        min_confidence: None,
        limit: Some(limit),
    };

    let entries = db
        .list_memory_entries(&filter)
        .context("Failed to list memory entries")?;

    // Filter by query if provided (simple text search)
    let entries: Vec<_> = if let Some(q) = query {
        let q_lower = q.to_lowercase();
        entries
            .into_iter()
            .filter(|e| e.content.to_lowercase().contains(&q_lower))
            .collect()
    } else {
        entries
    };

    // JSON output mode
    if json {
        let json_output: Vec<serde_json::Value> = entries
            .iter()
            .map(|e| memory_entry_to_json(e))
            .collect();
        println!("{}", serde_json::to_string(&json_output).unwrap_or_else(|_| "[]".to_string()));
        return Ok(());
    }

    if entries.is_empty() {
        println!("{} No memories found matching criteria", "⚠".yellow());
        return Ok(());
    }

    println!("{} Found {} memories:", "✓".green(), entries.len());
    println!();

    for (i, entry) in entries.iter().enumerate() {
        print_memory_entry(i + 1, entry);
    }

    Ok(())
}

/// Convert a memory entry to JSON value.
fn memory_entry_to_json(entry: &MemoryEntry) -> serde_json::Value {
    let mut obj = serde_json::json!({
        "id": entry.id,
        "tier": entry.tier,
        "content_type": entry.content_type,
        "content": entry.content,
        "created_at": entry.created_at,
        "access_count": entry.access_count,
    });

    if let Some(ref name) = entry.name {
        obj["name"] = serde_json::json!(name);
    }
    if let Some(ref desc) = entry.description {
        obj["description"] = serde_json::json!(desc);
    }
    if let Some(rel) = entry.relevance {
        obj["relevance"] = serde_json::json!(rel);
    }
    if let Some(conf) = entry.confidence {
        obj["confidence"] = serde_json::json!(conf);
    }
    if let Some(ref folder_id) = entry.folder_id {
        obj["folder_id"] = serde_json::json!(folder_id);
    }
    if let Some(ref metadata) = entry.metadata_json {
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(metadata) {
            obj["metadata"] = meta;
        }
    }

    obj
}

/// Forget memories.
fn forget(
    id: Option<&str>,
    all: bool,
    tier: Option<&str>,
    expired: bool,
) -> Result<()> {
    let db = get_database()?;

    if expired {
        let count = db
            .cleanup_expired_memory()
            .context("Failed to cleanup expired entries")?;
        println!("{} Cleaned up {} expired entries", "✓".green(), count);
        return Ok(());
    }

    if let Some(id) = id {
        let deleted = db
            .delete_memory_entry(id)
            .context("Failed to delete memory entry")?;
        if deleted {
            send_memory_event("deleted", id);
            println!("{} Deleted memory: {}", "✓".green(), id);
        } else {
            println!("{} Memory not found: {}", "⚠".yellow(), id);
        }
        return Ok(());
    }

    if all {
        let tier = tier.and_then(|t| parse_tier(Some(t)).ok());

        // List entries to delete
        // Single-user system - no user_id field
        let filter = MemoryQueryFilter {
            tier: tier.clone(),
            limit: Some(1000), // Reasonable batch size
            ..Default::default()
        };

        let entries = db
            .list_memory_entries(&filter)
            .context("Failed to list entries for deletion")?;

        let mut deleted = 0;
        for entry in entries {
            if db.delete_memory_entry(&entry.id).is_ok() {
                deleted += 1;
            }
        }

        let tier_str = tier.as_deref().map(tier_display).unwrap_or("all");
        println!("{} Cleared {} {} memories", "✓".green(), deleted, tier_str);
        return Ok(());
    }

    bail!("Specify --id to delete a specific memory, --all to clear all, or --expired to cleanup")
}

/// List memories.
/// Single-user system - no user_id parameter.
fn list(tier: Option<&str>, content_type: Option<&str>, limit: usize) -> Result<()> {
    let db = get_database()?;

    // Single-user system - no user_id field
    let filter = MemoryQueryFilter {
        tier: tier.and_then(|t| parse_tier(Some(t)).ok()),
        content_type: content_type.map(String::from),
        limit: Some(limit),
        ..Default::default()
    };

    let entries = db
        .list_memory_entries(&filter)
        .context("Failed to list memories")?;

    if entries.is_empty() {
        let tier_str = tier.map(tier_display).unwrap_or("any");
        println!("{} No {} memories found", "⚠".yellow(), tier_str);
        return Ok(());
    }

    println!("{} {} memories:", "✓".green(), entries.len());
    println!();

    for (i, entry) in entries.iter().enumerate() {
        print_memory_entry(i + 1, entry);
    }

    Ok(())
}

/// Show memory statistics.
/// Single-user system - no user_id parameter.
fn stats() -> Result<()> {
    let db = get_database()?;

    // Single-user system - get_memory_stats takes no user_id
    let stats = db
        .get_memory_stats()
        .context("Failed to get memory stats")?;

    println!("{} Memory Statistics", "📊".cyan());
    println!();

    let total = stats.get("total").copied().unwrap_or(0);
    let short_term = stats.get("short_term").copied().unwrap_or(0);
    let working = stats.get("working").copied().unwrap_or(0);
    let long_term = stats.get("long_term").copied().unwrap_or(0);

    println!("  Total memories: {}", total.to_string().bold());
    println!();
    println!("  By tier:");
    println!("    Short-term: {}", short_term.to_string().yellow());
    println!("    Working:    {}", working.to_string().cyan());
    println!("    Long-term:  {}", long_term.to_string().green());

    Ok(())
}

/// Promote a memory to a higher tier.
fn promote(id: &str, target_tier: &str) -> Result<()> {
    let db = get_database()?;
    let tier = parse_tier(Some(target_tier))?;

    // Get current entry to check it exists
    let entry = db
        .get_memory_entry(id)
        .context("Failed to get memory entry")?
        .ok_or_else(|| anyhow::anyhow!("Memory not found: {}", id))?;

    // Check valid promotion
    let current = &entry.tier;
    let valid = match (current.as_str(), tier.as_str()) {
        ("short_term", "working") | ("short_term", "long_term") | ("working", "long_term") => true,
        _ => false,
    };

    if !valid {
        bail!(
            "Cannot promote from {} to {}. Only upward promotions allowed.",
            tier_display(current),
            tier_display(&tier)
        );
    }

    db.update_memory_entry(id, Some(&tier), None, None, None)
        .context("Failed to promote memory")?;

    // Notify server for SSE broadcast to UI
    send_memory_event("promoted", id);

    println!(
        "{} Promoted {} → {}",
        "✓".green(),
        tier_display(current).dimmed(),
        tier_display(&tier).cyan()
    );
    println!("  ID: {}", id);

    Ok(())
}

/// Convert tier string to display format.
fn tier_display(tier: &str) -> &str {
    match tier {
        "short_term" => "short-term",
        "working" => "working",
        "long_term" => "long-term",
        other => other,
    }
}

/// Print a memory entry with formatting.
fn print_memory_entry(index: usize, entry: &MemoryEntry) {
    let tier_color = match entry.tier.as_str() {
        "short_term" => "yellow",
        "working" => "cyan",
        "long_term" => "green",
        _ => "white",
    };

    let short_id = if entry.id.len() >= 8 {
        &entry.id[..8]
    } else {
        &entry.id
    };

    println!(
        "  {}. {} [{}] <{}>",
        index,
        short_id.cyan(),
        tier_display(&entry.tier).color(tier_color),
        entry.content_type.dimmed()
    );

    // Show name if present
    if let Some(ref name) = entry.name {
        println!("     Name: {}", name.bold());
    }

    // Truncate content for display
    let content = if entry.content.len() > 100 {
        format!("{}...", &entry.content[..100])
    } else {
        entry.content.clone()
    };
    println!("     {}", content);

    // Show relevance/confidence if set
    if let Some(rel) = entry.relevance {
        if rel > 0.0 {
            print!("     Relevance: {:.2}", rel);
        }
    }
    if let Some(conf) = entry.confidence {
        if conf > 0.0 {
            print!("  Confidence: {:.2}", conf);
        }
    }
    if entry.relevance.is_some() || entry.confidence.is_some() {
        println!();
    }

    // Show metadata if present
    if let Some(ref metadata) = entry.metadata_json {
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(metadata) {
            if let Some(tags) = meta.get("tags").and_then(|t| t.as_array()) {
                let tags: Vec<String> = tags
                    .iter()
                    .filter_map(|t| t.as_str().map(String::from))
                    .collect();
                if !tags.is_empty() {
                    println!("     Tags: {}", tags.join(", ").dimmed());
                }
            }
        }
    }

    println!();
}

/// Send memory event notification to server for SSE broadcast.
/// Uses short timeouts (1 second) since this is a local server.
/// This allows CLI memory operations to trigger UI updates.
fn send_memory_event(event_type: &str, memory_id: &str) {
    let payload = serde_json::json!({
        "event_type": event_type,
        "memory_id": memory_id,
    });

    // Try Unix socket first (production)
    let socket_path = dirs::home_dir()
        .map(|h| h.join(".remote-dev/run/api.sock"))
        .filter(|p| p.exists());

    if let Some(socket) = socket_path {
        let payload_str = payload.to_string();
        let _ = Command::new("curl")
            .args([
                "--unix-socket",
                &socket.to_string_lossy(),
                "-s",  // Silent mode
                "-X",
                "POST",
                "-H",
                "Content-Type: application/json",
                "-d",
                &payload_str,
                "--max-time",
                "1",
                "--connect-timeout",
                "1",
                "http://localhost/api/memory/event",
            ])
            .output();
    }
    // Note: No fallback to HTTP needed since CLI always runs locally
}
