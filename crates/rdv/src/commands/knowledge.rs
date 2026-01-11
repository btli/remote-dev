//! Knowledge command for project knowledge base management.
//!
//! Manages long-term project knowledge: conventions, patterns, skills, tools, gotchas.
//! Knowledge entries are stored as long-term memories (no TTL expiration).

use anyhow::{bail, Context, Result};
use colored::Colorize;
use rdv_core::types::{MemoryEntry, MemoryQueryFilter, NewMemoryEntry};

use crate::cli::{KnowledgeAction, KnowledgeCommand, KnowledgeType};
use crate::config::Config;
use crate::database::{get_database, get_user_id};

/// Execute knowledge command.
pub fn execute(cmd: KnowledgeCommand, config: &Config) -> Result<()> {
    match cmd.action {
        KnowledgeAction::Add {
            r#type,
            name,
            description,
            folder,
            confidence,
            source,
            tags,
        } => add(r#type, name, description, folder, confidence, source, tags, config),

        KnowledgeAction::List {
            r#type,
            folder,
            limit,
        } => list(r#type, folder, limit, config),

        KnowledgeAction::Show { id } => show(&id, config),

        KnowledgeAction::Update {
            id,
            description,
            confidence,
            add_tags,
        } => update(&id, description, confidence, add_tags, config),

        KnowledgeAction::Remove { id, force } => remove(&id, force, config),

        KnowledgeAction::Import { path, dry_run } => import(&path, dry_run, config),

        KnowledgeAction::Export { path, folder } => export(&path, folder, config),
    }
}

/// Add knowledge to the knowledge base.
fn add(
    r#type: KnowledgeType,
    name: String,
    description: String,
    folder: Option<String>,
    confidence: Option<f64>,
    source: Option<String>,
    tags: Vec<String>,
    _config: &Config,
) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    // Resolve folder ID if name/ID provided
    let folder_id = if let Some(ref folder_ref) = folder {
        db.get_folder(folder_ref)
            .ok()
            .flatten()
            .or_else(|| db.get_folder_by_name(&user_id, folder_ref).ok().flatten())
            .map(|f| f.id)
    } else {
        None
    };

    // Build metadata
    let mut meta = serde_json::Map::new();
    if !tags.is_empty() {
        meta.insert("tags".to_string(), serde_json::json!(tags));
    }
    if let Some(ref src) = source {
        meta.insert("source".to_string(), serde_json::json!(src));
    }
    let metadata = if meta.is_empty() {
        None
    } else {
        Some(serde_json::Value::Object(meta).to_string())
    };

    let entry = NewMemoryEntry {
        user_id,
        session_id: None,
        folder_id,
        tier: "long_term".to_string(),
        content_type: r#type.as_str().to_string(),
        name: Some(name.clone()),
        description: Some(description.clone()),
        content: description,
        task_id: None,
        priority: None,
        confidence: confidence.or(Some(0.8)), // Default confidence for user-added knowledge
        relevance: Some(0.7),
        ttl_seconds: None, // Long-term memory has no TTL
        metadata_json: metadata,
    };

    let id = db.create_memory_entry(&entry)?;

    let type_icon = type_to_icon(&r#type);
    println!("{} {} Knowledge added", "✓".green(), type_icon);
    println!("  Type: {}", r#type.as_str().cyan());
    println!("  Name: {}", name.bold());
    println!("  ID: {}", &id[..8]);

    if let Some(conf) = confidence {
        println!("  Confidence: {:.0}%", conf * 100.0);
    }

    if let Some(src) = source {
        println!("  Source: {}", src.dimmed());
    }

    if !tags.is_empty() {
        println!("  Tags: {}", tags.join(", ").dimmed());
    }

    Ok(())
}

/// List knowledge entries.
fn list(
    r#type: Option<KnowledgeType>,
    folder: Option<String>,
    limit: usize,
    _config: &Config,
) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    // Resolve folder ID if name/ID provided
    let folder_id = if let Some(ref folder_ref) = folder {
        db.get_folder(folder_ref)
            .ok()
            .flatten()
            .or_else(|| db.get_folder_by_name(&user_id, folder_ref).ok().flatten())
            .map(|f| f.id)
    } else {
        None
    };

    // Knowledge types to query
    let types_to_query: Vec<&str> = match r#type {
        Some(ref t) => vec![t.as_str()],
        None => vec!["convention", "pattern", "skill", "tool", "gotcha"],
    };

    let mut all_entries: Vec<MemoryEntry> = Vec::new();

    for content_type in types_to_query {
        let filter = MemoryQueryFilter {
            user_id: user_id.clone(),
            folder_id: folder_id.clone(),
            tier: Some("long_term".to_string()),
            content_type: Some(content_type.to_string()),
            limit: Some(limit),
            ..Default::default()
        };

        let entries = db.list_memory_entries(&filter)?;
        all_entries.extend(entries);
    }

    // Sort by confidence (descending) then name
    all_entries.sort_by(|a, b| {
        let conf_cmp = b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal);
        if conf_cmp != std::cmp::Ordering::Equal {
            conf_cmp
        } else {
            a.name.cmp(&b.name)
        }
    });

    // Limit total results
    all_entries.truncate(limit);

    if all_entries.is_empty() {
        let type_str = r#type.map(|t| t.as_str()).unwrap_or("any type");
        println!("{} No {} knowledge found", "⚠".yellow(), type_str);
        return Ok(());
    }

    println!("{} {} knowledge entries:", "📚".cyan(), all_entries.len());
    println!();

    for (i, entry) in all_entries.iter().enumerate() {
        print_knowledge_entry(i + 1, entry);
    }

    Ok(())
}

