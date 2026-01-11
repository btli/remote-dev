//! Hierarchical Memory System
//!
//! High-level interface that wraps the memory store with:
//! - Semantic search across tiers
//! - Automatic consolidation
//! - Context-aware retrieval

use std::sync::Arc;
use rusqlite::Connection;
use tokio::sync::{RwLock, mpsc};
use uuid::Uuid;

use crate::{SDKResult, config::MemoryConfig};
use super::{
    MemoryStore, MemoryEntry, MemoryTier, MemoryContentType,
    ShortTermEntry, WorkingEntry, LongTermEntry,
    StoreMemoryInput, MemoryQuery, MemoryResult, ConsolidationResult,
    ShortTermMetadata, WorkingMetadata, LongTermMetadata, LongTermApplicability,
    MemoryStats, PruneOptions,
};

/// High-level hierarchical memory interface
pub struct HierarchicalMemory {
    store: MemoryStore,
    user_id: String,
    folder_id: Option<String>,
    config: MemoryConfig,
    shutdown_tx: Option<mpsc::Sender<()>>,
}

/// Options for remember operation
#[derive(Debug, Clone, Default)]
pub struct RememberOptions {
    pub content_type: Option<MemoryContentType>,
    pub source: Option<String>,
    pub metadata: Option<ShortTermMetadata>,
    pub ttl_seconds: Option<u64>,
}

/// Options for hold operation
#[derive(Debug, Clone, Default)]
pub struct HoldOptions {
    pub content_type: Option<MemoryContentType>,
    pub task_id: Option<String>,
    pub priority: Option<i32>,
    pub confidence: Option<f64>,
    pub metadata: Option<WorkingMetadata>,
}

/// Input for learn operation
#[derive(Debug, Clone)]
pub struct LearnInput {
    pub name: String,
    pub description: String,
    pub content: String,
    pub content_type: MemoryContentType,
    pub confidence: Option<f64>,
    pub applicability: Option<LongTermApplicability>,
    pub metadata: Option<LongTermMetadata>,
}

/// Context for recall operation
#[derive(Debug, Clone, Default)]
pub struct RecallContext {
    pub task_id: Option<String>,
    pub file_path: Option<String>,
    pub project_type: Option<String>,
    pub min_score: Option<f64>,
    pub limit_per_tier: Option<usize>,
}

impl HierarchicalMemory {
    /// Create a new hierarchical memory system
    pub fn new(
        db: Arc<RwLock<Connection>>,
        user_id: String,
        folder_id: Option<String>,
        config: MemoryConfig,
    ) -> Self {
        let store = MemoryStore::new(db, user_id.clone(), folder_id.clone());

        Self {
            store,
            user_id,
            folder_id,
            config,
            shutdown_tx: None,
        }
    }

    /// Store to short-term memory
    ///
    /// Short-term memory holds recent commands, tool results, and observations.
    /// Entries have a TTL and are automatically pruned when expired.
    pub async fn remember(&self, content: &str, options: RememberOptions) -> SDKResult<ShortTermEntry> {
        let input = StoreMemoryInput {
            session_id: Uuid::new_v4().to_string(), // TODO: Get from context
            user_id: self.user_id.clone(),
            folder_id: self.folder_id.clone(),
            tier: MemoryTier::ShortTerm,
            content_type: options.content_type.unwrap_or(MemoryContentType::Observation),
            content: content.to_string(),
            name: None,
            description: None,
            source: options.source,
            task_id: None,
            priority: None,
            confidence: None,
            ttl_seconds: options.ttl_seconds.or(Some(self.config.short_term_ttl)),
            metadata: options.metadata.map(|m| serde_json::to_value(m).unwrap_or_default()),
        };

        let entry = self.store.store(input).await?;
        match entry {
            MemoryEntry::ShortTerm(e) => Ok(e),
            _ => unreachable!("store should return ShortTermEntry for short_term tier"),
        }
    }

    /// Store to working memory
    ///
    /// Working memory holds current task context, active files, and hypotheses.
    /// Entries are priority-based and cleared when tasks complete.
    pub async fn hold(&self, content: &str, options: HoldOptions) -> SDKResult<WorkingEntry> {
        let input = StoreMemoryInput {
            session_id: Uuid::new_v4().to_string(),
            user_id: self.user_id.clone(),
            folder_id: self.folder_id.clone(),
            tier: MemoryTier::Working,
            content_type: options.content_type.unwrap_or(MemoryContentType::FileContext),
            content: content.to_string(),
            name: None,
            description: None,
            source: None,
            task_id: options.task_id,
            priority: options.priority,
            confidence: options.confidence,
            ttl_seconds: None,
            metadata: options.metadata.map(|m| serde_json::to_value(m).unwrap_or_default()),
        };

        let entry = self.store.store(input).await?;
        match entry {
            MemoryEntry::Working(e) => Ok(e),
            _ => unreachable!("store should return WorkingEntry for working tier"),
        }
    }

