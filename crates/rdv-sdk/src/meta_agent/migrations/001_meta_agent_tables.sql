-- SDK Meta-Agent Tables
-- Schema version: 1

-- Agent configurations
CREATE TABLE IF NOT EXISTS sdk_agent_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,  -- claude, codex, gemini, opencode
    task_spec TEXT NOT NULL,  -- JSON TaskSpec
    project_context TEXT NOT NULL,  -- JSON ProjectContext
    system_prompt TEXT NOT NULL,
    instructions_file TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    -- Constraints
    CHECK (provider IN ('claude', 'codex', 'gemini', 'opencode'))
);

-- Benchmarks
CREATE TABLE IF NOT EXISTS sdk_benchmarks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    task_spec TEXT NOT NULL,  -- JSON TaskSpec
    test_cases TEXT NOT NULL,  -- JSON array of TestCase
    timeout_seconds INTEGER NOT NULL DEFAULT 300,
    created_at TEXT NOT NULL
);

-- Benchmark results
CREATE TABLE IF NOT EXISTS sdk_benchmark_results (
    id TEXT PRIMARY KEY,
    benchmark_id TEXT NOT NULL,
    config_id TEXT NOT NULL,
    score REAL NOT NULL,
    passed INTEGER NOT NULL,
    test_results TEXT NOT NULL,  -- JSON array
    duration_ms INTEGER NOT NULL,
    errors TEXT NOT NULL DEFAULT '[]',  -- JSON array
    warnings TEXT NOT NULL DEFAULT '[]',  -- JSON array
    files_modified TEXT NOT NULL DEFAULT '[]',  -- JSON array
    commands_executed TEXT NOT NULL DEFAULT '[]',  -- JSON array
    executed_at TEXT NOT NULL,

    FOREIGN KEY (benchmark_id) REFERENCES sdk_benchmarks(id) ON DELETE CASCADE,
    FOREIGN KEY (config_id) REFERENCES sdk_agent_configs(id) ON DELETE CASCADE
);

-- Optimization runs
CREATE TABLE IF NOT EXISTS sdk_optimization_runs (
    id TEXT PRIMARY KEY,
    task_spec TEXT NOT NULL,  -- JSON TaskSpec
    project_context TEXT NOT NULL,  -- JSON ProjectContext
    options TEXT NOT NULL,  -- JSON OptimizationOptions
    initial_config_id TEXT NOT NULL,
    final_config_id TEXT,
    iterations INTEGER NOT NULL DEFAULT 0,
    final_score REAL,
    score_history TEXT NOT NULL DEFAULT '[]',  -- JSON array
    status TEXT NOT NULL DEFAULT 'running',  -- running, completed, failed
    stop_reason TEXT,  -- target_reached, max_iterations, no_improvement, timeout, error
    error TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,

    FOREIGN KEY (initial_config_id) REFERENCES sdk_agent_configs(id) ON DELETE SET NULL,
    FOREIGN KEY (final_config_id) REFERENCES sdk_agent_configs(id) ON DELETE SET NULL,

    CHECK (status IN ('running', 'completed', 'failed')),
    CHECK (stop_reason IS NULL OR stop_reason IN ('target_reached', 'max_iterations', 'no_improvement', 'timeout', 'error'))
);

-- Refinement suggestions
CREATE TABLE IF NOT EXISTS sdk_refinement_suggestions (
    id TEXT PRIMARY KEY,
    config_id TEXT NOT NULL,
    benchmark_result_id TEXT,
    target TEXT NOT NULL,  -- system_prompt, instructions, mcp_config, tool_config, memory_config
    change_type TEXT NOT NULL,  -- add, remove, modify
    current_value TEXT,
    suggested_value TEXT NOT NULL,
    rationale TEXT NOT NULL,
    expected_impact REAL NOT NULL,
    confidence REAL NOT NULL,
    applied INTEGER NOT NULL DEFAULT 0,
    applied_at TEXT,
    created_at TEXT NOT NULL,

    FOREIGN KEY (config_id) REFERENCES sdk_agent_configs(id) ON DELETE CASCADE,
    FOREIGN KEY (benchmark_result_id) REFERENCES sdk_benchmark_results(id) ON DELETE SET NULL,

    CHECK (target IN ('system_prompt', 'instructions', 'mcp_config', 'tool_config', 'memory_config')),
    CHECK (change_type IN ('add', 'remove', 'modify'))
);

-- Config version history
CREATE TABLE IF NOT EXISTS sdk_config_versions (
    id TEXT PRIMARY KEY,
    config_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    system_prompt TEXT NOT NULL,
    instructions_file TEXT NOT NULL,
    changes TEXT NOT NULL,  -- JSON description of changes
    created_at TEXT NOT NULL,

    FOREIGN KEY (config_id) REFERENCES sdk_agent_configs(id) ON DELETE CASCADE,
    UNIQUE (config_id, version)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_configs_provider ON sdk_agent_configs(provider);
CREATE INDEX IF NOT EXISTS idx_agent_configs_created ON sdk_agent_configs(created_at);

CREATE INDEX IF NOT EXISTS idx_benchmarks_name ON sdk_benchmarks(name);

CREATE INDEX IF NOT EXISTS idx_benchmark_results_benchmark ON sdk_benchmark_results(benchmark_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_config ON sdk_benchmark_results(config_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_score ON sdk_benchmark_results(score);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_date ON sdk_benchmark_results(executed_at);

CREATE INDEX IF NOT EXISTS idx_optimization_runs_status ON sdk_optimization_runs(status);
CREATE INDEX IF NOT EXISTS idx_optimization_runs_started ON sdk_optimization_runs(started_at);

CREATE INDEX IF NOT EXISTS idx_refinement_suggestions_config ON sdk_refinement_suggestions(config_id);
CREATE INDEX IF NOT EXISTS idx_refinement_suggestions_target ON sdk_refinement_suggestions(target);
CREATE INDEX IF NOT EXISTS idx_refinement_suggestions_applied ON sdk_refinement_suggestions(applied);

CREATE INDEX IF NOT EXISTS idx_config_versions_config ON sdk_config_versions(config_id);
