//! Session lifecycle hooks with memory integration.
//!
//! Provides hooks that integrate with the hierarchical memory system:
//! - `on_session_start`: Load relevant memories, prepare context
//! - `on_session_activity`: Capture observations to short-term memory
//! - `on_session_end`: Extract insights, promote valuable memories

#[cfg(feature = "db")]
use crate::db::Database;
#[cfg(feature = "db")]
use crate::error::Result;
#[cfg(feature = "db")]
use crate::memory::{
    ContentType, DbMemoryStore, LongTermMemory, MemoryConfig, MemoryManager, MemoryStats,
    RecallOptions, ShortTermMemory, StoreOptions, WorkingMemory,
};
#[cfg(feature = "db")]
use crate::types::MemoryEntry;
#[cfg(feature = "db")]
use std::sync::Arc;

/// Context for a session with memory integration.
#[derive(Debug, Clone)]
pub struct SessionMemoryContext {
    /// The session ID.
    pub session_id: String,
    /// The user ID.
    pub user_id: String,
    /// Optional folder ID.
    pub folder_id: Option<String>,
    /// Number of memories loaded at start.
    pub loaded_memory_count: usize,
    /// Number of observations captured.
    pub observations_captured: usize,
}

/// Result of session start with memory loading.
#[cfg(feature = "db")]
#[derive(Debug, Clone)]
pub struct SessionStartResult {
    /// The session context.
    pub context: SessionMemoryContext,
    /// Relevant memories loaded for this session.
    pub memories: Vec<MemoryEntry>,
    /// Summary of loaded memories by tier.
    pub stats: MemoryLoadStats,
}

/// Statistics about loaded memories.
#[derive(Debug, Clone, Default)]
pub struct MemoryLoadStats {
    /// Long-term memories (knowledge, patterns).
    pub long_term: usize,
    /// Working memories (active context).
    pub working: usize,
    /// Recent short-term memories.
    pub short_term: usize,
}

/// Result of session end with memory consolidation.
#[derive(Debug, Clone)]
pub struct SessionEndResult {
    /// Number of memories extracted from session.
    pub extracted: usize,
    /// Number of memories promoted to higher tiers.
    pub promoted: usize,
    /// Number of expired memories cleaned up.
    pub cleaned_up: usize,
    /// Insights extracted from the session.
    pub insights: Vec<String>,
}

/// Session lifecycle manager with memory integration.
#[cfg(feature = "db")]
pub struct SessionLifecycle {
    store: DbMemoryStore,
}

#[cfg(feature = "db")]
impl SessionLifecycle {
    /// Create a new session lifecycle manager.
    pub fn new(db: Arc<Database>, config: MemoryConfig) -> Self {
        Self {
            store: DbMemoryStore::new(db, config),
        }
    }

    /// Create with default configuration.
    pub fn with_defaults(db: Arc<Database>) -> Self {
        Self::new(db, MemoryConfig::default())
    }

    /// Called when a session starts.
    ///
    /// Loads relevant memories for the session context:
    /// 1. Long-term knowledge for the folder
    /// 2. Active working memories for the user
    /// 3. Recent short-term observations
    pub fn on_session_start(
        &self,
        session_id: &str,
        user_id: &str,
        folder_id: Option<&str>,
    ) -> Result<SessionStartResult> {
        let mut memories = Vec::new();
        let mut stats = MemoryLoadStats::default();

        // Load long-term knowledge for folder
        let long_term = self.store.knowledge(user_id, folder_id, None)?;
        stats.long_term = long_term.len();
        memories.extend(long_term);

        // Load active working memories
        let working = self.store.active(user_id, None, folder_id, None)?;
        stats.working = working.len();
        memories.extend(working);

        // Load recent short-term observations
        let short_term = self.store.recent(user_id, None, folder_id, 10)?;
        stats.short_term = short_term.len();
        memories.extend(short_term);

        let context = SessionMemoryContext {
            session_id: session_id.to_string(),
            user_id: user_id.to_string(),
            folder_id: folder_id.map(String::from),
            loaded_memory_count: memories.len(),
            observations_captured: 0,
        };

        Ok(SessionStartResult {
            context,
            memories,
            stats,
        })
    }

