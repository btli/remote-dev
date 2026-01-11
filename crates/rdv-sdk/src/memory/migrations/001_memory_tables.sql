-- Memory System Tables
-- Creates the hierarchical memory tables for short-term, working, and long-term memory

-- Main memory entries table (shared columns across all tiers)
CREATE TABLE IF NOT EXISTS sdk_memory_entries (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    folder_id TEXT,
    tier TEXT NOT NULL CHECK (tier IN ('short_term', 'working', 'long_term')),
    content_type TEXT NOT NULL,
    content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    last_accessed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    access_count INTEGER NOT NULL DEFAULT 0
);

-- Short-term memory extension
CREATE TABLE IF NOT EXISTS sdk_short_term_entries (
    id TEXT PRIMARY KEY NOT NULL REFERENCES sdk_memory_entries(id) ON DELETE CASCADE,
    source TEXT,
    relevance REAL NOT NULL DEFAULT 0.5,
    ttl_seconds INTEGER NOT NULL DEFAULT 3600,
    expires_at INTEGER NOT NULL,
    metadata_json TEXT DEFAULT '{}'
);

-- Working memory extension
CREATE TABLE IF NOT EXISTS sdk_working_entries (
    id TEXT PRIMARY KEY NOT NULL REFERENCES sdk_memory_entries(id) ON DELETE CASCADE,
    task_id TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0.5,
    metadata_json TEXT DEFAULT '{}'
);

-- Long-term memory extension
CREATE TABLE IF NOT EXISTS sdk_long_term_entries (
    id TEXT PRIMARY KEY NOT NULL REFERENCES sdk_memory_entries(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    source_sessions_json TEXT DEFAULT '[]',
    applicability_json TEXT DEFAULT '{}',
    metadata_json TEXT DEFAULT '{}'
);

-- Embedding storage for semantic search
CREATE TABLE IF NOT EXISTS sdk_memory_embeddings (
    id TEXT PRIMARY KEY NOT NULL,
    memory_id TEXT NOT NULL REFERENCES sdk_memory_entries(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Consolidation history
CREATE TABLE IF NOT EXISTS sdk_consolidation_history (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    folder_id TEXT,
    promoted_to_working INTEGER NOT NULL DEFAULT 0,
    consolidated_to_long_term INTEGER NOT NULL DEFAULT 0,
    pruned INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_memory_entries_user ON sdk_memory_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_entries_folder ON sdk_memory_entries(folder_id);
CREATE INDEX IF NOT EXISTS idx_memory_entries_tier ON sdk_memory_entries(tier);
CREATE INDEX IF NOT EXISTS idx_memory_entries_type ON sdk_memory_entries(content_type);
CREATE INDEX IF NOT EXISTS idx_memory_entries_session ON sdk_memory_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_entries_hash ON sdk_memory_entries(content_hash);
CREATE INDEX IF NOT EXISTS idx_memory_entries_created ON sdk_memory_entries(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_short_term_expires ON sdk_short_term_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_working_task ON sdk_working_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_working_priority ON sdk_working_entries(priority DESC);
CREATE INDEX IF NOT EXISTS idx_long_term_name ON sdk_long_term_entries(name);
CREATE INDEX IF NOT EXISTS idx_long_term_confidence ON sdk_long_term_entries(confidence DESC);

CREATE INDEX IF NOT EXISTS idx_embeddings_memory ON sdk_memory_embeddings(memory_id);
