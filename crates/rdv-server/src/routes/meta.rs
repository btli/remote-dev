//! Meta-agent routes for rdv-server.
//!
//! Provides REST API for managing meta-agent configurations and benchmarks.
//! The meta-agent system supports the BUILD → TEST → IMPROVE loop for
//! optimizing agent configurations.
//!
//! Routes:
//! - /sdk/meta/configs - Meta-agent config CRUD
//! - /sdk/meta/benchmarks - Benchmark definition CRUD
//! - /sdk/meta/benchmarks/:id/results - Benchmark results

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Extension, Json, Router,
};
use rdv_core::types::{
    MetaAgentBenchmark, MetaAgentBenchmarkResult, MetaAgentConfig, NewMetaAgentBenchmark,
    NewMetaAgentBenchmarkResult, NewMetaAgentConfig,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::middleware::AuthContext;
use crate::state::AppState;

// ─────────────────────────────────────────────────────────────────────────────
// Request/Response Types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConfigRequest {
    pub folder_id: Option<String>,
    pub name: String,
    pub provider: String,
    pub task_spec: serde_json::Value,
    pub project_context: serde_json::Value,
    pub system_prompt: String,
    pub instructions_file: String,
    pub mcp_config: Option<serde_json::Value>,
    pub tool_config: Option<serde_json::Value>,
    pub memory_config: Option<serde_json::Value>,
    #[serde(default = "default_empty_object")]
    pub metadata: serde_json::Value,
}