    /// Store to long-term memory
    ///
    /// Long-term memory holds project knowledge, conventions, and patterns.
    /// Entries are confidence-based and persist across sessions.
    pub async fn learn(&self, input: LearnInput) -> SDKResult<LongTermEntry> {
        let store_input = StoreMemoryInput {
            session_id: Uuid::new_v4().to_string(),
            user_id: self.user_id.clone(),
            folder_id: self.folder_id.clone(),
            tier: MemoryTier::LongTerm,
            content_type: input.content_type,
            content: input.content,
            name: Some(input.name),
            description: Some(input.description),
            source: None,
            task_id: None,
            priority: None,
            confidence: input.confidence,
            ttl_seconds: None,
            metadata: input.metadata.map(|m| serde_json::to_value(m).unwrap_or_default()),
        };

        let entry = self.store.store(store_input).await?;
        match entry {
            MemoryEntry::LongTerm(e) => Ok(e),
            _ => unreachable!("store should return LongTermEntry for long_term tier"),
        }
    }

    /// Context-aware retrieval across all tiers
    ///
    /// Searches across short-term, working, and long-term memory with
    /// relevance weighting based on the query and context.
    pub async fn recall(&self, query: &str, context: RecallContext) -> SDKResult<Vec<MemoryResult>> {
        let limit_per_tier = context.limit_per_tier.unwrap_or(10);

        // Query each tier separately and merge results
        let mut all_results = Vec::new();

        // Short-term (most recent, highest weight for current context)
        let short_term_query = MemoryQuery {
            query: Some(query.to_string()),
            user_id: Some(self.user_id.clone()),
            folder_id: self.folder_id.clone(),
            tiers: Some(vec![MemoryTier::ShortTerm]),
            task_id: context.task_id.clone(),
            min_score: context.min_score,
            limit: Some(limit_per_tier),
            include_expired: false,
            ..Default::default()
        };
        let mut short_term = self.store.retrieve(short_term_query).await?;
        // Boost short-term relevance
        for r in &mut short_term {
            r.score *= 1.2;
            r.reason = Some("short-term memory (recent)".into());
        }
        all_results.extend(short_term);

        // Working memory (task-related)
        let working_query = MemoryQuery {
            query: Some(query.to_string()),
            user_id: Some(self.user_id.clone()),
            folder_id: self.folder_id.clone(),
            tiers: Some(vec![MemoryTier::Working]),
            task_id: context.task_id.clone(),
            min_score: context.min_score,
            limit: Some(limit_per_tier),
            include_expired: false,
            ..Default::default()
        };
        let mut working = self.store.retrieve(working_query).await?;
        for r in &mut working {
            r.reason = Some("working memory (task context)".into());
        }
        all_results.extend(working);

        // Long-term (project knowledge)
        let long_term_query = MemoryQuery {
            query: Some(query.to_string()),
            user_id: Some(self.user_id.clone()),
            folder_id: self.folder_id.clone(),
            tiers: Some(vec![MemoryTier::LongTerm]),
            min_score: context.min_score,
            limit: Some(limit_per_tier),
            include_expired: false,
            ..Default::default()
        };
        let mut long_term = self.store.retrieve(long_term_query).await?;
        for r in &mut long_term {
            r.reason = Some("long-term memory (knowledge)".into());
        }
        all_results.extend(long_term);

        // Sort by score and limit
        all_results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        all_results.truncate(limit_per_tier * 3);

        Ok(all_results)
    }

    /// Get relevant context for a task
    pub async fn get_task_context(&self, task_id: &str) -> SDKResult<Vec<MemoryResult>> {
        let query = MemoryQuery {
            user_id: Some(self.user_id.clone()),
            folder_id: self.folder_id.clone(),
            task_id: Some(task_id.to_string()),
            tiers: Some(vec![MemoryTier::Working, MemoryTier::ShortTerm]),
            limit: Some(50),
            include_expired: false,
            ..Default::default()
        };

        self.store.retrieve(query).await
    }

    /// Get relevant context for a file
    pub async fn get_file_context(&self, file_path: &str) -> SDKResult<Vec<MemoryResult>> {
        // Search for entries mentioning this file
        let query = MemoryQuery {
            query: Some(file_path.to_string()),
            user_id: Some(self.user_id.clone()),
            folder_id: self.folder_id.clone(),
            limit: Some(20),
            include_expired: false,
            ..Default::default()
        };

        self.store.retrieve(query).await
    }

