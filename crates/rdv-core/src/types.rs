//! Shared types for rdv-core.
//!
//! These types are used by both the API client and the database layer.

use serde::{Deserialize, Serialize};

// ─────────────────────────────────────────────────────────────────────────────
// Entity Types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub tmux_session_name: String,
    pub project_path: Option<String>,
    pub folder_id: Option<String>,
    pub worktree_branch: Option<String>,
    pub agent_provider: Option<String>,
    pub is_orchestrator_session: bool,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub user_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub path: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub collapsed: bool,
    pub sort_order: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Orchestrator {
    pub id: String,
    pub session_id: String,
    pub user_id: String,
    pub orchestrator_type: String,
    pub status: String,
    pub scope_type: Option<String>,
    pub scope_id: Option<String>,
    pub custom_instructions: Option<String>,
    pub monitoring_interval: i32,
    pub stall_threshold: i32,
    pub auto_intervention: bool,
    pub last_activity_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub tmux_session_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StalledSession {
    pub session_id: String,
    pub session_name: String,
    pub tmux_session_name: String,
    pub folder_id: Option<String>,
    pub last_activity_at: Option<i64>,
    pub stalled_minutes: i32,
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Types (for creating entities)
// ─────────────────────────────────────────────────────────────────────────────

/// Input for creating a new terminal session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSession {
    pub user_id: String,
    pub name: String,
    pub tmux_session_name: String,
    pub project_path: Option<String>,
    pub folder_id: Option<String>,
    pub worktree_branch: Option<String>,
    pub agent_provider: Option<String>,
    pub is_orchestrator_session: bool,
}

/// Input for creating a new folder
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewFolder {
    pub user_id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

/// Input for creating a new orchestrator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewOrchestrator {
    pub session_id: String,
    pub user_id: String,
    /// "master" or "sub_orchestrator"
    pub orchestrator_type: String,
    /// "folder" or None
    pub scope_type: Option<String>,
    /// folder_id or None
    pub scope_id: Option<String>,
    pub custom_instructions: Option<String>,
    pub monitoring_interval: i32,
    pub stall_threshold: i32,
    pub auto_intervention: bool,
}

/// Orchestrator insight
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Insight {
    pub id: String,
    pub orchestrator_id: String,
    pub session_id: Option<String>,
    pub insight_type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub context: Option<String>,
    pub suggested_actions: Option<String>,
    pub resolved: bool,
    pub resolved_at: Option<i64>,
    pub resolved_by: Option<String>,
    pub created_at: i64,
}

/// Input for creating a new insight
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewInsight {
    pub orchestrator_id: String,
    pub session_id: Option<String>,
    pub insight_type: String,
    pub severity: String,
    pub title: String,
    pub description: String,
    pub context: Option<String>,
    pub suggested_actions: Option<String>,
}

/// Orchestrator for REST responses (simpler structure)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorSimple {
    pub id: String,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub session_id: Option<String>,
    pub orchestrator_type: String,
    pub status: String,
    pub monitoring_interval_secs: i32,
    pub stall_threshold_secs: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Insight counts by severity for an orchestrator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsightCounts {
    pub total: u32,
    pub unresolved: u32,
    pub critical: u32,
    pub high: u32,
    pub medium: u32,
    pub low: u32,
}

/// Audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLog {
    pub id: String,
    pub orchestrator_id: String,
    pub session_id: Option<String>,
    pub action_type: String,
    pub details: Option<String>,
    pub created_at: i64,
}

/// GitHub repository (cached from GitHub API)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubRepository {
    pub id: String,
    pub user_id: String,
    pub github_id: i64,
    pub name: String,
    pub full_name: String,
    pub clone_url: String,
    pub default_branch: String,
    pub local_path: Option<String>,
    pub is_private: bool,
    pub added_at: i64,
    pub updated_at: i64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Knowledge Types
// ─────────────────────────────────────────────────────────────────────────────

