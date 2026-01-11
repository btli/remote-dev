//! Memory consolidation utilities.
//!
//! Handles the process of promoting memories between tiers and
//! consolidating similar memories.

use crate::types::MemoryEntry;

/// Consolidation strategy for merging similar memories.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConsolidationStrategy {
    /// Keep the most recent memory, discard duplicates.
    KeepLatest,
    /// Merge content from all similar memories.
    Merge,
    /// Keep all memories, update relevance based on frequency.
    UpdateRelevance,
}

/// Criteria for determining if two memories should be consolidated.
#[derive(Debug, Clone)]
pub struct ConsolidationCriteria {
    /// Minimum similarity score (0.0 - 1.0) for content matching.
    pub similarity_threshold: f64,
    /// Whether to consolidate across different sessions.
    pub cross_session: bool,
    /// Whether to consolidate across different folders.
    pub cross_folder: bool,
    /// Maximum age difference in seconds for consolidation candidates.
    pub max_age_diff: Option<i64>,
}

impl Default for ConsolidationCriteria {
    fn default() -> Self {
        Self {
            similarity_threshold: 0.8,
            cross_session: true,
            cross_folder: false,
            max_age_diff: Some(86400 * 7), // 7 days
        }
    }
}

/// Result of a consolidation operation.
#[derive(Debug, Clone)]
pub struct ConsolidationResult {
    /// IDs of memories that were merged into a single memory.
    pub merged_ids: Vec<String>,
    /// ID of the resulting consolidated memory.
    pub consolidated_id: String,
    /// Relevance boost from consolidation.
    pub relevance_boost: f64,
}

/// Check if two memories are similar enough to consolidate.
///
/// Currently uses simple content hash comparison.
/// TODO: Implement semantic similarity with embeddings.
pub fn are_similar(a: &MemoryEntry, b: &MemoryEntry, criteria: &ConsolidationCriteria) -> bool {
    // Same content hash means identical content
    if a.content_hash == b.content_hash {
        return true;
    }

    // Check session/folder constraints
    if !criteria.cross_session && a.session_id != b.session_id {
        return false;
    }
    if !criteria.cross_folder && a.folder_id != b.folder_id {
        return false;
    }

    // Check age difference
    if let Some(max_diff) = criteria.max_age_diff {
        let age_diff = (a.created_at - b.created_at).abs();
        if age_diff > max_diff * 1000 {
            return false;
        }
    }

    // Simple substring matching for now
    // TODO: Use embeddings for semantic similarity
    let a_lower = a.content.to_lowercase();
    let b_lower = b.content.to_lowercase();

    // Check if one contains the other
    if a_lower.contains(&b_lower) || b_lower.contains(&a_lower) {
        return true;
    }

    // Check word overlap
    let a_words: std::collections::HashSet<&str> = a_lower.split_whitespace().collect();
    let b_words: std::collections::HashSet<&str> = b_lower.split_whitespace().collect();

    if a_words.is_empty() || b_words.is_empty() {
        return false;
    }

    let intersection = a_words.intersection(&b_words).count();
    let union = a_words.union(&b_words).count();
    let jaccard = intersection as f64 / union as f64;

    jaccard >= criteria.similarity_threshold
}

/// Calculate a relevance boost based on consolidation.
///
/// Memories that have been consolidated (appear frequently) get a boost.
pub fn calculate_relevance_boost(merged_count: usize, total_access: i32) -> f64 {
    let frequency_factor = (merged_count as f64).ln() / 10.0;
    let access_factor = (total_access as f64).ln() / 20.0;

    // Cap boost at 0.3
    (frequency_factor + access_factor).min(0.3)
}