    /// Run automatic consolidation
    ///
    /// Consolidation promotes frequently-accessed short-term entries to working memory,
    /// and stable working patterns to long-term knowledge.
    pub async fn consolidate(&self) -> SDKResult<ConsolidationResult> {
        let start = std::time::Instant::now();
        let mut result = ConsolidationResult::default();

        // 1. Promote frequently-accessed short-term entries to working
        let short_term_query = MemoryQuery {
            user_id: Some(self.user_id.clone()),
            folder_id: self.folder_id.clone(),
            tiers: Some(vec![MemoryTier::ShortTerm]),
            include_expired: false,
            limit: Some(100),
            ..Default::default()
        };

        let short_term = self.store.retrieve(short_term_query).await?;
        for entry_result in short_term {
            let entry = entry_result.entry;
            let base = entry.base();

            // Promote if accessed enough times
            if base.access_count >= self.config.promotion_threshold as u32 {
                if let Ok(_) = self.store.promote(entry.id(), MemoryTier::Working).await {
                    result.promoted_to_working += 1;
                }
            }
        }

        // 2. Consolidate stable working entries to long-term
        let working_query = MemoryQuery {
            user_id: Some(self.user_id.clone()),
            folder_id: self.folder_id.clone(),
            tiers: Some(vec![MemoryTier::Working]),
            include_expired: false,
            limit: Some(50),
            ..Default::default()
        };

        let working = self.store.retrieve(working_query).await?;
        for entry_result in working {
            if let MemoryEntry::Working(working_entry) = entry_result.entry {
                // Check if high confidence and frequently accessed
                if working_entry.confidence >= self.config.consolidation_confidence
                    && working_entry.base.access_count >= (self.config.promotion_threshold * 2) as u32
                {
                    if let Ok(promoted) = self.store.promote(&working_entry.base.id, MemoryTier::LongTerm).await {
                        if let MemoryEntry::LongTerm(lt) = promoted {
                            result.new_knowledge.push(lt);
                        }
                        result.consolidated_to_long_term += 1;
                    }
                }
            }
        }

        // 3. Prune expired and low-relevance entries
        let prune_result = self.store.prune(PruneOptions {
            max_relevance: Some(0.1),
            ..Default::default()
        }).await?;
        result.pruned = prune_result;

        result.duration_ms = start.elapsed().as_millis() as u64;

        Ok(result)
    }

    /// Clear working memory for a completed task
    pub async fn clear_task(&self, task_id: &str) -> SDKResult<usize> {
        let query = MemoryQuery {
            user_id: Some(self.user_id.clone()),
            task_id: Some(task_id.to_string()),
            tiers: Some(vec![MemoryTier::Working]),
            include_expired: true,
            ..Default::default()
        };

        let entries = self.store.retrieve(query).await?;
        let mut cleared = 0;

        for entry_result in entries {
            self.store.delete(entry_result.entry.id()).await?;
            cleared += 1;
        }

        Ok(cleared)
    }

    /// Get memory statistics
    pub async fn get_stats(&self) -> SDKResult<MemoryStats> {
        self.store.get_stats().await
    }

    /// Start background consolidation task
    pub async fn start_background_consolidation(&mut self) {
        if self.shutdown_tx.is_some() {
            return; // Already running
        }

        let (tx, _rx) = mpsc::channel::<()>(1);
        self.shutdown_tx = Some(tx);

        let interval = self.config.consolidation_interval;
        let user_id = self.user_id.clone();

        // Note: In production, this would spawn a tokio task
        // For now, we just set up the channel
        tracing::info!(
            user_id = %user_id,
            interval_seconds = interval,
            "Background consolidation configured (not yet spawned)"
        );
    }

    /// Stop background consolidation task
    pub async fn stop_background_consolidation(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_test_memory() -> HierarchicalMemory {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("./migrations/001_memory_tables.sql")).unwrap();

        let db = Arc::new(RwLock::new(conn));
        let config = MemoryConfig::default();

        HierarchicalMemory::new(db, "test-user".into(), None, config)
    }

    #[tokio::test]
    async fn test_remember() {
        let memory = setup_test_memory().await;

        let entry = memory.remember("git status", RememberOptions {
            content_type: Some(MemoryContentType::Command),
            source: Some("terminal".into()),
            ..Default::default()
        }).await.unwrap();

        assert_eq!(entry.base.content, "git status");
        assert_eq!(entry.base.content_type, MemoryContentType::Command);
    }

    #[tokio::test]
    async fn test_hold() {
        let memory = setup_test_memory().await;

        let entry = memory.hold("Working on auth feature", HoldOptions {
            task_id: Some("task-123".into()),
            priority: Some(10),
            ..Default::default()
        }).await.unwrap();

        assert_eq!(entry.task_id, Some("task-123".into()));
        assert_eq!(entry.priority, 10);
    }

    #[tokio::test]
    async fn test_learn() {
        let memory = setup_test_memory().await;

        let entry = memory.learn(LearnInput {
            name: "Use async/await".into(),
            description: "Always use async/await instead of callbacks".into(),
            content: "const result = await fetchData()".into(),
            content_type: MemoryContentType::Convention,
            confidence: Some(0.9),
            applicability: None,
            metadata: None,
        }).await.unwrap();

        assert_eq!(entry.name, "Use async/await");
        assert_eq!(entry.confidence, 0.9);
    }

    #[tokio::test]
    async fn test_recall() {
        let memory = setup_test_memory().await;

        // Add some entries
        memory.remember("git status", RememberOptions::default()).await.unwrap();
        memory.remember("git log", RememberOptions::default()).await.unwrap();
        memory.remember("npm install", RememberOptions::default()).await.unwrap();

        // Recall git-related entries
        let results = memory.recall("git", RecallContext::default()).await.unwrap();

        // Should find git entries
        assert!(results.iter().any(|r| r.entry.content().contains("git")));
    }
}
