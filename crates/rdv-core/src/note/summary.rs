//! Note summarization and aggregation.

use std::collections::HashMap;
use std::sync::Arc;

use crate::error::Result;
use crate::types::{Note, NoteType};

#[cfg(feature = "db")]
use crate::db::Database;

/// Summary of notes from a session.
#[derive(Debug, Clone)]
pub struct SessionNoteSummary {
    /// Session ID.
    pub session_id: String,
    /// Total notes in the session.
    pub total_notes: usize,
    /// Count by note type.
    pub by_type: HashMap<NoteType, usize>,
    /// Pinned notes.
    pub pinned_notes: Vec<Note>,
    /// High-priority notes (priority > 0.7).
    pub high_priority: Vec<Note>,
    /// Recent notes (last 5).
    pub recent: Vec<Note>,
    /// All unique tags used.
    pub tags: Vec<String>,
    /// Key decisions made.
    pub decisions: Vec<Note>,
    /// Gotchas encountered.
    pub gotchas: Vec<Note>,
}

impl SessionNoteSummary {
    /// Create an empty summary.
    pub fn empty(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            total_notes: 0,
            by_type: HashMap::new(),
            pinned_notes: vec![],
            high_priority: vec![],
            recent: vec![],
            tags: vec![],
            decisions: vec![],
            gotchas: vec![],
        }
    }

    /// Check if the session has any notes.
    pub fn has_notes(&self) -> bool {
        self.total_notes > 0
    }

    /// Format as a text summary.
    pub fn to_text(&self) -> String {
        let mut lines = vec![
            format!("## Session Notes Summary"),
            format!("Total: {} notes", self.total_notes),
            String::new(),
        ];

        // Type breakdown
        if !self.by_type.is_empty() {
            lines.push("### By Type".to_string());
            for (note_type, count) in &self.by_type {
                if *count > 0 {
                    lines.push(format!("- {:?}: {}", note_type, count));
                }
            }
            lines.push(String::new());
        }

        // Key decisions
        if !self.decisions.is_empty() {
            lines.push("### Key Decisions".to_string());
            for note in &self.decisions {
                let title = note.title.as_deref().unwrap_or("Untitled");
                lines.push(format!("- **{}**: {}", title, truncate(&note.content, 100)));
            }
            lines.push(String::new());
        }

        // Gotchas
        if !self.gotchas.is_empty() {
            lines.push("### Gotchas".to_string());
            for note in &self.gotchas {
                lines.push(format!("- {}", truncate(&note.content, 100)));
            }
            lines.push(String::new());
        }

        // Tags
        if !self.tags.is_empty() {
            lines.push(format!("### Tags: {}", self.tags.join(", ")));
        }

        lines.join("\n")
    }
}

/// Summary of notes from a folder.
#[derive(Debug, Clone)]
pub struct FolderNoteSummary {
    /// Folder ID.
    pub folder_id: String,
    /// Total notes in the folder.
    pub total_notes: usize,
    /// Count by note type.
    pub by_type: HashMap<NoteType, usize>,
    /// Notes by session.
    pub by_session: HashMap<String, usize>,
    /// Top tags by frequency.
    pub top_tags: Vec<(String, usize)>,
    /// Key patterns identified.
    pub patterns: Vec<Note>,
    /// All decisions.
    pub decisions: Vec<Note>,
    /// All gotchas.
    pub gotchas: Vec<Note>,
}

impl FolderNoteSummary {
    /// Create an empty summary.
    pub fn empty(folder_id: &str) -> Self {
        Self {
            folder_id: folder_id.to_string(),
            total_notes: 0,
            by_type: HashMap::new(),
            by_session: HashMap::new(),
            top_tags: vec![],
            patterns: vec![],
            decisions: vec![],
            gotchas: vec![],
        }
    }
}

/// Note summarization service.
#[cfg(feature = "db")]
pub struct NoteSummarizer {
    db: Arc<Database>,
}

