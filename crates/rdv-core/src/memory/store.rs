//! Database-backed memory store implementation.

use crate::error::Result;
use crate::types::{MemoryEntry, MemoryTier, NewMemoryEntry, MemoryQueryFilter};
#[cfg(feature = "db")]
use crate::db::Database;

use super::{
    ContentType, MemoryConfig, MemoryStats, RecallOptions, StoreOptions,
    traits::{MemoryStore, ShortTermMemory, WorkingMemory, LongTermMemory, MemoryManager, MaintenanceResult},
};

/// Database-backed memory store.
///
/// Uses SQLite via the Database struct for persistent storage.
#[cfg(feature = "db")]
pub struct DbMemoryStore {
    db: std::sync::Arc<Database>,
    config: MemoryConfig,
}

#[cfg(feature = "db")]
impl DbMemoryStore {
    /// Create a new database-backed memory store.
    pub fn new(db: std::sync::Arc<Database>, config: MemoryConfig) -> Self {
        Self { db, config }
    }

    /// Get the configuration.
    pub fn config(&self) -> &MemoryConfig {
        &self.config
    }

    fn ttl_for_tier(&self, tier: MemoryTier, options: &StoreOptions) -> Option<i32> {
        // Custom TTL overrides default
        if let Some(ttl) = options.ttl {
            return Some(ttl);
        }

        match tier {
            MemoryTier::ShortTerm => Some(self.config.short_term_ttl),
            MemoryTier::Working => Some(self.config.working_ttl),
            MemoryTier::LongTerm => None, // No TTL for long-term
        }
    }
}

#[cfg(feature = "db")]
impl MemoryStore for DbMemoryStore {
    fn store(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        tier: MemoryTier,
        content_type: &str,
        content: &str,
        options: &StoreOptions,
    ) -> Result<String> {
        let entry = NewMemoryEntry {
            user_id: user_id.to_string(),
            session_id: session_id.map(String::from),
            folder_id: folder_id.map(String::from),
            tier: tier.to_string(),
            content_type: content_type.to_string(),
            name: options.name.clone(),
            description: options.description.clone(),
            content: content.to_string(),
            task_id: options.task_id.clone(),
            priority: options.priority,
            confidence: options.confidence,
            relevance: options.relevance,
            ttl_seconds: self.ttl_for_tier(tier, options),
            metadata_json: options.metadata.as_ref().map(|v| v.to_string()),
        };

        self.db.create_memory_entry(&entry)
    }

    fn get(&self, id: &str) -> Result<Option<MemoryEntry>> {
        self.db.get_memory_entry(id)
    }

    fn query(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        options: &RecallOptions,
    ) -> Result<Vec<MemoryEntry>> {
        let filter = MemoryQueryFilter {
            user_id: user_id.to_string(),
            session_id: session_id.map(String::from),
            folder_id: folder_id.map(String::from),
            tier: options.tier.map(|t| t.to_string()),
            content_type: options.content_type.map(|ct| ct.as_str().to_string()),
            task_id: options.task_id.clone(),
            min_relevance: options.min_relevance.or(Some(self.config.min_relevance)),
            min_confidence: options.min_confidence,
            limit: options.limit,
        };

        self.db.list_memory_entries(&filter)
    }

    fn update_tier(&self, id: &str, new_tier: MemoryTier) -> Result<()> {
        self.db.update_memory_entry(id, Some(&new_tier.to_string()), None, None, None)
    }

    fn update_relevance(&self, id: &str, relevance: f64) -> Result<()> {
        self.db.update_memory_entry(id, None, Some(relevance), None, None)
    }

    fn update_confidence(&self, id: &str, confidence: f64) -> Result<()> {
        self.db.update_memory_entry(id, None, None, Some(confidence), None)
    }

    fn touch(&self, id: &str) -> Result<()> {
        self.db.touch_memory_entry(id)
    }

