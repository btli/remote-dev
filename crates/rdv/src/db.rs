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
        Self::open_path(&path)
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

    /// Create a new terminal session
    pub fn create_session(&self, session: &NewSession) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        self.conn.execute(
            "INSERT INTO terminal_session
             (id, user_id, name, tmux_session_name, project_path, folder_id, worktree_branch,
              agent_provider, is_orchestrator_session, status, last_activity_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active', ?10, ?10, ?10)",
            params![
                id,
                session.user_id,
                session.name,
                session.tmux_session_name,
                session.project_path,
                session.folder_id,
                session.worktree_branch,
                session.agent_provider,
                session.is_orchestrator_session,
                now,
            ],
        )?;

        Ok(id)
    }

    /// Update session status
    pub fn update_session_status(&self, session_id: &str, status: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE terminal_session SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now, session_id],
        )?;
        Ok(())
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

    /// Get folder by name for a user
    pub fn get_folder_by_name(&self, user_id: &str, name: &str) -> Result<Option<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, parent_id, name, collapsed, sort_order, created_at
             FROM session_folder WHERE user_id = ?1 AND name = ?2"
        )?;

        stmt.query_row(params![user_id, name], |row| {
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
        .context("Failed to get folder by name")
    }

    /// Create a new folder
    pub fn create_folder(&self, folder: &NewFolder) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        // Get max sort_order for this user to append at end
        let max_order: i32 = self.conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM session_folder WHERE user_id = ?1",
            params![folder.user_id],
            |row| row.get(0),
        )?;

        self.conn.execute(
            "INSERT INTO session_folder
             (id, user_id, parent_id, name, collapsed, sort_order, created_at)
             VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
            params![
                id,
                folder.user_id,
                folder.parent_id,
                folder.name,
                max_order + 1,
                now,
            ],
        )?;

        Ok(id)
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

    /// Create a new orchestrator
    pub fn create_orchestrator(&self, orchestrator: &NewOrchestrator) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        self.conn.execute(
            "INSERT INTO orchestrator_session
             (id, session_id, user_id, type, status, scope_type, scope_id,
              custom_instructions, monitoring_interval, stall_threshold,
              auto_intervention, last_activity_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'idle', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?11)",
            params![
                id,
                orchestrator.session_id,
                orchestrator.user_id,
                orchestrator.orchestrator_type,
                orchestrator.scope_type,
                orchestrator.scope_id,
                orchestrator.custom_instructions,
                orchestrator.monitoring_interval,
                orchestrator.stall_threshold,
                orchestrator.auto_intervention,
                now,
            ],
        )?;

        Ok(id)
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

/// Input struct for creating a new terminal session
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

/// Input struct for creating a new folder
#[derive(Debug, Clone)]
pub struct NewFolder {
    pub user_id: String,
    pub name: String,
    pub parent_id: Option<String>,
}

/// Input struct for creating a new orchestrator
#[derive(Debug, Clone)]
pub struct NewOrchestrator {
    pub session_id: String,
    pub user_id: String,
    pub orchestrator_type: String, // "master" or "sub_orchestrator"
    pub scope_type: Option<String>, // "folder" or None
    pub scope_id: Option<String>,   // folder_id or None
    pub custom_instructions: Option<String>,
    pub monitoring_interval: i32,
    pub stall_threshold: i32,
    pub auto_intervention: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_open_path_creates_database() {
        let temp = tempdir().expect("Failed to create temp dir");
        let db_path = temp.path().join("test.db");

        // Database shouldn't exist yet
        assert!(!db_path.exists());

        // Opening should create it
        let result = Database::open_path(&db_path);
        assert!(result.is_ok(), "Failed to open database: {:?}", result.err());

        // Path should exist after creation
        assert!(db_path.exists());
    }

    #[test]
    fn test_open_path_with_nonexistent_parent() {
        let temp = tempdir().expect("Failed to create temp dir");
        let db_path = temp.path().join("nested").join("path").join("test.db");

        // This should fail because parent directories don't exist
        let result = Database::open_path(&db_path);
        assert!(result.is_err());
    }

    #[test]
    fn test_open_path_with_existing_db() {
        let temp = tempdir().expect("Failed to create temp dir");
        let db_path = temp.path().join("existing.db");

        // Create the database first
        let _db1 = Database::open_path(&db_path).expect("Failed to create database");

        // Opening again should work
        let db2 = Database::open_path(&db_path);
        assert!(db2.is_ok(), "Failed to reopen database: {:?}", db2.err());
    }