/// Project knowledge metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectKnowledgeMetadata {
    pub project_name: Option<String>,
    pub project_path: Option<String>,
    pub framework: Option<String>,
    pub package_manager: Option<String>,
    pub test_runner: Option<String>,
    pub linter: Option<String>,
    pub build_tool: Option<String>,
}

/// Convention entry in project knowledge
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Convention {
    pub id: String,
    pub category: String,
    pub description: String,
    pub examples: Vec<String>,
    pub confidence: f64,
    pub source: String,
    pub created_at: i64,
}

/// Learned pattern in project knowledge
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnedPattern {
    pub id: String,
    #[serde(rename = "type")]
    pub pattern_type: String,
    pub description: String,
    pub context: String,
    pub confidence: f64,
    pub usage_count: i32,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
}

/// Skill definition in project knowledge
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub command: String,
    pub steps: Vec<SkillStep>,
    pub triggers: Vec<String>,
    pub scope: String,
    pub verified: bool,
    pub usage_count: i32,
    pub created_at: i64,
}

/// Step within a skill
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStep {
    pub description: String,
    pub command: Option<String>,
}

/// Tool definition in project knowledge
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub implementation: ToolImplementation,
    pub triggers: Vec<String>,
    pub confidence: f64,
    pub verified: bool,
    pub created_at: i64,
}

/// Tool implementation details
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolImplementation {
    #[serde(rename = "type")]
    pub impl_type: String,
    pub code: String,
}

/// Agent performance metrics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentPerformance(pub std::collections::HashMap<String, std::collections::HashMap<String, TaskMetrics>>);

/// Task metrics for an agent
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMetrics {
    pub success_rate: f64,
    pub avg_duration: f64,
    pub total_tasks: i32,
}

/// Project knowledge for a folder
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectKnowledge {
    pub id: String,
    pub folder_id: String,
    pub user_id: String,
    pub tech_stack: Vec<String>,
    pub conventions: Vec<Convention>,
    pub patterns: Vec<LearnedPattern>,
    pub skills: Vec<SkillDefinition>,
    pub tools: Vec<ToolDefinition>,
    pub agent_performance: AgentPerformance,
    pub metadata: ProjectKnowledgeMetadata,
    pub last_scanned_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Input for creating new project knowledge
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewProjectKnowledge {
    pub folder_id: String,
    pub user_id: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Token Types
// ─────────────────────────────────────────────────────────────────────────────

/// CLI token for programmatic API access
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CLIToken {
    pub id: String,
    pub user_id: String,
    /// User-friendly name (e.g., "CI Pipeline", "Orchestrator Agent")
    pub name: String,
    /// First 8 chars for identification (e.g., "rdv_abc1")
    pub key_prefix: String,
    /// SHA-256 hash of the full key (not the raw key)
    pub key_hash: String,
    pub last_used_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub created_at: i64,
}

/// Input for creating a new CLI token
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCLIToken {
    pub user_id: String,
    pub name: String,
    /// Optional expiration timestamp (milliseconds since epoch)
    pub expires_at: Option<i64>,
}

/// Response when creating a CLI token (includes the raw key, shown only once)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CLITokenCreateResponse {
    pub id: String,
    pub name: String,
    pub key_prefix: String,
    /// The full raw key - ONLY returned on creation, never stored
    pub raw_key: String,
    pub expires_at: Option<i64>,
    pub created_at: i64,
}

/// CLI token for validation (includes hash for comparison)
#[derive(Debug, Clone)]
pub struct CLITokenValidation {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub key_hash: String,
    pub expires_at: Option<i64>,
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK Memory Types
// ─────────────────────────────────────────────────────────────────────────────

/// Memory tier for hierarchical working memory
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryTier {
    ShortTerm,
    Working,
    LongTerm,
}

impl std::fmt::Display for MemoryTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemoryTier::ShortTerm => write!(f, "short_term"),
            MemoryTier::Working => write!(f, "working"),
            MemoryTier::LongTerm => write!(f, "long_term"),
        }
    }
}