/// Show details of a knowledge entry.
fn show(id: &str, _config: &Config) -> Result<()> {
    let db = get_database()?;

    // Try to find by partial ID
    let entry = find_entry_by_partial_id(db, id)?;

    let type_icon = str_to_icon(&entry.content_type);
    println!("{} {} {}", type_icon, entry.content_type.cyan(), entry.name.as_deref().unwrap_or("Untitled").bold());
    println!();
    println!("  ID: {}", entry.id);
    println!("  Tier: {}", tier_display(&entry.tier).yellow());

    if let Some(conf) = entry.confidence {
        let conf_str = format!("{:.0}%", conf * 100.0);
        let conf_colored = if conf >= 0.8 {
            conf_str.green()
        } else if conf >= 0.5 {
            conf_str.yellow()
        } else {
            conf_str.red()
        };
        println!("  Confidence: {}", conf_colored);
    }

    println!();
    println!("{}", "Content:".dimmed());
    println!("{}", entry.content);

    if let Some(ref metadata) = entry.metadata_json {
        if let Ok(meta) = serde_json::from_str::<serde_json::Value>(metadata) {
            println!();
            if let Some(tags) = meta.get("tags").and_then(|t| t.as_array()) {
                let tags: Vec<String> = tags
                    .iter()
                    .filter_map(|t| t.as_str().map(String::from))
                    .collect();
                if !tags.is_empty() {
                    println!("Tags: {}", tags.join(", ").dimmed());
                }
            }
            if let Some(source) = meta.get("source").and_then(|s| s.as_str()) {
                println!("Source: {}", source.dimmed());
            }
        }
    }

    println!();
    // created_at is Unix timestamp in milliseconds
    let created = chrono::DateTime::from_timestamp_millis(entry.created_at)
        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "unknown".to_string());
    println!("Created: {}", created.dimmed());
    println!("Access count: {}", entry.access_count);

    Ok(())
}

