//! Memory Type Definitions
//!
//! Defines the core types for the hierarchical memory system.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Memory tier (short-term, working, long-term)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryTier {
    ShortTerm,
    Working,
    LongTerm,
}

impl MemoryTier {
    /// Convert from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "short_term" => Some(Self::ShortTerm),
            "working" => Some(Self::Working),
            "long_term" => Some(Self::LongTerm),
            _ => None,
        }
    }

    /// Convert to string
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ShortTerm => "short_term",
            Self::Working => "working",
            Self::LongTerm => "long_term",
        }
    }
}

impl std::fmt::Display for MemoryTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Memory content type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryContentType {
    // Short-term types
    Command,
    ToolResult,
    Observation,
    // Working types
    FileContext,
    Hypothesis,
    Plan,
    // Long-term types
    Convention,
    Pattern,
    Gotcha,
    Skill,
}

impl MemoryContentType {
    /// Get the appropriate tier for this content type
    pub fn default_tier(&self) -> MemoryTier {
        match self {
            Self::Command | Self::ToolResult | Self::Observation => MemoryTier::ShortTerm,
            Self::FileContext | Self::Hypothesis | Self::Plan => MemoryTier::Working,
            Self::Convention | Self::Pattern | Self::Gotcha | Self::Skill => MemoryTier::LongTerm,
        }
    }

    /// Convert from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "command" => Some(Self::Command),
            "tool_result" => Some(Self::ToolResult),
            "observation" => Some(Self::Observation),
            "file_context" => Some(Self::FileContext),
            "hypothesis" => Some(Self::Hypothesis),
            "plan" => Some(Self::Plan),
            "convention" => Some(Self::Convention),
            "pattern" => Some(Self::Pattern),
            "gotcha" => Some(Self::Gotcha),
            "skill" => Some(Self::Skill),
            _ => None,
        }
    }

    /// Convert to string
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Command => "command",
            Self::ToolResult => "tool_result",
            Self::Observation => "observation",
            Self::FileContext => "file_context",
            Self::Hypothesis => "hypothesis",
            Self::Plan => "plan",
            Self::Convention => "convention",
            Self::Pattern => "pattern",
            Self::Gotcha => "gotcha",
            Self::Skill => "skill",
        }
    }
}

impl std::fmt::Display for MemoryContentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Base memory entry (common fields)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseMemoryEntry {
    pub id: String,
    pub session_id: String,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub tier: MemoryTier,
    pub content_type: MemoryContentType,
    pub content: String,
    pub content_hash: String,
    pub embedding_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_accessed_at: DateTime<Utc>,
    pub access_count: u32,
}

/// Short-term memory entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortTermEntry {
    #[serde(flatten)]
    pub base: BaseMemoryEntry,
    pub source: Option<String>,
    pub relevance: f64,
    pub ttl_seconds: u64,
    pub expires_at: DateTime<Utc>,
    pub metadata: ShortTermMetadata,
}

/// Short-term metadata
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ShortTermMetadata {
    pub command: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
    pub tags: Vec<String>,
}

/// Working memory entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkingEntry {
    #[serde(flatten)]
    pub base: BaseMemoryEntry,
    pub task_id: Option<String>,
    pub priority: i32,
    pub confidence: f64,
    pub metadata: WorkingMetadata,
}

