//! Extensions Database Migrations

use rusqlite::Connection;
use crate::SDKResult;

/// Run all extensions migrations
pub fn run_migrations(conn: &Connection) -> SDKResult<()> {
    conn.execute_batch(include_str!("001_extensions_tables.sql"))?;
    Ok(())
}