    fn delete(&self, id: &str) -> Result<bool> {
        self.db.delete_memory_entry(id)
    }

    fn cleanup_expired(&self) -> Result<usize> {
        self.db.cleanup_expired_memory()
    }

    fn stats(&self, user_id: &str) -> Result<MemoryStats> {
        let map = self.db.get_memory_stats(user_id)?;
        Ok(MemoryStats::from(map))
    }

    fn find_by_hash(&self, user_id: &str, content_hash: &str) -> Result<Option<MemoryEntry>> {
        // Use a filter to find by hash
        let filter = MemoryQueryFilter {
            user_id: user_id.to_string(),
            session_id: None,
            folder_id: None,
            tier: None,
            content_type: None,
            task_id: None,
            min_relevance: None,
            min_confidence: None,
            limit: Some(1),
        };

        let entries = self.db.list_memory_entries(&filter)?;

        // Filter by hash manually (TODO: add hash to query filter)
        Ok(entries.into_iter().find(|e| e.content_hash == content_hash))
    }
}

#[cfg(feature = "db")]
impl ShortTermMemory for DbMemoryStore {
    fn remember(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        content: &str,
        content_type: ContentType,
        options: Option<StoreOptions>,
    ) -> Result<String> {
        let opts = options.unwrap_or_default();
        self.store(
            user_id,
            session_id,
            folder_id,
            MemoryTier::ShortTerm,
            content_type.as_str(),
            content,
            &opts,
        )
    }

    fn recent(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>> {
        self.query(
            user_id,
            session_id,
            folder_id,
            &RecallOptions {
                tier: Some(MemoryTier::ShortTerm),
                limit: Some(limit),
                ..Default::default()
            },
        )
    }

    fn forget(&self, id: &str) -> Result<bool> {
        self.delete(id)
    }

    fn prune(&self) -> Result<usize> {
        self.cleanup_expired()
    }
}

#[cfg(feature = "db")]
impl WorkingMemory for DbMemoryStore {
    fn hold(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        content: &str,
        content_type: ContentType,
        options: Option<StoreOptions>,
    ) -> Result<String> {
        let opts = options.unwrap_or_default();
        self.store(
            user_id,
            session_id,
            folder_id,
            MemoryTier::Working,
            content_type.as_str(),
            content,
            &opts,
        )
    }

    fn release(&self, id: &str) -> Result<bool> {
        // Demote to short-term (will expire naturally)
        self.update_tier(id, MemoryTier::ShortTerm)?;
        Ok(true)
    }

    fn consolidate(&self, id: &str) -> Result<bool> {
        // Promote to long-term
        self.update_tier(id, MemoryTier::LongTerm)?;
        Ok(true)
    }

    fn active(
        &self,
        user_id: &str,
        session_id: Option<&str>,
        folder_id: Option<&str>,
        task_id: Option<&str>,
    ) -> Result<Vec<MemoryEntry>> {
        self.query(
            user_id,
            session_id,
            folder_id,
            &RecallOptions {
                tier: Some(MemoryTier::Working),
                task_id: task_id.map(String::from),
                ..Default::default()
            },
        )
    }

    fn refresh(&self, id: &str) -> Result<()> {
        // Touch updates last_accessed_at and increments access_count
        self.touch(id)
    }
}

#[cfg(feature = "db")]
impl LongTermMemory for DbMemoryStore {
    fn learn(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        content: &str,
        content_type: ContentType,
        options: Option<StoreOptions>,
    ) -> Result<String> {
        let opts = options.unwrap_or_default();
        self.store(
            user_id,
            None, // No session for long-term
            folder_id,
            MemoryTier::LongTerm,
            content_type.as_str(),
            content,
            &opts,
        )
    }

