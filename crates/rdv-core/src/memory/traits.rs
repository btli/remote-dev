//! Memory system traits defining the interface for memory operations.

use crate::error::Result;
use crate::types::{MemoryEntry, MemoryTier};
use super::{ContentType, MemoryConfig, MemoryStats, RecallOptions, StoreOptions};

/// Core trait for memory storage operations.
///
/// Implementations handle the actual storage backend (SQLite, in-memory, etc.).
pub trait MemoryStore: Send + Sync {
    /// Store a memory entry.
    fn store(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        tier: MemoryTier,
        content_type: &str,
        content: &str,
        options: &StoreOptions,
    ) -> Result<String>;

    /// Retrieve a memory entry by ID.
    fn get(&self, id: &str) -> Result<Option<MemoryEntry>>;

    /// Query memories with filters.
    fn query(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        options: &RecallOptions,
    ) -> Result<Vec<MemoryEntry>>;

    /// Update memory tier (promote or demote).
    fn update_tier(&self, id: &str, new_tier: MemoryTier) -> Result<()>;

    /// Update memory relevance score.
    fn update_relevance(&self, id: &str, relevance: f64) -> Result<()>;

    /// Update memory confidence score.
    fn update_confidence(&self, id: &str, confidence: f64) -> Result<()>;

    /// Increment access count (called on retrieval).
    fn touch(&self, id: &str) -> Result<()>;

    /// Delete a memory entry.
    fn delete(&self, id: &str) -> Result<bool>;

    /// Delete expired entries.
    fn cleanup_expired(&self) -> Result<usize>;

    /// Get memory statistics for a user.
    fn stats(&self, user_id: &str) -> Result<MemoryStats>;

    /// Find memories by content hash (for deduplication).
    fn find_by_hash(&self, user_id: &str, content_hash: &str) -> Result<Option<MemoryEntry>>;
}

/// Trait for short-term memory operations.
///
/// Short-term memory handles fast-decaying observations and recent context.
/// Default TTL: 5 minutes.
pub trait ShortTermMemory: Send + Sync {
    /// Remember an observation (auto-expires).
    fn remember(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        content: &str,
        content_type: ContentType,
        options: Option<StoreOptions>,
    ) -> Result<String>;

    /// Get recent memories (within TTL).
    fn recent(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>>;

    /// Forget a specific memory.
    fn forget(&self, id: &str) -> Result<bool>;

    /// Clear all expired short-term memories.
    fn prune(&self) -> Result<usize>;
}

/// Trait for working memory operations.
///
/// Working memory holds active task context and important patterns.
/// Default TTL: 24 hours.
pub trait WorkingMemory: Send + Sync {
    /// Hold something in working memory.
    fn hold(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        content: &str,
        content_type: ContentType,
        options: Option<StoreOptions>,
    ) -> Result<String>;

    /// Release (demote to short-term or delete).
    fn release(&self, id: &str) -> Result<bool>;

    /// Promote to long-term memory.
    fn consolidate(&self, id: &str) -> Result<bool>;

    /// Get all working memory for a session/task.
    fn active(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        task_id: Option<&str>,
    ) -> Result<Vec<MemoryEntry>>;

    /// Refresh TTL for a working memory.
    fn refresh(&self, id: &str) -> Result<()>;
}

/// Trait for long-term memory operations.
///
/// Long-term memory stores consolidated knowledge and learned patterns.
/// No TTL - permanent storage.
pub trait LongTermMemory: Send + Sync {
    /// Learn and store permanently.
    fn learn(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        content: &str,
        content_type: ContentType,
        options: Option<StoreOptions>,
    ) -> Result<String>;

    /// Recall relevant long-term memories.
    fn recall(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>>;

    /// Update a long-term memory (e.g., add more context).
    fn update(&self, id: &str, content: &str) -> Result<()>;

    /// Unlearn (remove from long-term memory).
    fn unlearn(&self, id: &str) -> Result<bool>;

    /// Get all long-term memories for a folder/project.
    fn knowledge(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        content_type: Option<ContentType>,
    ) -> Result<Vec<MemoryEntry>>;
}

/// Unified memory manager that orchestrates all tiers.
///
/// This is the main interface for agents to interact with the memory system.
pub trait MemoryManager: ShortTermMemory + WorkingMemory + LongTermMemory + Send + Sync {
    /// Get configuration.
    fn config(&self) -> &MemoryConfig;

    /// Search across all tiers.
    fn search(
        &self,
        user_id: &str,
        query: &str,
        options: RecallOptions,
    ) -> Result<Vec<MemoryEntry>>;

    /// Get overall statistics.
    fn stats(&self, user_id: &str) -> Result<MemoryStats>;

    /// Run maintenance (cleanup expired, consolidate candidates).
    fn maintain(&self, user_id: &str) -> Result<MaintenanceResult>;

    /// Auto-promote entries based on access patterns.
    fn auto_promote(&self, user_id: &str) -> Result<Vec<String>>;
}

/// Result of maintenance operations.
#[derive(Debug, Clone, Default)]
pub struct MaintenanceResult {
    /// Number of expired entries cleaned up.
    pub expired_cleaned: usize,
    /// Number of entries promoted to higher tier.
    pub promoted: usize,
    /// Number of entries consolidated to long-term.
    pub consolidated: usize,
    /// Errors encountered (non-fatal).
    pub errors: Vec<String>,
}
