//! ConsolidationService - Periodic memory consolidation
//!
//! This service provides scheduled memory lifecycle management:
//! - Cleanup expired short-term memories
//! - Promote working → long-term based on access patterns and confidence
//! - Demote stale long-term → working based on relevance decay
//! - Apply relevance decay over time
//!
//! Runs on a configurable interval (default: 4 hours)

use rdv_core::memory::{suggest_demotion, suggest_promotion};
use rdv_core::types::{MemoryEntry, MemoryQueryFilter, MemoryTier};
use rdv_core::Database;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{interval, Duration};
use tracing::{debug, error, info, warn};

/// Configuration for consolidation behavior
#[derive(Debug, Clone)]
pub struct ConsolidationConfig {
    /// Interval between consolidation runs in milliseconds (default: 4 hours)
    pub interval_ms: u64,
    /// Enable automatic promotion (short→working, working→long)
    pub auto_promotion: bool,
    /// Enable automatic demotion (long→working, working→short)
    pub auto_demotion: bool,
    /// Relevance decay factor per day (0-1, default: 0.02 = 2% per day)
    pub relevance_decay_rate: f64,
    /// Minimum days of inactivity before applying decay (default: 7)
    pub decay_grace_days: i64,
    /// Minimum relevance before considering for demotion (default: 0.2)
    pub min_relevance_for_demotion: f64,
    /// Minimum confidence before considering for demotion (default: 0.3)
    pub min_confidence_for_demotion: f64,
    /// Enable working memory compaction (default: true)
    pub enable_compaction: bool,
    /// Maximum working memory entries per session before compaction (default: 50)
    pub max_working_entries_per_session: usize,
    /// Similarity threshold for clustering (0-1, default: 0.6)
    pub compaction_similarity_threshold: f64,
}

impl Default for ConsolidationConfig {
    fn default() -> Self {
        Self {
            interval_ms: 4 * 60 * 60 * 1000, // 4 hours
            auto_promotion: true,
            auto_demotion: true,
            relevance_decay_rate: 0.02,    // 2% per day
            decay_grace_days: 7,
            min_relevance_for_demotion: 0.2,
            min_confidence_for_demotion: 0.3,
            enable_compaction: true,
            max_working_entries_per_session: 50,
            compaction_similarity_threshold: 0.6,
        }
    }
}

/// Result of a consolidation cycle
#[derive(Debug, Clone, Default)]
pub struct ConsolidationResult {
    /// Number of expired memories deleted
    pub expired_deleted: usize,
    /// Number of memories promoted to higher tier
    pub promoted: usize,
    /// Number of memories demoted to lower tier
    pub demoted: usize,
    /// Number of memories with relevance decay applied
    pub decayed: usize,
    /// Number of memories deleted during compaction
    pub compacted: usize,
    /// Total memories affected
    pub total_affected: usize,
    /// Duration of the consolidation run in milliseconds
    pub duration_ms: u64,
    /// Timestamp when consolidation completed
    pub completed_at: i64,
}

/// Handle for a running consolidation task
struct ConsolidationHandle {
    abort_handle: tokio::task::AbortHandle,
    user_id: String,
    config: ConsolidationConfig,
}

/// ConsolidationService manages periodic memory lifecycle operations
pub struct ConsolidationService {
    db: Arc<Database>,
    /// Active consolidation tasks: user_id -> ConsolidationHandle
    active_tasks: RwLock<HashMap<String, ConsolidationHandle>>,
    /// Lock for starting/stopping operations
    operation_lock: Mutex<()>,
    /// Default configuration
    default_config: ConsolidationConfig,
}

