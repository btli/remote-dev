//! Hierarchical Working Memory System
//!
//! Implements a three-tier memory architecture:
//! - Short-term: Recent commands, tool results, observations (TTL-based)
//! - Working: Current task context, active files, hypotheses (priority-based)
//! - Long-term: Project knowledge, conventions, patterns (confidence-based)
//!
//! # Architecture
//!
//! Memory flows upward through consolidation:
//! 1. New entries start in short-term memory
//! 2. Frequently accessed entries are promoted to working memory
//! 3. Stable patterns are consolidated into long-term knowledge
//!
//! Retrieval searches across all tiers with relevance weighting.

mod types;
mod store;
mod hierarchical;
pub mod embeddings;

pub mod migrations;

// Re-export public types
pub use types::{
    MemoryEntry, MemoryTier, MemoryContentType,
    ShortTermEntry, WorkingEntry, LongTermEntry,
    ShortTermMetadata, WorkingMetadata, LongTermMetadata,
    LongTermApplicability, StoreMemoryInput, MemoryQuery,
    MemoryResult, ConsolidationResult, PruneOptions, MemoryStats,
    SemanticSearchQuery, SemanticSearchResult,
};

pub use store::MemoryStore;
pub use hierarchical::HierarchicalMemory;
