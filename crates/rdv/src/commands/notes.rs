//! Notes command for structured note-taking system.
//!
//! Provides commands for capturing, searching, and managing notes
//! during coding sessions, with insight extraction capabilities.

use anyhow::{anyhow, Result};
use colored::Colorize;
use rdv_core::types::{NewNote, NoteFilter, NoteType, SdkInsightFilter, SdkInsightType as CoreSdkInsightType, UpdateNote};

use crate::cli::{NotesAction, NotesCommand, SdkInsightType, SdkNoteType};
use crate::config::Config;
use crate::database::{get_database, get_user_id};

/// Execute notes command.
pub fn execute(cmd: NotesCommand, _config: &Config) -> Result<()> {
    match cmd.action {
        NotesAction::Add {
            content,
            r#type,
            title,
            tags,
            session,
            folder,
            priority,
            pin,
        } => add_note(content, r#type, title, tags, session, folder, priority, pin),

        NotesAction::Search {
            query,
            r#type,
            tag,
            folder,
            include_archived,
            limit,
        } => search_notes(query, r#type, tag, folder, include_archived, limit),

        NotesAction::List {
            r#type,
            folder,
            pinned,
            include_archived,
            limit,
        } => list_notes(r#type, folder, pinned, include_archived, limit),

        NotesAction::Show { id } => show_note(&id),

        NotesAction::Update {
            id,
            content,
            title,
            add_tags,
            remove_tags,
            priority,
            pin,
            unpin,
            archive,
            unarchive,
        } => update_note(
            &id,
            content,
            title,
            add_tags,
            remove_tags,
            priority,
            pin,
            unpin,
            archive,
            unarchive,
        ),

        NotesAction::Delete { id, force } => delete_note(&id, force),

        NotesAction::Summarize { session } => summarize_session(&session),

        NotesAction::Insights {
            folder,
            extract,
            min_confidence,
            r#type,
            limit,
        } => view_insights(folder, extract, min_confidence, r#type, limit),
    }
}

/// Convert CLI note type to domain type.
fn to_note_type(cli_type: &SdkNoteType) -> NoteType {
    match cli_type {
        SdkNoteType::Observation => NoteType::Observation,
        SdkNoteType::Decision => NoteType::Decision,
        SdkNoteType::Gotcha => NoteType::Gotcha,
        SdkNoteType::Pattern => NoteType::Pattern,
        SdkNoteType::Question => NoteType::Question,
        SdkNoteType::Todo => NoteType::Todo,
        SdkNoteType::Reference => NoteType::Reference,
    }
}

/// Convert CLI insight type to domain type.
fn to_sdk_insight_type(cli_type: &SdkInsightType) -> CoreSdkInsightType {
    match cli_type {
        SdkInsightType::Convention => CoreSdkInsightType::Convention,
        SdkInsightType::Pattern => CoreSdkInsightType::Pattern,
        SdkInsightType::AntiPattern => CoreSdkInsightType::AntiPattern,
        SdkInsightType::Skill => CoreSdkInsightType::Skill,
        SdkInsightType::Gotcha => CoreSdkInsightType::Gotcha,
        SdkInsightType::BestPractice => CoreSdkInsightType::BestPractice,
        SdkInsightType::Dependency => CoreSdkInsightType::Dependency,
        SdkInsightType::Performance => CoreSdkInsightType::Performance,
    }
}

/// Get note type icon.
fn note_type_icon(note_type: &str) -> &'static str {
    match note_type {
        "observation" => "👁",
        "decision" => "✓",
        "gotcha" => "⚠",
        "pattern" => "🔄",
        "question" => "❓",
        "todo" => "☐",
        "reference" => "📎",
        _ => "📝",
    }
}

/// Add a new note.
fn add_note(
    content: String,
    r#type: SdkNoteType,
    title: Option<String>,
    tags: Vec<String>,
    session: Option<String>,
    folder: Option<String>,
    priority: Option<f64>,
    pin: bool,
) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    // Resolve folder ID if provided
    let folder_id = if let Some(ref folder_ref) = folder {
        db.get_folder(folder_ref)
            .ok()
            .flatten()
            .or_else(|| db.get_folder_by_name(&user_id, folder_ref).ok().flatten())
            .map(|f| f.id)
    } else {
        None
    };

    let note = NewNote {
        user_id: user_id.clone(),
        session_id: session,
        folder_id,
        note_type: to_note_type(&r#type),
        title,
        content: content.clone(),
        tags,
        context: None,
        priority: priority.unwrap_or(0.5),
    };

    let id = db.create_note(&note)?;

    let icon = note_type_icon(r#type.as_str());
    println!("{} {} Note created", "✓".green(), icon);
    println!("  Type: {}", r#type.as_str().cyan());
    println!("  ID: {}", &id[..8].dimmed());

    if pin {
        db.update_note(
            &id,
            &UpdateNote {
                pinned: Some(true),
                ..Default::default()
            },
        )?;
        println!("  Pinned: {}", "yes".yellow());
    }

    if !note.tags.is_empty() {
        println!("  Tags: {}", note.tags.join(", ").dimmed());
    }

    // Show preview of content
    let preview = if content.len() > 60 {
        format!("{}...", &content[..57])
    } else {
        content
    };
    println!("  Content: {}", preview.dimmed());

    Ok(())
}

/// Search notes by content.
fn search_notes(
    query: String,
    r#type: Option<SdkNoteType>,
    tag: Option<String>,
    folder: Option<String>,
    include_archived: bool,
    limit: usize,
) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    // If tag provided, search by tag first
    let notes = if let Some(ref tag_query) = tag {
        db.search_notes_by_tag(&user_id, tag_query)?
    } else {
        db.search_notes_by_content(&user_id, &query, Some(limit))?
    };

    // Filter by type if specified
    let notes: Vec<_> = notes
        .into_iter()
        .filter(|n| {
            if !include_archived && n.archived {
                return false;
            }
            if let Some(ref t) = r#type {
                if n.note_type != to_note_type(t) {
                    return false;
                }
            }
            if let Some(ref f) = folder {
                if n.folder_id.as_deref() != Some(f.as_str()) {
                    return false;
                }
            }
            true
        })
        .take(limit)
        .collect();

    if notes.is_empty() {
        println!("{} No notes found for query: {}", "ℹ".blue(), query);
        return Ok(());
    }

    println!(
        "{} Found {} notes matching \"{}\":\n",
        "🔍".cyan(),
        notes.len(),
        query
    );

    for note in notes {
        print_note_summary(&note);
    }

    Ok(())
}

/// List notes with filters.
fn list_notes(
    r#type: Option<SdkNoteType>,
    folder: Option<String>,
    pinned: bool,
    include_archived: bool,
    limit: usize,
) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    let filter = NoteFilter {
        user_id,
        session_id: None,
        folder_id: folder,
        note_type: r#type.map(|t| to_note_type(&t)),
        archived: if include_archived { None } else { Some(false) },
        pinned: if pinned { Some(true) } else { None },
        limit: Some(limit),
    };

    let notes = db.list_notes_filtered(&filter)?;

    if notes.is_empty() {
        println!("{} No notes found", "ℹ".blue());
        return Ok(());
    }

    println!("{} {} notes:\n", "📝".cyan(), notes.len());

    for note in notes {
        print_note_summary(&note);
    }

    Ok(())
}

/// Show a single note in detail.
fn show_note(id: &str) -> Result<()> {
    let db = get_database()?;

    let note = db
        .get_note(id)?
        .ok_or_else(|| anyhow!("Note not found: {}", id))?;

    let icon = note_type_icon(&note.note_type.to_string());

    println!("{} Note {}", icon, &note.id[..8].cyan());
    println!("─────────────────────────────────────");

    if let Some(ref title) = note.title {
        println!("Title: {}", title.bold());
    }

    println!("Type: {}", note.note_type.to_string().cyan());

    if note.pinned {
        println!("Status: {} Pinned", "📌".yellow());
    }
    if note.archived {
        println!("Status: {} Archived", "📦".dimmed());
    }

    println!("Priority: {:.1}", note.priority);

    // Parse and display tags
    if let Ok(tags) = serde_json::from_str::<Vec<String>>(&note.tags_json) {
        if !tags.is_empty() {
            println!("Tags: {}", tags.join(", ").dimmed());
        }
    }

    if let Some(ref session_id) = note.session_id {
        println!("Session: {}", &session_id[..8].dimmed());
    }
    if let Some(ref folder_id) = note.folder_id {
        println!("Folder: {}", &folder_id[..8].dimmed());
    }

    println!("\n{}", "Content:".underline());
    println!("{}", note.content);

    // Show context if present
    if !note.context_json.is_empty() && note.context_json != "{}" && note.context_json != "null" {
        println!("\n{}", "Context:".underline());
        if let Ok(ctx) = serde_json::from_str::<serde_json::Value>(&note.context_json) {
            println!("{}", serde_json::to_string_pretty(&ctx)?);
        }
    }

    println!("\nCreated: {}", note.created_at);
    println!("Updated: {}", note.updated_at);

    Ok(())
}

/// Update a note.
#[allow(clippy::too_many_arguments)]
fn update_note(
    id: &str,
    content: Option<String>,
    title: Option<String>,
    add_tags: Vec<String>,
    remove_tags: Vec<String>,
    priority: Option<f64>,
    pin: bool,
    unpin: bool,
    archive: bool,
    unarchive: bool,
) -> Result<()> {
    let db = get_database()?;

    // Get existing note to handle tags
    let existing = db
        .get_note(id)?
        .ok_or_else(|| anyhow!("Note not found: {}", id))?;

    // Handle tag updates
    let new_tags = if !add_tags.is_empty() || !remove_tags.is_empty() {
        let mut current_tags: Vec<String> =
            serde_json::from_str(&existing.tags_json).unwrap_or_default();

        // Add new tags
        for tag in add_tags {
            if !current_tags.contains(&tag) {
                current_tags.push(tag);
            }
        }

        // Remove tags
        for tag in &remove_tags {
            current_tags.retain(|t| t != tag);
        }

        Some(current_tags)
    } else {
        None
    };

    // Determine pinned/archived state
    let pinned = if pin {
        Some(true)
    } else if unpin {
        Some(false)
    } else {
        None
    };

    let archived = if archive {
        Some(true)
    } else if unarchive {
        Some(false)
    } else {
        None
    };

    let update = UpdateNote {
        note_type: None,
        title,
        content,
        tags: new_tags,
        context: None,
        priority,
        pinned,
        archived,
    };

    let updated = db.update_note(id, &update)?;

    if updated {
        println!("{} Note {} updated", "✓".green(), &id[..8]);
    } else {
        println!("{} No changes made to note {}", "ℹ".blue(), &id[..8]);
    }

    Ok(())
}

/// Delete a note.
fn delete_note(id: &str, force: bool) -> Result<()> {
    let db = get_database()?;

    // Get note first to show what we're deleting
    let note = db
        .get_note(id)?
        .ok_or_else(|| anyhow!("Note not found: {}", id))?;

    if !force {
        println!("About to delete note:");
        println!("  ID: {}", &id[..8]);
        println!("  Type: {}", note.note_type.to_string());
        if let Some(ref title) = note.title {
            println!("  Title: {}", title);
        }
        let preview = if note.content.len() > 50 {
            format!("{}...", &note.content[..47])
        } else {
            note.content.clone()
        };
        println!("  Content: {}", preview);
        println!("\n{} Use --force to confirm deletion", "⚠".yellow());
        return Ok(());
    }

    let deleted = db.delete_note(id)?;

    if deleted {
        println!("{} Note {} deleted", "✓".green(), &id[..8]);
    } else {
        println!("{} Failed to delete note {}", "✗".red(), &id[..8]);
    }

    Ok(())
}

/// Summarize notes for a session.
fn summarize_session(session_id: &str) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    let filter = NoteFilter {
        user_id,
        session_id: Some(session_id.to_string()),
        folder_id: None,
        note_type: None,
        archived: Some(false),
        pinned: None,
        limit: Some(100),
    };

    let notes = db.list_notes_filtered(&filter)?;

    if notes.is_empty() {
        println!("{} No notes found for session {}", "ℹ".blue(), &session_id[..8]);
        return Ok(());
    }

    // Group by type
    let mut by_type: std::collections::HashMap<String, Vec<_>> = std::collections::HashMap::new();
    for note in &notes {
        by_type
            .entry(note.note_type.to_string())
            .or_default()
            .push(note);
    }

    println!(
        "{} Session {} Summary ({} notes):\n",
        "📊".cyan(),
        &session_id[..8],
        notes.len()
    );

    // Display by type with icons
    let type_order = [
        "decision",
        "gotcha",
        "pattern",
        "todo",
        "question",
        "observation",
        "reference",
    ];

    for note_type in type_order {
        if let Some(type_notes) = by_type.get(note_type) {
            let icon = note_type_icon(note_type);
            println!(
                "{} {} ({}):",
                icon,
                note_type.to_uppercase().bold(),
                type_notes.len()
            );
            for note in type_notes {
                let preview = if note.content.len() > 70 {
                    format!("{}...", &note.content[..67])
                } else {
                    note.content.clone()
                };
                if note.pinned {
                    println!("  📌 {}", preview);
                } else {
                    println!("  • {}", preview);
                }
            }
            println!();
        }
    }

    Ok(())
}

/// View or extract insights from notes.
fn view_insights(
    folder: Option<String>,
    extract: bool,
    min_confidence: Option<f64>,
    r#type: Option<SdkInsightType>,
    limit: usize,
) -> Result<()> {
    let db = get_database()?;
    let user_id = get_user_id();

    if extract {
        println!(
            "{} Extracting insights from notes...",
            "⚙".yellow()
        );
        // Note: Full extraction would use the InsightExtractor from rdv-core
        // For now, we'll just show existing insights
        println!("{} Insight extraction via CLI is not yet implemented", "ℹ".blue());
        println!("  Use the API endpoint POST /api/sdk/insights/extract instead");
        return Ok(());
    }

    let has_folder_filter = folder.is_some();

    // List existing insights with filter
    let filter = SdkInsightFilter {
        user_id,
        folder_id: folder,
        insight_type: r#type.as_ref().map(to_sdk_insight_type),
        applicability: None,
        applicability_context: None,
        active: None,
        verified: None,
        min_confidence,
        limit: Some(limit),
    };

    let insights = db.list_sdk_insights(&filter)?;

    if insights.is_empty() {
        println!("{} No insights found", "ℹ".blue());
        if !has_folder_filter {
            println!("  Tip: Use --extract to generate insights from notes");
        }
        return Ok(());
    }

    println!("{} {} insights:\n", "💡".cyan(), insights.len());

    for insight in insights {
        let confidence_color = if insight.confidence >= 0.8 {
            format!("{:.0}%", insight.confidence * 100.0).green()
        } else if insight.confidence >= 0.5 {
            format!("{:.0}%", insight.confidence * 100.0).yellow()
        } else {
            format!("{:.0}%", insight.confidence * 100.0).dimmed()
        };

        println!(
            "  {} [{}] {} {}",
            insight_type_icon(&insight.insight_type.to_string()),
            insight.insight_type.to_string().cyan(),
            insight.title.bold(),
            confidence_color
        );

        // Show description preview
        let desc_preview = if insight.description.len() > 80 {
            format!("{}...", &insight.description[..77])
        } else {
            insight.description.clone()
        };
        println!("     {}", desc_preview.dimmed());

        if insight.verified {
            println!("     {} Verified", "✓".green());
        }

        println!();
    }

    Ok(())
}

/// Get insight type icon.
fn insight_type_icon(insight_type: &str) -> &'static str {
    match insight_type {
        "convention" => "📐",
        "pattern" => "🔄",
        "anti_pattern" => "🚫",
        "skill" => "🛠",
        "gotcha" => "⚠",
        "best_practice" => "✨",
        "dependency" => "🔗",
        "performance" => "⚡",
        _ => "💡",
    }
}

/// Print note summary for list/search display.
fn print_note_summary(note: &rdv_core::types::Note) {
    let icon = note_type_icon(&note.note_type.to_string());
    let id_short = &note.id[..8];

    // Status indicators
    let mut status = String::new();
    if note.pinned {
        status.push_str("📌 ");
    }
    if note.archived {
        status.push_str("📦 ");
    }

    // Title or content preview
    let display = if let Some(ref title) = note.title {
        title.clone()
    } else if note.content.len() > 60 {
        format!("{}...", &note.content[..57])
    } else {
        note.content.clone()
    };

    println!(
        "  {} {} {} {}",
        icon,
        id_short.dimmed(),
        status,
        display
    );

    // Show tags if present
    if let Ok(tags) = serde_json::from_str::<Vec<String>>(&note.tags_json) {
        if !tags.is_empty() {
            println!("     {}", tags.iter().map(|t| format!("#{}", t)).collect::<Vec<_>>().join(" ").dimmed());
        }
    }
}