fn default_empty_object() -> serde_json::Value {
    serde_json::json!({})
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListConfigsQuery {
    pub folder_id: Option<String>,
    pub provider: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigResponse {
    pub id: String,
    pub user_id: String,
    pub folder_id: Option<String>,
    pub name: String,
    pub provider: String,
    pub version: i32,
    pub task_spec: serde_json::Value,
    pub project_context: serde_json::Value,
    pub system_prompt: String,
    pub instructions_file: String,
    pub mcp_config: serde_json::Value,
    pub tool_config: serde_json::Value,
    pub memory_config: serde_json::Value,
    pub metadata: serde_json::Value,
    pub created_at: i64,
    pub updated_at: i64,
}

impl From<MetaAgentConfig> for ConfigResponse {
    fn from(c: MetaAgentConfig) -> Self {
        Self {
            id: c.id,
            user_id: c.user_id,
            folder_id: c.folder_id,
            name: c.name,
            provider: c.provider,
            version: c.version,
            task_spec: serde_json::from_str(&c.task_spec_json).unwrap_or_default(),
            project_context: serde_json::from_str(&c.project_context_json).unwrap_or_default(),
            system_prompt: c.system_prompt,
            instructions_file: c.instructions_file,
            mcp_config: c.mcp_config_json.as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!({})),
            tool_config: c.tool_config_json.as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!({})),
            memory_config: c.memory_config_json.as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .unwrap_or_else(|| serde_json::json!({})),
            metadata: serde_json::from_str(&c.metadata_json).unwrap_or_default(),
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBenchmarkRequest {
    pub name: String,
    pub task_spec: serde_json::Value,
    pub test_cases: Vec<serde_json::Value>,
    pub success_criteria: serde_json::Value,
    pub timeout_seconds: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkResponse {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub task_spec: serde_json::Value,
    pub test_cases: serde_json::Value,
    pub success_criteria: serde_json::Value,
    pub timeout_seconds: i32,
    pub run_count: i32,
    pub last_run_at: Option<i64>,
    pub created_at: i64,
}

impl From<MetaAgentBenchmark> for BenchmarkResponse {
    fn from(b: MetaAgentBenchmark) -> Self {
        Self {
            id: b.id,
            user_id: b.user_id,
            name: b.name,
            task_spec: serde_json::from_str(&b.task_spec_json).unwrap_or_default(),
            test_cases: serde_json::from_str(&b.test_cases_json).unwrap_or_default(),
            success_criteria: serde_json::from_str(&b.success_criteria_json).unwrap_or_default(),
            timeout_seconds: b.timeout_seconds,
            run_count: b.run_count,
            last_run_at: b.last_run_at,
            created_at: b.created_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResultRequest {
    pub config_id: String,
    pub score: f64,
    pub passed: bool,
    pub duration_ms: i32,
    pub test_results: serde_json::Value,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub files_modified: Vec<String>,
    pub commands_executed: Vec<String>,
    pub raw_output: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResultsQuery {
    pub config_id: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultResponse {
    pub id: String,
    pub benchmark_id: String,
    pub config_id: String,
    pub user_id: String,
    pub score: f64,
    pub passed: bool,
    pub duration_ms: i32,
    pub test_results: serde_json::Value,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub files_modified: Vec<String>,
    pub commands_executed: Vec<String>,
    pub raw_output: Option<String>,
    pub executed_at: i64,
}

impl From<MetaAgentBenchmarkResult> for ResultResponse {
    fn from(r: MetaAgentBenchmarkResult) -> Self {
        Self {
            id: r.id,
            benchmark_id: r.benchmark_id,
            config_id: r.config_id,
            user_id: r.user_id,
            score: r.score,
            passed: r.passed,
            duration_ms: r.duration_ms,
            test_results: serde_json::from_str(&r.test_results_json).unwrap_or_default(),
            errors: serde_json::from_str(&r.errors_json).unwrap_or_default(),
            warnings: serde_json::from_str(&r.warnings_json).unwrap_or_default(),
            files_modified: serde_json::from_str(&r.files_modified_json).unwrap_or_default(),
            commands_executed: serde_json::from_str(&r.commands_executed_json).unwrap_or_default(),
            raw_output: r.raw_output,
            executed_at: r.executed_at,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessResponse {
    pub success: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const VALID_PROVIDERS: &[&str] = &["claude", "codex", "gemini", "opencode"];

fn validate_provider(provider: &str) -> Result<(), (axum::http::StatusCode, String)> {
    if !VALID_PROVIDERS.contains(&provider) {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            format!("Provider must be one of: {}", VALID_PROVIDERS.join(", ")),
        ));
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Routes
// ─────────────────────────────────────────────────────────────────────────────

/// POST /api/sdk/meta/configs - Create a new meta-agent config
async fn create_config(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<CreateConfigRequest>,
) -> Result<Json<ConfigResponse>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    validate_provider(&req.provider)?;

    let config = NewMetaAgentConfig {
        user_id: user_id.clone(),
        folder_id: req.folder_id,
        name: req.name,
        provider: req.provider,
        task_spec: req.task_spec,
        project_context: req.project_context,
        system_prompt: req.system_prompt,
        instructions_file: req.instructions_file,
        mcp_config: req.mcp_config,
        tool_config: req.tool_config,
        memory_config: req.memory_config,
        metadata: req.metadata,
    };

    let id = state
        .db
        .create_meta_agent_config(&config)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let created = state
        .db
        .get_meta_agent_config(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to retrieve created config".to_string(),
        ))?;

    Ok(Json(ConfigResponse::from(created)))
}

/// GET /api/sdk/meta/configs - List meta-agent configs
async fn list_configs(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListConfigsQuery>,
) -> Result<Json<Vec<ConfigResponse>>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    let configs = state
        .db
        .list_meta_agent_configs(&user_id, query.folder_id.as_deref(), query.provider.as_deref())
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(configs.into_iter().map(ConfigResponse::from).collect()))
}

/// GET /api/sdk/meta/configs/:id - Get a specific config
async fn get_config(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<ConfigResponse>, (axum::http::StatusCode, String)> {
    let _user_id = auth.user_id().to_string();

    let config = state
        .db
        .get_meta_agent_config(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Config not found".to_string()))?;

    Ok(Json(ConfigResponse::from(config)))
}

/// DELETE /api/sdk/meta/configs/:id - Delete a config
async fn delete_config(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<SuccessResponse>, (axum::http::StatusCode, String)> {
    let deleted = state
        .db
        .delete_meta_agent_config(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if !deleted {
        return Err((axum::http::StatusCode::NOT_FOUND, "Config not found".to_string()));
    }

    Ok(Json(SuccessResponse { success: true }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark Routes
// ─────────────────────────────────────────────────────────────────────────────

/// POST /api/sdk/meta/benchmarks - Create a new benchmark
async fn create_benchmark(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(req): Json<CreateBenchmarkRequest>,
) -> Result<Json<BenchmarkResponse>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    let benchmark = NewMetaAgentBenchmark {
        user_id: user_id.clone(),
        name: req.name,
        task_spec: req.task_spec,
        test_cases: req.test_cases,
        success_criteria: req.success_criteria,
        timeout_seconds: req.timeout_seconds,
    };

    let id = state
        .db
        .create_meta_agent_benchmark(&benchmark)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let created = state
        .db
        .get_meta_agent_benchmark(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to retrieve created benchmark".to_string(),
        ))?;

    Ok(Json(BenchmarkResponse::from(created)))
}

/// GET /api/sdk/meta/benchmarks - List benchmarks
async fn list_benchmarks(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<Vec<BenchmarkResponse>>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    let benchmarks = state
        .db
        .list_meta_agent_benchmarks(&user_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(benchmarks.into_iter().map(BenchmarkResponse::from).collect()))
}

/// GET /api/sdk/meta/benchmarks/:id - Get a specific benchmark
async fn get_benchmark(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<BenchmarkResponse>, (axum::http::StatusCode, String)> {
    let benchmark = state
        .db
        .get_meta_agent_benchmark(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Benchmark not found".to_string()))?;

    Ok(Json(BenchmarkResponse::from(benchmark)))
}

/// POST /api/sdk/meta/benchmarks/:id/run - Record a benchmark run
async fn record_benchmark_run(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> Result<Json<BenchmarkResponse>, (axum::http::StatusCode, String)> {
    // First verify the benchmark exists
    let _benchmark = state
        .db
        .get_meta_agent_benchmark(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Benchmark not found".to_string()))?;

    // Record the run
    state
        .db
        .increment_benchmark_run(&id)
        .map_err(|e: rdv_core::Error| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Get updated benchmark
    let updated = state
        .db
        .get_meta_agent_benchmark(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to retrieve updated benchmark".to_string(),
        ))?;

    Ok(Json(BenchmarkResponse::from(updated)))
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark Result Routes
// ─────────────────────────────────────────────────────────────────────────────

/// POST /api/sdk/meta/benchmarks/:id/results - Create a benchmark result
async fn create_result(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(benchmark_id): Path<String>,
    Json(req): Json<CreateResultRequest>,
) -> Result<Json<ResultResponse>, (axum::http::StatusCode, String)> {
    let user_id = auth.user_id().to_string();

    // Verify benchmark exists
    let _benchmark = state
        .db
        .get_meta_agent_benchmark(&benchmark_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Benchmark not found".to_string()))?;

    let result = NewMetaAgentBenchmarkResult {
        benchmark_id: benchmark_id.clone(),
        config_id: req.config_id,
        user_id: user_id.clone(),
        score: req.score,
        passed: req.passed,
        duration_ms: req.duration_ms,
        test_results: req.test_results,
        errors: req.errors,
        warnings: req.warnings,
        files_modified: req.files_modified,
        commands_executed: req.commands_executed,
        raw_output: req.raw_output,
    };

    let id = state
        .db
        .create_benchmark_result(&result)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let created = state
        .db
        .get_benchmark_result(&id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to retrieve created result".to_string(),
        ))?;

    Ok(Json(ResultResponse::from(created)))
}

/// GET /api/sdk/meta/benchmarks/:id/results - List benchmark results
async fn list_results(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path(benchmark_id): Path<String>,
    Query(query): Query<ListResultsQuery>,
) -> Result<Json<Vec<ResultResponse>>, (axum::http::StatusCode, String)> {
    let results = state
        .db
        .list_benchmark_results(&benchmark_id, query.config_id.as_deref(), query.limit)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(results.into_iter().map(ResultResponse::from).collect()))
}

/// GET /api/sdk/meta/benchmarks/:benchmark_id/results/:result_id - Get a specific result
async fn get_result(
    State(state): State<Arc<AppState>>,
    Extension(_auth): Extension<AuthContext>,
    Path((_benchmark_id, result_id)): Path<(String, String)>,
) -> Result<Json<ResultResponse>, (axum::http::StatusCode, String)> {
    let result = state
        .db
        .get_benchmark_result(&result_id)
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or((axum::http::StatusCode::NOT_FOUND, "Result not found".to_string()))?;

    Ok(Json(ResultResponse::from(result)))
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────

/// Create the meta-agent router
pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        // Config routes
        .route("/sdk/meta/configs", get(list_configs).post(create_config))
        .route(
            "/sdk/meta/configs/{id}",
            get(get_config).delete(delete_config),
        )
        // Benchmark routes
        .route(
            "/sdk/meta/benchmarks",
            get(list_benchmarks).post(create_benchmark),
        )
        .route("/sdk/meta/benchmarks/{id}", get(get_benchmark))
        .route(
            "/sdk/meta/benchmarks/{id}/run",
            axum::routing::post(record_benchmark_run),
        )
        // Benchmark result routes
        .route(
            "/sdk/meta/benchmarks/{id}/results",
            get(list_results).post(create_result),
        )
        .route(
            "/sdk/meta/benchmarks/{benchmark_id}/results/{result_id}",
            get(get_result),
        )
}