/// Update a knowledge entry.
fn update(
    id: &str,
    description: Option<String>,
    confidence: Option<f64>,
    add_tags: Vec<String>,
    _config: &Config,
) -> Result<()> {
    let db = get_database()?;

    let entry = find_entry_by_partial_id(db, id)?;

    // Note: The update_memory_entry API doesn't support description/tags updates
    // We can only update tier, relevance, confidence, and priority
    // For description/tags changes, we'd need to delete and recreate

    if description.is_some() {
        println!("{} Note: Description updates require re-creating the entry (not yet supported)", "⚠".yellow());
    }

    if !add_tags.is_empty() {
        println!("{} Note: Tag updates require re-creating the entry (not yet supported)", "⚠".yellow());
    }

    if let Some(conf) = confidence {
        db.update_memory_entry(
            &entry.id,
            None, // Don't change tier
            None, // Don't change relevance
            Some(conf),
            None, // Don't change priority
        )?;
        println!("{} Updated confidence: {:.0}%", "✓".green(), conf * 100.0);
    } else if description.is_none() && add_tags.is_empty() {
        println!("{} No changes to apply", "⚠".yellow());
    }

    Ok(())
}

/// Remove a knowledge entry.
fn remove(id: &str, force: bool, _config: &Config) -> Result<()> {
    let db = get_database()?;

    let entry = find_entry_by_partial_id(db, id)?;

    if !force {
        println!("About to delete: {} - {}", entry.content_type.cyan(), entry.name.as_deref().unwrap_or("Untitled").bold());
        println!("Content preview: {}", &entry.content[..entry.content.len().min(100)]);
        println!();
        println!("Use --force to confirm deletion");
        return Ok(());
    }

    db.delete_memory_entry(&entry.id)?;
    println!("{} Removed: {}", "✓".green(), entry.name.as_deref().unwrap_or(&entry.id[..8]));

    Ok(())
}

/// Import knowledge from a CLAUDE.md or similar config file.
fn import(path: &str, dry_run: bool, _config: &Config) -> Result<()> {
    use std::fs;

    let content = fs::read_to_string(path)
        .with_context(|| format!("Failed to read file: {}", path))?;

    // Simple extraction of knowledge-like sections
    // This is a basic implementation - could be enhanced with LLM processing
    let mut found = Vec::new();

    // Look for common patterns
    for line in content.lines() {
        let line = line.trim();

        // Skip empty lines and headers
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        // Look for convention-like statements
        if line.starts_with("- **") || line.starts_with("- ALWAYS") || line.starts_with("- NEVER") {
            found.push(("convention", line.trim_start_matches("- ").to_string()));
        }
        // Look for command patterns
        else if line.contains("```") || line.starts_with("$") || line.starts_with(">") {
            // Skip code blocks
        }
        // Look for gotcha-like warnings
        else if line.to_lowercase().contains("warning") || line.to_lowercase().contains("caution") {
            found.push(("gotcha", line.to_string()));
        }
    }

    if found.is_empty() {
        println!("{} No extractable knowledge found in {}", "⚠".yellow(), path);
        println!("Consider manually adding knowledge with 'rdv knowledge add'");
        return Ok(());
    }

    println!("Found {} potential knowledge entries:", found.len());
    println!();

    for (i, (ktype, content)) in found.iter().enumerate() {
        let preview = if content.len() > 60 {
            format!("{}...", &content[..60])
        } else {
            content.clone()
        };
        println!("  {}. [{}] {}", i + 1, ktype.cyan(), preview);
    }

    if dry_run {
        println!();
        println!("{}", "Dry run - no changes made".dimmed());
        println!("Remove --dry-run to import these entries");
    } else {
        let db = get_database()?;
        let user_id = get_user_id();
        let mut imported = 0;

        for (ktype, content) in found {
            let entry = NewMemoryEntry {
                user_id: user_id.clone(),
                session_id: None,
                folder_id: None,
                tier: "long_term".to_string(),
                content_type: ktype.to_string(),
                name: Some(content[..content.len().min(50)].to_string()),
                description: None,
                content,
                task_id: None,
                priority: None,
                confidence: Some(0.7), // Imported knowledge has slightly lower confidence
                relevance: Some(0.6),
                ttl_seconds: None,
                metadata_json: Some(serde_json::json!({
                    "source": format!("import:{}", path),
                }).to_string()),
            };

            if db.create_memory_entry(&entry).is_ok() {
                imported += 1;
            }
        }

        println!();
        println!("{} Imported {} entries from {}", "✓".green(), imported, path);
    }

    Ok(())
}