    fn recall(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        _query: &str,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>> {
        // TODO: Implement semantic search with embeddings
        // For now, return most recent long-term memories
        self.query(
            user_id,
            None,
            folder_id,
            &RecallOptions {
                tier: Some(MemoryTier::LongTerm),
                limit: Some(limit),
                ..Default::default()
            },
        )
    }

    fn update(&self, _id: &str, _content: &str) -> Result<()> {
        // TODO: Implement content update
        // For now, we don't support updating content directly
        Ok(())
    }

    fn unlearn(&self, id: &str) -> Result<bool> {
        self.delete(id)
    }

    fn knowledge(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        content_type: Option<ContentType>,
    ) -> Result<Vec<MemoryEntry>> {
        self.query(
            user_id,
            None,
            folder_id,
            &RecallOptions {
                tier: Some(MemoryTier::LongTerm),
                content_type,
                ..Default::default()
            },
        )
    }
}

#[cfg(feature = "db")]
impl MemoryManager for DbMemoryStore {
    fn config(&self) -> &MemoryConfig {
        &self.config
    }

    fn search(
        &self,
        user_id: &str,
        _query: &str,
        options: RecallOptions,
    ) -> Result<Vec<MemoryEntry>> {
        // TODO: Implement semantic search with embeddings
        // For now, return filtered results
        self.query(user_id, None, None, &options)
    }

    fn stats(&self, user_id: &str) -> Result<MemoryStats> {
        MemoryStore::stats(self, user_id)
    }

    fn maintain(&self, user_id: &str) -> Result<MaintenanceResult> {
        let mut result = MaintenanceResult::default();

        // 1. Cleanup expired entries
        match self.cleanup_expired() {
            Ok(count) => result.expired_cleaned = count,
            Err(e) => result.errors.push(format!("Cleanup error: {}", e)),
        }

        // 2. Auto-promote if enabled
        if self.config.auto_promotion {
            match self.auto_promote(user_id) {
                Ok(ids) => result.promoted = ids.len(),
                Err(e) => result.errors.push(format!("Auto-promote error: {}", e)),
            }
        }

        // 3. Check for consolidation candidates
        match self.find_consolidation_candidates(user_id) {
            Ok(candidates) => {
                for id in candidates {
                    if let Err(e) = self.consolidate(&id) {
                        result.errors.push(format!("Consolidation error for {}: {}", id, e));
                    } else {
                        result.consolidated += 1;
                    }
                }
            }
            Err(e) => result.errors.push(format!("Find candidates error: {}", e)),
        }

        Ok(result)
    }

    fn auto_promote(&self, user_id: &str) -> Result<Vec<String>> {
        let mut promoted = Vec::new();

        // Find short-term memories with high access count
        let filter = MemoryQueryFilter {
            user_id: user_id.to_string(),
            session_id: None,
            folder_id: None,
            tier: Some("short_term".to_string()),
            content_type: None,
            task_id: None,
            min_relevance: None,
            min_confidence: None,
            limit: Some(100),
        };

        let entries = self.db.list_memory_entries(&filter)?;

        for entry in entries {
            // Promote if accessed more than 3 times
            if entry.access_count >= 3 {
                if self.update_tier(&entry.id, MemoryTier::Working).is_ok() {
                    promoted.push(entry.id);
                }
            }
        }

        Ok(promoted)
    }
}

#[cfg(feature = "db")]
impl DbMemoryStore {
    /// Find working memories that should be consolidated to long-term.
    fn find_consolidation_candidates(&self, user_id: &str) -> Result<Vec<String>> {
        let filter = MemoryQueryFilter {
            user_id: user_id.to_string(),
            session_id: None,
            folder_id: None,
            tier: Some("working".to_string()),
            content_type: None,
            task_id: None,
            min_relevance: None,
            min_confidence: Some(self.config.consolidation_threshold),
            limit: Some(50),
        };

        let entries = self.db.list_memory_entries(&filter)?;

        // Consolidate entries with high confidence and high access count
        Ok(entries
            .into_iter()
            .filter(|e| e.access_count >= 5)
            .map(|e| e.id)
            .collect())
    }
}