    #[test]
    fn test_user_struct() {
        let user = User {
            id: "user-123".to_string(),
            name: Some("Test User".to_string()),
            email: Some("test@example.com".to_string()),
        };

        assert_eq!(user.id, "user-123");
        assert_eq!(user.name, Some("Test User".to_string()));
        assert_eq!(user.email, Some("test@example.com".to_string()));

        // Test with None values
        let user_minimal = User {
            id: "user-456".to_string(),
            name: None,
            email: None,
        };
        assert!(user_minimal.name.is_none());
        assert!(user_minimal.email.is_none());
    }

    #[test]
    fn test_session_struct() {
        let session = Session {
            id: "sess-123".to_string(),
            user_id: "user-456".to_string(),
            name: "Test Session".to_string(),
            tmux_session_name: "rdv-abc".to_string(),
            project_path: Some("/path/to/project".to_string()),
            folder_id: Some("folder-789".to_string()),
            agent_provider: Some("claude".to_string()),
            is_orchestrator_session: false,
            status: "active".to_string(),
            created_at: 1000000,
            updated_at: 1000001,
        };

        assert_eq!(session.id, "sess-123");
        assert_eq!(session.status, "active");
        assert!(!session.is_orchestrator_session);
        assert_eq!(session.agent_provider, Some("claude".to_string()));
    }

    #[test]
    fn test_folder_struct() {
        let folder = Folder {
            id: "folder-123".to_string(),
            user_id: "user-456".to_string(),
            parent_id: Some("parent-789".to_string()),
            name: "My Folder".to_string(),
            collapsed: false,
            sort_order: 5,
            created_at: 1000000,
        };

        assert_eq!(folder.id, "folder-123");
        assert_eq!(folder.name, "My Folder");
        assert!(!folder.collapsed);
        assert_eq!(folder.sort_order, 5);

        // Test root folder (no parent)
        let root_folder = Folder {
            id: "folder-root".to_string(),
            user_id: "user-456".to_string(),
            parent_id: None,
            name: "Root".to_string(),
            collapsed: true,
            sort_order: 0,
            created_at: 1000000,
        };
        assert!(root_folder.parent_id.is_none());
        assert!(root_folder.collapsed);
    }

    #[test]
    fn test_orchestrator_struct() {
        let orchestrator = Orchestrator {
            id: "orch-123".to_string(),
            session_id: "sess-456".to_string(),
            user_id: "user-789".to_string(),
            orchestrator_type: "master".to_string(),
            status: "active".to_string(),
            scope_type: None,
            scope_id: None,
            custom_instructions: Some("Be helpful".to_string()),
            monitoring_interval: 30,
            stall_threshold: 300,
            auto_intervention: true,
            last_activity_at: 1000000,
            created_at: 999999,
            updated_at: 1000001,
            tmux_session_name: "rdv-master".to_string(),
        };

        assert_eq!(orchestrator.orchestrator_type, "master");
        assert!(orchestrator.auto_intervention);
        assert_eq!(orchestrator.monitoring_interval, 30);
        assert_eq!(orchestrator.stall_threshold, 300);
    }

    #[test]
    fn test_insight_struct() {
        let insight = Insight {
            id: "insight-123".to_string(),
            orchestrator_id: "orch-456".to_string(),
            session_id: Some("sess-789".to_string()),
            insight_type: "stall".to_string(),
            severity: "high".to_string(),
            title: "Session Stalled".to_string(),
            description: "No activity for 10 minutes".to_string(),
            context: Some("{\"last_hash\":\"abc\"}".to_string()),
            suggested_actions: Some("[\"Check logs\",\"Restart session\"]".to_string()),
            resolved: false,
            resolved_at: None,
            resolved_by: None,
            resolution_notes: None,
            confidence: 0.85,
            triggered_by: "monitoring".to_string(),
            created_at: 1000000,
        };

        assert_eq!(insight.insight_type, "stall");
        assert_eq!(insight.severity, "high");
        assert!(!insight.resolved);
        assert_eq!(insight.confidence, 0.85);

        // Test resolved insight
        let resolved_insight = Insight {
            resolved: true,
            resolved_at: Some(1000500),
            resolved_by: Some("user@example.com".to_string()),
            resolution_notes: Some("Fixed manually".to_string()),
            ..insight.clone()
        };
        assert!(resolved_insight.resolved);
        assert!(resolved_insight.resolved_at.is_some());
    }

