//! Direct SQLite database access for rdv.
//!
//! This module provides direct read/write access to the Remote Dev SQLite database.
//!
//! Database location priority:
//! 1. RDV_DATABASE_PATH env var
//! 2. Walk up directory tree looking for sqlite.db
//! 3. ~/.remote-dev/sqlite.db

pub mod types;

pub use types::*;

use crate::error::{Error, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::Mutex;

/// Database connection wrapper.
///
/// Thread-safe via internal Mutex. All database operations acquire the lock.
pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    /// Open database connection, auto-detecting location
    pub fn open() -> Result<Self> {
        let path = Self::find_database()?;
        let conn = Connection::open(&path).map_err(Error::Database)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Open database at specific path
    pub fn open_path(path: &PathBuf) -> Result<Self> {
        let conn = Connection::open(path).map_err(Error::Database)?;
        Ok(Self { conn: Mutex::new(conn) })
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
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        conn.execute_batch("SELECT 1")
            .map_err(Error::Database)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Session Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List all sessions for a user
    pub fn list_sessions(&self, user_id: &str, folder_id: Option<&str>) -> Result<Vec<Session>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let sessions = if let Some(fid) = folder_id {
            let mut stmt = conn.prepare(
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
            let mut stmt = conn.prepare(
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
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
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
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
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
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
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
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE terminal_session SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now, session_id],
        )?;
        Ok(())
    }

    /// Update session last activity timestamp
    pub fn update_session_activity(&self, session_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE terminal_session SET last_activity_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )?;
        Ok(())
    }

    /// Update session last activity timestamp with a specific timestamp
    pub fn update_session_activity_at(&self, session_id: &str, timestamp: i64) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        conn.execute(
            "UPDATE terminal_session SET last_activity_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![timestamp, session_id],
        )?;
        Ok(())
    }

    /// Get active session count for user
    pub fn get_active_session_count(&self, user_id: &str) -> Result<u32> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let count: u32 = conn.query_row(
            "SELECT COUNT(*) FROM terminal_session WHERE user_id = ?1 AND status = 'active'",
            params![user_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Count all active sessions (for health check)
    pub fn count_active_sessions(&self) -> Result<u32> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let count: u32 = conn.query_row(
            "SELECT COUNT(*) FROM terminal_session WHERE status = 'active'",
            [],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Update session name
    pub fn update_session_name(&self, session_id: &str, name: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE terminal_session SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, session_id],
        )?;
        Ok(())
    }

    /// Update session folder
    pub fn update_session_folder(&self, session_id: &str, folder_id: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE terminal_session SET folder_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![folder_id, now, session_id],
        )?;
        Ok(())
    }

    /// Reorder sessions by updating their tab_order based on the order of IDs provided
    /// Validates all sessions belong to the user before updating
    pub fn reorder_sessions(&self, user_id: &str, session_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();

        // Use a transaction to ensure atomicity
        let tx = conn.unchecked_transaction()?;

        for (index, session_id) in session_ids.iter().enumerate() {
            let rows_affected = tx.execute(
                "UPDATE terminal_session SET tab_order = ?1, updated_at = ?2
                 WHERE id = ?3 AND user_id = ?4",
                params![index as i32, now, session_id, user_id],
            )?;

            // If no rows affected, session doesn't exist or doesn't belong to user
            if rows_affected == 0 {
                // Roll back by dropping tx without commit
                return Err(Error::Other(format!(
                    "Session {} not found or access denied",
                    session_id
                )));
            }
        }

        tx.commit()?;
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Folder Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List all folders for a user
    pub fn list_folders(&self, user_id: &str) -> Result<Vec<Folder>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, parent_id, name, path, color, icon, collapsed, sort_order, created_at, updated_at
             FROM session_folder WHERE user_id = ?1 ORDER BY sort_order",
        )?;

        let folders = stmt
            .query_map(params![user_id], Self::map_folder)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(folders)
    }

    /// Get folder by ID
    pub fn get_folder(&self, folder_id: &str) -> Result<Option<Folder>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, parent_id, name, path, color, icon, collapsed, sort_order, created_at, updated_at
             FROM session_folder WHERE id = ?1",
        )?;

        Ok(stmt.query_row(params![folder_id], Self::map_folder).optional()?)
    }

    /// Get folder by name for a user
    pub fn get_folder_by_name(&self, user_id: &str, name: &str) -> Result<Option<Folder>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, parent_id, name, path, color, icon, collapsed, sort_order, created_at, updated_at
             FROM session_folder WHERE user_id = ?1 AND name = ?2",
        )?;

        Ok(stmt.query_row(params![user_id, name], Self::map_folder).optional()?)
    }

    /// Get child folders
    pub fn get_child_folders(&self, parent_id: &str) -> Result<Vec<Folder>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, parent_id, name, path, color, icon, collapsed, sort_order, created_at, updated_at
             FROM session_folder WHERE parent_id = ?1 ORDER BY sort_order",
        )?;

        let folders = stmt
            .query_map(params![parent_id], Self::map_folder)?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(folders)
    }

    fn map_folder(row: &rusqlite::Row) -> rusqlite::Result<Folder> {
        Ok(Folder {
            id: row.get(0)?,
            user_id: row.get(1)?,
            parent_id: row.get(2)?,
            name: row.get(3)?,
            path: row.get(4)?,
            color: row.get(5)?,
            icon: row.get(6)?,
            collapsed: row.get(7)?,
            sort_order: row.get(8)?,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
        })
    }

    /// Create a new folder (by parameters)
    #[allow(clippy::too_many_arguments)]
    pub fn create_folder(
        &self,
        id: &str,
        user_id: &str,
        name: &str,
        path: Option<&str>,
        parent_id: Option<&str>,
        color: Option<&str>,
        icon: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();

        // Get max sort_order for this user to append at end
        let max_order: i32 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM session_folder WHERE user_id = ?1",
            params![user_id],
            |row| row.get(0),
        )?;

        conn.execute(
            "INSERT INTO session_folder
             (id, user_id, parent_id, name, path, color, icon, collapsed, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?9)",
            params![id, user_id, parent_id, name, path, color, icon, max_order + 1, now],
        )?;

        Ok(())
    }

    /// Create a new folder (from struct)
    pub fn create_folder_from_struct(&self, folder: &NewFolder) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.create_folder(&id, &folder.user_id, &folder.name, None, folder.parent_id.as_deref(), None, None)?;
        Ok(id)
    }

    /// Update folder
    #[allow(clippy::too_many_arguments)]
    pub fn update_folder(
        &self,
        folder_id: &str,
        name: Option<&str>,
        path: Option<&str>,
        parent_id: Option<&str>,
        color: Option<&str>,
        icon: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();

        if let Some(n) = name {
            conn.execute(
                "UPDATE session_folder SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![n, now, folder_id],
            )?;
        }
        if let Some(p) = path {
            conn.execute(
                "UPDATE session_folder SET path = ?1, updated_at = ?2 WHERE id = ?3",
                params![p, now, folder_id],
            )?;
        }
        if let Some(pid) = parent_id {
            conn.execute(
                "UPDATE session_folder SET parent_id = ?1, updated_at = ?2 WHERE id = ?3",
                params![pid, now, folder_id],
            )?;
        }
        if let Some(c) = color {
            conn.execute(
                "UPDATE session_folder SET color = ?1, updated_at = ?2 WHERE id = ?3",
                params![c, now, folder_id],
            )?;
        }
        if let Some(i) = icon {
            conn.execute(
                "UPDATE session_folder SET icon = ?1, updated_at = ?2 WHERE id = ?3",
                params![i, now, folder_id],
            )?;
        }

        Ok(())
    }

    /// Delete folder
    pub fn delete_folder(&self, folder_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        conn.execute(
            "DELETE FROM session_folder WHERE id = ?1",
            params![folder_id],
        )?;
        Ok(())
    }

    /// Reorder folders by updating their sort_order based on the order of IDs provided
    /// Validates all folders belong to the user before updating
    pub fn reorder_folders(&self, user_id: &str, folder_ids: &[String]) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();

        // Use a transaction to ensure atomicity
        let tx = conn.unchecked_transaction()?;

        for (index, folder_id) in folder_ids.iter().enumerate() {
            let rows_affected = tx.execute(
                "UPDATE session_folder SET sort_order = ?1, updated_at = ?2
                 WHERE id = ?3 AND user_id = ?4",
                params![index as i32, now, folder_id, user_id],
            )?;

            // If no rows affected, folder doesn't exist or doesn't belong to user
            if rows_affected == 0 {
                // Roll back by dropping tx without commit
                return Err(Error::Other(format!(
                    "Folder {} not found or access denied",
                    folder_id
                )));
            }
        }

        tx.commit()?;
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // User Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get default user (first user in database, for local single-user mode)
    pub fn get_default_user(&self) -> Result<Option<User>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare("SELECT id, name, email FROM user LIMIT 1")?;

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
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare("SELECT id, name, email FROM user WHERE email = ?1")?;

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
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
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
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
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

    /// Check if a folder orchestrator exists (including pending bootstrap).
    ///
    /// Unlike get_folder_orchestrator, this doesn't require a session to exist.
    pub fn folder_orchestrator_exists(&self, user_id: &str, folder_id: &str) -> Result<bool> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM orchestrator_session
             WHERE user_id = ?1 AND scope_id = ?2",
            params![user_id, folder_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// List all orchestrators for user (returns OrchestratorSimple for REST API)
    pub fn list_orchestrators(&self, user_id: &str) -> Result<Vec<OrchestratorSimple>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, scope_id, session_id, type, status,
                    monitoring_interval, stall_threshold, created_at, updated_at
             FROM orchestrator_session
             WHERE user_id = ?1
             ORDER BY type DESC, created_at",
        )?;

        let orchestrators = stmt
            .query_map(params![user_id], |row| {
                Ok(OrchestratorSimple {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    folder_id: row.get(2)?,
                    session_id: row.get(3)?,
                    orchestrator_type: row.get(4)?,
                    status: row.get(5)?,
                    monitoring_interval_secs: row.get(6)?,
                    stall_threshold_secs: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(orchestrators)
    }

    /// Update orchestrator status
    pub fn update_orchestrator_status(&self, orchestrator_id: &str, status: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        conn.execute(
            "UPDATE orchestrator_session SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, chrono::Utc::now().timestamp_millis(), orchestrator_id],
        )?;
        Ok(())
    }

    /// Create a new orchestrator
    pub fn create_orchestrator(&self, orchestrator: &NewOrchestrator) -> Result<String> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
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
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let threshold_ms = chrono::Utc::now().timestamp_millis() - (threshold_secs * 1000);

        let mut stmt = conn.prepare(
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

    /// Check if there's an unresolved stall insight for a session
    pub fn has_unresolved_stall_insight(&self, session_id: &str) -> Result<bool> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM orchestrator_insight
             WHERE session_id = ?1 AND type = 'stall' AND resolved = 0",
            params![session_id],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Extended Orchestrator Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get orchestrator by ID
    pub fn get_orchestrator(&self, orchestrator_id: &str) -> Result<Option<OrchestratorSimple>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, scope_id, session_id, type, status,
                    monitoring_interval, stall_threshold, created_at, updated_at
             FROM orchestrator_session WHERE id = ?1",
        )?;

        Ok(stmt
            .query_row(params![orchestrator_id], |row| {
                Ok(OrchestratorSimple {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    folder_id: row.get(2)?,
                    session_id: row.get(3)?,
                    orchestrator_type: row.get(4)?,
                    status: row.get(5)?,
                    monitoring_interval_secs: row.get(6)?,
                    stall_threshold_secs: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .optional()?)
    }

    /// Create orchestrator (by parameters)
    #[allow(clippy::too_many_arguments)]
    pub fn create_orchestrator_simple(
        &self,
        id: &str,
        user_id: &str,
        folder_id: Option<&str>,
        session_id: Option<&str>,
        orchestrator_type: &str,
        monitoring_interval: i32,
        stall_threshold: i32,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO orchestrator_session
             (id, user_id, scope_id, session_id, type, status,
              monitoring_interval, stall_threshold, auto_intervention,
              last_activity_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'idle', ?6, ?7, 1, ?8, ?8, ?8)",
            params![
                id, user_id, folder_id, session_id, orchestrator_type,
                monitoring_interval, stall_threshold, now
            ],
        )?;

        Ok(())
    }

    /// Update orchestrator monitoring interval
    pub fn update_orchestrator_interval(&self, orchestrator_id: &str, interval: i32) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE orchestrator_session SET monitoring_interval = ?1, updated_at = ?2 WHERE id = ?3",
            params![interval, now, orchestrator_id],
        )?;
        Ok(())
    }

    /// Update orchestrator stall threshold
    pub fn update_orchestrator_threshold(&self, orchestrator_id: &str, threshold: i32) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE orchestrator_session SET stall_threshold = ?1, updated_at = ?2 WHERE id = ?3",
            params![threshold, now, orchestrator_id],
        )?;
        Ok(())
    }

    /// Update orchestrator last activity timestamp
    pub fn update_orchestrator_activity(&self, orchestrator_id: &str, timestamp: i64) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        conn.execute(
            "UPDATE orchestrator_session SET last_activity_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![timestamp, orchestrator_id],
        )?;
        Ok(())
    }

    /// Delete orchestrator
    pub fn delete_orchestrator(&self, orchestrator_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        conn.execute(
            "DELETE FROM orchestrator_session WHERE id = ?1",
            params![orchestrator_id],
        )?;
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Insight Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List insights for an orchestrator
    pub fn list_insights(&self, orchestrator_id: &str, resolved: Option<bool>) -> Result<Vec<Insight>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let query = if let Some(r) = resolved {
            format!(
                "SELECT id, orchestrator_id, session_id, type, severity, title, description,
                        context, suggested_actions, resolved, resolved_at, resolved_by, created_at
                 FROM orchestrator_insight
                 WHERE orchestrator_id = ?1 AND resolved = {}
                 ORDER BY created_at DESC",
                if r { 1 } else { 0 }
            )
        } else {
            "SELECT id, orchestrator_id, session_id, type, severity, title, description,
                    context, suggested_actions, resolved, resolved_at, resolved_by, created_at
             FROM orchestrator_insight
             WHERE orchestrator_id = ?1
             ORDER BY created_at DESC".to_string()
        };

        let mut stmt = conn.prepare(&query)?;

        let insights = stmt
            .query_map(params![orchestrator_id], |row| {
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
                    created_at: row.get(12)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(insights)
    }

    /// Create an insight
    pub fn create_insight(&self, insight: &NewInsight) -> Result<String> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO orchestrator_insight
             (id, orchestrator_id, session_id, type, severity, title, description,
              context, suggested_actions, resolved, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10)",
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
                now,
            ],
        )?;

        Ok(id)
    }

    /// Get insight by ID
    pub fn get_insight(&self, insight_id: &str) -> Result<Option<Insight>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;

        conn.query_row(
            "SELECT id, orchestrator_id, session_id, type, severity, title, description,
                    context, suggested_actions, resolved, resolved_at, resolved_by, created_at
             FROM orchestrator_insight WHERE id = ?1",
            params![insight_id],
            |row| {
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
                    created_at: row.get(12)?,
                })
            },
        )
        .optional()
        .map_err(Error::from)
    }

    /// Resolve an insight
    pub fn resolve_insight(&self, insight_id: &str, resolved_by: Option<&str>) -> Result<bool> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();

        let rows = conn.execute(
            "UPDATE orchestrator_insight
             SET resolved = 1, resolved_at = ?1, resolved_by = ?2
             WHERE id = ?3 AND resolved = 0",
            params![now, resolved_by, insight_id],
        )?;

        Ok(rows > 0)
    }

    /// Delete an insight
    pub fn delete_insight(&self, insight_id: &str) -> Result<bool> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;

        let rows = conn.execute(
            "DELETE FROM orchestrator_insight WHERE id = ?1",
            params![insight_id],
        )?;

        Ok(rows > 0)
    }

    /// Bulk resolve insights for a session
    pub fn resolve_session_insights(&self, session_id: &str, resolved_by: Option<&str>) -> Result<usize> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();

        let rows = conn.execute(
            "UPDATE orchestrator_insight
             SET resolved = 1, resolved_at = ?1, resolved_by = ?2
             WHERE session_id = ?3 AND resolved = 0",
            params![now, resolved_by, session_id],
        )?;

        Ok(rows)
    }

    /// Get insight counts for an orchestrator
    pub fn get_insight_counts(&self, orchestrator_id: &str) -> Result<InsightCounts> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;

        // Total count
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM orchestrator_insight WHERE orchestrator_id = ?1",
            params![orchestrator_id],
            |row| row.get(0),
        )?;

        // Unresolved count
        let unresolved: i64 = conn.query_row(
            "SELECT COUNT(*) FROM orchestrator_insight WHERE orchestrator_id = ?1 AND resolved = 0",
            params![orchestrator_id],
            |row| row.get(0),
        )?;

        // Count by severity (unresolved only)
        let critical: i64 = conn.query_row(
            "SELECT COUNT(*) FROM orchestrator_insight WHERE orchestrator_id = ?1 AND resolved = 0 AND severity = 'critical'",
            params![orchestrator_id],
            |row| row.get(0),
        )?;

        let high: i64 = conn.query_row(
            "SELECT COUNT(*) FROM orchestrator_insight WHERE orchestrator_id = ?1 AND resolved = 0 AND severity = 'high'",
            params![orchestrator_id],
            |row| row.get(0),
        )?;

        let medium: i64 = conn.query_row(
            "SELECT COUNT(*) FROM orchestrator_insight WHERE orchestrator_id = ?1 AND resolved = 0 AND severity = 'medium'",
            params![orchestrator_id],
            |row| row.get(0),
        )?;

        let low: i64 = conn.query_row(
            "SELECT COUNT(*) FROM orchestrator_insight WHERE orchestrator_id = ?1 AND resolved = 0 AND severity = 'low'",
            params![orchestrator_id],
            |row| row.get(0),
        )?;

        Ok(InsightCounts {
            total: total as u32,
            unresolved: unresolved as u32,
            critical: critical as u32,
            high: high as u32,
            medium: medium as u32,
            low: low as u32,
        })
    }

    /// Cleanup old resolved insights
    pub fn cleanup_old_insights(&self, max_age_secs: i64) -> Result<usize> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let cutoff = chrono::Utc::now().timestamp_millis() - (max_age_secs * 1000);

        let rows = conn.execute(
            "DELETE FROM orchestrator_insight
             WHERE resolved = 1 AND resolved_at IS NOT NULL AND resolved_at <= ?1",
            params![cutoff],
        )?;

        Ok(rows)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Audit Log Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Create audit log entry
    pub fn create_audit_log(
        &self,
        orchestrator_id: &str,
        session_id: &str,
        action_type: &str,
        details: &str,
    ) -> Result<String> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO orchestrator_audit_log
             (id, orchestrator_id, session_id, action_type, details, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, orchestrator_id, session_id, action_type, details, now],
        )?;

        Ok(id)
    }

    /// List audit logs for an orchestrator
    pub fn list_audit_logs(
        &self,
        orchestrator_id: &str,
        action_type: Option<&str>,
        session_id: Option<&str>,
        start_date: Option<i64>,
        end_date: Option<i64>,
        limit: usize,
    ) -> Result<Vec<AuditLog>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;

        // Build dynamic query
        let mut query = String::from(
            "SELECT id, orchestrator_id, session_id, action_type, details, created_at
             FROM orchestrator_audit_log
             WHERE orchestrator_id = ?1",
        );
        let mut param_idx = 2;

        if action_type.is_some() {
            query.push_str(&format!(" AND action_type = ?{}", param_idx));
            param_idx += 1;
        }
        if session_id.is_some() {
            query.push_str(&format!(" AND session_id = ?{}", param_idx));
            param_idx += 1;
        }
        if start_date.is_some() {
            query.push_str(&format!(" AND created_at >= ?{}", param_idx));
            param_idx += 1;
        }
        if end_date.is_some() {
            query.push_str(&format!(" AND created_at <= ?{}", param_idx));
        }

        query.push_str(" ORDER BY created_at DESC LIMIT ?");

        let mut stmt = conn.prepare(&query)?;

        // Build params dynamically
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(orchestrator_id.to_string())];
        if let Some(at) = action_type {
            params_vec.push(Box::new(at.to_string()));
        }
        if let Some(sid) = session_id {
            params_vec.push(Box::new(sid.to_string()));
        }
        if let Some(sd) = start_date {
            params_vec.push(Box::new(sd));
        }
        if let Some(ed) = end_date {
            params_vec.push(Box::new(ed));
        }
        params_vec.push(Box::new(limit as i64));

        let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        let logs = stmt
            .query_map(params_refs.as_slice(), |row| {
                Ok(AuditLog {
                    id: row.get(0)?,
                    orchestrator_id: row.get(1)?,
                    session_id: row.get(2)?,
                    action_type: row.get(3)?,
                    details: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(logs)
    }

    /// Count audit logs for an orchestrator (with optional filters)
    pub fn count_audit_logs(
        &self,
        orchestrator_id: &str,
        action_type: Option<&str>,
        session_id: Option<&str>,
        start_date: Option<i64>,
        end_date: Option<i64>,
    ) -> Result<u32> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;

        // Build dynamic query
        let mut query = String::from(
            "SELECT COUNT(*) FROM orchestrator_audit_log WHERE orchestrator_id = ?1",
        );
        let mut param_idx = 2;

        if action_type.is_some() {
            query.push_str(&format!(" AND action_type = ?{}", param_idx));
            param_idx += 1;
        }
        if session_id.is_some() {
            query.push_str(&format!(" AND session_id = ?{}", param_idx));
            param_idx += 1;
        }
        if start_date.is_some() {
            query.push_str(&format!(" AND created_at >= ?{}", param_idx));
            param_idx += 1;
        }
        if end_date.is_some() {
            query.push_str(&format!(" AND created_at <= ?{}", param_idx));
        }

        let mut stmt = conn.prepare(&query)?;

        // Build params dynamically
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(orchestrator_id.to_string())];
        if let Some(at) = action_type {
            params_vec.push(Box::new(at.to_string()));
        }
        if let Some(sid) = session_id {
            params_vec.push(Box::new(sid.to_string()));
        }
        if let Some(sd) = start_date {
            params_vec.push(Box::new(sd));
        }
        if let Some(ed) = end_date {
            params_vec.push(Box::new(ed));
        }

        let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        let count: u32 = stmt.query_row(params_refs.as_slice(), |row| row.get(0))?;
        Ok(count)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GitHub Repository Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get a GitHub repository by ID
    pub fn get_github_repository(&self, id: &str, user_id: &str) -> Result<Option<GitHubRepository>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let repo = conn
            .query_row(
                "SELECT id, user_id, github_id, name, full_name, clone_url, default_branch,
                        local_path, is_private, added_at, updated_at
                 FROM github_repository
                 WHERE id = ?1 AND user_id = ?2",
                params![id, user_id],
                |row| {
                    Ok(GitHubRepository {
                        id: row.get(0)?,
                        user_id: row.get(1)?,
                        github_id: row.get(2)?,
                        name: row.get(3)?,
                        full_name: row.get(4)?,
                        clone_url: row.get(5)?,
                        default_branch: row.get(6)?,
                        local_path: row.get(7)?,
                        is_private: row.get(8)?,
                        added_at: row.get(9)?,
                        updated_at: row.get(10)?,
                    })
                },
            )
            .optional()?;
        Ok(repo)
    }

    /// List GitHub repositories for a user
    pub fn list_github_repositories(&self, user_id: &str) -> Result<Vec<GitHubRepository>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, github_id, name, full_name, clone_url, default_branch,
                    local_path, is_private, added_at, updated_at
             FROM github_repository
             WHERE user_id = ?1
             ORDER BY name ASC",
        )?;
        let repos = stmt
            .query_map(params![user_id], |row| {
                Ok(GitHubRepository {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    github_id: row.get(2)?,
                    name: row.get(3)?,
                    full_name: row.get(4)?,
                    clone_url: row.get(5)?,
                    default_branch: row.get(6)?,
                    local_path: row.get(7)?,
                    is_private: row.get(8)?,
                    added_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(repos)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Project Knowledge Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// Get project knowledge by folder ID
    pub fn get_project_knowledge_by_folder(&self, folder_id: &str, user_id: &str) -> Result<Option<ProjectKnowledge>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let result = conn
            .query_row(
                "SELECT id, folder_id, user_id, tech_stack_json, conventions_json, patterns_json,
                        skills_json, tools_json, agent_performance_json, metadata_json,
                        last_scanned_at, created_at, updated_at
                 FROM project_knowledge
                 WHERE folder_id = ?1 AND user_id = ?2",
                params![folder_id, user_id],
                |row| {
                    let tech_stack_json: String = row.get(3)?;
                    let conventions_json: String = row.get(4)?;
                    let patterns_json: String = row.get(5)?;
                    let skills_json: String = row.get(6)?;
                    let tools_json: String = row.get(7)?;
                    let agent_performance_json: String = row.get(8)?;
                    let metadata_json: String = row.get(9)?;

                    Ok((
                        row.get::<_, String>(0)?,  // id
                        row.get::<_, String>(1)?,  // folder_id
                        row.get::<_, String>(2)?,  // user_id
                        tech_stack_json,
                        conventions_json,
                        patterns_json,
                        skills_json,
                        tools_json,
                        agent_performance_json,
                        metadata_json,
                        row.get::<_, Option<i64>>(10)?, // last_scanned_at
                        row.get::<_, i64>(11)?,         // created_at
                        row.get::<_, i64>(12)?,         // updated_at
                    ))
                },
            )
            .optional()?;

        match result {
            Some((id, folder_id, user_id, tech_stack_json, conventions_json, patterns_json,
                  skills_json, tools_json, agent_performance_json, metadata_json,
                  last_scanned_at, created_at, updated_at)) => {
                let tech_stack: Vec<String> = serde_json::from_str(&tech_stack_json)
                    .unwrap_or_default();
                let conventions: Vec<Convention> = serde_json::from_str(&conventions_json)
                    .unwrap_or_default();
                let patterns: Vec<LearnedPattern> = serde_json::from_str(&patterns_json)
                    .unwrap_or_default();
                let skills: Vec<SkillDefinition> = serde_json::from_str(&skills_json)
                    .unwrap_or_default();
                let tools: Vec<ToolDefinition> = serde_json::from_str(&tools_json)
                    .unwrap_or_default();
                let agent_performance: AgentPerformance = serde_json::from_str(&agent_performance_json)
                    .unwrap_or_default();
                let metadata: ProjectKnowledgeMetadata = serde_json::from_str(&metadata_json)
                    .unwrap_or(ProjectKnowledgeMetadata {
                        project_name: None,
                        project_path: None,
                        framework: None,
                        package_manager: None,
                        test_runner: None,
                        linter: None,
                        build_tool: None,
                    });

                Ok(Some(ProjectKnowledge {
                    id,
                    folder_id,
                    user_id,
                    tech_stack,
                    conventions,
                    patterns,
                    skills,
                    tools,
                    agent_performance,
                    metadata,
                    last_scanned_at,
                    created_at,
                    updated_at,
                }))
            }
            None => Ok(None),
        }
    }

    /// Create project knowledge for a folder
    pub fn create_project_knowledge(&self, input: &NewProjectKnowledge) -> Result<String> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        let empty_array = "[]";
        let empty_object = "{}";
        let default_metadata = serde_json::json!({
            "projectName": null,
            "projectPath": null,
            "framework": null,
            "packageManager": null,
            "testRunner": null,
            "linter": null,
            "buildTool": null
        }).to_string();

        conn.execute(
            "INSERT INTO project_knowledge
             (id, folder_id, user_id, tech_stack_json, conventions_json, patterns_json,
              skills_json, tools_json, agent_performance_json, metadata_json,
              last_scanned_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                id,
                input.folder_id,
                input.user_id,
                empty_array,
                empty_array,
                empty_array,
                empty_array,
                empty_array,
                empty_object,
                default_metadata,
                Option::<i64>::None,
                now,
                now
            ],
        )?;

        Ok(id)
    }

    /// Update project knowledge
    pub fn update_project_knowledge(&self, knowledge: &ProjectKnowledge) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();

        let tech_stack_json = serde_json::to_string(&knowledge.tech_stack)
            .map_err(|e| Error::Serialization(e.to_string()))?;
        let conventions_json = serde_json::to_string(&knowledge.conventions)
            .map_err(|e| Error::Serialization(e.to_string()))?;
        let patterns_json = serde_json::to_string(&knowledge.patterns)
            .map_err(|e| Error::Serialization(e.to_string()))?;
        let skills_json = serde_json::to_string(&knowledge.skills)
            .map_err(|e| Error::Serialization(e.to_string()))?;
        let tools_json = serde_json::to_string(&knowledge.tools)
            .map_err(|e| Error::Serialization(e.to_string()))?;
        let agent_performance_json = serde_json::to_string(&knowledge.agent_performance)
            .map_err(|e| Error::Serialization(e.to_string()))?;
        let metadata_json = serde_json::to_string(&knowledge.metadata)
            .map_err(|e| Error::Serialization(e.to_string()))?;

        conn.execute(
            "UPDATE project_knowledge SET
             tech_stack_json = ?1, conventions_json = ?2, patterns_json = ?3,
             skills_json = ?4, tools_json = ?5, agent_performance_json = ?6,
             metadata_json = ?7, last_scanned_at = ?8, updated_at = ?9
             WHERE id = ?10",
            params![
                tech_stack_json,
                conventions_json,
                patterns_json,
                skills_json,
                tools_json,
                agent_performance_json,
                metadata_json,
                knowledge.last_scanned_at,
                now,
                knowledge.id
            ],
        )?;

        Ok(())
    }

    /// Delete project knowledge
    pub fn delete_project_knowledge(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        conn.execute("DELETE FROM project_knowledge WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CLI Token Operations
    // ─────────────────────────────────────────────────────────────────────────

    /// List all CLI tokens for a user (excludes the key_hash for security)
    pub fn list_cli_tokens(&self, user_id: &str) -> Result<Vec<CLIToken>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, name, key_prefix, key_hash, last_used_at, expires_at, created_at
             FROM api_key
             WHERE user_id = ?1
             ORDER BY created_at DESC",
        )?;

        let tokens = stmt
            .query_map(params![user_id], |row| {
                Ok(CLIToken {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    name: row.get(2)?,
                    key_prefix: row.get(3)?,
                    key_hash: row.get(4)?,
                    last_used_at: row.get(5)?,
                    expires_at: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(tokens)
    }

    /// Get a CLI token by ID
    pub fn get_cli_token(&self, id: &str, user_id: &str) -> Result<Option<CLIToken>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let token = conn
            .query_row(
                "SELECT id, user_id, name, key_prefix, key_hash, last_used_at, expires_at, created_at
                 FROM api_key
                 WHERE id = ?1 AND user_id = ?2",
                params![id, user_id],
                |row| {
                    Ok(CLIToken {
                        id: row.get(0)?,
                        user_id: row.get(1)?,
                        name: row.get(2)?,
                        key_prefix: row.get(3)?,
                        key_hash: row.get(4)?,
                        last_used_at: row.get(5)?,
                        expires_at: row.get(6)?,
                        created_at: row.get(7)?,
                    })
                },
            )
            .optional()?;
        Ok(token)
    }

    /// Get a CLI token by prefix (for display/identification)
    pub fn get_cli_token_by_prefix(&self, prefix: &str, user_id: &str) -> Result<Option<CLIToken>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let token = conn
            .query_row(
                "SELECT id, user_id, name, key_prefix, key_hash, last_used_at, expires_at, created_at
                 FROM api_key
                 WHERE key_prefix = ?1 AND user_id = ?2",
                params![prefix, user_id],
                |row| {
                    Ok(CLIToken {
                        id: row.get(0)?,
                        user_id: row.get(1)?,
                        name: row.get(2)?,
                        key_prefix: row.get(3)?,
                        key_hash: row.get(4)?,
                        last_used_at: row.get(5)?,
                        expires_at: row.get(6)?,
                        created_at: row.get(7)?,
                    })
                },
            )
            .optional()?;
        Ok(token)
    }

    /// Create a new CLI token (stores the hash, not the raw key)
    pub fn create_cli_token(
        &self,
        id: &str,
        user_id: &str,
        name: &str,
        key_prefix: &str,
        key_hash: &str,
        expires_at: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();

        conn.execute(
            "INSERT INTO api_key (id, user_id, name, key_prefix, key_hash, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, user_id, name, key_prefix, key_hash, expires_at, now],
        )?;

        Ok(())
    }

    /// Revoke (delete) a CLI token
    pub fn revoke_cli_token(&self, id: &str, user_id: &str) -> Result<bool> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let rows = conn.execute(
            "DELETE FROM api_key WHERE id = ?1 AND user_id = ?2",
            params![id, user_id],
        )?;
        Ok(rows > 0)
    }

    /// Update last_used_at timestamp for a token
    pub fn update_cli_token_last_used(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE api_key SET last_used_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    /// Get all CLI tokens for validation (used by auth middleware on startup)
    pub fn get_all_cli_tokens_for_validation(&self) -> Result<Vec<CLITokenValidation>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let mut stmt = conn.prepare(
            "SELECT id, user_id, name, key_hash, expires_at
             FROM api_key",
        )?;

        let tokens = stmt
            .query_map([], |row| {
                Ok(CLITokenValidation {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    name: row.get(2)?,
                    key_hash: row.get(3)?,
                    expires_at: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(tokens)
    }

    /// Validate a CLI token hash and return token info if valid
    pub fn validate_cli_token_hash(&self, key_hash: &str) -> Result<Option<CLITokenValidation>> {
        let conn = self.conn.lock().map_err(|_| Error::LockPoisoned)?;
        let now = chrono::Utc::now().timestamp_millis();

        let token = conn
            .query_row(
                "SELECT id, user_id, name, key_hash, expires_at
                 FROM api_key
                 WHERE key_hash = ?1 AND (expires_at IS NULL OR expires_at > ?2)",
                params![key_hash, now],
                |row| {
                    Ok(CLITokenValidation {
                        id: row.get(0)?,
                        user_id: row.get(1)?,
                        name: row.get(2)?,
                        key_hash: row.get(3)?,
                        expires_at: row.get(4)?,
                    })
                },
            )
            .optional()?;

        Ok(token)
    }
}