    /// Capture an observation during the session.
    ///
    /// Stores in short-term memory with session linkage.
    pub fn capture_observation(
        &self,
        user_id: &str,
        session_id: &str,
        folder_id: Option<&str>,
        content: &str,
        content_type: ContentType,
    ) -> Result<String> {
        self.store.remember(
            user_id,
            Some(session_id),
            folder_id,
            content,
            content_type,
            None,
        )
    }

    /// Capture an error observation.
    pub fn capture_error(
        &self,
        user_id: &str,
        session_id: &str,
        folder_id: Option<&str>,
        error_content: &str,
    ) -> Result<String> {
        self.store.remember(
            user_id,
            Some(session_id),
            folder_id,
            error_content,
            ContentType::Error,
            Some(StoreOptions {
                confidence: Some(0.9), // Errors are high confidence
                ..Default::default()
            }),
        )
    }

    /// Hold a piece of context in working memory.
    pub fn hold_context(
        &self,
        user_id: &str,
        session_id: &str,
        folder_id: Option<&str>,
        content: &str,
        name: Option<&str>,
    ) -> Result<String> {
        self.store.hold(
            user_id,
            Some(session_id),
            folder_id,
            content,
            ContentType::Context,
            Some(StoreOptions {
                name: name.map(String::from),
                confidence: Some(0.7),
                ..Default::default()
            }),
        )
    }

    /// Learn a pattern or convention to long-term memory.
    pub fn learn_pattern(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        content: &str,
        name: Option<&str>,
    ) -> Result<String> {
        self.store.learn(
            user_id,
            folder_id,
            content,
            ContentType::Pattern,
            Some(StoreOptions {
                name: name.map(String::from),
                confidence: Some(0.8),
                relevance: Some(0.7),
                ..Default::default()
            }),
        )
    }

    /// Called when a session ends.
    ///
    /// Performs cleanup and consolidation:
    /// 1. Extracts insights from session activity
    /// 2. Auto-promotes frequently accessed memories
    /// 3. Cleans up expired entries
    pub fn on_session_end(
        &self,
        user_id: &str,
        _session_id: &str,
        _folder_id: Option<&str>,
    ) -> Result<SessionEndResult> {
        let mut result = SessionEndResult {
            extracted: 0,
            promoted: 0,
            cleaned_up: 0,
            insights: Vec::new(),
        };

        // Run maintenance (auto-promote, cleanup)
        let maintenance = self.store.maintain(user_id)?;
        result.promoted = maintenance.promoted;
        result.cleaned_up = maintenance.expired_cleaned;

        // TODO: Extract insights from scrollback using learning system
        // This will be implemented with the learning integration

        Ok(result)
    }

    /// Get memory statistics for a user.
    pub fn get_stats(&self, user_id: &str) -> Result<MemoryStats> {
        MemoryManager::stats(&self.store, user_id)
    }

    /// Search memories across all tiers.
    pub fn search(
        &self,
        user_id: &str,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<MemoryEntry>> {
        self.store.search(
            user_id,
            query,
            RecallOptions {
                limit,
                ..Default::default()
            },
        )
    }

    /// Consolidate a working memory to long-term.
    pub fn consolidate_memory(&self, memory_id: &str) -> Result<bool> {
        self.store.consolidate(memory_id)
    }

    /// Release a memory from working memory (demote to short-term).
    pub fn release_memory(&self, memory_id: &str) -> Result<bool> {
        self.store.release(memory_id)
    }

    /// Forget a memory completely.
    pub fn forget_memory(&self, memory_id: &str) -> Result<bool> {
        self.store.forget(memory_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_load_stats_default() {
        let stats = MemoryLoadStats::default();
        assert_eq!(stats.long_term, 0);
        assert_eq!(stats.working, 0);
        assert_eq!(stats.short_term, 0);
    }

    #[test]
    fn test_session_memory_context() {
        let ctx = SessionMemoryContext {
            session_id: "test-session".to_string(),
            user_id: "user-123".to_string(),
            folder_id: Some("folder-abc".to_string()),
            loaded_memory_count: 5,
            observations_captured: 3,
        };
        assert_eq!(ctx.session_id, "test-session");
        assert_eq!(ctx.user_id, "user-123");
        assert_eq!(ctx.folder_id, Some("folder-abc".to_string()));
        assert_eq!(ctx.loaded_memory_count, 5);
        assert_eq!(ctx.observations_captured, 3);
    }
}
