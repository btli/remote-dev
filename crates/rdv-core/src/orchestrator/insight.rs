//! Memory-enhanced insight generation for orchestrators.
//!
//! Generates insights with historical context from the memory system.
//! When a stall or error is detected, this module:
//! 1. Queries memory for similar past situations
//! 2. Retrieves what actions were suggested/taken
//! 3. Generates context-aware insights with recommendations

#[cfg(feature = "db")]
use crate::db::Database;
#[cfg(feature = "db")]
use crate::error::Result;
#[cfg(feature = "db")]
use crate::memory::{
    ContentType, DbMemoryStore, LongTermMemory, MemoryConfig, MemoryManager, RecallOptions,
    ShortTermMemory, StoreOptions, WorkingMemory,
};
#[cfg(feature = "db")]
use crate::types::MemoryEntry;
#[cfg(feature = "db")]
use std::sync::Arc;

/// Severity level for orchestrator insights.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsightSeverity {
    /// Informational - normal patterns observed.
    Info,
    /// Warning - potential issue detected.
    Warning,
    /// Error - definite problem requiring attention.
    Error,
    /// Critical - urgent issue requiring immediate action.
    Critical,
}

impl InsightSeverity {
    /// Convert to string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            InsightSeverity::Info => "info",
            InsightSeverity::Warning => "warning",
            InsightSeverity::Error => "error",
            InsightSeverity::Critical => "critical",
        }
    }

    /// Parse from string.
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "info" => Some(InsightSeverity::Info),
            "warning" => Some(InsightSeverity::Warning),
            "error" => Some(InsightSeverity::Error),
            "critical" => Some(InsightSeverity::Critical),
            _ => None,
        }
    }
}

/// Type of orchestrator insight.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InsightType {
    /// Agent session stalled - no progress detected.
    Stall,
    /// Error detected in session output.
    Error,
    /// Pattern observed - potential improvement.
    Pattern,
    /// Task completed successfully.
    TaskComplete,
    /// Session ended.
    SessionEnd,
}

impl InsightType {
    /// Convert to string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            InsightType::Stall => "stall",
            InsightType::Error => "error",
            InsightType::Pattern => "pattern",
            InsightType::TaskComplete => "task_complete",
            InsightType::SessionEnd => "session_end",
        }
    }
}

/// A suggested action for the user or orchestrator.
#[derive(Debug, Clone)]
pub struct SuggestedAction {
    /// Description of the action.
    pub description: String,
    /// Command to execute (if applicable).
    pub command: Option<String>,
    /// Confidence score (0.0 - 1.0).
    pub confidence: f64,
    /// Whether this action was successful in the past.
    pub historically_successful: bool,
    /// Number of times this action was used before.
    pub usage_count: usize,
}

/// Historical context from memory for an insight.
#[derive(Debug, Clone)]
pub struct HistoricalContext {
    /// Number of similar situations found in memory.
    pub similar_count: usize,
    /// Most relevant past memory entries.
    pub relevant_memories: Vec<MemoryReference>,
    /// Success rate of past resolutions.
    pub success_rate: f64,
    /// Common actions that worked.
    pub effective_actions: Vec<String>,
}

impl Default for HistoricalContext {
    fn default() -> Self {
        Self {
            similar_count: 0,
            relevant_memories: Vec::new(),
            success_rate: 0.0,
            effective_actions: Vec::new(),
        }
    }
}

/// Reference to a relevant memory entry.
#[derive(Debug, Clone)]
pub struct MemoryReference {
    /// Memory ID.
    pub id: String,
    /// Memory content summary.
    pub summary: String,
    /// Similarity score (0.0 - 1.0).
    pub similarity: f64,
    /// Timestamp when created.
    pub created_at: i64,
}

