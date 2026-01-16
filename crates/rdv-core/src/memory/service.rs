//! Memory consolidation service.
//!
//! Provides periodic memory management operations:
//! - Tier promotion based on access patterns
//! - Consolidation of similar memories
//! - Pruning of expired and irrelevant entries
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │                  MemoryConsolidationService                     │
//! │  ┌─────────────────────────────────────────────────────────────┐│
//! │  │                    Consolidation Cycle                       ││
//! │  │  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ ││
//! │  │  │   Prune    │─▶│  Promote   │─▶│     Consolidate        │ ││
//! │  │  │  expired   │  │   tiers    │  │  similar memories      │ ││
//! │  │  └────────────┘  └────────────┘  └────────────────────────┘ ││
//! │  └─────────────────────────────────────────────────────────────┘│
//! │                           ↓                                      │
//! │                    MemoryStore                                  │
//! └─────────────────────────────────────────────────────────────────┘
//! ```

use crate::error::Result;
use crate::types::{MemoryEntry, MemoryTier};

use super::{
    are_similar, calculate_relevance_boost, merge_content, suggest_demotion, suggest_promotion,
    ConsolidationCriteria, ConsolidationStrategy, MemoryConfig, MemoryStore, RecallOptions,
    StoreOptions,
};

use std::collections::HashMap;

/// Configuration for the consolidation service.
#[derive(Debug, Clone)]
pub struct ConsolidationServiceConfig {
    /// How often to run consolidation (in seconds).
    pub interval_secs: u64,
    /// Maximum entries to process per cycle.
    pub batch_size: usize,
    /// Minimum age before considering entry for consolidation (seconds).
    pub min_age_secs: i64,
    /// Strategy for merging similar memories.
    pub merge_strategy: ConsolidationStrategy,
    /// Criteria for determining similarity.
    pub similarity_criteria: ConsolidationCriteria,
    /// Enable automatic tier promotion.
    pub auto_promotion: bool,
    /// Enable automatic tier demotion.
    pub auto_demotion: bool,
    /// Prune entries with relevance below this threshold.
    pub prune_relevance_threshold: f64,
}

impl Default for ConsolidationServiceConfig {
    fn default() -> Self {
        Self {
            interval_secs: 300, // 5 minutes
            batch_size: 100,
            min_age_secs: 300, // 5 minutes
            merge_strategy: ConsolidationStrategy::UpdateRelevance,
            similarity_criteria: ConsolidationCriteria::default(),
            auto_promotion: true,
            auto_demotion: true,
            prune_relevance_threshold: 0.1,
        }
    }
}

/// Result of a consolidation cycle.
#[derive(Debug, Clone, Default)]
pub struct ConsolidationCycleResult {
    /// Number of expired entries pruned.
    pub pruned_expired: usize,
    /// Number of low-relevance entries pruned.
    pub pruned_irrelevant: usize,
    /// Number of entries promoted to higher tier.
    pub promoted: usize,
    /// Number of entries demoted to lower tier.
    pub demoted: usize,
    /// Number of entries consolidated (merged).
    pub consolidated: usize,
    /// Number of entries with updated relevance scores.
    pub relevance_updated: usize,
    /// Errors encountered during the cycle.
    pub errors: Vec<String>,
}

impl ConsolidationCycleResult {
    /// Check if any work was done.
    pub fn has_changes(&self) -> bool {
        self.pruned_expired > 0
            || self.pruned_irrelevant > 0
            || self.promoted > 0
            || self.demoted > 0
            || self.consolidated > 0
            || self.relevance_updated > 0
    }

    /// Total entries affected.
    pub fn total_affected(&self) -> usize {
        self.pruned_expired
            + self.pruned_irrelevant
            + self.promoted
            + self.demoted
            + self.consolidated
            + self.relevance_updated
    }
}

/// Memory consolidation service.
///
/// Runs periodic memory management operations for a user's memory space.
pub struct MemoryConsolidationService<S: MemoryStore> {
    store: S,
    config: ConsolidationServiceConfig,
    _memory_config: MemoryConfig,
}

impl<S: MemoryStore> MemoryConsolidationService<S> {
    /// Create a new consolidation service.
    pub fn new(store: S, config: ConsolidationServiceConfig, memory_config: MemoryConfig) -> Self {
        Self {
            store,
            config,
            _memory_config: memory_config,
        }
    }