/// Merge multiple memory entries into one.
///
/// Returns the merged content based on the strategy.
pub fn merge_content(entries: &[MemoryEntry], strategy: ConsolidationStrategy) -> String {
    match strategy {
        ConsolidationStrategy::KeepLatest => {
            entries
                .iter()
                .max_by_key(|e| e.created_at)
                .map(|e| e.content.clone())
                .unwrap_or_default()
        }
        ConsolidationStrategy::Merge => {
            // Deduplicate and join
            let mut seen = std::collections::HashSet::new();
            let mut parts = Vec::new();

            for entry in entries {
                if seen.insert(&entry.content_hash) {
                    parts.push(entry.content.as_str());
                }
            }

            parts.join("\n\n---\n\n")
        }
        ConsolidationStrategy::UpdateRelevance => {
            // Just use the most relevant one
            entries
                .iter()
                .max_by(|a, b| {
                    a.relevance.unwrap_or(0.5)
                        .partial_cmp(&b.relevance.unwrap_or(0.5))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|e| e.content.clone())
                .unwrap_or_default()
        }
    }
}

/// Determine which tier a memory should be promoted to based on metrics.
pub fn suggest_promotion(entry: &MemoryEntry) -> Option<crate::types::MemoryTier> {
    use crate::types::MemoryTier;

    let current_tier = entry.tier.parse::<MemoryTier>().ok()?;
    let access_count = entry.access_count;
    let confidence = entry.confidence.unwrap_or(0.5);
    let relevance = entry.relevance.unwrap_or(0.5);

    match current_tier {
        MemoryTier::ShortTerm => {
            // Promote to working if accessed multiple times
            if access_count >= 3 || confidence >= 0.7 {
                Some(MemoryTier::Working)
            } else {
                None
            }
        }
        MemoryTier::Working => {
            // Promote to long-term if high confidence and relevance
            if access_count >= 5 && confidence >= 0.8 && relevance >= 0.7 {
                Some(MemoryTier::LongTerm)
            } else {
                None
            }
        }
        MemoryTier::LongTerm => {
            // Already at top tier
            None
        }
    }
}

/// Determine if a memory should be demoted based on metrics.
pub fn suggest_demotion(entry: &MemoryEntry) -> Option<crate::types::MemoryTier> {
    use crate::types::MemoryTier;

    let current_tier = entry.tier.parse::<MemoryTier>().ok()?;
    let relevance = entry.relevance.unwrap_or(0.5);
    let confidence = entry.confidence.unwrap_or(0.5);

    // Only demote if both relevance and confidence are low
    if relevance < 0.2 && confidence < 0.3 {
        match current_tier {
            MemoryTier::LongTerm => Some(MemoryTier::Working),
            MemoryTier::Working => Some(MemoryTier::ShortTerm),
            MemoryTier::ShortTerm => None, // Will expire naturally
        }
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_relevance_boost() {
        // Single consolidation, low access
        assert!(calculate_relevance_boost(1, 1) < 0.1);

        // Multiple consolidations
        let boost = calculate_relevance_boost(5, 10);
        assert!(boost > 0.1);
        assert!(boost <= 0.3);
    }

    #[test]
    fn test_merge_content_strategies() {
        // Create test entries
        let entries = vec![
            MemoryEntry {
                id: "1".to_string(),
                user_id: "test".to_string(),
                session_id: None,
                folder_id: None,
                tier: "short_term".to_string(),
                content_type: "observation".to_string(),
                name: None,
                description: None,
                content: "First observation".to_string(),
                content_hash: "hash1".to_string(),
                embedding_id: None,
                task_id: None,
                priority: None,
                confidence: Some(0.5),
                relevance: Some(0.5),
                ttl_seconds: None,
                access_count: 1,
                last_accessed_at: 1000,
                source_sessions_json: None,
                metadata_json: None,
                created_at: 1000,
                updated_at: 1000,
                expires_at: None,
            },
            MemoryEntry {
                id: "2".to_string(),
                user_id: "test".to_string(),
                session_id: None,
                folder_id: None,
                tier: "short_term".to_string(),
                content_type: "observation".to_string(),
                name: None,
                description: None,
                content: "Second observation".to_string(),
                content_hash: "hash2".to_string(),
                embedding_id: None,
                task_id: None,
                priority: None,
                confidence: Some(0.7),
                relevance: Some(0.8),
                ttl_seconds: None,
                access_count: 3,
                last_accessed_at: 2000,
                source_sessions_json: None,
                metadata_json: None,
                created_at: 2000,
                updated_at: 2000,
                expires_at: None,
            },
        ];

        // Test KeepLatest
        let latest = merge_content(&entries, ConsolidationStrategy::KeepLatest);
        assert_eq!(latest, "Second observation");

        // Test Merge
        let merged = merge_content(&entries, ConsolidationStrategy::Merge);
        assert!(merged.contains("First observation"));
        assert!(merged.contains("Second observation"));

        // Test UpdateRelevance
        let best = merge_content(&entries, ConsolidationStrategy::UpdateRelevance);
        assert_eq!(best, "Second observation");
    }
}