impl std::str::FromStr for MemoryTier {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "short_term" => Ok(MemoryTier::ShortTerm),
            "working" => Ok(MemoryTier::Working),
            "long_term" => Ok(MemoryTier::LongTerm),
            _ => Err(format!("Invalid memory tier: {}", s)),
        }
    }
}

/// Memory entry in the hierarchical working memory system
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: String,
    pub user_id: String,
    pub session_id: Option<String>,
    pub folder_id: Option<String>,
    pub tier: String,
    pub content_type: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub content: String,
    pub content_hash: String,
    pub embedding_id: Option<String>,
    pub task_id: Option<String>,
    pub priority: Option<i32>,
    pub confidence: Option<f64>,
    pub relevance: Option<f64>,
    pub ttl_seconds: Option<i32>,
    pub access_count: i32,
    pub last_accessed_at: i64,
    pub source_sessions_json: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub expires_at: Option<i64>,
}

/// Input for creating a new memory entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMemoryEntry {
    pub user_id: String,
    pub session_id: Option<String>,
    pub folder_id: Option<String>,
    pub tier: String,
    pub content_type: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub content: String,
    pub task_id: Option<String>,
    pub priority: Option<i32>,
    pub confidence: Option<f64>,
    pub relevance: Option<f64>,
    pub ttl_seconds: Option<i32>,
    pub metadata_json: Option<String>,
}

/// Filter criteria for querying memory entries
#[derive(Debug, Clone, Default)]
pub struct MemoryQueryFilter {
    pub user_id: String,
    pub session_id: Option<String>,
    pub folder_id: Option<String>,
    pub tier: Option<String>,
    pub content_type: Option<String>,
    pub task_id: Option<String>,
    pub min_relevance: Option<f64>,
    pub min_confidence: Option<f64>,
    pub limit: Option<usize>,
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK Note Types
// ─────────────────────────────────────────────────────────────────────────────

/// Note entry for the note-taking service
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub user_id: String,
    pub session_id: Option<String>,
    pub folder_id: Option<String>,
    pub content: String,
    pub tags_json: String,
    pub embedding_id: Option<String>,
    pub created_at: i64,
}

/// Input for creating a new note
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewNote {
    pub user_id: String,
    pub session_id: Option<String>,
    pub folder_id: Option<String>,
    pub content: String,
    pub tags: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK Extension Types
// ─────────────────────────────────────────────────────────────────────────────

/// Extension state in the extension registry
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtensionState {
    Unloaded,
    Loading,
    Loaded,
    Error,
    Disabled,
}

impl std::fmt::Display for ExtensionState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExtensionState::Unloaded => write!(f, "unloaded"),
            ExtensionState::Loading => write!(f, "loading"),
            ExtensionState::Loaded => write!(f, "loaded"),
            ExtensionState::Error => write!(f, "error"),
            ExtensionState::Disabled => write!(f, "disabled"),
        }
    }
}

impl std::str::FromStr for ExtensionState {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "unloaded" => Ok(ExtensionState::Unloaded),
            "loading" => Ok(ExtensionState::Loading),
            "loaded" => Ok(ExtensionState::Loaded),
            "error" => Ok(ExtensionState::Error),
            "disabled" => Ok(ExtensionState::Disabled),
            _ => Err(format!("Invalid extension state: {}", s)),
        }
    }
}

/// SDK Extension in the extension registry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extension {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub repository: Option<String>,
    pub extension_type: String,
    pub remote_dev_version: String,
    pub main_path: String,
    pub state: String,
    pub error: Option<String>,
    pub permissions_json: String,
    pub config_schema_json: Option<String>,
    pub config_values_json: String,
    pub dependencies_json: String,
    pub loaded_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Input for creating a new extension
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewExtension {
    pub user_id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub repository: Option<String>,
    pub extension_type: String,
    pub remote_dev_version: String,
    pub main_path: String,
    pub permissions: Vec<String>,
    pub config_schema: Option<serde_json::Value>,
    pub dependencies: std::collections::HashMap<String, String>,
}