#[cfg(feature = "db")]
impl NoteSummarizer {
    /// Create a new summarizer.
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// Summarize notes for a session.
    pub fn summarize_session(&self, user_id: &str, session_id: &str) -> Result<SessionNoteSummary> {
        use crate::types::NoteFilter;

        let filter = NoteFilter {
            user_id: user_id.to_string(),
            session_id: Some(session_id.to_string()),
            folder_id: None,
            note_type: None,
            archived: Some(false),
            pinned: None,
            limit: None,
        };

        let notes = self.db.list_notes_filtered(&filter)?;

        if notes.is_empty() {
            return Ok(SessionNoteSummary::empty(session_id));
        }

        // Count by type
        let mut by_type: HashMap<NoteType, usize> = HashMap::new();
        for note in &notes {
            *by_type.entry(note.note_type).or_insert(0) += 1;
        }

        // Collect pinned notes
        let pinned_notes: Vec<Note> = notes.iter().filter(|n| n.pinned).cloned().collect();

        // Collect high-priority notes
        let high_priority: Vec<Note> = notes.iter().filter(|n| n.priority > 0.7).cloned().collect();

        // Get recent notes (sorted by created_at, take last 5)
        let mut sorted_notes = notes.clone();
        sorted_notes.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        let recent: Vec<Note> = sorted_notes.into_iter().take(5).collect();

        // Collect all tags
        let mut all_tags: Vec<String> = vec![];
        for note in &notes {
            if let Ok(tags) = serde_json::from_str::<Vec<String>>(&note.tags_json) {
                for tag in tags {
                    if !all_tags.contains(&tag) {
                        all_tags.push(tag);
                    }
                }
            }
        }
        all_tags.sort();

        // Collect decisions
        let decisions: Vec<Note> = notes
            .iter()
            .filter(|n| n.note_type == NoteType::Decision)
            .cloned()
            .collect();

        // Collect gotchas
        let gotchas: Vec<Note> = notes
            .iter()
            .filter(|n| n.note_type == NoteType::Gotcha)
            .cloned()
            .collect();

        Ok(SessionNoteSummary {
            session_id: session_id.to_string(),
            total_notes: notes.len(),
            by_type,
            pinned_notes,
            high_priority,
            recent,
            tags: all_tags,
            decisions,
            gotchas,
        })
    }

    /// Summarize notes for a folder.
    pub fn summarize_folder(&self, user_id: &str, folder_id: &str) -> Result<FolderNoteSummary> {
        use crate::types::NoteFilter;

        let filter = NoteFilter {
            user_id: user_id.to_string(),
            session_id: None,
            folder_id: Some(folder_id.to_string()),
            note_type: None,
            archived: Some(false),
            pinned: None,
            limit: None,
        };

        let notes = self.db.list_notes_filtered(&filter)?;

        if notes.is_empty() {
            return Ok(FolderNoteSummary::empty(folder_id));
        }

        // Count by type
        let mut by_type: HashMap<NoteType, usize> = HashMap::new();
        for note in &notes {
            *by_type.entry(note.note_type).or_insert(0) += 1;
        }

        // Count by session
        let mut by_session: HashMap<String, usize> = HashMap::new();
        for note in &notes {
            if let Some(ref sid) = note.session_id {
                *by_session.entry(sid.clone()).or_insert(0) += 1;
            }
        }

        // Count tags
        let mut tag_counts: HashMap<String, usize> = HashMap::new();
        for note in &notes {
            if let Ok(tags) = serde_json::from_str::<Vec<String>>(&note.tags_json) {
                for tag in tags {
                    *tag_counts.entry(tag).or_insert(0) += 1;
                }
            }
        }

        // Get top tags
        let mut top_tags: Vec<(String, usize)> = tag_counts.into_iter().collect();
        top_tags.sort_by(|a, b| b.1.cmp(&a.1));
        top_tags.truncate(10);

        // Collect patterns
        let patterns: Vec<Note> = notes
            .iter()
            .filter(|n| n.note_type == NoteType::Pattern)
            .cloned()
            .collect();

        // Collect decisions
        let decisions: Vec<Note> = notes
            .iter()
            .filter(|n| n.note_type == NoteType::Decision)
            .cloned()
            .collect();

        // Collect gotchas
        let gotchas: Vec<Note> = notes
            .iter()
            .filter(|n| n.note_type == NoteType::Gotcha)
            .cloned()
            .collect();

        Ok(FolderNoteSummary {
            folder_id: folder_id.to_string(),
            total_notes: notes.len(),
            by_type,
            by_session,
            top_tags,
            patterns,
            decisions,
            gotchas,
        })
    }

    /// Get notes that might be related to a query.
    pub fn find_related(
        &self,
        user_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<Vec<Note>> {
        // Simple text-based search for now
        // In the future, this could use embeddings for semantic search
        self.db.search_notes_by_content(user_id, query, Some(limit))
    }
}

/// Truncate text to a maximum length, adding "..." if truncated.
fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...", &s[..max_len.saturating_sub(3)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_summary_empty() {
        let summary = SessionNoteSummary::empty("test-session");
        assert!(!summary.has_notes());
        assert_eq!(summary.total_notes, 0);
    }

    #[test]
    fn test_truncate() {
        assert_eq!(truncate("hello", 10), "hello");
        assert_eq!(truncate("hello world!", 8), "hello...");
    }

    #[test]
    fn test_summary_to_text() {
        let summary = SessionNoteSummary::empty("test");
        let text = summary.to_text();
        assert!(text.contains("Session Notes Summary"));
        assert!(text.contains("Total: 0 notes"));
    }
}
