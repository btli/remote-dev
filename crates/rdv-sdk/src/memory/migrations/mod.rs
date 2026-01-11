//! Memory system database migrations
//!
//! SQL migrations are embedded as strings and executed during SDK initialization.

use rusqlite::Connection;
use crate::SDKResult;

/// Memory tables SQL (001)
pub const MEMORY_TABLES_SQL: &str = include_str!("001_memory_tables.sql");

/// Run all memory migrations
pub fn run_migrations(conn: &Connection) -> SDKResult<()> {
    conn.execute_batch(MEMORY_TABLES_SQL)?;
    Ok(())
}