    /// Run a single consolidation cycle for a user.
    ///
    /// This performs:
    /// 1. Pruning of expired entries
    /// 2. Pruning of irrelevant entries
    /// 3. Tier promotion based on access patterns
    /// 4. Tier demotion for stale entries
    /// 5. Consolidation of similar memories
    pub fn run_cycle(&self, user_id: &str) -> Result<ConsolidationCycleResult> {
        let mut result = ConsolidationCycleResult::default();

        // 1. Prune expired entries
        match self.store.cleanup_expired() {
            Ok(count) => result.pruned_expired = count,
            Err(e) => result.errors.push(format!("Prune expired failed: {}", e)),
        }

        // 2. Prune irrelevant entries
        match self.prune_irrelevant(user_id) {
            Ok(count) => result.pruned_irrelevant = count,
            Err(e) => result.errors.push(format!("Prune irrelevant failed: {}", e)),
        }

        // 3. Promote entries based on access patterns
        if self.config.auto_promotion {
            match self.promote_entries(user_id) {
                Ok(count) => result.promoted = count,
                Err(e) => result.errors.push(format!("Promotion failed: {}", e)),
            }
        }

        // 4. Demote stale entries
        if self.config.auto_demotion {
            match self.demote_entries(user_id) {
                Ok(count) => result.demoted = count,
                Err(e) => result.errors.push(format!("Demotion failed: {}", e)),
            }
        }

        // 5. Consolidate similar memories
        match self.consolidate_similar(user_id) {
            Ok((consolidated, relevance_updated)) => {
                result.consolidated = consolidated;
                result.relevance_updated = relevance_updated;
            }
            Err(e) => result.errors.push(format!("Consolidation failed: {}", e)),
        }

        Ok(result)
    }

    /// Prune entries with very low relevance.
    fn prune_irrelevant(&self, user_id: &str) -> Result<usize> {
        let options = RecallOptions::default();
        let entries = self.store.query(user_id, None, None, &options)?;
        let mut pruned = 0;

        for entry in entries {
            let relevance = entry.relevance.unwrap_or(0.5);
            let confidence = entry.confidence.unwrap_or(0.5);
            let access_count = entry.access_count;

            // Only prune if:
            // - Relevance is very low
            // - Confidence is low
            // - Not recently accessed (access_count > 0 means it's been useful)
            if relevance < self.config.prune_relevance_threshold
                && confidence < 0.3
                && access_count == 0
            {
                // Don't prune long-term memories without explicit action
                if entry.tier.parse::<MemoryTier>().ok() != Some(MemoryTier::LongTerm) {
                    if let Err(e) = self.store.delete(&entry.id) {
                        tracing::warn!("Failed to prune irrelevant entry {}: {}", entry.id, e);
                    } else {
                        pruned += 1;
                    }
                }
            }
        }

        Ok(pruned)
    }

    /// Promote entries to higher tiers based on access patterns.
    fn promote_entries(&self, user_id: &str) -> Result<usize> {
        let options = RecallOptions::default();
        let entries = self.store.query(user_id, None, None, &options)?;
        let mut promoted = 0;

        for entry in entries.iter().take(self.config.batch_size) {
            if let Some(new_tier) = suggest_promotion(entry) {
                if let Err(e) = self.store.update_tier(&entry.id, new_tier) {
                    tracing::warn!("Failed to promote entry {}: {}", entry.id, e);
                } else {
                    promoted += 1;
                    tracing::debug!(
                        "Promoted {} from {} to {}",
                        entry.id,
                        entry.tier,
                        new_tier.to_string()
                    );
                }
            }
        }

        Ok(promoted)
    }

    /// Demote entries to lower tiers based on relevance.
    fn demote_entries(&self, user_id: &str) -> Result<usize> {
        let options = RecallOptions::default();
        let entries = self.store.query(user_id, None, None, &options)?;
        let mut demoted = 0;

        for entry in entries.iter().take(self.config.batch_size) {
            if let Some(new_tier) = suggest_demotion(entry) {
                if let Err(e) = self.store.update_tier(&entry.id, new_tier) {
                    tracing::warn!("Failed to demote entry {}: {}", entry.id, e);
                } else {
                    demoted += 1;
                    tracing::debug!(
                        "Demoted {} from {} to {}",
                        entry.id,
                        entry.tier,
                        new_tier.to_string()
                    );
                }
            }
        }

        Ok(demoted)
    }

