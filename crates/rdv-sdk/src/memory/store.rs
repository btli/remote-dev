//! Memory Store Implementation
//!
//! SQLite-based storage for the hierarchical memory system.

use std::sync::Arc;
use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, Row};
use sha2::{Sha256, Digest};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{SDKError, SDKResult};
use super::types::*;

/// Memory store for persisting memory entries to SQLite
#[allow(dead_code)]
pub struct MemoryStore {
    db: Arc<RwLock<Connection>>,
    user_id: String,
    folder_id: Option<String>,
}

impl MemoryStore {
    /// Create a new memory store
    pub fn new(db: Arc<RwLock<Connection>>, user_id: String, folder_id: Option<String>) -> Self {
        Self {
            db,
            user_id,
            folder_id,
        }
    }

    /// Store a new memory entry
    pub async fn store(&self, input: StoreMemoryInput) -> SDKResult<MemoryEntry> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let content_hash = Self::hash_content(&input.content);

        let db = self.db.write().await;

        // Insert base entry
        db.execute(
            "INSERT INTO sdk_memory_entries (id, session_id, user_id, folder_id, tier, content_type, content, content_hash, created_at, last_accessed_at, access_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 0)",
            params![
                &id,
                &input.session_id,
                &input.user_id,
                &input.folder_id,
                input.tier.as_str(),
                input.content_type.as_str(),
                &input.content,
                &content_hash,
                now.timestamp_millis(),
            ],
        )?;

