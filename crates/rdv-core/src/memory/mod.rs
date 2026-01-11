//! Hierarchical Working Memory system for AI agents.
//!
//! Provides a three-tier memory architecture inspired by cognitive computing principles:
//!
//! - **Short-term memory**: Fast-decaying observations and recent context (minutes)
//! - **Working memory**: Active task context and important patterns (hours to days)
//! - **Long-term memory**: Consolidated knowledge and learned patterns (permanent)
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │                     Memory Manager                              │
//! │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
//! │  │ Short-Term  │  │   Working   │  │       Long-Term         │ │
//! │  │ (minutes)   │─▶│  (hours)    │─▶│  (permanent)            │ │
//! │  │ TTL: 5min   │  │ TTL: 24h    │  │ No TTL, consolidated    │ │
//! │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
//! │         │                │                    │                │
//! │         └────────────────┴────────────────────┘                │
//! │                          │                                      │
//! │                    MemoryStore                                 │
//! └─────────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Usage
//!
//! ```ignore
//! use rdv_core::memory::{MemoryManager, MemoryConfig};
//!
//! let config = MemoryConfig::default();
//! let manager = MemoryManager::new(db, config);
//!
//! // Store a short-term observation
//! manager.remember("User prefers dark mode", ContentType::Observation).await?;
//!
//! // Hold something in working memory
//! manager.hold("Current task: implement memory system", ContentType::Context).await?;
//!
//! // Learn a permanent pattern
//! manager.learn("This codebase uses Clean Architecture", ContentType::Pattern).await?;
//!
//! // Retrieve relevant memories
//! let memories = manager.recall("architecture patterns", 5).await?;
//! ```

mod traits;
mod store;
mod consolidation;

pub use traits::*;
pub use store::*;
pub use consolidation::*;

use crate::types::{MemoryTier, MemoryQueryFilter};

/// Configuration for the memory system.
#[derive(Debug, Clone)]
pub struct MemoryConfig {
    /// Default TTL for short-term memories in seconds (default: 5 minutes).
    pub short_term_ttl: i32,
    /// Default TTL for working memories in seconds (default: 24 hours).
    pub working_ttl: i32,
    /// Maximum entries per tier per user.
    pub max_entries_per_tier: usize,
    /// Minimum relevance score for retrieval (0.0 - 1.0).
    pub min_relevance: f64,
    /// Minimum confidence for consolidation (0.0 - 1.0).
    pub consolidation_threshold: f64,
    /// Enable automatic tier promotion based on access patterns.
    pub auto_promotion: bool,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            short_term_ttl: 300,           // 5 minutes
            working_ttl: 86400,            // 24 hours
            max_entries_per_tier: 1000,
            min_relevance: 0.3,
            consolidation_threshold: 0.8,
            auto_promotion: true,
        }
    }
}

/// Content type for memory entries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentType {
    /// Raw observation from agent activity.
    Observation,
    /// Context about current task or session.
    Context,
    /// Learned pattern or convention.
    Pattern,
    /// Skill or procedure.
    Skill,
    /// Error or warning.
    Error,
    /// User preference.
    Preference,
    /// Code snippet or example.
    Code,
    /// Documentation or note.
    Documentation,
}

impl ContentType {
    /// Convert to string for storage.
    pub fn as_str(&self) -> &'static str {
        match self {
            ContentType::Observation => "observation",
            ContentType::Context => "context",
            ContentType::Pattern => "pattern",
            ContentType::Skill => "skill",
            ContentType::Error => "error",
            ContentType::Preference => "preference",
            ContentType::Code => "code",
            ContentType::Documentation => "documentation",
        }
    }

    /// Parse from string.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "observation" => Some(ContentType::Observation),
            "context" => Some(ContentType::Context),
            "pattern" => Some(ContentType::Pattern),
            "skill" => Some(ContentType::Skill),
            "error" => Some(ContentType::Error),
            "preference" => Some(ContentType::Preference),
            "code" => Some(ContentType::Code),
            "documentation" => Some(ContentType::Documentation),
            _ => None,
        }
    }
}

/// Options for storing memories.
#[derive(Debug, Clone, Default)]
pub struct StoreOptions {
    /// Optional name/title for the memory.
    pub name: Option<String>,
    /// Optional description.
    pub description: Option<String>,
    /// Optional task ID to link to.
    pub task_id: Option<String>,
    /// Initial priority (higher = more important).
    pub priority: Option<i32>,
    /// Initial confidence score (0.0 - 1.0).
    pub confidence: Option<f64>,
    /// Initial relevance score (0.0 - 1.0).
    pub relevance: Option<f64>,
    /// Custom TTL in seconds (overrides tier default).
    pub ttl: Option<i32>,
    /// Additional metadata as JSON.
    pub metadata: Option<serde_json::Value>,
}

/// Options for retrieving memories.
#[derive(Debug, Clone, Default)]
pub struct RecallOptions {
    /// Only retrieve from specific tier.
    pub tier: Option<MemoryTier>,
    /// Only retrieve specific content type.
    pub content_type: Option<ContentType>,
    /// Only retrieve memories linked to this task.
    pub task_id: Option<String>,
    /// Minimum relevance score.
    pub min_relevance: Option<f64>,
    /// Minimum confidence score.
    pub min_confidence: Option<f64>,
    /// Maximum number of results.
    pub limit: Option<usize>,
}

impl From<RecallOptions> for MemoryQueryFilter {
    fn from(opts: RecallOptions) -> Self {
        Self {
            user_id: String::new(), // Must be set by caller
            session_id: None,
            folder_id: None,
            tier: opts.tier.map(|t| t.to_string()),
            content_type: opts.content_type.map(|ct| ct.as_str().to_string()),
            task_id: opts.task_id,
            min_relevance: opts.min_relevance,
            min_confidence: opts.min_confidence,
            limit: opts.limit,
        }
    }
}

/// Statistics about memory usage.
#[derive(Debug, Clone, Default)]
pub struct MemoryStats {
    /// Total entries across all tiers.
    pub total: i64,
    /// Short-term memory entries.
    pub short_term: i64,
    /// Working memory entries.
    pub working: i64,
    /// Long-term memory entries.
    pub long_term: i64,
}

impl From<std::collections::HashMap<String, i64>> for MemoryStats {
    fn from(map: std::collections::HashMap<String, i64>) -> Self {
        Self {
            total: map.get("total").copied().unwrap_or(0),
            short_term: map.get("short_term").copied().unwrap_or(0),
            working: map.get("working").copied().unwrap_or(0),
            long_term: map.get("long_term").copied().unwrap_or(0),
        }
    }
}