/// Extension tool registered by an extension
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionTool {
    pub id: String,
    pub extension_id: String,
    pub user_id: String,
    pub name: String,
    pub description: String,
    pub input_schema_json: String,
    pub output_schema_json: Option<String>,
    pub permissions_json: String,
    pub examples_json: String,
    pub is_dangerous: bool,
    pub timeout_ms: Option<i32>,
    pub execution_count: i32,
    pub last_executed_at: Option<i64>,
    pub created_at: i64,
}

/// Input for creating a new extension tool
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewExtensionTool {
    pub extension_id: String,
    pub user_id: String,
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: Option<serde_json::Value>,
    pub permissions: Vec<String>,
    pub examples: Vec<serde_json::Value>,
    pub is_dangerous: bool,
    pub timeout_ms: Option<i32>,
}

/// Extension prompt template registered by an extension
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionPrompt {
    pub id: String,
    pub extension_id: String,
    pub user_id: String,
    pub name: String,
    pub description: String,
    pub template: String,
    pub variables_json: String,
    pub category: Option<String>,
    pub tags_json: String,
    pub usage_count: i32,
    pub last_used_at: Option<i64>,
    pub created_at: i64,
}

/// Input for creating a new extension prompt
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewExtensionPrompt {
    pub extension_id: String,
    pub user_id: String,
    pub name: String,
    pub description: String,
    pub template: String,
    pub variables: Vec<serde_json::Value>,
    pub category: Option<String>,
    pub tags: Vec<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// SDK Meta-Agent Types
// ─────────────────────────────────────────────────────────────────────────────

/// Meta-agent configuration for generating agent configurations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaAgentConfig {
    pub id: String,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub name: String,
    pub provider: String,
    pub version: i32,
    pub task_spec_json: String,
    pub project_context_json: String,
    pub system_prompt: String,
    pub instructions_file: String,
    pub mcp_config_json: Option<String>,
    pub tool_config_json: Option<String>,
    pub memory_config_json: Option<String>,
    pub metadata_json: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Input for creating a new meta-agent config
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMetaAgentConfig {
    pub user_id: String,
    pub folder_id: Option<String>,
    pub name: String,
    pub provider: String,
    pub task_spec: serde_json::Value,
    pub project_context: serde_json::Value,
    pub system_prompt: String,
    pub instructions_file: String,
    pub mcp_config: Option<serde_json::Value>,
    pub tool_config: Option<serde_json::Value>,
    pub memory_config: Option<serde_json::Value>,
    pub metadata: serde_json::Value,
}

/// Meta-agent benchmark definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaAgentBenchmark {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub task_spec_json: String,
    pub test_cases_json: String,
    pub success_criteria_json: String,
    pub timeout_seconds: i32,
    pub run_count: i32,
    pub last_run_at: Option<i64>,
    pub created_at: i64,
}

/// Input for creating a new meta-agent benchmark
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMetaAgentBenchmark {
    pub user_id: String,
    pub name: String,
    pub task_spec: serde_json::Value,
    pub test_cases: Vec<serde_json::Value>,
    pub success_criteria: serde_json::Value,
    pub timeout_seconds: Option<i32>,
}

/// Meta-agent benchmark result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaAgentBenchmarkResult {
    pub id: String,
    pub benchmark_id: String,
    pub config_id: String,
    pub user_id: String,
    pub score: f64,
    pub passed: bool,
    pub duration_ms: i32,
    pub test_results_json: String,
    pub errors_json: String,
    pub warnings_json: String,
    pub files_modified_json: String,
    pub commands_executed_json: String,
    pub raw_output: Option<String>,
    pub executed_at: i64,
}

/// Input for creating a new benchmark result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMetaAgentBenchmarkResult {
    pub benchmark_id: String,
    pub config_id: String,
    pub user_id: String,
    pub score: f64,
    pub passed: bool,
    pub duration_ms: i32,
    pub test_results: serde_json::Value,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub files_modified: Vec<String>,
    pub commands_executed: Vec<String>,
    pub raw_output: Option<String>,
}