    /// Consolidate similar memories.
    fn consolidate_similar(&self, user_id: &str) -> Result<(usize, usize)> {
        let options = RecallOptions::default();
        let entries = self.store.query(user_id, None, None, &options)?;

        // Group entries by tier and content type for consolidation
        let mut groups: HashMap<(String, String), Vec<MemoryEntry>> = HashMap::new();
        for entry in entries {
            let key = (entry.tier.clone(), entry.content_type.clone());
            groups.entry(key).or_default().push(entry);
        }

        let mut consolidated = 0;
        let mut relevance_updated = 0;

        for ((_tier, _content_type), entries) in groups {
            // Find similar entries within each group
            let mut processed: Vec<bool> = vec![false; entries.len()];

            for i in 0..entries.len() {
                if processed[i] {
                    continue;
                }

                let mut similar_group = vec![entries[i].clone()];
                processed[i] = true;

                for j in (i + 1)..entries.len() {
                    if processed[j] {
                        continue;
                    }

                    if are_similar(&entries[i], &entries[j], &self.config.similarity_criteria) {
                        similar_group.push(entries[j].clone());
                        processed[j] = true;
                    }
                }

                // If we found similar entries, consolidate them
                if similar_group.len() > 1 {
                    match self.merge_entries(user_id, &similar_group) {
                        Ok(merged_count) => {
                            consolidated += merged_count;
                        }
                        Err(e) => {
                            tracing::warn!("Failed to consolidate entries: {}", e);
                        }
                    }
                } else if similar_group.len() == 1 {
                    // Single entry - just update relevance if needed
                    let entry = &similar_group[0];
                    let boost = calculate_relevance_boost(1, entry.access_count);
                    if boost > 0.0 {
                        let current_relevance = entry.relevance.unwrap_or(0.5);
                        let new_relevance = (current_relevance + boost).min(1.0);

                        if self.store.update_relevance(&entry.id, new_relevance).is_ok() {
                            relevance_updated += 1;
                        }
                    }
                }
            }
        }

        Ok((consolidated, relevance_updated))
    }

    /// Merge a group of similar entries into one.
    fn merge_entries(&self, user_id: &str, entries: &[MemoryEntry]) -> Result<usize> {
        if entries.is_empty() {
            return Ok(0);
        }

        // Use the most recent entry as the base
        let base = entries.iter().max_by_key(|e| e.created_at).unwrap();

        // Calculate combined metrics
        let total_access: i32 = entries.iter().map(|e| e.access_count).sum();
        let avg_confidence: f64 =
            entries.iter().filter_map(|e| e.confidence).sum::<f64>() / entries.len() as f64;
        let max_relevance: f64 = entries
            .iter()
            .filter_map(|e| e.relevance)
            .fold(0.0, f64::max);

        // Calculate relevance boost from consolidation
        let relevance_boost = calculate_relevance_boost(entries.len(), total_access);

        // Merge content based on strategy
        let merged_content = merge_content(entries, self.config.merge_strategy);

        // Parse tier
        let tier = base
            .tier
            .parse::<MemoryTier>()
            .unwrap_or(MemoryTier::Working);

        // Create merged entry
        let store_options = StoreOptions {
            name: base.name.clone(),
            description: base.description.clone(),
            task_id: base.task_id.clone(),
            priority: base.priority,
            confidence: Some(avg_confidence),
            relevance: Some((max_relevance + relevance_boost).min(1.0)),
            ttl: base.ttl_seconds,
            metadata: base
                .metadata_json
                .as_ref()
                .and_then(|s| serde_json::from_str(s).ok()),
        };

        // Insert merged entry
        self.store.store(
            user_id,
            base.session_id.as_deref(),
            base.folder_id.as_deref(),
            tier,
            &base.content_type,
            &merged_content,
            &store_options,
        )?;

        // Delete original entries (except the base, which we keep for reference)
        let mut deleted = 0;
        for entry in entries {
            if entry.id != base.id {
                if self.store.delete(&entry.id).is_ok() {
                    deleted += 1;
                }
            }
        }

        Ok(deleted)
    }

    /// Get the service configuration.
    pub fn config(&self) -> &ConsolidationServiceConfig {
        &self.config
    }

    /// Update the service configuration.
    pub fn set_config(&mut self, config: ConsolidationServiceConfig) {
        self.config = config;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_consolidation_cycle_result() {
        let result = ConsolidationCycleResult {
            pruned_expired: 5,
            pruned_irrelevant: 3,
            promoted: 2,
            demoted: 1,
            consolidated: 4,
            relevance_updated: 10,
            errors: vec![],
        };

        assert!(result.has_changes());
        assert_eq!(result.total_affected(), 25);
    }

    #[test]
    fn test_consolidation_cycle_result_empty() {
        let result = ConsolidationCycleResult::default();

        assert!(!result.has_changes());
        assert_eq!(result.total_affected(), 0);
    }

    #[test]
    fn test_consolidation_service_config_default() {
        let config = ConsolidationServiceConfig::default();

        assert_eq!(config.interval_secs, 300);
        assert_eq!(config.batch_size, 100);
        assert!(config.auto_promotion);
        assert!(config.auto_demotion);
    }
}
