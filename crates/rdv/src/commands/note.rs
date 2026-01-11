//! Note command for quick memory capture.
//!
//! Convenience wrapper around memory commands for capturing quick notes.
//! Notes are stored as short-term memories with optional promotion to working memory.

use anyhow::Result;
use colored::Colorize;
use rdv_core::types::NewMemoryEntry;

use crate::cli::NoteCommand;
use crate::config::Config;
use crate::database::{get_database, get_user_id};

/// Execute note command.
pub fn execute(cmd: NoteCommand, _config: &Config) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    // Determine tier based on note type
    // TODOs and decisions go to working memory (24h TTL)
    // Observations and others go to short-term (1h or custom TTL)
    let tier = match cmd.r#type {
        crate::cli::NoteType::Todo | crate::cli::NoteType::Decision => "working",
        _ => "short_term",
    };

    // Default TTLs
    let ttl = match tier {
        "short_term" => cmd.ttl.or(Some(3600)), // 1 hour default
        "working" => cmd.ttl.or(Some(86400)),   // 24 hours for working
        _ => cmd.ttl,
    };

    // Build metadata
    let metadata = if cmd.tags.is_empty() && cmd.priority.is_none() {
        None
    } else {
        let mut meta = serde_json::Map::new();
        if !cmd.tags.is_empty() {
            meta.insert(
                "tags".to_string(),
                serde_json::json!(cmd.tags),
            );
        }
        if let Some(priority) = cmd.priority {
            meta.insert("priority".to_string(), serde_json::json!(priority));
        }
        Some(serde_json::Value::Object(meta).to_string())
    };

    // Get folder ID if name/ID provided
    let folder_id = if let Some(ref folder_ref) = cmd.folder {
        // Try to resolve folder by ID first, then by name
        db.get_folder(folder_ref)
            .ok()
            .flatten()
            .or_else(|| db.get_folder_by_name(&user_id, folder_ref).ok().flatten())
            .map(|f| f.id)
    } else {
        None
    };

    let entry = NewMemoryEntry {
        user_id,
        session_id: None,
        folder_id,
        tier: tier.to_string(),
        content_type: format!("note:{}", cmd.r#type.as_str()),
        name: Some(format!("[{}] {}",
            cmd.r#type.as_str().to_uppercase(),
            &cmd.content[..cmd.content.len().min(50)]
        )),
        description: None,
        content: cmd.content,
        task_id: None,
        priority: cmd.priority,
        confidence: Some(1.0), // User-created notes have full confidence
        relevance: Some(0.7), // Default relevance
        ttl_seconds: ttl,
        metadata_json: metadata,
    };

    let id = db.create_memory_entry(&entry)?;

    let type_icon = match cmd.r#type {
        crate::cli::NoteType::Todo => "☐",
        crate::cli::NoteType::Reminder => "⏰",
        crate::cli::NoteType::Question => "❓",
        crate::cli::NoteType::Observation => "👁",
        crate::cli::NoteType::Warning => "⚠",
        crate::cli::NoteType::Decision => "✓",
    };

    println!("{} {} Note captured", "✓".green(), type_icon);
    println!("  Type: {}", cmd.r#type.as_str().cyan());
    println!("  Tier: {}", tier_display(tier).yellow());
    println!("  ID: {}", &id[..8]);

    if let Some(ttl) = ttl {
        let hours = ttl / 3600;
        if hours > 0 {
            println!("  Expires: {}h", hours);
        } else {
            println!("  Expires: {}m", ttl / 60);
        }
    }

    if !cmd.tags.is_empty() {
        println!("  Tags: {}", cmd.tags.join(", ").dimmed());
    }

    if let Some(priority) = cmd.priority {
        let priority_str = match priority {
            1 => "P1 (Critical)".red(),
            2 => "P2 (High)".yellow(),
            3 => "P3 (Medium)".cyan(),
            _ => "P4 (Low)".dimmed(),
        };
        println!("  Priority: {}", priority_str);
    }

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
