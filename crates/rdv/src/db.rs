//! Direct SQLite database access for rdv.
//!
//! This module provides direct read/write access to the Remote Dev SQLite database,
//! bypassing the HTTP API for faster, simpler operations.
//!
//! Database location:
//! 1. RDV_DATABASE_PATH env var
//! 2. ./sqlite.db (project root)
//! 3. Walk up directory tree looking for sqlite.db

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Database connection wrapper
pub struct Database {
    conn: Connection,
}

impl Database {
    /// Open database connection, auto-detecting location
    pub fn open() -> Result<Self> {
        let path = Self::find_database()?;
        let conn = Connection::open(&path)
            .with_context(|| format!("Failed to open database at {:?}", path))?;
        Ok(Self { conn })
    }

    /// Open database at specific path
    pub fn open_path(path: &PathBuf) -> Result<Self> {
        let conn = Connection::open(path)
            .with_context(|| format!("Failed to open database at {:?}", path))?;
        Ok(Self { conn })
    }

    /// Find database file location
    fn find_database() -> Result<PathBuf> {
        // 1. Environment variable
        if let Ok(path) = std::env::var("RDV_DATABASE_PATH") {
            let path = PathBuf::from(path);
            if path.exists() {
                return Ok(path);
            }
        }

        // 2. Walk up directory tree from current dir
        if let Ok(mut current) = std::env::current_dir() {
            loop {
                let db_path = current.join("sqlite.db");
                if db_path.exists() {
                    return Ok(db_path);
                }
                if !current.pop() {
                    break;
                }
            }
        }

        // 3. Check common locations
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let candidates = [
            home.join("Projects/btli/remote-dev/sqlite.db"),
            home.join(".remote-dev/sqlite.db"),
            PathBuf::from("./sqlite.db"),
        ];

        for candidate in &candidates {
            if candidate.exists() {
                return Ok(candidate.clone());
            }
        }

        anyhow::bail!("Could not find sqlite.db. Set RDV_DATABASE_PATH or run from project directory.")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Session Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List all sessions for a user
    pub fn list_sessions(&self, user_id: &str, folder_id: Option<&str>) -> Result<Vec<Session>> {
        if let Some(fid) = folder_id {
            let mut stmt = self.conn.prepare(
                "SELECT id, user_id, name, tmux_session_name, project_path, folder_id,
                        agent_provider, is_orchestrator_session, status, created_at, updated_at
                 FROM terminal_session
                 WHERE user_id = ?1 AND folder_id = ?2 AND status != 'closed'
                 ORDER BY tab_order"
            )?;
            let sessions = stmt.query_map(params![user_id, fid], Self::map_session)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(sessions)
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT id, user_id, name, tmux_session_name, project_path, folder_id,
                        agent_provider, is_orchestrator_session, status, created_at, updated_at
                 FROM terminal_session
                 WHERE user_id = ?1 AND status != 'closed'
                 ORDER BY tab_order"
            )?;
            let sessions = stmt.query_map(params![user_id], Self::map_session)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(sessions)
        }
    }

