//! Database types for rdv-core.

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
#[derive(Debug, Clone)]
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
#[derive(Debug, Clone)]
pub struct NewFolder {
    pub user_id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

/// Input for creating a new orchestrator
#[derive(Debug, Clone)]
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
#[derive(Debug, Clone)]
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
