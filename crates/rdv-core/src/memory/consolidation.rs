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

    /// Helper to create a test memory entry
    fn create_test_entry(
        id: &str,
        tier: &str,
        content: &str,
        content_hash: &str,
        confidence: f64,
        relevance: f64,
        access_count: i32,
        created_at: i64,
    ) -> MemoryEntry {
        MemoryEntry {
            id: id.to_string(),
            user_id: "test".to_string(),
            session_id: Some("session-1".to_string()),
            folder_id: Some("folder-1".to_string()),
            tier: tier.to_string(),
            content_type: "observation".to_string(),
            name: None,
            description: None,
            content: content.to_string(),
            content_hash: content_hash.to_string(),
            embedding_id: None,
            task_id: None,
            priority: None,
            confidence: Some(confidence),
            relevance: Some(relevance),
            ttl_seconds: None,
            access_count,
            last_accessed_at: created_at,
            source_sessions_json: None,
            metadata_json: None,
            created_at,
            updated_at: created_at,
            expires_at: None,
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Relevance Boost Tests
    // ─────────────────────────────────────────────────────────────────────────────

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
    fn test_relevance_boost_cap() {
        // Very high values should still be capped at 0.3
        let boost = calculate_relevance_boost(100, 1000);
        assert!(boost <= 0.3);
    }

    #[test]
    fn test_relevance_boost_zero_access() {
        // Zero access produces -inf due to ln(0) = -inf
        // After min(0.3) cap, result is capped to 0.3 or remains -inf
        let boost = calculate_relevance_boost(1, 0);
        // ln(0) = -inf, -inf / 20 = -inf, (frequency_factor + -inf) = -inf
        // min(-inf, 0.3) = -inf (min picks smaller value)
        assert!(boost.is_infinite() && boost < 0.0);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Merge Content Strategy Tests
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_merge_content_strategies() {
        let entries = vec![
            create_test_entry("1", "short_term", "First observation", "hash1", 0.5, 0.5, 1, 1000),
            create_test_entry("2", "short_term", "Second observation", "hash2", 0.7, 0.8, 3, 2000),
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

    #[test]
    fn test_merge_content_empty_entries() {
        let entries: Vec<MemoryEntry> = vec![];

        let latest = merge_content(&entries, ConsolidationStrategy::KeepLatest);
        assert!(latest.is_empty());

        let merged = merge_content(&entries, ConsolidationStrategy::Merge);
        assert!(merged.is_empty());
    }

    #[test]
    fn test_merge_content_single_entry() {
        let entries = vec![
            create_test_entry("1", "short_term", "Only entry", "hash1", 0.5, 0.5, 1, 1000),
        ];

        let latest = merge_content(&entries, ConsolidationStrategy::KeepLatest);
        assert_eq!(latest, "Only entry");

        let merged = merge_content(&entries, ConsolidationStrategy::Merge);
        assert_eq!(merged, "Only entry");
    }

    #[test]
    fn test_merge_deduplicates_identical_hashes() {
        let entries = vec![
            create_test_entry("1", "short_term", "Same content", "same_hash", 0.5, 0.5, 1, 1000),
            create_test_entry("2", "short_term", "Same content", "same_hash", 0.6, 0.6, 2, 2000),
        ];

        let merged = merge_content(&entries, ConsolidationStrategy::Merge);
        // Should only have one occurrence despite two entries
        assert_eq!(merged.matches("Same content").count(), 1);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Similarity Detection Tests
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_are_similar_identical_hash() {
        let a = create_test_entry("1", "short_term", "Content A", "same_hash", 0.5, 0.5, 1, 1000);
        let b = create_test_entry("2", "short_term", "Content B", "same_hash", 0.5, 0.5, 1, 2000);

        let criteria = ConsolidationCriteria::default();
        assert!(are_similar(&a, &b, &criteria));
    }

    #[test]
    fn test_are_similar_substring_match() {
        let a = create_test_entry("1", "short_term", "API endpoint error in authentication", "hash1", 0.5, 0.5, 1, 1000);
        let b = create_test_entry("2", "short_term", "API endpoint error in authentication module", "hash2", 0.5, 0.5, 1, 2000);

        let criteria = ConsolidationCriteria::default();
        assert!(are_similar(&a, &b, &criteria));
    }

    #[test]
    fn test_are_similar_high_word_overlap() {
        let a = create_test_entry("1", "short_term", "Error handling in user authentication service", "hash1", 0.5, 0.5, 1, 1000);
        let b = create_test_entry("2", "short_term", "Error handling in user auth service module", "hash2", 0.5, 0.5, 1, 2000);

        let criteria = ConsolidationCriteria {
            similarity_threshold: 0.5, // Lower threshold for this test
            ..Default::default()
        };
        assert!(are_similar(&a, &b, &criteria));
    }

    #[test]
    fn test_are_similar_different_sessions_allowed() {
        let mut a = create_test_entry("1", "short_term", "Same content", "hash1", 0.5, 0.5, 1, 1000);
        let mut b = create_test_entry("2", "short_term", "Same content", "hash1", 0.5, 0.5, 1, 2000);
        a.session_id = Some("session-1".to_string());
        b.session_id = Some("session-2".to_string());

        let criteria = ConsolidationCriteria {
            cross_session: true,
            ..Default::default()
        };
        assert!(are_similar(&a, &b, &criteria));
    }

    #[test]
    fn test_are_similar_different_sessions_blocked() {
        let mut a = create_test_entry("1", "short_term", "Same content", "hash1", 0.5, 0.5, 1, 1000);
        let mut b = create_test_entry("2", "short_term", "Same content", "hash2", 0.5, 0.5, 1, 2000);
        a.session_id = Some("session-1".to_string());
        b.session_id = Some("session-2".to_string());

        let criteria = ConsolidationCriteria {
            cross_session: false,
            ..Default::default()
        };
        assert!(!are_similar(&a, &b, &criteria));
    }

    #[test]
    fn test_are_similar_age_difference_blocked() {
        let a = create_test_entry("1", "short_term", "Same content", "hash1", 0.5, 0.5, 1, 1000);
        // 8 days later (in milliseconds)
        let b = create_test_entry("2", "short_term", "Same content", "hash2", 0.5, 0.5, 1, 1000 + 8 * 86400 * 1000);

        let criteria = ConsolidationCriteria {
            max_age_diff: Some(7 * 86400), // 7 days
            ..Default::default()
        };
        assert!(!are_similar(&a, &b, &criteria));
    }

    #[test]
    fn test_are_similar_empty_content() {
        let a = create_test_entry("1", "short_term", "", "hash1", 0.5, 0.5, 1, 1000);
        let b = create_test_entry("2", "short_term", "", "hash2", 0.5, 0.5, 1, 2000);

        let criteria = ConsolidationCriteria::default();
        // Empty strings are substring of each other, so they ARE similar
        // This is the current implementation behavior
        assert!(are_similar(&a, &b, &criteria));
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Promotion Suggestion Tests
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_suggest_promotion_short_to_working() {
        let entry = create_test_entry("1", "short_term", "Content", "hash", 0.8, 0.5, 5, 1000);

        let result = suggest_promotion(&entry);
        assert_eq!(result, Some(crate::types::MemoryTier::Working));
    }

    #[test]
    fn test_suggest_promotion_working_to_long() {
        let entry = create_test_entry("1", "working", "Content", "hash", 0.9, 0.8, 10, 1000);

        let result = suggest_promotion(&entry);
        assert_eq!(result, Some(crate::types::MemoryTier::LongTerm));
    }

    #[test]
    fn test_suggest_promotion_long_term_no_promotion() {
        let entry = create_test_entry("1", "long_term", "Content", "hash", 0.95, 0.9, 20, 1000);

        let result = suggest_promotion(&entry);
        assert_eq!(result, None); // Already at top tier
    }

    #[test]
    fn test_suggest_promotion_low_confidence_no_promotion() {
        let entry = create_test_entry("1", "short_term", "Content", "hash", 0.3, 0.5, 1, 1000);

        let result = suggest_promotion(&entry);
        assert_eq!(result, None);
    }

    #[test]
    fn test_suggest_promotion_high_confidence_triggers() {
        let entry = create_test_entry("1", "short_term", "Content", "hash", 0.75, 0.5, 1, 1000);

        let result = suggest_promotion(&entry);
        assert_eq!(result, Some(crate::types::MemoryTier::Working));
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Demotion Suggestion Tests
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_suggest_demotion_long_to_working() {
        let entry = create_test_entry("1", "long_term", "Content", "hash", 0.1, 0.1, 0, 1000);

        let result = suggest_demotion(&entry);
        assert_eq!(result, Some(crate::types::MemoryTier::Working));
    }

    #[test]
    fn test_suggest_demotion_working_to_short() {
        let entry = create_test_entry("1", "working", "Content", "hash", 0.15, 0.15, 0, 1000);

        let result = suggest_demotion(&entry);
        assert_eq!(result, Some(crate::types::MemoryTier::ShortTerm));
    }

    #[test]
    fn test_suggest_demotion_short_term_returns_none() {
        let entry = create_test_entry("1", "short_term", "Content", "hash", 0.1, 0.1, 0, 1000);

        let result = suggest_demotion(&entry);
        assert_eq!(result, None); // Will expire naturally
    }

    #[test]
    fn test_suggest_demotion_high_relevance_no_demotion() {
        let entry = create_test_entry("1", "long_term", "Content", "hash", 0.1, 0.8, 0, 1000);

        let result = suggest_demotion(&entry);
        assert_eq!(result, None); // High relevance protects
    }

    #[test]
    fn test_suggest_demotion_high_confidence_no_demotion() {
        let entry = create_test_entry("1", "long_term", "Content", "hash", 0.8, 0.1, 0, 1000);

        let result = suggest_demotion(&entry);
        assert_eq!(result, None); // High confidence protects
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Consolidation Criteria Tests
    // ─────────────────────────────────────────────────────────────────────────────

    #[test]
    fn test_consolidation_criteria_defaults() {
        let criteria = ConsolidationCriteria::default();

        assert_eq!(criteria.similarity_threshold, 0.8);
        assert!(criteria.cross_session);
        assert!(!criteria.cross_folder);
        assert_eq!(criteria.max_age_diff, Some(86400 * 7)); // 7 days
    }

    #[test]
    fn test_consolidation_strategy_variants() {
        // Ensure all variants are distinct
        assert_ne!(ConsolidationStrategy::KeepLatest, ConsolidationStrategy::Merge);
        assert_ne!(ConsolidationStrategy::Merge, ConsolidationStrategy::UpdateRelevance);
        assert_ne!(ConsolidationStrategy::KeepLatest, ConsolidationStrategy::UpdateRelevance);
    }
}