    /// Get session by ID
    pub fn get_session(&self, session_id: &str) -> Result<Option<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, name, tmux_session_name, project_path, folder_id,
                    agent_provider, is_orchestrator_session, status, created_at, updated_at
             FROM terminal_session WHERE id = ?1"
        )?;

        stmt.query_row(params![session_id], Self::map_session)
            .optional()
            .context("Failed to get session")
    }

    /// Get session by tmux session name
    pub fn get_session_by_tmux_name(&self, tmux_name: &str) -> Result<Option<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, name, tmux_session_name, project_path, folder_id,
                    agent_provider, is_orchestrator_session, status, created_at, updated_at
             FROM terminal_session WHERE tmux_session_name = ?1"
        )?;

        stmt.query_row(params![tmux_name], Self::map_session)
            .optional()
            .context("Failed to get session by tmux name")
    }

    fn map_session(row: &rusqlite::Row) -> rusqlite::Result<Session> {
        Ok(Session {
            id: row.get(0)?,
            user_id: row.get(1)?,
            name: row.get(2)?,
            tmux_session_name: row.get(3)?,
            project_path: row.get(4)?,
            folder_id: row.get(5)?,
            agent_provider: row.get(6)?,
            is_orchestrator_session: row.get(7)?,
            status: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Folder Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List all folders for a user
    pub fn list_folders(&self, user_id: &str) -> Result<Vec<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, parent_id, name, collapsed, sort_order, created_at
             FROM session_folder WHERE user_id = ?1 ORDER BY sort_order"
        )?;

        let folders = stmt.query_map(params![user_id], |row| {
            Ok(Folder {
                id: row.get(0)?,
                user_id: row.get(1)?,
                parent_id: row.get(2)?,
                name: row.get(3)?,
                collapsed: row.get(4)?,
                sort_order: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

        Ok(folders)
    }

    /// Get folder by ID
    pub fn get_folder(&self, folder_id: &str) -> Result<Option<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, parent_id, name, collapsed, sort_order, created_at
             FROM session_folder WHERE id = ?1"
        )?;

        stmt.query_row(params![folder_id], |row| {
            Ok(Folder {
                id: row.get(0)?,
                user_id: row.get(1)?,
                parent_id: row.get(2)?,
                name: row.get(3)?,
                collapsed: row.get(4)?,
                sort_order: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .optional()
        .context("Failed to get folder")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Orchestrator Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get master orchestrator for user
    pub fn get_master_orchestrator(&self, user_id: &str) -> Result<Option<Orchestrator>> {
        let mut stmt = self.conn.prepare(
            "SELECT o.id, o.session_id, o.user_id, o.type, o.status, o.scope_type, o.scope_id,
                    o.custom_instructions, o.monitoring_interval, o.stall_threshold,
                    o.auto_intervention, o.last_activity_at, o.created_at, o.updated_at,
                    t.tmux_session_name
             FROM orchestrator_session o
             JOIN terminal_session t ON o.session_id = t.id
             WHERE o.user_id = ?1 AND o.type = 'master'"
        )?;

        stmt.query_row(params![user_id], Self::map_orchestrator)
            .optional()
            .context("Failed to get master orchestrator")
    }

    /// Get folder orchestrator
    pub fn get_folder_orchestrator(&self, user_id: &str, folder_id: &str) -> Result<Option<Orchestrator>> {
        let mut stmt = self.conn.prepare(
            "SELECT o.id, o.session_id, o.user_id, o.type, o.status, o.scope_type, o.scope_id,
                    o.custom_instructions, o.monitoring_interval, o.stall_threshold,
                    o.auto_intervention, o.last_activity_at, o.created_at, o.updated_at,
                    t.tmux_session_name
             FROM orchestrator_session o
             JOIN terminal_session t ON o.session_id = t.id
             WHERE o.user_id = ?1 AND o.scope_id = ?2"
        )?;

        stmt.query_row(params![user_id, folder_id], Self::map_orchestrator)
            .optional()
            .context("Failed to get folder orchestrator")
    }

    /// List all orchestrators for user
    pub fn list_orchestrators(&self, user_id: &str) -> Result<Vec<Orchestrator>> {
        let mut stmt = self.conn.prepare(
            "SELECT o.id, o.session_id, o.user_id, o.type, o.status, o.scope_type, o.scope_id,
                    o.custom_instructions, o.monitoring_interval, o.stall_threshold,
                    o.auto_intervention, o.last_activity_at, o.created_at, o.updated_at,
                    t.tmux_session_name
             FROM orchestrator_session o
             JOIN terminal_session t ON o.session_id = t.id
             WHERE o.user_id = ?1
             ORDER BY o.type DESC, o.created_at"
        )?;

        let orchestrators = stmt.query_map(params![user_id], Self::map_orchestrator)?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(orchestrators)
    }

    /// Update orchestrator status
    pub fn update_orchestrator_status(&self, orchestrator_id: &str, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE orchestrator_session SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, chrono::Utc::now().timestamp_millis(), orchestrator_id],
        )?;
        Ok(())
    }

    fn map_orchestrator(row: &rusqlite::Row) -> rusqlite::Result<Orchestrator> {
        Ok(Orchestrator {
            id: row.get(0)?,
            session_id: row.get(1)?,
            user_id: row.get(2)?,
            orchestrator_type: row.get(3)?,
            status: row.get(4)?,
            scope_type: row.get(5)?,
            scope_id: row.get(6)?,
            custom_instructions: row.get(7)?,
            monitoring_interval: row.get(8)?,
            stall_threshold: row.get(9)?,
            auto_intervention: row.get(10)?,
            last_activity_at: row.get(11)?,
            created_at: row.get(12)?,
            updated_at: row.get(13)?,
            tmux_session_name: row.get(14)?,
        })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Insights Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List insights for an orchestrator
    pub fn list_insights(&self, orchestrator_id: &str, resolved: Option<bool>) -> Result<Vec<Insight>> {
        let sql = match resolved {
            Some(true) => {
                "SELECT id, orchestrator_id, session_id, type, severity, title, description,
                        context, suggested_actions, resolved, resolved_at, resolved_by,
                        resolution_notes, confidence, triggered_by, created_at
                 FROM orchestrator_insight WHERE orchestrator_id = ?1 AND resolved = 1
                 ORDER BY created_at DESC"
            }
            Some(false) => {
                "SELECT id, orchestrator_id, session_id, type, severity, title, description,
                        context, suggested_actions, resolved, resolved_at, resolved_by,
                        resolution_notes, confidence, triggered_by, created_at
                 FROM orchestrator_insight WHERE orchestrator_id = ?1 AND resolved = 0
                 ORDER BY created_at DESC"
            }
            None => {
                "SELECT id, orchestrator_id, session_id, type, severity, title, description,
                        context, suggested_actions, resolved, resolved_at, resolved_by,
                        resolution_notes, confidence, triggered_by, created_at
                 FROM orchestrator_insight WHERE orchestrator_id = ?1
                 ORDER BY created_at DESC"
            }
        };

        let mut stmt = self.conn.prepare(sql)?;
        let insights = stmt.query_map(params![orchestrator_id], |row| {
            Ok(Insight {
                id: row.get(0)?,
                orchestrator_id: row.get(1)?,
                session_id: row.get(2)?,
                insight_type: row.get(3)?,
                severity: row.get(4)?,
                title: row.get(5)?,
                description: row.get(6)?,
                context: row.get(7)?,
                suggested_actions: row.get(8)?,
                resolved: row.get(9)?,
                resolved_at: row.get(10)?,
                resolved_by: row.get(11)?,
                resolution_notes: row.get(12)?,
                confidence: row.get(13)?,
                triggered_by: row.get(14)?,
                created_at: row.get(15)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

        Ok(insights)
    }

    /// Create a new insight
    pub fn create_insight(&self, insight: &NewInsight) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        self.conn.execute(
            "INSERT INTO orchestrator_insight
             (id, orchestrator_id, session_id, type, severity, title, description,
              context, suggested_actions, resolved, confidence, triggered_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12)",
            params![
                id,
                insight.orchestrator_id,
                insight.session_id,
                insight.insight_type,
                insight.severity,
                insight.title,
                insight.description,
                insight.context,
                insight.suggested_actions,
                insight.confidence,
                insight.triggered_by,
                now,
            ],
        )?;

        Ok(id)
    }

    /// Resolve an insight
    pub fn resolve_insight(&self, insight_id: &str, resolved_by: &str, notes: Option<&str>) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE orchestrator_insight SET resolved = 1, resolved_at = ?1, resolved_by = ?2, resolution_notes = ?3
             WHERE id = ?4",
            params![now, resolved_by, notes, insight_id],
        )?;
        Ok(())
    }

    /// Check if there's an unresolved stall insight for this session
    pub fn has_unresolved_stall_insight(&self, session_id: &str) -> Result<bool> {
        let count: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM orchestrator_insight
             WHERE session_id = ?1 AND type = 'stall' AND resolved = 0",
            params![session_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get default user (first user in database, for local single-user mode)
    pub fn get_default_user(&self) -> Result<Option<User>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, email FROM user LIMIT 1"
        )?;

        stmt.query_row([], |row| {
            Ok(User {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
            })
        })
        .optional()
        .context("Failed to get default user")
    }

    /// Get user by email
    pub fn get_user_by_email(&self, email: &str) -> Result<Option<User>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, email FROM user WHERE email = ?1"
        )?;

        stmt.query_row(params![email], |row| {
            Ok(User {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
            })
        })
        .optional()
        .context("Failed to get user by email")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Task Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List tasks for a user
    pub fn list_tasks(&self, user_id: &str, status: Option<&str>) -> Result<Vec<Task>> {
        let sql = match status {
            Some(_) => {
                "SELECT id, orchestrator_id, user_id, folder_id, description, type, status,
                        confidence, estimated_duration, assigned_agent, delegation_id,
                        beads_issue_id, context_injected, result_json, error_json,
                        created_at, updated_at, completed_at
                 FROM tasks WHERE user_id = ?1 AND status = ?2
                 ORDER BY created_at DESC"
            }
            None => {
                "SELECT id, orchestrator_id, user_id, folder_id, description, type, status,
                        confidence, estimated_duration, assigned_agent, delegation_id,
                        beads_issue_id, context_injected, result_json, error_json,
                        created_at, updated_at, completed_at
                 FROM tasks WHERE user_id = ?1
                 ORDER BY created_at DESC"
            }
        };

        let mut stmt = self.conn.prepare(sql)?;
        let tasks = if let Some(s) = status {
            stmt.query_map(params![user_id, s], Self::map_task)?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            stmt.query_map(params![user_id], Self::map_task)?
                .collect::<Result<Vec<_>, _>>()?
        };

        Ok(tasks)
    }

    /// Get task by ID
    pub fn get_task(&self, task_id: &str) -> Result<Option<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, orchestrator_id, user_id, folder_id, description, type, status,
                    confidence, estimated_duration, assigned_agent, delegation_id,
                    beads_issue_id, context_injected, result_json, error_json,
                    created_at, updated_at, completed_at
             FROM tasks WHERE id = ?1"
        )?;

        stmt.query_row(params![task_id], Self::map_task)
            .optional()
            .context("Failed to get task")
    }

    /// Get task by beads issue ID
    pub fn get_task_by_beads_id(&self, beads_id: &str) -> Result<Option<Task>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, orchestrator_id, user_id, folder_id, description, type, status,
                    confidence, estimated_duration, assigned_agent, delegation_id,
                    beads_issue_id, context_injected, result_json, error_json,
                    created_at, updated_at, completed_at
             FROM tasks WHERE beads_issue_id = ?1"
        )?;

        stmt.query_row(params![beads_id], Self::map_task)
            .optional()
            .context("Failed to get task by beads ID")
    }

    /// Update task status
    pub fn update_task_status(&self, task_id: &str, status: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        if status == "completed" || status == "failed" {
            self.conn.execute(
                "UPDATE tasks SET status = ?1, updated_at = ?2, completed_at = ?2 WHERE id = ?3",
                params![status, now, task_id],
            )?;
        } else {
            self.conn.execute(
                "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![status, now, task_id],
            )?;
        }
        Ok(())
    }

    fn map_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
        Ok(Task {
            id: row.get(0)?,
            orchestrator_id: row.get(1)?,
            user_id: row.get(2)?,
            folder_id: row.get(3)?,
            description: row.get(4)?,
            task_type: row.get(5)?,
            status: row.get(6)?,
            confidence: row.get(7)?,
            estimated_duration: row.get(8)?,
            assigned_agent: row.get(9)?,
            delegation_id: row.get(10)?,
            beads_issue_id: row.get(11)?,
            context_injected: row.get(12)?,
            result_json: row.get(13)?,
            error_json: row.get(14)?,
            created_at: row.get(15)?,
            updated_at: row.get(16)?,
            completed_at: row.get(17)?,
        })
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Monitoring Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get sessions that may be stalled (no activity for threshold_secs)
    pub fn get_stalled_sessions(&self, user_id: &str, threshold_secs: i64) -> Result<Vec<StalledSession>> {
        let threshold_ms = chrono::Utc::now().timestamp_millis() - (threshold_secs * 1000);

        let mut stmt = self.conn.prepare(
            "SELECT id, name, tmux_session_name, folder_id, last_activity_at
             FROM terminal_session
             WHERE user_id = ?1
               AND status = 'active'
               AND (last_activity_at IS NULL OR last_activity_at < ?2)
             ORDER BY last_activity_at ASC"
        )?;

        let sessions = stmt.query_map(params![user_id, threshold_ms], |row| {
            let last_activity: Option<i64> = row.get(4)?;
            let stalled_minutes = if let Some(last) = last_activity {
                let now = chrono::Utc::now().timestamp_millis();
                ((now - last) / 60000) as i32
            } else {
                -1 // Unknown, never had activity
            };
            Ok(StalledSession {
                session_id: row.get(0)?,
                session_name: row.get(1)?,
                tmux_session_name: row.get(2)?,
                folder_id: row.get(3)?,
                last_activity_at: last_activity,
                stalled_minutes,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

        Ok(sessions)
    }

    /// Update session last activity timestamp
    pub fn update_session_activity(&self, session_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE terminal_session SET last_activity_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )?;
        Ok(())
    }

    /// Get active session count for user
    pub fn get_active_session_count(&self, user_id: &str) -> Result<u32> {
        let count: u32 = self.conn.query_row(
            "SELECT COUNT(*) FROM terminal_session WHERE user_id = ?1 AND status = 'active'",
            params![user_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Types
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
    pub collapsed: bool,
    pub sort_order: i32,
    pub created_at: i64,
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
    pub resolution_notes: Option<String>,
    pub confidence: f64,
    pub triggered_by: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub orchestrator_id: Option<String>,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub description: String,
    pub task_type: String,
    pub status: String,
    pub confidence: Option<f64>,
    pub estimated_duration: Option<i32>,
    pub assigned_agent: Option<String>,
    pub delegation_id: Option<String>,
    pub beads_issue_id: Option<String>,
    pub context_injected: bool,
    pub result_json: Option<String>,
    pub error_json: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
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

/// Input struct for creating a new insight
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
    pub confidence: f64,
    pub triggered_by: String,
}