        // Insert tier-specific data
        match input.tier {
            MemoryTier::ShortTerm => {
                let ttl = input.ttl_seconds.unwrap_or(3600);
                let expires_at = now + Duration::seconds(ttl as i64);
                let metadata = input.metadata.unwrap_or_default();

                db.execute(
                    "INSERT INTO sdk_short_term_entries (id, source, relevance, ttl_seconds, expires_at, metadata_json)
                     VALUES (?1, ?2, 0.5, ?3, ?4, ?5)",
                    params![
                        &id,
                        &input.source,
                        ttl,
                        expires_at.timestamp_millis(),
                        serde_json::to_string(&metadata)?,
                    ],
                )?;
            }
            MemoryTier::Working => {
                let metadata = input.metadata.unwrap_or_default();

                db.execute(
                    "INSERT INTO sdk_working_entries (id, task_id, priority, confidence, metadata_json)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        &id,
                        &input.task_id,
                        input.priority.unwrap_or(0),
                        input.confidence.unwrap_or(0.5),
                        serde_json::to_string(&metadata)?,
                    ],
                )?;
            }
            MemoryTier::LongTerm => {
                let metadata = input.metadata.unwrap_or_default();

                db.execute(
                    "INSERT INTO sdk_long_term_entries (id, name, description, confidence, source_sessions_json, applicability_json, metadata_json)
                     VALUES (?1, ?2, ?3, ?4, '[]', '{}', ?5)",
                    params![
                        &id,
                        input.name.as_deref().unwrap_or(""),
                        input.description.as_deref().unwrap_or(""),
                        input.confidence.unwrap_or(0.5),
                        serde_json::to_string(&metadata)?,
                    ],
                )?;
            }
        }

        drop(db);
        self.get(&id).await?.ok_or_else(|| SDKError::not_found("MemoryEntry", &id))
    }

    /// Get a memory entry by ID
    pub async fn get(&self, id: &str) -> SDKResult<Option<MemoryEntry>> {
        let db = self.db.read().await;

        let result = db.query_row(
            "SELECT tier FROM sdk_memory_entries WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        );

        match result {
            Ok(tier_str) => {
                let tier = MemoryTier::from_str(&tier_str)
                    .ok_or_else(|| SDKError::memory(format!("invalid tier: {}", tier_str)))?;

                match tier {
                    MemoryTier::ShortTerm => {
                        let entry = self.get_short_term_entry(&db, id)?;
                        Ok(entry.map(MemoryEntry::ShortTerm))
                    }
                    MemoryTier::Working => {
                        let entry = self.get_working_entry(&db, id)?;
                        Ok(entry.map(MemoryEntry::Working))
                    }
                    MemoryTier::LongTerm => {
                        let entry = self.get_long_term_entry(&db, id)?;
                        Ok(entry.map(MemoryEntry::LongTerm))
                    }
                }
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Retrieve memory entries matching a query
    pub async fn retrieve(&self, query: MemoryQuery) -> SDKResult<Vec<MemoryResult>> {
        let db = self.db.read().await;
        let mut results = Vec::new();

        // Build SQL query based on filters
        let mut sql = String::from(
            "SELECT id, tier, content FROM sdk_memory_entries WHERE 1=1"
        );
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(ref user_id) = query.user_id {
            sql.push_str(" AND user_id = ?");
            params_vec.push(Box::new(user_id.clone()));
        }

        if let Some(ref folder_id) = query.folder_id {
            sql.push_str(" AND folder_id = ?");
            params_vec.push(Box::new(folder_id.clone()));
        }

        if let Some(ref session_id) = query.session_id {
            sql.push_str(" AND session_id = ?");
            params_vec.push(Box::new(session_id.clone()));
        }

        if let Some(ref tiers) = query.tiers {
            if !tiers.is_empty() {
                let tier_placeholders: Vec<&str> = tiers.iter().map(|t| t.as_str()).collect();
                sql.push_str(&format!(
                    " AND tier IN ({})",
                    tier_placeholders.iter().map(|_| "?").collect::<Vec<_>>().join(",")
                ));
                for tier in tier_placeholders {
                    params_vec.push(Box::new(tier.to_string()));
                }
            }
        }

        if let Some(ref content_types) = query.content_types {
            if !content_types.is_empty() {
                let type_placeholders: Vec<&str> = content_types.iter().map(|t| t.as_str()).collect();
                sql.push_str(&format!(
                    " AND content_type IN ({})",
                    type_placeholders.iter().map(|_| "?").collect::<Vec<_>>().join(",")
                ));
                for ct in type_placeholders {
                    params_vec.push(Box::new(ct.to_string()));
                }
            }
        }

        if !query.include_expired {
            sql.push_str(
                " AND (tier != 'short_term' OR id IN (SELECT id FROM sdk_short_term_entries WHERE expires_at > ?))"
            );
            params_vec.push(Box::new(Utc::now().timestamp_millis()));
        }

        sql.push_str(" ORDER BY last_accessed_at DESC, access_count DESC");

        if let Some(limit) = query.limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        // Execute query and collect results first
        let param_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        let matched_entries: Vec<(String, String)> = {
            let mut stmt = db.prepare(&sql)?;
            let rows = stmt.query_map(param_refs.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(2)?, // content for relevance calculation
                ))
            })?;
            rows.filter_map(|r| r.ok()).collect()
        };

        // Release the lock before fetching full entries
        drop(db);

        // Now fetch full entries and calculate scores
        for (id, content) in matched_entries {
            // Calculate relevance score
            let score = self.calculate_relevance(&content, query.query.as_deref());

            if let Some(min_score) = query.min_score {
                if score < min_score {
                    continue;
                }
            }

            // Get full entry
            if let Some(entry) = self.get(&id).await? {
                results.push(MemoryResult {
                    entry,
                    score,
                    reason: None,
                });
            }
        }

        // Sort by score
        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

        Ok(results)
    }

    /// Update an existing entry
    pub async fn update(&self, id: &str, _updates: serde_json::Value) -> SDKResult<MemoryEntry> {
        let db = self.db.write().await;

        // Update last_accessed_at
        db.execute(
            "UPDATE sdk_memory_entries SET last_accessed_at = ?1 WHERE id = ?2",
            params![Utc::now().timestamp_millis(), id],
        )?;

        drop(db);
        self.get(id).await?.ok_or_else(|| SDKError::not_found("MemoryEntry", id))
    }

    /// Delete an entry
    pub async fn delete(&self, id: &str) -> SDKResult<()> {
        let db = self.db.write().await;

        // Delete from base table (cascades to tier-specific tables)
        db.execute(
            "DELETE FROM sdk_memory_entries WHERE id = ?1",
            params![id],
        )?;

        Ok(())
    }

    /// Record access to an entry
    pub async fn record_access(&self, id: &str) -> SDKResult<()> {
        let db = self.db.write().await;

        db.execute(
            "UPDATE sdk_memory_entries SET last_accessed_at = ?1, access_count = access_count + 1 WHERE id = ?2",
            params![Utc::now().timestamp_millis(), id],
        )?;

        Ok(())
    }

    /// Promote an entry to a higher tier
    pub async fn promote(&self, id: &str, target_tier: MemoryTier) -> SDKResult<MemoryEntry> {
        let entry = self.get(id).await?.ok_or_else(|| SDKError::not_found("MemoryEntry", id))?;
        let current_tier = entry.tier();

        if target_tier == current_tier {
            return Ok(entry);
        }

        // Only allow promotions (short_term -> working -> long_term)
        match (current_tier, target_tier) {
            (MemoryTier::ShortTerm, MemoryTier::Working) |
            (MemoryTier::ShortTerm, MemoryTier::LongTerm) |
            (MemoryTier::Working, MemoryTier::LongTerm) => {}
            _ => {
                return Err(SDKError::invalid_operation(format!(
                    "cannot promote from {} to {}",
                    current_tier, target_tier
                )));
            }
        }

        let db = self.db.write().await;

        // Update tier in base table
        db.execute(
            "UPDATE sdk_memory_entries SET tier = ?1 WHERE id = ?2",
            params![target_tier.as_str(), id],
        )?;

        // Delete from old tier table
        match current_tier {
            MemoryTier::ShortTerm => {
                db.execute("DELETE FROM sdk_short_term_entries WHERE id = ?1", params![id])?;
            }
            MemoryTier::Working => {
                db.execute("DELETE FROM sdk_working_entries WHERE id = ?1", params![id])?;
            }
            _ => {}
        }

        // Insert into new tier table
        match target_tier {
            MemoryTier::Working => {
                db.execute(
                    "INSERT INTO sdk_working_entries (id, priority, confidence, metadata_json) VALUES (?1, 0, 0.5, '{}')",
                    params![id],
                )?;
            }
            MemoryTier::LongTerm => {
                let content = entry.content();
                db.execute(
                    "INSERT INTO sdk_long_term_entries (id, name, description, confidence, source_sessions_json, applicability_json, metadata_json) VALUES (?1, ?2, '', 0.5, '[]', '{}', '{}')",
                    params![id, &content[..content.len().min(100)]],
                )?;
            }
            _ => {}
        }

        drop(db);
        self.get(id).await?.ok_or_else(|| SDKError::not_found("MemoryEntry", id))
    }

    /// Prune expired and low-relevance entries
    pub async fn prune(&self, options: PruneOptions) -> SDKResult<usize> {
        if options.dry_run {
            // Count entries that would be pruned
            return self.count_prunable(&options).await;
        }

        let db = self.db.write().await;
        let mut pruned = 0;

        // Prune expired short-term entries
        let result = db.execute(
            "DELETE FROM sdk_memory_entries WHERE id IN (
                SELECT id FROM sdk_short_term_entries WHERE expires_at < ?1
            )",
            params![Utc::now().timestamp_millis()],
        )?;
        pruned += result;

        // Prune by age if specified
        if let Some(older_than) = options.older_than_seconds {
            let cutoff = Utc::now() - Duration::seconds(older_than as i64);
            let result = db.execute(
                "DELETE FROM sdk_memory_entries WHERE created_at < ?1 AND tier = 'short_term'",
                params![cutoff.timestamp_millis()],
            )?;
            pruned += result;
        }

        // Prune by relevance if specified
        if let Some(max_relevance) = options.max_relevance {
            let result = db.execute(
                "DELETE FROM sdk_memory_entries WHERE id IN (
                    SELECT id FROM sdk_short_term_entries WHERE relevance < ?1
                )",
                params![max_relevance],
            )?;
            pruned += result;
        }

        Ok(pruned)
    }

    /// Get memory statistics
    pub async fn get_stats(&self) -> SDKResult<MemoryStats> {
        let db = self.db.read().await;
        let mut stats = MemoryStats::default();

        // Count by tier
        let mut stmt = db.prepare("SELECT tier, COUNT(*) FROM sdk_memory_entries WHERE user_id = ?1 GROUP BY tier")?;
        let rows = stmt.query_map(params![&self.user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
        })?;

        for row in rows {
            let (tier, count) = row?;
            stats.count_by_tier.insert(tier, count);
        }

        // Count by type
        let mut stmt = db.prepare("SELECT content_type, COUNT(*) FROM sdk_memory_entries WHERE user_id = ?1 GROUP BY content_type")?;
        let rows = stmt.query_map(params![&self.user_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
        })?;

        for row in rows {
            let (content_type, count) = row?;
            stats.count_by_type.insert(content_type, count);
        }

        // Get last consolidation
        let last_consolidation = db.query_row(
            "SELECT created_at FROM sdk_consolidation_history WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1",
            params![&self.user_id],
            |row| row.get::<_, i64>(0),
        );

        if let Ok(ts) = last_consolidation {
            stats.last_consolidation_at = DateTime::from_timestamp_millis(ts);
        }

        Ok(stats)
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Private helpers
    // ─────────────────────────────────────────────────────────────────────────────

    fn hash_content(content: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        hex::encode(hasher.finalize())
    }

    fn calculate_relevance(&self, content: &str, query: Option<&str>) -> f64 {
        let Some(query) = query else {
            return 0.5; // Default relevance if no query
        };

        let query_lower = query.to_lowercase();
        let content_lower = content.to_lowercase();

        // Simple keyword matching (would be replaced with embeddings in production)
        let query_words: Vec<&str> = query_lower.split_whitespace().collect();
        let matches = query_words.iter().filter(|w| content_lower.contains(*w)).count();

        if query_words.is_empty() {
            return 0.5;
        }

        (matches as f64 / query_words.len() as f64).min(1.0)
    }

    fn get_short_term_entry(&self, db: &Connection, id: &str) -> SDKResult<Option<ShortTermEntry>> {
        let result = db.query_row(
            "SELECT m.id, m.session_id, m.user_id, m.folder_id, m.tier, m.content_type, m.content, m.content_hash, m.embedding_id, m.created_at, m.last_accessed_at, m.access_count,
                    s.source, s.relevance, s.ttl_seconds, s.expires_at, s.metadata_json
             FROM sdk_memory_entries m
             JOIN sdk_short_term_entries s ON m.id = s.id
             WHERE m.id = ?1",
            params![id],
            |row| self.row_to_short_term_entry(row),
        );

        match result {
            Ok(entry) => Ok(Some(entry)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn get_working_entry(&self, db: &Connection, id: &str) -> SDKResult<Option<WorkingEntry>> {
        let result = db.query_row(
            "SELECT m.id, m.session_id, m.user_id, m.folder_id, m.tier, m.content_type, m.content, m.content_hash, m.embedding_id, m.created_at, m.last_accessed_at, m.access_count,
                    w.task_id, w.priority, w.confidence, w.metadata_json
             FROM sdk_memory_entries m
             JOIN sdk_working_entries w ON m.id = w.id
             WHERE m.id = ?1",
            params![id],
            |row| self.row_to_working_entry(row),
        );

        match result {
            Ok(entry) => Ok(Some(entry)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn get_long_term_entry(&self, db: &Connection, id: &str) -> SDKResult<Option<LongTermEntry>> {
        let result = db.query_row(
            "SELECT m.id, m.session_id, m.user_id, m.folder_id, m.tier, m.content_type, m.content, m.content_hash, m.embedding_id, m.created_at, m.last_accessed_at, m.access_count,
                    l.name, l.description, l.confidence, l.source_sessions_json, l.applicability_json, l.metadata_json
             FROM sdk_memory_entries m
             JOIN sdk_long_term_entries l ON m.id = l.id
             WHERE m.id = ?1",
            params![id],
            |row| self.row_to_long_term_entry(row),
        );

        match result {
            Ok(entry) => Ok(Some(entry)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn row_to_base_entry(&self, row: &Row) -> rusqlite::Result<BaseMemoryEntry> {
        Ok(BaseMemoryEntry {
            id: row.get(0)?,
            session_id: row.get(1)?,
            user_id: row.get(2)?,
            folder_id: row.get(3)?,
            tier: MemoryTier::from_str(&row.get::<_, String>(4)?).unwrap_or(MemoryTier::ShortTerm),
            content_type: MemoryContentType::from_str(&row.get::<_, String>(5)?).unwrap_or(MemoryContentType::Observation),
            content: row.get(6)?,
            content_hash: row.get(7)?,
            embedding_id: row.get(8)?,
            created_at: DateTime::from_timestamp_millis(row.get::<_, i64>(9)?).unwrap_or_default(),
            last_accessed_at: DateTime::from_timestamp_millis(row.get::<_, i64>(10)?).unwrap_or_default(),
            access_count: row.get(11)?,
        })
    }

    fn row_to_short_term_entry(&self, row: &Row) -> rusqlite::Result<ShortTermEntry> {
        let base = self.row_to_base_entry(row)?;
        let metadata_json: String = row.get(16)?;

        Ok(ShortTermEntry {
            base,
            source: row.get(12)?,
            relevance: row.get(13)?,
            ttl_seconds: row.get(14)?,
            expires_at: DateTime::from_timestamp_millis(row.get::<_, i64>(15)?).unwrap_or_default(),
            metadata: serde_json::from_str(&metadata_json).unwrap_or_default(),
        })
    }

    fn row_to_working_entry(&self, row: &Row) -> rusqlite::Result<WorkingEntry> {
        let base = self.row_to_base_entry(row)?;
        let metadata_json: String = row.get(15)?;

        Ok(WorkingEntry {
            base,
            task_id: row.get(12)?,
            priority: row.get(13)?,
            confidence: row.get(14)?,
            metadata: serde_json::from_str(&metadata_json).unwrap_or_default(),
        })
    }

    fn row_to_long_term_entry(&self, row: &Row) -> rusqlite::Result<LongTermEntry> {
        let base = self.row_to_base_entry(row)?;
        let source_sessions_json: String = row.get(15)?;
        let applicability_json: String = row.get(16)?;
        let metadata_json: String = row.get(17)?;

        Ok(LongTermEntry {
            base,
            name: row.get(12)?,
            description: row.get(13)?,
            confidence: row.get(14)?,
            source_sessions: serde_json::from_str(&source_sessions_json).unwrap_or_default(),
            applicability: serde_json::from_str(&applicability_json).unwrap_or_default(),
            metadata: serde_json::from_str(&metadata_json).unwrap_or_default(),
        })
    }

    async fn count_prunable(&self, options: &PruneOptions) -> SDKResult<usize> {
        let db = self.db.read().await;
        let mut count = 0;

        // Count expired
        let expired: usize = db.query_row(
            "SELECT COUNT(*) FROM sdk_short_term_entries WHERE expires_at < ?1",
            params![Utc::now().timestamp_millis()],
            |row| row.get(0),
        )?;
        count += expired;

        if let Some(max_relevance) = options.max_relevance {
            let low_relevance: usize = db.query_row(
                "SELECT COUNT(*) FROM sdk_short_term_entries WHERE relevance < ?1",
                params![max_relevance],
                |row| row.get(0),
            )?;
            count += low_relevance;
        }

        Ok(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup_test_db() -> Arc<RwLock<Connection>> {
        let conn = Connection::open_in_memory().unwrap();

        // Run migrations
        conn.execute_batch(include_str!("./migrations/001_memory_tables.sql")).unwrap();

        Arc::new(RwLock::new(conn))
    }

    #[tokio::test]
    async fn test_store_and_get() {
        let db = setup_test_db().await;
        let store = MemoryStore::new(db, "user-123".into(), None);

        let input = StoreMemoryInput {
            session_id: "session-1".into(),
            user_id: "user-123".into(),
            folder_id: None,
            tier: MemoryTier::ShortTerm,
            content_type: MemoryContentType::Command,
            content: "git status".into(),
            name: None,
            description: None,
            source: Some("terminal".into()),
            task_id: None,
            priority: None,
            confidence: None,
            ttl_seconds: Some(3600),
            metadata: None,
        };

        let entry = store.store(input).await.unwrap();
        assert_eq!(entry.content(), "git status");
        assert_eq!(entry.tier(), MemoryTier::ShortTerm);

        let retrieved = store.get(entry.id()).await.unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().content(), "git status");
    }

    #[tokio::test]
    async fn test_retrieve_with_query() {
        let db = setup_test_db().await;
        let store = MemoryStore::new(db, "user-123".into(), None);

        // Store multiple entries
        for content in ["git status", "git log", "npm install"] {
            let input = StoreMemoryInput {
                session_id: "session-1".into(),
                user_id: "user-123".into(),
                folder_id: None,
                tier: MemoryTier::ShortTerm,
                content_type: MemoryContentType::Command,
                content: content.into(),
                name: None,
                description: None,
                source: None,
                task_id: None,
                priority: None,
                confidence: None,
                ttl_seconds: None,
                metadata: None,
            };
            store.store(input).await.unwrap();
        }

        // Query for git commands with min_score to filter non-matching
        let query = MemoryQuery {
            query: Some("git".into()),
            user_id: Some("user-123".into()),
            min_score: Some(0.1), // Filter out entries that don't match
            ..Default::default()
        };

        let results = store.retrieve(query).await.unwrap();
        assert_eq!(results.len(), 2); // git status and git log (npm install filtered out)
    }

    #[tokio::test]
    async fn test_promote() {
        let db = setup_test_db().await;
        let store = MemoryStore::new(db, "user-123".into(), None);

        let input = StoreMemoryInput {
            session_id: "session-1".into(),
            user_id: "user-123".into(),
            folder_id: None,
            tier: MemoryTier::ShortTerm,
            content_type: MemoryContentType::Command,
            content: "important command".into(),
            name: None,
            description: None,
            source: None,
            task_id: None,
            priority: None,
            confidence: None,
            ttl_seconds: None,
            metadata: None,
        };

        let entry = store.store(input).await.unwrap();
        assert_eq!(entry.tier(), MemoryTier::ShortTerm);

        let promoted = store.promote(entry.id(), MemoryTier::Working).await.unwrap();
        assert_eq!(promoted.tier(), MemoryTier::Working);
    }
}
