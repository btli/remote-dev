//! Database connection utility for direct rdv-core access.
//!
//! The CLI uses a hybrid approach:
//! - Direct rdv-core Database for: memory, notes, learning, knowledge
//! - HTTP API for: sessions requiring server coordination
//!
//! This module provides a shared database connection that opens the same
//! sqlite.db file used by rdv-server.

use anyhow::{Context, Result};
use rdv_core::db::Database;
use std::sync::OnceLock;

/// Global database connection (lazy initialized)
static DATABASE: OnceLock<Database> = OnceLock::new();

/// Cached user ID (looked up once from database)
static USER_ID: OnceLock<String> = OnceLock::new();

/// Get or initialize the database connection.
///
/// The database path is resolved by rdv-core in this order:
/// 1. RDV_DATABASE_PATH environment variable
/// 2. Walk up directory tree looking for sqlite.db
/// 3. ~/.remote-dev/sqlite.db
pub fn get_database() -> Result<&'static Database> {
    // Check if already initialized
    if let Some(db) = DATABASE.get() {
        return Ok(db);
    }

    // Initialize the database
    let db = Database::open().context("Failed to open database")?;

    // Try to set it (another thread might have beaten us)
    match DATABASE.set(db) {
        Ok(()) => Ok(DATABASE.get().expect("just set")),
        Err(_) => {
            // Another thread initialized it, use that one
            Ok(DATABASE.get().expect("must be set"))
        }
    }
}

/// Get the user ID for local operations.
///
/// Resolution order:
/// 1. RDV_USER_ID environment variable (if it's a valid UUID)
/// 2. Look up user in database by email matching USER@* pattern
/// 3. First user in database
/// 4. "default" (will fail on FK constraint)
pub fn get_user_id() -> String {
    // Check cached value first
    if let Some(id) = USER_ID.get() {
        return id.clone();
    }

    // 1. Check environment variable (should be a UUID)
    if let Ok(user_id) = std::env::var("RDV_USER_ID") {
        // Validate it looks like a UUID
        if user_id.len() == 36 && user_id.chars().filter(|c| *c == '-').count() == 4 {
            let _ = USER_ID.set(user_id.clone());
            return user_id;
        }
    }

    // 2. Try to look up from database
    if let Ok(db) = get_database() {
        // Try to get first user (most common single-user case)
        if let Ok(Some(user)) = db.get_default_user() {
            let _ = USER_ID.set(user.id.clone());
            return user.id;
        }
    }

    // 3. Fallback (will fail FK constraint but at least gives error message)
    "default".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_user_id_has_value() {
        // Should always return something
        let user_id = get_user_id();
        assert!(!user_id.is_empty());
    }
}
