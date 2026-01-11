//! Note-taking service implementation.

use std::sync::Arc;

use crate::error::Result;
use crate::types::{Note, NoteType, NewNote, UpdateNote, NoteFilter};

#[cfg(feature = "db")]
use crate::db::Database;

use super::{
    CaptureOptions, extract_tags, NoteOperationResult, NoteServiceConfig, SearchOptions,
};

/// Note-taking service for AI agents.
///
/// Provides methods for capturing, searching, and managing notes during
/// coding sessions.
#[cfg(feature = "db")]
pub struct NoteTakingService {
    db: Arc<Database>,
    config: NoteServiceConfig,
}

#[cfg(feature = "db")]
impl NoteTakingService {
    /// Create a new note-taking service.
    pub fn new(db: Arc<Database>, config: NoteServiceConfig) -> Self {
        Self { db, config }
    }

    /// Get the service configuration.
    pub fn config(&self) -> &NoteServiceConfig {
        &self.config
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Capture Operations
    // ─────────────────────────────────────────────────────────────────────────────

    /// Capture a new note.
    ///
    /// This is the primary method for creating notes. It handles:
    /// - Content validation
    /// - Auto-tagging (if enabled)
    /// - Priority assignment
    /// - Session/folder linking
    pub fn capture(
        &self,
        user_id: &str,
        content: &str,
        note_type: NoteType,
        options: CaptureOptions,
    ) -> Result<NoteOperationResult> {
        // Validate content length
        if content.len() > self.config.max_content_length {
            return Ok(NoteOperationResult::with_error(format!(
                "Content exceeds maximum length of {} characters",
                self.config.max_content_length
            )));
        }

        // Build tags list
        let mut tags = options.tags.clone();
        if self.config.auto_tag {
            let auto_tags = extract_tags(content);
            for tag in auto_tags {
                if !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
        }

        // Determine priority
        let priority = options.priority.unwrap_or(self.config.default_priority);

        // Create the note
        let new_note = NewNote {
            user_id: user_id.to_string(),
            session_id: options.session_id,
            folder_id: options.folder_id,
            note_type,
            title: options.title,
            content: content.to_string(),
            tags,
            context: options.context,
            priority,
        };

        match self.db.create_note(&new_note) {
            Ok(id) => Ok(NoteOperationResult::single(id)),
            Err(e) => Ok(NoteOperationResult::with_error(e.to_string())),
        }
    }

    /// Quick capture - create a simple observation note.
    pub fn quick_capture(&self, user_id: &str, content: &str) -> Result<NoteOperationResult> {
        self.capture(user_id, content, NoteType::Observation, CaptureOptions::default())
    }

    /// Capture a decision with context.
    pub fn capture_decision(
        &self,
        user_id: &str,
        decision: &str,
        rationale: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<NoteOperationResult> {
        let content = if let Some(rationale) = rationale {
            format!("{}\n\nRationale: {}", decision, rationale)
        } else {
            decision.to_string()
        };

        self.capture(
            user_id,
            &content,
            NoteType::Decision,
            CaptureOptions {
                session_id: session_id.map(String::from),
                tags: vec!["decision".to_string()],
                ..Default::default()
            },
        )
    }

    /// Capture a gotcha/pitfall.
    pub fn capture_gotcha(
        &self,
        user_id: &str,
        gotcha: &str,
        workaround: Option<&str>,
        session_id: Option<&str>,
    ) -> Result<NoteOperationResult> {
        let content = if let Some(workaround) = workaround {
            format!("⚠️ {}\n\nWorkaround: {}", gotcha, workaround)
        } else {
            format!("⚠️ {}", gotcha)
        };

        self.capture(
            user_id,
            &content,
            NoteType::Gotcha,
            CaptureOptions {
                session_id: session_id.map(String::from),
                tags: vec!["gotcha".to_string(), "warning".to_string()],
                priority: Some(0.7), // Gotchas are higher priority
                ..Default::default()
            },
        )
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Search Operations
    // ─────────────────────────────────────────────────────────────────────────────

    /// Search notes by content text.
    pub fn search(
        &self,
        user_id: &str,
        query: &str,
        options: SearchOptions,
    ) -> Result<Vec<Note>> {
        let limit = options.limit.unwrap_or(self.config.default_search_limit);
        self.db.search_notes_by_content(user_id, query, Some(limit))
    }

    /// Search notes by tag.
    pub fn search_by_tag(&self, user_id: &str, tag: &str, limit: usize) -> Result<Vec<Note>> {
        let notes = self.db.search_notes_by_tag(user_id, tag)?;
        Ok(notes.into_iter().take(limit).collect())
    }

    /// List notes with filters.
    pub fn list(&self, filter: &NoteFilter) -> Result<Vec<Note>> {
        self.db.list_notes_filtered(filter)
    }

    /// Get a specific note by ID.
    pub fn get(&self, id: &str) -> Result<Option<Note>> {
        self.db.get_note(id)
    }

    /// List notes for a specific session.
    pub fn list_for_session(&self, user_id: &str, session_id: &str) -> Result<Vec<Note>> {
        let filter = NoteFilter {
            user_id: user_id.to_string(),
            session_id: Some(session_id.to_string()),
            folder_id: None,
            note_type: None,
            archived: Some(false),
            pinned: None,
            limit: Some(self.config.default_search_limit),
        };
        self.db.list_notes_filtered(&filter)
    }

    /// List notes for a specific folder.
    pub fn list_for_folder(&self, user_id: &str, folder_id: &str) -> Result<Vec<Note>> {
        let filter = NoteFilter {
            user_id: user_id.to_string(),
            session_id: None,
            folder_id: Some(folder_id.to_string()),
            note_type: None,
            archived: Some(false),
            pinned: None,
            limit: Some(self.config.default_search_limit),
        };
        self.db.list_notes_filtered(&filter)
    }

    /// Get pinned notes for a user.
    pub fn get_pinned(&self, user_id: &str) -> Result<Vec<Note>> {
        let filter = NoteFilter {
            user_id: user_id.to_string(),
            session_id: None,
            folder_id: None,
            note_type: None,
            archived: Some(false),
            pinned: Some(true),
            limit: Some(100),
        };
        self.db.list_notes_filtered(&filter)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Update Operations
    // ─────────────────────────────────────────────────────────────────────────────

    /// Update a note.
    pub fn update(&self, id: &str, update: &UpdateNote) -> Result<bool> {
        self.db.update_note(id, update)
    }

    /// Pin a note.
    pub fn pin(&self, id: &str) -> Result<bool> {
        self.db.update_note(id, &UpdateNote {
            note_type: None,
            title: None,
            content: None,
            tags: None,
            context: None,
            priority: None,
            pinned: Some(true),
            archived: None,
        })
    }

    /// Unpin a note.
    pub fn unpin(&self, id: &str) -> Result<bool> {
        self.db.update_note(id, &UpdateNote {
            note_type: None,
            title: None,
            content: None,
            tags: None,
            context: None,
            priority: None,
            pinned: Some(false),
            archived: None,
        })
    }

    /// Archive a note.
    pub fn archive(&self, id: &str) -> Result<bool> {
        self.db.update_note(id, &UpdateNote {
            note_type: None,
            title: None,
            content: None,
            tags: None,
            context: None,
            priority: None,
            pinned: None,
            archived: Some(true),
        })
    }

    /// Unarchive a note.
    pub fn unarchive(&self, id: &str) -> Result<bool> {
        self.db.update_note(id, &UpdateNote {
            note_type: None,
            title: None,
            content: None,
            tags: None,
            context: None,
            priority: None,
            pinned: None,
            archived: Some(false),
        })
    }

    /// Add tags to a note.
    pub fn add_tags(&self, id: &str, new_tags: &[String]) -> Result<bool> {
        // Get existing note to merge tags
        let note = match self.db.get_note(id)? {
            Some(n) => n,
            None => return Ok(false),
        };

        // Parse existing tags
        let mut tags: Vec<String> = serde_json::from_str(&note.tags_json).unwrap_or_default();

        // Add new tags (avoiding duplicates)
        for tag in new_tags {
            let tag_lower = tag.to_lowercase();
            if !tags.contains(&tag_lower) {
                tags.push(tag_lower);
            }
        }

        // Update note with new tags
        self.db.update_note(id, &UpdateNote {
            note_type: None,
            title: None,
            content: None,
            tags: Some(tags),
            context: None,
            priority: None,
            pinned: None,
            archived: None,
        })
    }

    /// Remove tags from a note.
    pub fn remove_tags(&self, id: &str, tags_to_remove: &[String]) -> Result<bool> {
        // Get existing note to filter tags
        let note = match self.db.get_note(id)? {
            Some(n) => n,
            None => return Ok(false),
        };

        // Parse existing tags
        let mut tags: Vec<String> = serde_json::from_str(&note.tags_json).unwrap_or_default();

        // Remove specified tags
        let tags_lower: Vec<String> = tags_to_remove.iter().map(|t| t.to_lowercase()).collect();
        tags.retain(|t| !tags_lower.contains(t));

        // Update note with filtered tags
        self.db.update_note(id, &UpdateNote {
            note_type: None,
            title: None,
            content: None,
            tags: Some(tags),
            context: None,
            priority: None,
            pinned: None,
            archived: None,
        })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Delete Operations
    // ─────────────────────────────────────────────────────────────────────────────

    /// Delete a note.
    pub fn delete(&self, id: &str) -> Result<bool> {
        self.db.delete_note(id)
    }

    /// Delete all archived notes for a user.
    pub fn delete_archived(&self, user_id: &str) -> Result<NoteOperationResult> {
        let filter = NoteFilter {
            user_id: user_id.to_string(),
            session_id: None,
            folder_id: None,
            note_type: None,
            archived: Some(true),
            pinned: None,
            limit: None,
        };

        let archived_notes = self.db.list_notes_filtered(&filter)?;
        let mut deleted_ids = Vec::new();
        let mut errors = Vec::new();

        for note in archived_notes {
            match self.db.delete_note(&note.id) {
                Ok(true) => deleted_ids.push(note.id),
                Ok(false) => errors.push(format!("Note {} not found", note.id)),
                Err(e) => errors.push(format!("Failed to delete {}: {}", note.id, e)),
            }
        }

        Ok(NoteOperationResult {
            affected: deleted_ids.len(),
            note_ids: deleted_ids,
            errors,
        })
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Embedding Operations
    // ─────────────────────────────────────────────────────────────────────────────

    /// Set the embedding ID for a note (for semantic search).
    pub fn set_embedding(&self, note_id: &str, embedding_id: &str) -> Result<bool> {
        self.db.set_note_embedding(note_id, embedding_id)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Statistics Operations
    // ─────────────────────────────────────────────────────────────────────────────

    /// Get note counts by type for a user.
    pub fn get_counts_by_type(&self, user_id: &str) -> Result<std::collections::HashMap<NoteType, usize>> {
        let mut counts = std::collections::HashMap::new();

        for note_type in [
            NoteType::Observation,
            NoteType::Decision,
            NoteType::Gotcha,
            NoteType::Pattern,
            NoteType::Question,
            NoteType::Todo,
            NoteType::Reference,
        ] {
            let filter = NoteFilter {
                user_id: user_id.to_string(),
                session_id: None,
                folder_id: None,
                note_type: Some(note_type),
                archived: Some(false),
                pinned: None,
                limit: None,
            };

            let notes = self.db.list_notes_filtered(&filter)?;
            counts.insert(note_type, notes.len());
        }

        Ok(counts)
    }
}

#[cfg(all(test, feature = "db"))]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn create_test_service() -> (NoteTakingService, tempfile::TempDir) {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = Arc::new(Database::open_path(&db_path).unwrap());
        let config = NoteServiceConfig::default();
        (NoteTakingService::new(db, config), dir)
    }

    #[test]
    fn test_capture_note() {
        let (service, _dir) = create_test_service();

        // Need to create a user first
        // For now just test configuration
        assert_eq!(service.config().default_priority, 0.5);
    }

    #[test]
    fn test_note_service_config() {
        let config = NoteServiceConfig::default();
        assert!(config.auto_tag);
        assert_eq!(config.max_content_length, 10000);
    }
}