/// A memory-enhanced insight.
#[derive(Debug, Clone)]
pub struct EnhancedInsight {
    /// Unique insight ID.
    pub id: String,
    /// Insight type.
    pub insight_type: InsightType,
    /// Severity level.
    pub severity: InsightSeverity,
    /// Human-readable title.
    pub title: String,
    /// Detailed description.
    pub description: String,
    /// Session ID where this was detected.
    pub session_id: String,
    /// Folder ID (if applicable).
    pub folder_id: Option<String>,
    /// Historical context from memory.
    pub history: HistoricalContext,
    /// Suggested actions.
    pub suggested_actions: Vec<SuggestedAction>,
    /// Confidence score for this insight.
    pub confidence: f64,
    /// Timestamp.
    pub created_at: i64,
}

/// Service for generating memory-enhanced insights.
#[cfg(feature = "db")]
pub struct InsightGenerator {
    store: DbMemoryStore,
}

#[cfg(feature = "db")]
impl InsightGenerator {
    /// Create a new insight generator.
    pub fn new(db: Arc<Database>, config: MemoryConfig) -> Self {
        Self {
            store: DbMemoryStore::new(db, config),
        }
    }

    /// Create with default configuration.
    pub fn with_defaults(db: Arc<Database>) -> Self {
        Self::new(db, MemoryConfig::default())
    }

    /// Generate an insight for a stalled session.
    pub fn generate_stall_insight(
        &self,
        user_id: &str,
        session_id: &str,
        folder_id: Option<&str>,
        scrollback_content: &str,
        stall_duration_secs: u64,
    ) -> Result<EnhancedInsight> {
        // Query memory for similar stall situations
        let history = self.query_similar_situations(
            user_id,
            folder_id,
            "stall stuck loop frozen no progress",
            scrollback_content,
        )?;

        // Determine severity based on duration
        let severity = if stall_duration_secs > 600 {
            InsightSeverity::Critical
        } else if stall_duration_secs > 300 {
            InsightSeverity::Error
        } else if stall_duration_secs > 180 {
            InsightSeverity::Warning
        } else {
            InsightSeverity::Info
        };

        // Generate suggested actions
        let mut suggested_actions = Vec::new();

        // Add historically effective actions first
        for action in &history.effective_actions {
            suggested_actions.push(SuggestedAction {
                description: action.clone(),
                command: None,
                confidence: 0.8,
                historically_successful: true,
                usage_count: 1,
            });
        }

        // Add standard stall recovery actions
        suggested_actions.push(SuggestedAction {
            description: "Analyze scrollback for error patterns".to_string(),
            command: Some("rdv session scrollback --analyze".to_string()),
            confidence: 0.7,
            historically_successful: false,
            usage_count: 0,
        });

        suggested_actions.push(SuggestedAction {
            description: "Inject a hint to unstick the agent".to_string(),
            command: Some("rdv nudge <session> 'Try a different approach'".to_string()),
            confidence: 0.6,
            historically_successful: false,
            usage_count: 0,
        });

        let insight_id = uuid::Uuid::new_v4().to_string();

        // Store this insight in short-term memory for future reference
        let _ = self.store.remember(
            user_id,
            Some(session_id),
            folder_id,
            &format!(
                "Stall detected: duration={}s, severity={:?}, similar_past={}",
                stall_duration_secs, severity, history.similar_count
            ),
            ContentType::Observation,
            Some(StoreOptions {
                name: Some(format!("stall-insight-{}", &insight_id[..8])),
                confidence: Some(0.7 + (stall_duration_secs as f64 / 1000.0).min(0.2)),
                ..Default::default()
            }),
        );

        Ok(EnhancedInsight {
            id: insight_id,
            insight_type: InsightType::Stall,
            severity,
            title: "Session Stalled".to_string(),
            description: format!(
                "Session has been stalled for {} seconds. {} similar situations found in history.",
                stall_duration_secs, history.similar_count
            ),
            session_id: session_id.to_string(),
            folder_id: folder_id.map(String::from),
            history,
            suggested_actions,
            confidence: 0.7 + (stall_duration_secs as f64 / 1000.0).min(0.25),
            created_at: chrono::Utc::now().timestamp_millis(),
        })
    }

