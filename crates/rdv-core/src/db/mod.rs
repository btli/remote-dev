//! Direct SQLite database access for rdv.
//!
//! This module provides direct read/write access to the Remote Dev SQLite database.
//!
//! Database location priority:
//! 1. RDV_DATABASE_PATH env var
//! 2. Walk up directory tree looking for sqlite.db
//! 3. ~/.remote-dev/sqlite.db

mod types;

pub use types::*;

use crate::error::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;

/// Database connection wrapper
pub struct Database {
    conn: Connection,
}

impl Database {
    /// Open database connection, auto-detecting location
    pub fn open() -> Result<Self> {
        let path = Self::find_database()?;
        let conn = Connection::open(&path).map_err(Error::Database)?;
        Ok(Self { conn })
    }

    /// Open database at specific path
    pub fn open_path(path: &PathBuf) -> Result<Self> {
        let conn = Connection::open(path).map_err(Error::Database)?;
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
            home.join(".remote-dev/sqlite.db"),
            home.join("Projects/btli/remote-dev/sqlite.db"),
            PathBuf::from("./sqlite.db"),
        ];

        for candidate in &candidates {
            if candidate.exists() {
                return Ok(candidate.clone());
            }
        }

        Err(Error::DatabaseNotFound)
    }

    /// Check database connectivity
    pub fn ping(&self) -> Result<()> {
        self.conn
            .execute_batch("SELECT 1")
            .map_err(Error::Database)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Session Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List all sessions for a user
    pub fn list_sessions(&self, user_id: &str, folder_id: Option<&str>) -> Result<Vec<Session>> {
        let sessions = if let Some(fid) = folder_id {
            let mut stmt = self.conn.prepare(
                "SELECT id, user_id, name, tmux_session_name, project_path, folder_id,
                        worktree_branch, agent_provider, is_orchestrator_session, status,
                        created_at, updated_at
                 FROM terminal_session
                 WHERE user_id = ?1 AND folder_id = ?2 AND status != 'closed'
                 ORDER BY tab_order",
            )?;
            stmt.query_map(params![user_id, fid], Self::map_session)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        } else {
            let mut stmt = self.conn.prepare(
                "SELECT id, user_id, name, tmux_session_name, project_path, folder_id,
                        worktree_branch, agent_provider, is_orchestrator_session, status,
                        created_at, updated_at
                 FROM terminal_session
                 WHERE user_id = ?1 AND status != 'closed'
                 ORDER BY tab_order",
            )?;
            stmt.query_map(params![user_id], Self::map_session)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        Ok(sessions)
    }

    /// Get session by ID
    pub fn get_session(&self, session_id: &str) -> Result<Option<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, name, tmux_session_name, project_path, folder_id,
                    worktree_branch, agent_provider, is_orchestrator_session, status,
                    created_at, updated_at
             FROM terminal_session WHERE id = ?1",
        )?;

        Ok(stmt
            .query_row(params![session_id], Self::map_session)
            .optional()?)
    }

    /// Get session by tmux session name
    pub fn get_session_by_tmux_name(&self, tmux_name: &str) -> Result<Option<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, name, tmux_session_name, project_path, folder_id,
                    worktree_branch, agent_provider, is_orchestrator_session, status,
                    created_at, updated_at
             FROM terminal_session WHERE tmux_session_name = ?1",
        )?;

        Ok(stmt
            .query_row(params![tmux_name], Self::map_session)
            .optional()?)
    }

    fn map_session(row: &rusqlite::Row) -> rusqlite::Result<Session> {
        Ok(Session {
            id: row.get(0)?,
            user_id: row.get(1)?,
            name: row.get(2)?,
            tmux_session_name: row.get(3)?,
            project_path: row.get(4)?,
            folder_id: row.get(5)?,
            worktree_branch: row.get(6)?,
            agent_provider: row.get(7)?,
            is_orchestrator_session: row.get(8)?,
            status: row.get(9)?,
            created_at: row.get(10)?,
            updated_at: row.get(11)?,
        })
    }

    /// Create a new terminal session
    pub fn create_session(&self, session: &NewSession) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        self.conn.execute(
            "INSERT INTO terminal_session
             (id, user_id, name, tmux_session_name, project_path, folder_id,
              worktree_branch, agent_provider, is_orchestrator_session, status,
              last_activity_at, created_at, updated_at)
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

    // ─────────────────────────────────────────────────────────────────────────
    // Folder Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List all folders for a user
    pub fn list_folders(&self, user_id: &str) -> Result<Vec<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, parent_id, name, collapsed, sort_order, created_at
             FROM session_folder WHERE user_id = ?1 ORDER BY sort_order",
        )?;

        let folders = stmt
            .query_map(params![user_id], |row| {
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
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(folders)
    }

    /// Get folder by ID
    pub fn get_folder(&self, folder_id: &str) -> Result<Option<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, parent_id, name, collapsed, sort_order, created_at
             FROM session_folder WHERE id = ?1",
        )?;

        Ok(stmt
            .query_row(params![folder_id], |row| {
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
            .optional()?)
    }

    /// Get folder by name for a user
    pub fn get_folder_by_name(&self, user_id: &str, name: &str) -> Result<Option<Folder>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_id, parent_id, name, collapsed, sort_order, created_at
             FROM session_folder WHERE user_id = ?1 AND name = ?2",
        )?;

        Ok(stmt
            .query_row(params![user_id, name], |row| {
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
            .optional()?)
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
            params![id, folder.user_id, folder.parent_id, folder.name, max_order + 1, now,],
        )?;

        Ok(id)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get default user (first user in database, for local single-user mode)
    pub fn get_default_user(&self) -> Result<Option<User>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, email FROM user LIMIT 1")?;

        Ok(stmt
            .query_row([], |row| {
                Ok(User {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                })
            })
            .optional()?)
    }

    /// Get user by email
    pub fn get_user_by_email(&self, email: &str) -> Result<Option<User>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, name, email FROM user WHERE email = ?1")?;

        Ok(stmt
            .query_row(params![email], |row| {
                Ok(User {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    email: row.get(2)?,
                })
            })
            .optional()?)
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
             WHERE o.user_id = ?1 AND o.type = 'master'",
        )?;

        Ok(stmt
            .query_row(params![user_id], Self::map_orchestrator)
            .optional()?)
    }

    /// Get folder orchestrator
    pub fn get_folder_orchestrator(
        &self,
        user_id: &str,
        folder_id: &str,
    ) -> Result<Option<Orchestrator>> {
        let mut stmt = self.conn.prepare(
            "SELECT o.id, o.session_id, o.user_id, o.type, o.status, o.scope_type, o.scope_id,
                    o.custom_instructions, o.monitoring_interval, o.stall_threshold,
                    o.auto_intervention, o.last_activity_at, o.created_at, o.updated_at,
                    t.tmux_session_name
             FROM orchestrator_session o
             JOIN terminal_session t ON o.session_id = t.id
             WHERE o.user_id = ?1 AND o.scope_id = ?2",
        )?;

        Ok(stmt
            .query_row(params![user_id, folder_id], Self::map_orchestrator)
            .optional()?)
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
             ORDER BY o.type DESC, o.created_at",
        )?;

        let orchestrators = stmt
            .query_map(params![user_id], Self::map_orchestrator)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

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
    // Monitoring Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get sessions that may be stalled (no activity for threshold_secs)
    pub fn get_stalled_sessions(
        &self,
        user_id: &str,
        threshold_secs: i64,
    ) -> Result<Vec<StalledSession>> {
        let threshold_ms = chrono::Utc::now().timestamp_millis() - (threshold_secs * 1000);

        let mut stmt = self.conn.prepare(
            "SELECT id, name, tmux_session_name, folder_id, last_activity_at
             FROM terminal_session
             WHERE user_id = ?1
               AND status = 'active'
               AND is_orchestrator_session = 0
               AND (last_activity_at IS NULL OR last_activity_at < ?2)
             ORDER BY last_activity_at ASC",
        )?;

        let sessions = stmt
            .query_map(params![user_id, threshold_ms], |row| {
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
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(sessions)
    }
}
