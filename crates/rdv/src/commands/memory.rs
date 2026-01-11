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

use crate::cli::{MemoryCommand, MemoryAction};
use crate::config::Config;
use crate::database::{get_database, get_user_id};

/// Execute memory command.
pub fn execute(cmd: MemoryCommand, config: &Config) -> Result<()> {
    match cmd.action {
        MemoryAction::Remember {
            content,
            tier,
            ttl,
            tags,
            content_type,
            name,
            description,
        } => remember(&content, tier.as_deref(), ttl, tags, &content_type, name, description, config),

        MemoryAction::Recall {
            tier,
            content_type,
            min_relevance,
            limit,
            query,
        } => recall(tier.as_deref(), content_type.as_deref(), min_relevance, limit, query.as_deref(), config),

        MemoryAction::Forget { id, all, tier, expired } => {
            forget(id.as_deref(), all, tier.as_deref(), expired, config)
        }

        MemoryAction::List {
            tier,
            content_type,
            limit,
        } => list(tier.as_deref(), content_type.as_deref(), limit, config),

        MemoryAction::Stats => stats(config),

        MemoryAction::Promote { id, tier } => promote(&id, &tier, config),
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

/// Store something in memory.
fn remember(
    content: &str,
    tier: Option<&str>,
    ttl: Option<i32>,
    tags: Vec<String>,
    content_type: &str,
    name: Option<String>,
    description: Option<String>,
    _config: &Config,
) -> Result<()> {
    let db = get_database()?;
    let tier = parse_tier(tier)?;
    let user_id = get_user_id();

    // Build metadata JSON if tags provided
    let metadata_json = if tags.is_empty() {
        None
    } else {
        Some(serde_json::json!({ "tags": tags }).to_string())
    };

    let entry = NewMemoryEntry {
        user_id,
        session_id: None,
        folder_id: None,
        tier: tier.clone(),
        content_type: content_type.to_string(),
        name,
        description,
        content: content.to_string(),
        task_id: None,
        priority: None,
        confidence: None,
        relevance: None,
        ttl_seconds: ttl,
        metadata_json,
    };

    let id = db
        .create_memory_entry(&entry)
        .context("Failed to create memory entry")?;

    println!("{} Stored in {} memory", "✓".green(), tier_display(&tier).cyan());
    println!("  ID: {}", id);
    if let Some(ttl) = ttl {
        println!("  TTL: {} seconds", ttl);
    }
    if !tags.is_empty() {
        println!("  Tags: {}", tags.join(", "));
    }

    Ok(())
}

/// Recall memories matching criteria.
fn recall(
    tier: Option<&str>,
    content_type: Option<&str>,
    min_relevance: Option<f64>,
    limit: usize,
    query: Option<&str>,
    _config: &Config,
) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    let filter = MemoryQueryFilter {
        user_id,
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

/// Forget memories.
fn forget(
    id: Option<&str>,
    all: bool,
    tier: Option<&str>,
    expired: bool,
    _config: &Config,
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
            println!("{} Deleted memory: {}", "✓".green(), id);
        } else {
            println!("{} Memory not found: {}", "⚠".yellow(), id);
        }
        return Ok(());
    }

    if all {
        let user_id = get_user_id();
        let tier = tier.and_then(|t| parse_tier(Some(t)).ok());

        // List entries to delete
        let filter = MemoryQueryFilter {
            user_id,
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
fn list(tier: Option<&str>, content_type: Option<&str>, limit: usize, _config: &Config) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    let filter = MemoryQueryFilter {
        user_id,
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
fn stats(_config: &Config) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    let stats = db
        .get_memory_stats(&user_id)
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
fn promote(id: &str, target_tier: &str, _config: &Config) -> Result<()> {
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