impl ConsolidationService {
    /// Create a new consolidation service
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            active_tasks: RwLock::new(HashMap::new()),
            operation_lock: Mutex::new(()),
            default_config: ConsolidationConfig::default(),
        }
    }

    /// Create with custom default configuration
    pub fn with_config(db: Arc<Database>, config: ConsolidationConfig) -> Self {
        Self {
            db,
            active_tasks: RwLock::new(HashMap::new()),
            operation_lock: Mutex::new(()),
            default_config: config,
        }
    }

    /// Run a single consolidation cycle for a user
    ///
    /// This performs:
    /// 1. Cleanup expired short-term memories
    /// 2. Apply relevance decay to inactive memories
    /// 3. Promote eligible working memories to long-term
    /// 4. Demote stale long-term memories to working
    pub fn run_consolidation(
        &self,
        user_id: &str,
        config: &ConsolidationConfig,
    ) -> Result<ConsolidationResult, String> {
        let start = std::time::Instant::now();
        let mut result = ConsolidationResult::default();

        // 1. Cleanup expired memories
        let expired = self
            .db
            .cleanup_expired_memory()
            .map_err(|e| e.to_string())?;
        result.expired_deleted = expired;
        debug!(user_id = %user_id, expired = expired, "Cleaned up expired memories");

        // 2. Get all user memories for processing
        let filter = MemoryQueryFilter {
            user_id: user_id.to_string(),
            limit: Some(10000), // Process in batches if needed
            ..Default::default()
        };

        let memories = self
            .db
            .list_memory_entries(&filter)
            .map_err(|e| e.to_string())?;

        // 3. Apply relevance decay
        result.decayed = self.apply_relevance_decay(&memories, config)?;

        // 4. Process promotions
        if config.auto_promotion {
            result.promoted = self.process_promotions(&memories)?;
        }

        // 5. Process demotions
        if config.auto_demotion {
            result.demoted = self.process_demotions(&memories, config)?;
        }

        // 6. Compact working memory if enabled
        if config.enable_compaction {
            result.compacted = self.compact_working_memory(&memories, config)?;
        }

        result.total_affected =
            result.expired_deleted + result.promoted + result.demoted + result.decayed + result.compacted;
        result.duration_ms = start.elapsed().as_millis() as u64;
        result.completed_at = chrono::Utc::now().timestamp_millis();

        info!(
            user_id = %user_id,
            expired = result.expired_deleted,
            promoted = result.promoted,
            demoted = result.demoted,
            decayed = result.decayed,
            compacted = result.compacted,
            duration_ms = result.duration_ms,
            "Consolidation cycle completed"
        );

        Ok(result)
    }

    /// Apply relevance decay to memories that haven't been accessed recently
    fn apply_relevance_decay(
        &self,
        memories: &[MemoryEntry],
        config: &ConsolidationConfig,
    ) -> Result<usize, String> {
        let now = chrono::Utc::now().timestamp_millis();
        let grace_period_ms = config.decay_grace_days * 24 * 60 * 60 * 1000;
        let mut decayed_count = 0;

        for memory in memories {
            // Skip short-term (will expire naturally)
            if memory.tier == "short_term" {
                continue;
            }

            // Check if past grace period
            let last_access = memory.last_accessed_at;
            let inactive_ms = now - last_access;

            if inactive_ms <= grace_period_ms {
                continue;
            }

            // Calculate days inactive beyond grace period
            let extra_inactive_days = (inactive_ms - grace_period_ms) / (24 * 60 * 60 * 1000);
            if extra_inactive_days < 1 {
                continue;
            }

            // Calculate decay
            let current_relevance = memory.relevance.unwrap_or(0.5);
            let decay_amount = config.relevance_decay_rate * extra_inactive_days as f64;
            let new_relevance = (current_relevance - decay_amount).max(0.0);

            // Only update if decay is significant (> 0.01)
            if (current_relevance - new_relevance).abs() > 0.01 {
                if self
                    .db
                    .update_memory_entry(&memory.id, None, Some(new_relevance), None, None)
                    .is_ok()
                {
                    decayed_count += 1;
                    debug!(
                        memory_id = %memory.id,
                        old_relevance = current_relevance,
                        new_relevance = new_relevance,
                        inactive_days = extra_inactive_days,
                        "Applied relevance decay"
                    );
                }
            }
        }

        Ok(decayed_count)
    }

    /// Process memories eligible for promotion
    fn process_promotions(&self, memories: &[MemoryEntry]) -> Result<usize, String> {
        let mut promoted_count = 0;

        for memory in memories {
            // Skip long-term (already at top tier)
            if memory.tier == "long_term" {
                continue;
            }

            if let Some(new_tier) = suggest_promotion(memory) {
                let tier_str = match new_tier {
                    MemoryTier::ShortTerm => "short_term",
                    MemoryTier::Working => "working",
                    MemoryTier::LongTerm => "long_term",
                };

                if self
                    .db
                    .update_memory_entry(&memory.id, Some(tier_str), None, None, None)
                    .is_ok()
                {
                    promoted_count += 1;
                    info!(
                        memory_id = %memory.id,
                        from_tier = %memory.tier,
                        to_tier = tier_str,
                        access_count = memory.access_count,
                        confidence = ?memory.confidence,
                        "Promoted memory"
                    );
                }
            }
        }

        Ok(promoted_count)
    }

    /// Process memories eligible for demotion
    fn process_demotions(
        &self,
        memories: &[MemoryEntry],
        config: &ConsolidationConfig,
    ) -> Result<usize, String> {
        let mut demoted_count = 0;

        for memory in memories {
            // Skip short-term (will expire naturally)
            if memory.tier == "short_term" {
                continue;
            }

            let relevance = memory.relevance.unwrap_or(0.5);
            let confidence = memory.confidence.unwrap_or(0.5);

            // Additional check beyond suggest_demotion: respect config thresholds
            if relevance >= config.min_relevance_for_demotion
                || confidence >= config.min_confidence_for_demotion
            {
                continue;
            }

            if let Some(new_tier) = suggest_demotion(memory) {
                let tier_str = match new_tier {
                    MemoryTier::ShortTerm => "short_term",
                    MemoryTier::Working => "working",
                    MemoryTier::LongTerm => "long_term",
                };

                if self
                    .db
                    .update_memory_entry(&memory.id, Some(tier_str), None, None, None)
                    .is_ok()
                {
                    demoted_count += 1;
                    warn!(
                        memory_id = %memory.id,
                        from_tier = %memory.tier,
                        to_tier = tier_str,
                        relevance = relevance,
                        confidence = confidence,
                        "Demoted memory"
                    );
                }
            }
        }

        Ok(demoted_count)
    }

    /// Compact working memory by clustering similar entries and keeping the best representative
    ///
    /// Strategy:
    /// 1. Group working memories by session
    /// 2. For sessions exceeding threshold, cluster by content similarity
    /// 3. Keep the highest relevance entry from each cluster
    /// 4. Delete redundant entries
    fn compact_working_memory(
        &self,
        memories: &[MemoryEntry],
        config: &ConsolidationConfig,
    ) -> Result<usize, String> {
        use std::collections::HashMap;

        // Filter working memories only
        let working_memories: Vec<&MemoryEntry> = memories
            .iter()
            .filter(|m| m.tier == "working")
            .collect();

        if working_memories.is_empty() {
            return Ok(0);
        }

        // Group by session
        let mut by_session: HashMap<String, Vec<&MemoryEntry>> = HashMap::new();
        for memory in &working_memories {
            let session_key = memory.session_id.clone().unwrap_or_else(|| "no-session".to_string());
            by_session.entry(session_key).or_default().push(memory);
        }

        let mut compacted_count = 0;

        // Process each session that exceeds threshold
        for (session_id, session_memories) in by_session {
            if session_memories.len() <= config.max_working_entries_per_session {
                continue;
            }

            debug!(
                session_id = %session_id,
                count = session_memories.len(),
                threshold = config.max_working_entries_per_session,
                "Session exceeds working memory threshold, compacting"
            );

            // Cluster similar memories
            let clusters = self.cluster_by_similarity(&session_memories, config.compaction_similarity_threshold);

            // For each cluster with > 1 entry, keep only the best
            for cluster in clusters {
                if cluster.len() <= 1 {
                    continue;
                }

                // Find the best entry (highest relevance, then most recent)
                let best = cluster.iter().max_by(|a, b| {
                    let rel_a = a.relevance.unwrap_or(0.5);
                    let rel_b = b.relevance.unwrap_or(0.5);
                    rel_a.partial_cmp(&rel_b).unwrap_or(std::cmp::Ordering::Equal)
                        .then_with(|| a.created_at.cmp(&b.created_at))
                });

                if let Some(best_entry) = best {
                    // Calculate relevance boost from cluster size
                    let boost = ((cluster.len() as f64).ln() / 10.0).min(0.2);
                    let new_relevance = (best_entry.relevance.unwrap_or(0.5) + boost).min(1.0);

                    // Update best entry with boosted relevance
                    let _ = self.db.update_memory_entry(
                        &best_entry.id,
                        None,
                        Some(new_relevance),
                        None,
                        None,
                    );

                    // Delete other entries in cluster
                    for entry in &cluster {
                        if entry.id != best_entry.id {
                            if self.db.delete_memory_entry(&entry.id).is_ok() {
                                compacted_count += 1;
                                debug!(
                                    memory_id = %entry.id,
                                    kept_id = %best_entry.id,
                                    "Compacted redundant working memory"
                                );
                            }
                        }
                    }
                }
            }
        }

        if compacted_count > 0 {
            info!(
                compacted = compacted_count,
                "Working memory compaction completed"
            );
        }

        Ok(compacted_count)
    }

    /// Cluster memories by content similarity using Jaccard index on word sets
    fn cluster_by_similarity<'a>(
        &self,
        memories: &[&'a MemoryEntry],
        threshold: f64,
    ) -> Vec<Vec<&'a MemoryEntry>> {
        use std::collections::HashSet;

        if memories.is_empty() {
            return vec![];
        }

        // Pre-compute word sets for each memory
        let word_sets: Vec<HashSet<String>> = memories
            .iter()
            .map(|m| {
                m.content
                    .to_lowercase()
                    .split_whitespace()
                    .filter(|w| w.len() > 2)
                    .map(|s| s.to_string())
                    .collect()
            })
            .collect();

        // Track which memories have been clustered
        let mut clustered: Vec<bool> = vec![false; memories.len()];
        let mut clusters: Vec<Vec<&'a MemoryEntry>> = vec![];

        for i in 0..memories.len() {
            if clustered[i] {
                continue;
            }

            let mut cluster: Vec<&'a MemoryEntry> = vec![memories[i]];
            clustered[i] = true;

            // Find similar memories
            for j in (i + 1)..memories.len() {
                if clustered[j] {
                    continue;
                }

                // Also cluster by same content type
                if memories[i].content_type != memories[j].content_type {
                    continue;
                }

                // Calculate Jaccard similarity
                let set_a = &word_sets[i];
                let set_b = &word_sets[j];

                if set_a.is_empty() && set_b.is_empty() {
                    continue;
                }

                let intersection = set_a.intersection(set_b).count();
                let union = set_a.union(set_b).count();
                let similarity = if union > 0 {
                    intersection as f64 / union as f64
                } else {
                    0.0
                };

                if similarity >= threshold {
                    cluster.push(memories[j]);
                    clustered[j] = true;
                }
            }

            clusters.push(cluster);
        }

        clusters
    }

    /// Start periodic consolidation for a user
    pub async fn start_consolidation(
        self: Arc<Self>,
        user_id: String,
        config: Option<ConsolidationConfig>,
    ) {
        let _lock = self.operation_lock.lock().await;

        // Stop existing task if any
        self.stop_consolidation_inner(&user_id).await;

        let config = config.unwrap_or_else(|| self.default_config.clone());
        let interval_hours = config.interval_ms / (60 * 60 * 1000);

        info!(
            user_id = %user_id,
            interval_hours = interval_hours,
            "Starting periodic consolidation"
        );

        let service = Arc::clone(&self);
        let u_id = user_id.clone();
        let cfg = config.clone();

        let handle = tokio::spawn(async move {
            // Initial run after a short delay
            tokio::time::sleep(Duration::from_secs(60)).await;

            let mut consolidation_interval = interval(Duration::from_millis(cfg.interval_ms));

            loop {
                consolidation_interval.tick().await;

                match service.run_consolidation(&u_id, &cfg) {
                    Ok(result) => {
                        if result.total_affected > 0 {
                            info!(
                                user_id = %u_id,
                                total_affected = result.total_affected,
                                "Consolidation cycle completed with changes"
                            );
                        }
                    }
                    Err(e) => {
                        error!(
                            user_id = %u_id,
                            error = %e,
                            "Consolidation cycle failed"
                        );
                    }
                }
            }
        });

        let mut tasks = self.active_tasks.write().await;
        tasks.insert(
            user_id.clone(),
            ConsolidationHandle {
                abort_handle: handle.abort_handle(),
                user_id,
                config,
            },
        );
    }

    /// Stop consolidation for a user (internal, assumes lock is held)
    async fn stop_consolidation_inner(&self, user_id: &str) {
        let mut tasks = self.active_tasks.write().await;
        if let Some(handle) = tasks.remove(user_id) {
            handle.abort_handle.abort();
            info!(user_id = %user_id, "Stopped consolidation");
        }
    }

    /// Stop consolidation for a user
    pub async fn stop_consolidation(&self, user_id: &str) {
        let _lock = self.operation_lock.lock().await;
        self.stop_consolidation_inner(user_id).await;
    }

    /// Check if consolidation is active for a user
    pub async fn is_consolidation_active(&self, user_id: &str) -> bool {
        let tasks = self.active_tasks.read().await;
        tasks.contains_key(user_id)
    }

    /// Get all users with active consolidation
    pub async fn get_active_consolidations(&self) -> Vec<String> {
        let tasks = self.active_tasks.read().await;
        tasks.keys().cloned().collect()
    }

    /// Stop all consolidation tasks
    pub async fn stop_all_consolidation(&self) {
        let _lock = self.operation_lock.lock().await;
        let mut tasks = self.active_tasks.write().await;

        for (user_id, handle) in tasks.drain() {
            handle.abort_handle.abort();
            info!(user_id = %user_id, "Stopped consolidation");
        }
    }

    /// Run consolidation once for a user (manual trigger)
    pub fn consolidate_now(
        &self,
        user_id: &str,
        config: Option<ConsolidationConfig>,
    ) -> Result<ConsolidationResult, String> {
        let config = config.unwrap_or_else(|| self.default_config.clone());
        self.run_consolidation(user_id, &config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_defaults() {
        let config = ConsolidationConfig::default();
        assert_eq!(config.interval_ms, 4 * 60 * 60 * 1000);
        assert!(config.auto_promotion);
        assert!(config.auto_demotion);
        assert!((config.relevance_decay_rate - 0.02).abs() < 0.001);
    }

    #[test]
    fn test_result_default() {
        let result = ConsolidationResult::default();
        assert_eq!(result.expired_deleted, 0);
        assert_eq!(result.promoted, 0);
        assert_eq!(result.demoted, 0);
        assert_eq!(result.total_affected, 0);
    }
}
