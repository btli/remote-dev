-- SDK Extensions Tables
-- Schema version: 1

-- Extensions registry
CREATE TABLE IF NOT EXISTS sdk_extensions (
    id TEXT PRIMARY KEY,
    manifest TEXT NOT NULL,  -- JSON manifest
    config TEXT NOT NULL DEFAULT '{}',  -- JSON configuration
    state TEXT NOT NULL DEFAULT 'unloaded',  -- active, disabled, failed, loading, unloaded
    enabled INTEGER NOT NULL DEFAULT 0,
    installed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error TEXT,

    -- Constraints
    CHECK (state IN ('active', 'disabled', 'failed', 'loading', 'unloaded'))
);

-- Extension tools
CREATE TABLE IF NOT EXISTS sdk_extension_tools (
    id TEXT PRIMARY KEY,
    extension_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT,
    input_schema TEXT NOT NULL,  -- JSON Schema
    output_schema TEXT,  -- JSON Schema
    is_async INTEGER NOT NULL DEFAULT 0,
    has_side_effects INTEGER NOT NULL DEFAULT 0,
    permissions TEXT NOT NULL DEFAULT '[]',  -- JSON array
    examples TEXT NOT NULL DEFAULT '[]',  -- JSON array
    created_at TEXT NOT NULL,

    FOREIGN KEY (extension_id) REFERENCES sdk_extensions(id) ON DELETE CASCADE,
    UNIQUE (extension_id, name)
);

-- Extension prompts
CREATE TABLE IF NOT EXISTS sdk_extension_prompts (
    id TEXT PRIMARY KEY,
    extension_id TEXT NOT NULL,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT,
    template TEXT NOT NULL,
    variables TEXT NOT NULL DEFAULT '[]',  -- JSON array
    tags TEXT NOT NULL DEFAULT '[]',  -- JSON array
    examples TEXT NOT NULL DEFAULT '[]',  -- JSON array
    created_at TEXT NOT NULL,

    FOREIGN KEY (extension_id) REFERENCES sdk_extensions(id) ON DELETE CASCADE,
    UNIQUE (extension_id, name)
);

-- Extension resources
CREATE TABLE IF NOT EXISTS sdk_extension_resources (
    id TEXT PRIMARY KEY,
    extension_id TEXT NOT NULL,
    uri_pattern TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    cacheable INTEGER NOT NULL DEFAULT 1,
    cache_ttl INTEGER,
    created_at TEXT NOT NULL,

    FOREIGN KEY (extension_id) REFERENCES sdk_extensions(id) ON DELETE CASCADE,
    UNIQUE (extension_id, uri_pattern)
);

-- Tool execution logs
CREATE TABLE IF NOT EXISTS sdk_tool_executions (
    id TEXT PRIMARY KEY,
    tool_id TEXT NOT NULL,
    extension_id TEXT NOT NULL,
    session_id TEXT,
    user_id TEXT NOT NULL,
    folder_id TEXT,
    input TEXT NOT NULL,  -- JSON
    output TEXT,  -- JSON
    success INTEGER NOT NULL,
    error TEXT,
    duration_ms INTEGER NOT NULL,
    executed_at TEXT NOT NULL,

    FOREIGN KEY (tool_id) REFERENCES sdk_extension_tools(id) ON DELETE CASCADE,
    FOREIGN KEY (extension_id) REFERENCES sdk_extensions(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_extensions_state ON sdk_extensions(state);
CREATE INDEX IF NOT EXISTS idx_extensions_enabled ON sdk_extensions(enabled);

CREATE INDEX IF NOT EXISTS idx_extension_tools_ext ON sdk_extension_tools(extension_id);
CREATE INDEX IF NOT EXISTS idx_extension_tools_name ON sdk_extension_tools(name);
CREATE INDEX IF NOT EXISTS idx_extension_tools_category ON sdk_extension_tools(category);

CREATE INDEX IF NOT EXISTS idx_extension_prompts_ext ON sdk_extension_prompts(extension_id);
CREATE INDEX IF NOT EXISTS idx_extension_prompts_name ON sdk_extension_prompts(name);
CREATE INDEX IF NOT EXISTS idx_extension_prompts_category ON sdk_extension_prompts(category);

CREATE INDEX IF NOT EXISTS idx_extension_resources_ext ON sdk_extension_resources(extension_id);

CREATE INDEX IF NOT EXISTS idx_tool_executions_tool ON sdk_tool_executions(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_user ON sdk_tool_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_session ON sdk_tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_date ON sdk_tool_executions(executed_at);