/// Working memory metadata
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkingMetadata {
    pub file_path: Option<String>,
    pub line_range: Option<LineRange>,
    pub related_files: Vec<String>,
    pub depends_on: Vec<String>,
    pub status: Option<WorkingEntryStatus>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct LineRange {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkingEntryStatus {
    Active,
    Validated,
    Invalidated,
}

/// Long-term memory entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LongTermEntry {
    #[serde(flatten)]
    pub base: BaseMemoryEntry,
    pub name: String,
    pub description: String,
    pub confidence: f64,
    pub source_sessions: Vec<String>,
    pub applicability: LongTermApplicability,
    pub metadata: LongTermMetadata,
}

/// Long-term applicability conditions
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LongTermApplicability {
    pub project_types: Vec<String>,
    pub task_types: Vec<String>,
    pub file_patterns: Vec<String>,
    pub conditions: Vec<String>,
}

/// Long-term metadata
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LongTermMetadata {
    pub examples: Vec<String>,
    pub anti_patterns: Vec<String>,
    pub related_knowledge: Vec<String>,
    pub doc_links: Vec<String>,
    pub last_validated_at: Option<DateTime<Utc>>,
    pub success_count: u32,
    pub failure_count: u32,
}

/// Union type for all memory entries
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tier")]
pub enum MemoryEntry {
    #[serde(rename = "short_term")]
    ShortTerm(ShortTermEntry),
    #[serde(rename = "working")]
    Working(WorkingEntry),
    #[serde(rename = "long_term")]
    LongTerm(LongTermEntry),
}

impl MemoryEntry {
    /// Get the entry ID
    pub fn id(&self) -> &str {
        match self {
            Self::ShortTerm(e) => &e.base.id,
            Self::Working(e) => &e.base.id,
            Self::LongTerm(e) => &e.base.id,
        }
    }

    /// Get the tier
    pub fn tier(&self) -> MemoryTier {
        match self {
            Self::ShortTerm(_) => MemoryTier::ShortTerm,
            Self::Working(_) => MemoryTier::Working,
            Self::LongTerm(_) => MemoryTier::LongTerm,
        }
    }

    /// Get the content
    pub fn content(&self) -> &str {
        match self {
            Self::ShortTerm(e) => &e.base.content,
            Self::Working(e) => &e.base.content,
            Self::LongTerm(e) => &e.base.content,
        }
    }

    /// Get the base entry
    pub fn base(&self) -> &BaseMemoryEntry {
        match self {
            Self::ShortTerm(e) => &e.base,
            Self::Working(e) => &e.base,
            Self::LongTerm(e) => &e.base,
        }
    }
}

/// Input for storing a new memory entry
#[derive(Debug, Clone)]
pub struct StoreMemoryInput {
    pub session_id: String,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub tier: MemoryTier,
    pub content_type: MemoryContentType,
    pub content: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub source: Option<String>,
    pub task_id: Option<String>,
    pub priority: Option<i32>,
    pub confidence: Option<f64>,
    pub ttl_seconds: Option<u64>,
    pub metadata: Option<serde_json::Value>,
}

/// Query for retrieving memory entries
#[derive(Debug, Clone, Default)]
pub struct MemoryQuery {
    pub query: Option<String>,
    pub session_id: Option<String>,
    pub user_id: Option<String>,
    pub folder_id: Option<String>,
    pub tiers: Option<Vec<MemoryTier>>,
    pub content_types: Option<Vec<MemoryContentType>>,
    pub task_id: Option<String>,
    pub min_score: Option<f64>,
    pub limit: Option<usize>,
    pub include_expired: bool,
}

/// Semantic search query with embedding-based similarity
#[derive(Debug, Clone)]
pub struct SemanticSearchQuery {
    /// Natural language query text
    pub query: String,
    /// User ID (required)
    pub user_id: String,
    /// Optional folder scope
    pub folder_id: Option<String>,
    /// Optional session scope (searches session + folder + long_term)
    pub session_id: Option<String>,
    /// Filter by memory tiers
    pub tiers: Option<Vec<MemoryTier>>,
    /// Filter by content types
    pub content_types: Option<Vec<MemoryContentType>>,
    /// Minimum similarity score (0-1, default: 0.3)
    pub min_similarity: f64,
    /// Maximum results (default: 20)
    pub limit: usize,
    /// Include expired short-term entries
    pub include_expired: bool,
}

impl Default for SemanticSearchQuery {
    fn default() -> Self {
        Self {
            query: String::new(),
            user_id: String::new(),
            folder_id: None,
            session_id: None,
            tiers: None,
            content_types: None,
            min_similarity: 0.3,
            limit: 20,
            include_expired: false,
        }
    }
}

/// Semantic search result with similarity scoring
#[derive(Debug, Clone)]
pub struct SemanticSearchResult {
    /// Memory entry
    pub entry: MemoryEntry,
    /// Combined relevance score (0-1)
    pub score: f64,
    /// Semantic similarity component (0-1)
    pub semantic_score: f64,
    /// Tier weight component
    pub tier_weight: f64,
    /// Content type weight component
    pub type_weight: f64,
}

impl MemoryTier {
    /// Get weight for semantic search scoring
    /// Long-term memories are more valuable (proven patterns)
    pub fn weight(&self) -> f64 {
        match self {
            Self::LongTerm => 1.0,
            Self::Working => 0.8,
            Self::ShortTerm => 0.6,
        }
    }
}

impl MemoryContentType {
    /// Get weight for semantic search scoring
    /// Gotchas and patterns are most actionable
    pub fn weight(&self) -> f64 {
        match self {
            Self::Gotcha => 1.0,
            Self::Pattern => 0.9,
            Self::Convention => 0.85,
            Self::Skill => 0.8,
            Self::Plan => 0.75,
            Self::Hypothesis => 0.7,
            Self::Observation => 0.6,
            Self::FileContext => 0.5,
            Self::Command => 0.45,
            Self::ToolResult => 0.4,
        }
    }
}

/// Result from memory retrieval
#[derive(Debug, Clone)]
pub struct MemoryResult {
    pub entry: MemoryEntry,
    pub score: f64,
    pub reason: Option<String>,
}

/// Result from consolidation
#[derive(Debug, Clone, Default)]
pub struct ConsolidationResult {
    pub promoted_to_working: usize,
    pub consolidated_to_long_term: usize,
    pub pruned: usize,
    pub new_knowledge: Vec<LongTermEntry>,
    pub duration_ms: u64,
}

/// Options for pruning
#[derive(Debug, Clone, Default)]
pub struct PruneOptions {
    pub older_than_seconds: Option<u64>,
    pub max_relevance: Option<f64>,
    pub limit: Option<usize>,
    pub dry_run: bool,
}

/// Memory statistics
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MemoryStats {
    pub count_by_tier: std::collections::HashMap<String, usize>,
    pub count_by_type: std::collections::HashMap<String, usize>,
    pub avg_score_by_tier: std::collections::HashMap<String, f64>,
    pub storage_size_bytes: u64,
    pub last_consolidation_at: Option<DateTime<Utc>>,
    pub last_prune_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tier_conversion() {
        assert_eq!(MemoryTier::from_str("short_term"), Some(MemoryTier::ShortTerm));
        assert_eq!(MemoryTier::ShortTerm.as_str(), "short_term");
    }

    #[test]
    fn test_content_type_default_tier() {
        assert_eq!(MemoryContentType::Command.default_tier(), MemoryTier::ShortTerm);
        assert_eq!(MemoryContentType::FileContext.default_tier(), MemoryTier::Working);
        assert_eq!(MemoryContentType::Convention.default_tier(), MemoryTier::LongTerm);
    }
}
