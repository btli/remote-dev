//! Note-taking service for AI agents.
//!
//! Provides a structured system for capturing, searching, and summarizing notes
//! during coding sessions. Integrates with the embedding system for semantic search.
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │                    NoteTakingService                           │
//! │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
//! │  │   capture   │  │   search    │  │     summarize           │ │
//! │  │ (note CRUD) │  │ (tag/text)  │  │  (group insights)       │ │
//! │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
//! │                          │                                      │
//! │                    Database Layer                              │
//! └─────────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Usage
//!
//! ```ignore
//! use rdv_core::note::{NoteTakingService, NoteServiceConfig, CaptureOptions};
//!
//! let config = NoteServiceConfig::default();
//! let service = NoteTakingService::new(db, config);
//!
//! // Capture a note during a session
//! let id = service.capture(
//!     user_id,
//!     "Found a bug in authentication flow",
//!     NoteType::Observation,
//!     CaptureOptions {
//!         session_id: Some(session_id.to_string()),
//!         tags: vec!["bug".into(), "auth".into()],
//!         ..Default::default()
//!     },
//! )?;
//!
//! // Search notes by tag
//! let notes = service.search_by_tag(user_id, "bug", 10)?;
//!
//! // Search by content
//! let notes = service.search(user_id, "authentication", SearchOptions::default())?;
//!
//! // Summarize notes for a session
//! let summary = service.summarize_session(session_id)?;
//! ```

mod service;
mod summary;

pub use service::*;
pub use summary::*;

use crate::types::NoteType;

/// Configuration for the note-taking service.
#[derive(Debug, Clone)]
pub struct NoteServiceConfig {
    /// Default priority for new notes (0.0 to 1.0).
    pub default_priority: f64,
    /// Maximum number of notes to return in searches.
    pub default_search_limit: usize,
    /// Enable auto-tagging based on content.
    pub auto_tag: bool,
    /// Maximum content length for notes.
    pub max_content_length: usize,
}

impl Default for NoteServiceConfig {
    fn default() -> Self {
        Self {
            default_priority: 0.5,
            default_search_limit: 50,
            auto_tag: true,
            max_content_length: 10000,
        }
    }
}

/// Options for capturing a note.
#[derive(Debug, Clone, Default)]
pub struct CaptureOptions {
    /// Link to specific session.
    pub session_id: Option<String>,
    /// Link to specific folder.
    pub folder_id: Option<String>,
    /// Optional short title.
    pub title: Option<String>,
    /// Tags for categorization.
    pub tags: Vec<String>,
    /// Context information (file paths, line numbers, etc.).
    pub context: Option<serde_json::Value>,
    /// Priority (0.0 to 1.0, higher = more important).
    pub priority: Option<f64>,
    /// Whether to pin this note.
    pub pinned: bool,
}

/// Options for searching notes.
#[derive(Debug, Clone, Default)]
pub struct SearchOptions {
    /// Filter by session.
    pub session_id: Option<String>,
    /// Filter by folder.
    pub folder_id: Option<String>,
    /// Filter by note type.
    pub note_type: Option<NoteType>,
    /// Include archived notes.
    pub include_archived: bool,
    /// Only show pinned notes.
    pub pinned_only: bool,
    /// Maximum results to return.
    pub limit: Option<usize>,
}

/// Result of note operations.
#[derive(Debug, Clone)]
pub struct NoteOperationResult {
    /// Number of notes affected.
    pub affected: usize,
    /// IDs of affected notes.
    pub note_ids: Vec<String>,
    /// Any errors encountered.
    pub errors: Vec<String>,
}

impl NoteOperationResult {
    /// Create a new result with a single note ID.
    pub fn single(id: String) -> Self {
        Self {
            affected: 1,
            note_ids: vec![id],
            errors: vec![],
        }
    }

    /// Create an empty result.
    pub fn empty() -> Self {
        Self {
            affected: 0,
            note_ids: vec![],
            errors: vec![],
        }
    }

    /// Create a result with an error.
    pub fn with_error(error: String) -> Self {
        Self {
            affected: 0,
            note_ids: vec![],
            errors: vec![error],
        }
    }

    /// Check if the operation was successful.
    pub fn is_success(&self) -> bool {
        self.errors.is_empty() && self.affected > 0
    }
}

/// Tag extraction helper - extracts potential tags from content.
pub fn extract_tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();

    // Extract hashtags
    for word in content.split_whitespace() {
        if word.starts_with('#') && word.len() > 1 {
            let tag = word[1..].trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-');
            if !tag.is_empty() {
                tags.push(tag.to_lowercase());
            }
        }
    }

    // Extract common keywords
    let keywords = [
        "bug", "fix", "todo", "hack", "note", "important", "warn", "error",
        "refactor", "cleanup", "performance", "security", "test", "doc",
    ];

    let content_lower = content.to_lowercase();
    for keyword in keywords {
        if content_lower.contains(keyword) && !tags.contains(&keyword.to_string()) {
            tags.push(keyword.to_string());
        }
    }

    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_note_service_config_default() {
        let config = NoteServiceConfig::default();
        assert_eq!(config.default_priority, 0.5);
        assert_eq!(config.default_search_limit, 50);
        assert!(config.auto_tag);
        assert_eq!(config.max_content_length, 10000);
    }

    #[test]
    fn test_capture_options_default() {
        let opts = CaptureOptions::default();
        assert!(opts.session_id.is_none());
        assert!(opts.folder_id.is_none());
        assert!(opts.title.is_none());
        assert!(opts.tags.is_empty());
        assert!(opts.context.is_none());
        assert!(opts.priority.is_none());
        assert!(!opts.pinned);
    }

    #[test]
    fn test_note_operation_result() {
        let result = NoteOperationResult::single("test-id".to_string());
        assert!(result.is_success());
        assert_eq!(result.affected, 1);
        assert_eq!(result.note_ids.len(), 1);

        let empty = NoteOperationResult::empty();
        assert!(!empty.is_success());

        let error = NoteOperationResult::with_error("test error".to_string());
        assert!(!error.is_success());
    }

    #[test]
    fn test_extract_tags() {
        let content = "Found a #bug in the authentication #security flow. TODO: fix it.";
        let tags = extract_tags(content);

        assert!(tags.contains(&"bug".to_string()));
        assert!(tags.contains(&"security".to_string()));
        assert!(tags.contains(&"todo".to_string()));
    }

    #[test]
    fn test_extract_tags_empty() {
        let content = "Just a regular note without any special tags.";
        let tags = extract_tags(content);
        assert!(tags.contains(&"note".to_string())); // "note" keyword detected
    }
}
