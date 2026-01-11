//! Meta-Agent Database Migrations

use rusqlite::Connection;
use crate::SDKResult;

/// Run all meta-agent migrations
pub fn run_migrations(conn: &Connection) -> SDKResult<()> {
    conn.execute_batch(include_str!("001_meta_agent_tables.sql"))?;
    Ok(())
}