    #[test]
    fn test_task_struct() {
        let task = Task {
            id: "task-123".to_string(),
            orchestrator_id: Some("orch-456".to_string()),
            user_id: "user-789".to_string(),
            folder_id: Some("folder-abc".to_string()),
            description: "Fix the bug".to_string(),
            task_type: "bug".to_string(),
            status: "pending".to_string(),
            confidence: Some(0.9),
            estimated_duration: Some(30),
            assigned_agent: Some("claude".to_string()),
            delegation_id: None,
            beads_issue_id: Some("beads-xyz".to_string()),
            context_injected: false,
            result_json: None,
            error_json: None,
            created_at: 1000000,
            updated_at: 1000001,
            completed_at: None,
        };

        assert_eq!(task.task_type, "bug");
        assert_eq!(task.status, "pending");
        assert!(!task.context_injected);
        assert!(task.completed_at.is_none());

        // Test completed task
        let completed_task = Task {
            status: "completed".to_string(),
            completed_at: Some(1000500),
            result_json: Some("{\"success\": true}".to_string()),
            ..task.clone()
        };
        assert_eq!(completed_task.status, "completed");
        assert!(completed_task.completed_at.is_some());
    }

    #[test]
    fn test_stalled_session_struct() {
        let stalled = StalledSession {
            session_id: "sess-123".to_string(),
            session_name: "Test Session".to_string(),
            tmux_session_name: "rdv-abc".to_string(),
            folder_id: Some("folder-456".to_string()),
            last_activity_at: Some(1000000),
            stalled_minutes: 15,
        };

        assert_eq!(stalled.stalled_minutes, 15);
        assert!(stalled.last_activity_at.is_some());

        // Test session that never had activity
        let never_active = StalledSession {
            last_activity_at: None,
            stalled_minutes: -1,
            ..stalled.clone()
        };
        assert!(never_active.last_activity_at.is_none());
        assert_eq!(never_active.stalled_minutes, -1);
    }

    #[test]
    fn test_new_insight_struct() {
        let new_insight = NewInsight {
            orchestrator_id: "orch-123".to_string(),
            session_id: Some("sess-456".to_string()),
            insight_type: "error".to_string(),
            severity: "medium".to_string(),
            title: "Error Detected".to_string(),
            description: "Something went wrong".to_string(),
            context: None,
            suggested_actions: None,
            confidence: 0.75,
            triggered_by: "user".to_string(),
        };

        assert_eq!(new_insight.insight_type, "error");
        assert_eq!(new_insight.confidence, 0.75);
    }

    #[test]
    fn test_new_session_struct() {
        let new_session = NewSession {
            user_id: "user-123".to_string(),
            name: "New Session".to_string(),
            tmux_session_name: "rdv-new".to_string(),
            project_path: Some("/projects/test".to_string()),
            folder_id: None,
            worktree_branch: Some("feature/my-branch".to_string()),
            agent_provider: Some("claude".to_string()),
            is_orchestrator_session: false,
        };

        assert_eq!(new_session.name, "New Session");
        assert!(!new_session.is_orchestrator_session);
        assert_eq!(new_session.worktree_branch, Some("feature/my-branch".to_string()));
    }

    #[test]
    fn test_new_folder_struct() {
        let new_folder = NewFolder {
            user_id: "user-123".to_string(),
            name: "New Folder".to_string(),
            parent_id: None,
        };

        assert_eq!(new_folder.name, "New Folder");
        assert!(new_folder.parent_id.is_none());
    }

    #[test]
    fn test_new_orchestrator_struct() {
        let new_orch = NewOrchestrator {
            session_id: "sess-123".to_string(),
            user_id: "user-456".to_string(),
            orchestrator_type: "sub_orchestrator".to_string(),
            scope_type: Some("folder".to_string()),
            scope_id: Some("folder-789".to_string()),
            custom_instructions: Some("Monitor this folder".to_string()),
            monitoring_interval: 60,
            stall_threshold: 600,
            auto_intervention: false,
        };

        assert_eq!(new_orch.orchestrator_type, "sub_orchestrator");
        assert!(!new_orch.auto_intervention);
        assert_eq!(new_orch.monitoring_interval, 60);
    }
}