/// Export knowledge to a file.
fn export(path: &str, folder: Option<String>, _config: &Config) -> Result<()> {
    use std::fs;

    let db = get_database()?;
    let user_id = get_user_id();

    // Resolve folder ID if name/ID provided
    let folder_id = if let Some(ref folder_ref) = folder {
        db.get_folder(folder_ref)
            .ok()
            .flatten()
            .or_else(|| db.get_folder_by_name(&user_id, folder_ref).ok().flatten())
            .map(|f| f.id)
    } else {
        None
    };

    let mut all_entries: Vec<MemoryEntry> = Vec::new();

    for content_type in ["convention", "pattern", "skill", "tool", "gotcha"] {
        let filter = MemoryQueryFilter {
            user_id: user_id.clone(),
            folder_id: folder_id.clone(),
            tier: Some("long_term".to_string()),
            content_type: Some(content_type.to_string()),
            limit: Some(1000),
            ..Default::default()
        };

        let entries = db.list_memory_entries(&filter)?;
        all_entries.extend(entries);
    }

    if all_entries.is_empty() {
        println!("{} No knowledge to export", "⚠".yellow());
        return Ok(());
    }

    // Convert to exportable format
    let export_data: Vec<serde_json::Value> = all_entries
        .iter()
        .map(|e| {
            let created_at = chrono::DateTime::from_timestamp_millis(e.created_at)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| e.created_at.to_string());
            serde_json::json!({
                "type": e.content_type,
                "name": e.name,
                "description": e.description,
                "content": e.content,
                "confidence": e.confidence,
                "metadata": e.metadata_json.as_ref().and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok()),
                "created_at": created_at,
            })
        })
        .collect();

    let json = serde_json::to_string_pretty(&export_data)?;
    fs::write(path, json)?;

    println!("{} Exported {} entries to {}", "✓".green(), all_entries.len(), path);

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn find_entry_by_partial_id(db: &rdv_core::db::Database, partial_id: &str) -> Result<MemoryEntry> {
    // Try exact match first
    if let Ok(Some(entry)) = db.get_memory_entry(partial_id) {
        return Ok(entry);
    }

    // Try partial match
    let user_id = get_user_id();
    let filter = MemoryQueryFilter {
        user_id,
        tier: Some("long_term".to_string()),
        limit: Some(100),
        ..Default::default()
    };

    let entries = db.list_memory_entries(&filter)?;

    for entry in entries {
        if entry.id.starts_with(partial_id) {
            return Ok(entry);
        }
    }

    bail!("Knowledge entry not found: {}", partial_id)
}

fn type_to_icon(t: &KnowledgeType) -> &'static str {
    match t {
        KnowledgeType::Convention => "📏",
        KnowledgeType::Pattern => "🔄",
        KnowledgeType::Skill => "🎯",
        KnowledgeType::Tool => "🔧",
        KnowledgeType::Gotcha => "⚠️",
    }
}

fn str_to_icon(s: &str) -> &'static str {
    match s {
        "convention" => "📏",
        "pattern" => "🔄",
        "skill" => "🎯",
        "tool" => "🔧",
        "gotcha" => "⚠️",
        _ => "📝",
    }
}

fn tier_display(tier: &str) -> &str {
    match tier {
        "short_term" => "short-term",
        "working" => "working",
        "long_term" => "long-term",
        other => other,
    }
}

fn print_knowledge_entry(index: usize, entry: &MemoryEntry) {
    let icon = str_to_icon(&entry.content_type);
    let short_id = &entry.id[..8];

    let confidence_str = entry.confidence
        .map(|c| format!("{:.0}%", c * 100.0))
        .unwrap_or_else(|| "-".to_string());

    println!(
        "  {}. {} {} [{}] {}",
        index,
        icon,
        short_id.cyan(),
        entry.content_type.dimmed(),
        confidence_str.yellow()
    );

    if let Some(ref name) = entry.name {
        println!("     {}", name.bold());
    }

    // Truncate content for display
    let content = if entry.content.len() > 80 {
        format!("{}...", &entry.content[..80])
    } else {
        entry.content.clone()
    };
    println!("     {}", content.dimmed());

    println!();
}