    /// Generate an insight for a detected error.
    pub fn generate_error_insight(
        &self,
        user_id: &str,
        session_id: &str,
        folder_id: Option<&str>,
        error_content: &str,
    ) -> Result<EnhancedInsight> {
        // Query memory for similar errors
        let history = self.query_similar_situations(
            user_id,
            folder_id,
            &format!("error failed exception {}", error_content),
            error_content,
        )?;

        // Store the error in memory
        let _ = self.store.remember(
            user_id,
            Some(session_id),
            folder_id,
            error_content,
            ContentType::Error,
            Some(StoreOptions {
                confidence: Some(0.9),
                ..Default::default()
            }),
        );

        // Generate suggested actions
        let mut suggested_actions = Vec::new();

        // Add historically effective actions
        for action in &history.effective_actions {
            suggested_actions.push(SuggestedAction {
                description: action.clone(),
                command: None,
                confidence: 0.85,
                historically_successful: true,
                usage_count: 1,
            });
        }

        // Add standard error recovery actions
        suggested_actions.push(SuggestedAction {
            description: "Search documentation for error message".to_string(),
            command: None,
            confidence: 0.6,
            historically_successful: false,
            usage_count: 0,
        });

        let insight_id = uuid::Uuid::new_v4().to_string();

        Ok(EnhancedInsight {
            id: insight_id,
            insight_type: InsightType::Error,
            severity: InsightSeverity::Error,
            title: "Error Detected".to_string(),
            description: format!(
                "Error detected: {}. {} similar errors found in history with {:.0}% resolution rate.",
                error_content.chars().take(100).collect::<String>(),
                history.similar_count,
                history.success_rate * 100.0
            ),
            session_id: session_id.to_string(),
            folder_id: folder_id.map(String::from),
            history,
            suggested_actions,
            confidence: 0.9,
            created_at: chrono::Utc::now().timestamp_millis(),
        })
    }

    /// Generate an insight for a pattern observation.
    pub fn generate_pattern_insight(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        pattern_description: &str,
        confidence: f64,
    ) -> Result<EnhancedInsight> {
        // Store the pattern in long-term memory
        let _ = self.store.learn(
            user_id,
            folder_id,
            pattern_description,
            ContentType::Pattern,
            Some(StoreOptions {
                confidence: Some(confidence),
                relevance: Some(0.7),
                ..Default::default()
            }),
        );

        let insight_id = uuid::Uuid::new_v4().to_string();

        Ok(EnhancedInsight {
            id: insight_id,
            insight_type: InsightType::Pattern,
            severity: InsightSeverity::Info,
            title: "Pattern Observed".to_string(),
            description: pattern_description.to_string(),
            session_id: String::new(),
            folder_id: folder_id.map(String::from),
            history: HistoricalContext::default(),
            suggested_actions: vec![SuggestedAction {
                description: "Consider adding this pattern to project documentation".to_string(),
                command: None,
                confidence,
                historically_successful: false,
                usage_count: 0,
            }],
            confidence,
            created_at: chrono::Utc::now().timestamp_millis(),
        })
    }

    /// Record that a suggested action was taken and its outcome.
    pub fn record_action_outcome(
        &self,
        user_id: &str,
        session_id: &str,
        folder_id: Option<&str>,
        action_description: &str,
        was_successful: bool,
    ) -> Result<()> {
        let content = if was_successful {
            format!("SUCCESS: Action '{}' resolved the issue", action_description)
        } else {
            format!("FAILED: Action '{}' did not resolve the issue", action_description)
        };

        // Store in working memory with high confidence if successful
        if was_successful {
            self.store.hold(
                user_id,
                Some(session_id),
                folder_id,
                &content,
                ContentType::Context,
                Some(StoreOptions {
                    confidence: Some(0.9),
                    relevance: Some(0.8),
                    ..Default::default()
                }),
            )?;
        } else {
            // Store failure as observation with lower confidence
            self.store.remember(
                user_id,
                Some(session_id),
                folder_id,
                &content,
                ContentType::Observation,
                Some(StoreOptions {
                    confidence: Some(0.5),
                    ..Default::default()
                }),
            )?;
        }

        Ok(())
    }

    /// Query memory for similar situations.
    fn query_similar_situations(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        query_terms: &str,
        _context: &str,
    ) -> Result<HistoricalContext> {
        // Search across all tiers for relevant memories
        let memories = self.store.search(
            user_id,
            query_terms,
            RecallOptions {
                limit: Some(20),
                min_relevance: Some(0.3),
                ..Default::default()
            },
        )?;

        // Filter to folder-relevant memories
        let relevant: Vec<&MemoryEntry> = memories
            .iter()
            .filter(|m| {
                folder_id.is_none()
                    || m.folder_id.as_deref() == folder_id
                    || m.folder_id.is_none()
            })
            .collect();

        // Extract effective actions from past memories
        let effective_actions: Vec<String> = relevant
            .iter()
            .filter(|m| m.content.contains("SUCCESS:"))
            .map(|m| {
                m.content
                    .replace("SUCCESS: Action '", "")
                    .replace("' resolved the issue", "")
            })
            .take(5)
            .collect();

        // Calculate success rate
        let success_count = relevant
            .iter()
            .filter(|m| m.content.contains("SUCCESS:"))
            .count();
        let total_outcomes = relevant
            .iter()
            .filter(|m| m.content.contains("SUCCESS:") || m.content.contains("FAILED:"))
            .count();
        let success_rate = if total_outcomes > 0 {
            success_count as f64 / total_outcomes as f64
        } else {
            0.0
        };

        // Create memory references
        let relevant_memories: Vec<MemoryReference> = relevant
            .iter()
            .take(5)
            .map(|m| MemoryReference {
                id: m.id.clone(),
                summary: m.content.chars().take(100).collect(),
                similarity: m.relevance.unwrap_or(0.5),
                created_at: m.created_at,
            })
            .collect();

        Ok(HistoricalContext {
            similar_count: relevant.len(),
            relevant_memories,
            success_rate,
            effective_actions,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_insight_severity_conversion() {
        assert_eq!(InsightSeverity::Info.as_str(), "info");
        assert_eq!(InsightSeverity::Warning.as_str(), "warning");
        assert_eq!(InsightSeverity::Error.as_str(), "error");
        assert_eq!(InsightSeverity::Critical.as_str(), "critical");

        assert_eq!(InsightSeverity::from_str("info"), Some(InsightSeverity::Info));
        assert_eq!(InsightSeverity::from_str("WARNING"), Some(InsightSeverity::Warning));
        assert_eq!(InsightSeverity::from_str("unknown"), None);
    }

    #[test]
    fn test_insight_type_conversion() {
        assert_eq!(InsightType::Stall.as_str(), "stall");
        assert_eq!(InsightType::Error.as_str(), "error");
        assert_eq!(InsightType::Pattern.as_str(), "pattern");
        assert_eq!(InsightType::TaskComplete.as_str(), "task_complete");
        assert_eq!(InsightType::SessionEnd.as_str(), "session_end");
    }

    #[test]
    fn test_historical_context_default() {
        let ctx = HistoricalContext::default();
        assert_eq!(ctx.similar_count, 0);
        assert!(ctx.relevant_memories.is_empty());
        assert_eq!(ctx.success_rate, 0.0);
        assert!(ctx.effective_actions.is_empty());
    }

    #[test]
    fn test_suggested_action() {
        let action = SuggestedAction {
            description: "Test action".to_string(),
            command: Some("test cmd".to_string()),
            confidence: 0.8,
            historically_successful: true,
            usage_count: 5,
        };
        assert_eq!(action.description, "Test action");
        assert_eq!(action.command, Some("test cmd".to_string()));
        assert!(action.historically_successful);
        assert_eq!(action.usage_count, 5);
    }
}
