//! Meta-Agent MCP tools.
//!
//! Provides MCP tools for the BUILD → TEST → IMPROVE optimization loop:
//! - meta_optimize: Run full optimization loop for a task
//! - meta_build: Generate initial agent config from task spec
//! - meta_benchmark: Create benchmark for a task
//! - meta_run_benchmark: Run benchmark against a config
//! - meta_improve: Generate refinement suggestions

use rdv_core::Database;
use rdv_sdk::extensions::{DynamicToolRouter, SDK, ToolHandler, ToolInput, ToolOutput};
use rdv_sdk::meta_agent::{
    AgentProvider, BenchmarkBuilder, OptimizationOptions, ProjectContext, TaskSpec, TaskType,
};
use serde_json::json;
use std::sync::Arc;
use tracing::{debug, info};

/// Extension ID for meta-agent tools
const META_EXTENSION_ID: &str = "meta";

/// Register all meta-agent tools with the dynamic tool router
pub async fn register_meta_agent_tools(
    router: Arc<DynamicToolRouter>,
    db: Arc<Database>,
) -> Result<(), String> {
    info!("Registering meta-agent tools...");

    // Register meta_optimize tool
    let db_clone = Arc::clone(&db);
    register_meta_optimize(&router, db_clone).await?;

    // Register meta_build tool
    let db_clone = Arc::clone(&db);
    register_meta_build(&router, db_clone).await?;

    // Register meta_benchmark tool
    register_meta_benchmark(&router).await?;

    // Register meta_run_benchmark tool
    register_meta_run_benchmark(&router).await?;

    // Register meta_improve tool
    let db_clone = Arc::clone(&db);
    register_meta_improve(&router, db_clone).await?;

    let count = router.tool_count().await;
    info!("Registered meta-agent tools (total: {})", count);

    Ok(())
}

/// Register meta_optimize tool - runs full BUILD → TEST → IMPROVE loop
/// Note: This is a simplified version that generates a config directly.
/// For full optimization, use the TypeScript API at /api/sdk/meta.
async fn register_meta_optimize(
    router: &DynamicToolRouter,
    _db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("meta_optimize")
        .display_name("Optimize Agent Config")
        .description("Generate an optimized agent configuration for a task. For iterative optimization, use the HTTP API at /api/sdk/meta.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "task": {
                    "type": "object",
                    "description": "Task specification",
                    "properties": {
                        "id": { "type": "string" },
                        "taskType": {
                            "type": "string",
                            "enum": ["feature", "bugfix", "refactor", "test", "docs", "review"]
                        },
                        "description": { "type": "string" },
                        "acceptanceCriteria": {
                            "type": "array",
                            "items": { "type": "string" }
                        },
                        "complexity": { "type": "number" },
                        "relevantFiles": {
                            "type": "array",
                            "items": { "type": "string" }
                        },
                        "constraints": {
                            "type": "array",
                            "items": { "type": "string" }
                        }
                    },
                    "required": ["id", "taskType", "description"]
                },
                "context": {
                    "type": "object",
                    "description": "Project context",
                    "properties": {
                        "projectPath": { "type": "string" },
                        "projectType": { "type": "string" },
                        "language": { "type": "string" },
                        "frameworks": {
                            "type": "array",
                            "items": { "type": "string" }
                        },
                        "packageManager": { "type": "string" },
                        "testFramework": { "type": "string" },
                        "linter": { "type": "string" },
                        "hasCi": { "type": "boolean" },
                        "currentBranch": { "type": "string" },
                        "folderId": { "type": "string" }
                    },
                    "required": ["projectPath", "language"]
                },
                "provider": {
                    "type": "string",
                    "enum": ["claude", "codex", "gemini", "opencode"],
                    "description": "Target agent provider (default: claude)"
                }
            },
            "required": ["task", "context"]
        }))
        .category("meta-agent")
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        Box::pin(async move {
            let args = &input.args;

            // Parse task spec
            let task = match parse_task_spec(args.get("task")) {
                Ok(t) => t,
                Err(e) => {
                    return ToolOutput {
                        data: json!({"success": false, "error": e}),
                        success: false,
                        error: Some(e),
                        duration_ms: 0,
                        side_effects: vec![],
                    }
                }
            };

            // Parse project context
            let context = match parse_project_context(args.get("context")) {
                Ok(c) => c,
                Err(e) => {
                    return ToolOutput {
                        data: json!({"success": false, "error": e}),
                        success: false,
                        error: Some(e),
                        duration_ms: 0,
                        side_effects: vec![],
                    }
                }
            };

            // Parse provider
            let provider = args
                .get("provider")
                .and_then(|v| v.as_str())
                .map(parse_provider)
                .unwrap_or(AgentProvider::Claude);

            // Generate config directly (simplified version)
            let config_id = format!("config-{}", uuid::Uuid::new_v4());
            let system_prompt = generate_system_prompt(&task, &context, provider);
            let instructions = generate_instructions(&task, &context);

            debug!("Generated config {} for task {}", &config_id[..8], &task.id);

            ToolOutput {
                data: json!({
                    "success": true,
                    "config": {
                        "id": config_id,
                        "name": format!("Config for {}", task.description),
                        "provider": format!("{:?}", provider).to_lowercase(),
                        "version": 1,
                        "systemPrompt": system_prompt,
                        "instructionsFile": instructions
                    },
                    "note": "For iterative optimization with benchmarking, use POST /api/sdk/meta"
                }),
                success: true,
                error: None,
                duration_ms: 0,
                side_effects: vec![],
            }
        })
    });

    router
        .register_tool_with_handler(META_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register meta_build tool - generates initial config from task
async fn register_meta_build(
    router: &DynamicToolRouter,
    _db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("meta_build")
        .display_name("Build Agent Config")
        .description("Generate an initial agent configuration from a task specification (BUILD phase only).")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "task": {
                    "type": "object",
                    "description": "Task specification",
                    "properties": {
                        "id": { "type": "string" },
                        "taskType": {
                            "type": "string",
                            "enum": ["feature", "bugfix", "refactor", "test", "docs", "review"]
                        },
                        "description": { "type": "string" },
                        "acceptanceCriteria": {
                            "type": "array",
                            "items": { "type": "string" }
                        },
                        "relevantFiles": {
                            "type": "array",
                            "items": { "type": "string" }
                        },
                        "constraints": {
                            "type": "array",
                            "items": { "type": "string" }
                        }
                    },
                    "required": ["id", "taskType", "description"]
                },
                "context": {
                    "type": "object",
                    "description": "Project context",
                    "properties": {
                        "projectPath": { "type": "string" },
                        "language": { "type": "string" },
                        "frameworks": { "type": "array", "items": { "type": "string" } },
                        "packageManager": { "type": "string" }
                    },
                    "required": ["projectPath", "language"]
                },
                "provider": {
                    "type": "string",
                    "enum": ["claude", "codex", "gemini", "opencode"],
                    "description": "Target agent provider (default: claude)"
                }
            },
            "required": ["task", "context"]
        }))
        .category("meta-agent")
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        Box::pin(async move {
            let args = &input.args;

            let task = match parse_task_spec(args.get("task")) {
                Ok(t) => t,
                Err(e) => {
                    return ToolOutput {
                        data: json!({"success": false, "error": e}),
                        success: false,
                        error: Some(e),
                        duration_ms: 0,
                        side_effects: vec![],
                    }
                }
            };

            let context = match parse_project_context(args.get("context")) {
                Ok(c) => c,
                Err(e) => {
                    return ToolOutput {
                        data: json!({"success": false, "error": e}),
                        success: false,
                        error: Some(e),
                        duration_ms: 0,
                        side_effects: vec![],
                    }
                }
            };

            let provider = args
                .get("provider")
                .and_then(|v| v.as_str())
                .map(parse_provider)
                .unwrap_or(AgentProvider::Claude);

            // Generate config directly
            let config_id = format!("config-{}", uuid::Uuid::new_v4());
            let system_prompt = generate_system_prompt(&task, &context, provider);
            let instructions = generate_instructions(&task, &context);

            ToolOutput {
                data: json!({
                    "success": true,
                    "config": {
                        "id": config_id,
                        "name": format!("Config for {}", task.description),
                        "provider": format!("{:?}", provider).to_lowercase(),
                        "version": 1,
                        "systemPrompt": system_prompt,
                        "instructionsFile": instructions
                    }
                }),
                success: true,
                error: None,
                duration_ms: 0,
                side_effects: vec![],
            }
        })
    });

    router
        .register_tool_with_handler(META_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register meta_benchmark tool - creates a benchmark for a task
async fn register_meta_benchmark(router: &DynamicToolRouter) -> Result<(), String> {
    let tool = SDK::tool("meta_benchmark")
        .display_name("Create Benchmark")
        .description("Create a benchmark with test cases for evaluating agent configurations.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "task": {
                    "type": "object",
                    "description": "Task specification to generate benchmark for",
                    "properties": {
                        "id": { "type": "string" },
                        "taskType": { "type": "string" },
                        "description": { "type": "string" },
                        "acceptanceCriteria": { "type": "array", "items": { "type": "string" } },
                        "relevantFiles": { "type": "array", "items": { "type": "string" } },
                        "constraints": { "type": "array", "items": { "type": "string" } }
                    },
                    "required": ["id", "taskType", "description"]
                },
                "context": {
                    "type": "object",
                    "description": "Optional project context for context-aware test generation",
                    "properties": {
                        "projectPath": { "type": "string" },
                        "language": { "type": "string" },
                        "frameworks": { "type": "array", "items": { "type": "string" } }
                    }
                },
                "customTestCases": {
                    "type": "array",
                    "description": "Optional custom test cases to include",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string" },
                            "description": { "type": "string" },
                            "input": { "type": "string" },
                            "expectedPatterns": { "type": "array", "items": { "type": "string" } },
                            "weight": { "type": "number" }
                        }
                    }
                },
                "timeoutSeconds": {
                    "type": "integer",
                    "description": "Benchmark timeout in seconds (default: 300)"
                }
            },
            "required": ["task"]
        }))
        .category("meta-agent")
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        Box::pin(async move {
            let args = &input.args;

            let task = match parse_task_spec(args.get("task")) {
                Ok(t) => t,
                Err(e) => {
                    return ToolOutput {
                        data: json!({"success": false, "error": e}),
                        success: false,
                        error: Some(e),
                        duration_ms: 0,
                        side_effects: vec![],
                    }
                }
            };

            let context = args
                .get("context")
                .and_then(|c| parse_project_context(Some(c)).ok());

            let timeout = args
                .get("timeoutSeconds")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32)
                .unwrap_or(300);

            // Build benchmark
            let mut builder = BenchmarkBuilder::new(task);

            if let Some(ctx) = context {
                builder = builder.with_context(ctx);
            }

            builder = builder.with_timeout(timeout as u64);

            let benchmark = builder.build();

            ToolOutput {
                data: json!({
                    "success": true,
                    "benchmark": {
                        "id": benchmark.id,
                        "name": benchmark.name,
                        "testCaseCount": benchmark.test_cases.len(),
                        "testCases": benchmark.test_cases.iter().map(|tc| json!({
                            "id": tc.id,
                            "description": tc.description,
                            "expectedPatterns": tc.expected_patterns,
                            "weight": tc.weight
                        })).collect::<Vec<_>>(),
                        "timeoutSeconds": benchmark.timeout_seconds
                    }
                }),
                success: true,
                error: None,
                duration_ms: 0,
                side_effects: vec![],
            }
        })
    });

    router
        .register_tool_with_handler(META_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register meta_run_benchmark tool - runs benchmark against a config
async fn register_meta_run_benchmark(router: &DynamicToolRouter) -> Result<(), String> {
    let tool = SDK::tool("meta_run_benchmark")
        .display_name("Run Benchmark")
        .description("Run a benchmark against an agent configuration and return detailed results.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "config": {
                    "type": "object",
                    "description": "Agent configuration to test",
                    "properties": {
                        "id": { "type": "string" },
                        "systemPrompt": { "type": "string" },
                        "instructionsFile": { "type": "string" }
                    },
                    "required": ["systemPrompt"]
                },
                "benchmark": {
                    "type": "object",
                    "description": "Benchmark to run",
                    "properties": {
                        "id": { "type": "string" },
                        "testCases": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": { "type": "string" },
                                    "description": { "type": "string" },
                                    "expectedPatterns": { "type": "array", "items": { "type": "string" } },
                                    "weight": { "type": "number" }
                                }
                            }
                        }
                    },
                    "required": ["testCases"]
                }
            },
            "required": ["config", "benchmark"]
        }))
        .category("meta-agent")
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        Box::pin(async move {
            let args = &input.args;

            let config = match args.get("config") {
                Some(c) => c,
                None => {
                    return ToolOutput {
                        data: json!({"success": false, "error": "config is required"}),
                        success: false,
                        error: Some("config is required".to_string()),
                        duration_ms: 0,
                        side_effects: vec![],
                    }
                }
            };

            let benchmark = match args.get("benchmark") {
                Some(b) => b,
                None => {
                    return ToolOutput {
                        data: json!({"success": false, "error": "benchmark is required"}),
                        success: false,
                        error: Some("benchmark is required".to_string()),
                        duration_ms: 0,
                        side_effects: vec![],
                    }
                }
            };

            // Extract config content for pattern matching
            let system_prompt = config
                .get("systemPrompt")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let instructions = config
                .get("instructionsFile")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let combined_content = format!("{} {}", system_prompt, instructions).to_lowercase();

            // Run test cases
            let test_cases = benchmark
                .get("testCases")
                .and_then(|v| v.as_array())
                .map(|arr| arr.to_vec())
                .unwrap_or_default();

            let start_time = std::time::Instant::now();
            let mut test_results = Vec::new();
            let mut total_score = 0.0;
            let mut total_weight = 0.0;

            for tc in &test_cases {
                let tc_id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
                let patterns = tc
                    .get("expectedPatterns")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|p| p.as_str())
                            .map(|s| s.to_string())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let weight = tc.get("weight").and_then(|v| v.as_f64()).unwrap_or(1.0);

                // Check pattern matches
                let mut matches_found = 0;
                for pattern in &patterns {
                    if combined_content.contains(&pattern.to_lowercase()) {
                        matches_found += 1;
                    }
                }

                let score = if patterns.is_empty() {
                    1.0
                } else {
                    matches_found as f64 / patterns.len() as f64
                };
                let passed = patterns.is_empty() || matches_found == patterns.len();

                test_results.push(json!({
                    "testCaseId": tc_id,
                    "passed": passed,
                    "score": score,
                    "matchedPatterns": matches_found,
                    "totalPatterns": patterns.len()
                }));

                total_score += score * weight;
                total_weight += weight;
            }

            let final_score = if total_weight > 0.0 {
                total_score / total_weight
            } else {
                0.0
            };
            let all_passed = test_results
                .iter()
                .all(|r| r.get("passed").and_then(|v| v.as_bool()).unwrap_or(false));

            ToolOutput {
                data: json!({
                    "success": true,
                    "result": {
                        "score": final_score,
                        "passed": all_passed && final_score >= 0.7,
                        "testResults": test_results,
                        "durationMs": start_time.elapsed().as_millis() as u64
                    }
                }),
                success: true,
                error: None,
                duration_ms: start_time.elapsed().as_millis() as u64,
                side_effects: vec![],
            }
        })
    });

    router
        .register_tool_with_handler(META_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Register meta_improve tool - generates refinement suggestions
async fn register_meta_improve(
    router: &DynamicToolRouter,
    _db: Arc<Database>,
) -> Result<(), String> {
    let tool = SDK::tool("meta_improve")
        .display_name("Improve Config")
        .description("Analyze benchmark results and generate refinement suggestions for improving the agent configuration.")
        .input_schema(json!({
            "type": "object",
            "properties": {
                "config": {
                    "type": "object",
                    "description": "Current agent configuration",
                    "properties": {
                        "id": { "type": "string" },
                        "systemPrompt": { "type": "string" },
                        "instructionsFile": { "type": "string" }
                    }
                },
                "benchmarkResults": {
                    "type": "object",
                    "description": "Results from running the benchmark",
                    "properties": {
                        "score": { "type": "number" },
                        "passed": { "type": "boolean" },
                        "testResults": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "testCaseId": { "type": "string" },
                                    "passed": { "type": "boolean" },
                                    "score": { "type": "number" },
                                    "error": { "type": "string" }
                                }
                            }
                        }
                    }
                },
                "strategy": {
                    "type": "string",
                    "enum": ["rule_based", "score_based", "composite"],
                    "description": "Refinement strategy to use (default: composite)"
                }
            },
            "required": ["config", "benchmarkResults"]
        }))
        .category("meta-agent")
        .build();

    let handler: ToolHandler = Arc::new(move |input: ToolInput| {
        Box::pin(async move {
            let args = &input.args;

            // Parse config
            let config_json = match args.get("config") {
                Some(c) => c,
                None => {
                    return ToolOutput {
                        data: json!({"success": false, "error": "config is required"}),
                        success: false,
                        error: Some("config is required".to_string()),
                        duration_ms: 0,
                        side_effects: vec![],
                    }
                }
            };

            let results_json = match args.get("benchmarkResults") {
                Some(r) => r,
                None => {
                    return ToolOutput {
                        data: json!({"success": false, "error": "benchmarkResults is required"}),
                        success: false,
                        error: Some("benchmarkResults is required".to_string()),
                        duration_ms: 0,
                        side_effects: vec![],
                    }
                }
            };

            // Generate suggestions based on failed tests
            let test_results = results_json
                .get("testResults")
                .and_then(|v| v.as_array())
                .map(|arr| arr.to_vec())
                .unwrap_or_default();

            let score = results_json
                .get("score")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);

            let mut suggestions = Vec::new();

            // Analyze failed tests
            for result in &test_results {
                let passed = result
                    .get("passed")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if !passed {
                    let test_case_id = result
                        .get("testCaseId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let error = result.get("error").and_then(|v| v.as_str());

                    suggestions.push(json!({
                        "target": "system_prompt",
                        "changeType": "modify",
                        "rationale": format!("Test case {} failed - add coverage for this scenario", test_case_id),
                        "priority": 1,
                        "error": error
                    }));
                }
            }

            // Score-based suggestions
            if score < 0.5 {
                suggestions.push(json!({
                    "target": "system_prompt",
                    "changeType": "modify",
                    "rationale": "Score below 50% - consider restructuring the system prompt with clearer instructions",
                    "priority": 0
                }));
            } else if score < 0.7 {
                suggestions.push(json!({
                    "target": "instructions",
                    "changeType": "add",
                    "rationale": "Score between 50-70% - add more detailed acceptance criteria coverage",
                    "priority": 1
                }));
            }

            ToolOutput {
                data: json!({
                    "success": true,
                    "currentScore": score,
                    "suggestions": suggestions,
                    "suggestionCount": suggestions.len()
                }),
                success: true,
                error: None,
                duration_ms: 0,
                side_effects: vec![],
            }
        })
    });

    router
        .register_tool_with_handler(META_EXTENSION_ID, tool, handler)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// Helper functions for parsing

fn parse_task_spec(value: Option<&serde_json::Value>) -> Result<TaskSpec, String> {
    let task = value.ok_or("task is required")?;

    let id = task
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("task.id is required")?
        .to_string();

    let task_type_str = task
        .get("taskType")
        .and_then(|v| v.as_str())
        .ok_or("task.taskType is required")?;

    let task_type = match task_type_str {
        "feature" => TaskType::Feature,
        "bugfix" => TaskType::Bugfix,
        "refactor" => TaskType::Refactor,
        "test" => TaskType::Test,
        "docs" => TaskType::Docs,
        "review" => TaskType::Review,
        _ => return Err(format!("Invalid taskType: {}", task_type_str)),
    };

    let description = task
        .get("description")
        .and_then(|v| v.as_str())
        .ok_or("task.description is required")?
        .to_string();

    let acceptance_criteria = task
        .get("acceptanceCriteria")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    let complexity = task.get("complexity").and_then(|v| v.as_u64()).map(|v| v as u8);

    let relevant_files = task
        .get("relevantFiles")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    let constraints = task
        .get("constraints")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    Ok(TaskSpec {
        id,
        task_type,
        description,
        acceptance_criteria,
        complexity,
        relevant_files,
        constraints,
        beads_issue_id: None,
    })
}

fn parse_project_context(value: Option<&serde_json::Value>) -> Result<ProjectContext, String> {
    let ctx = value.ok_or("context is required")?;

    let project_path = ctx
        .get("projectPath")
        .and_then(|v| v.as_str())
        .ok_or("context.projectPath is required")?
        .to_string();

    let language = ctx
        .get("language")
        .and_then(|v| v.as_str())
        .ok_or("context.language is required")?
        .to_string();

    let project_type = ctx
        .get("projectType")
        .and_then(|v| v.as_str())
        .unwrap_or("software")
        .to_string();

    let frameworks = ctx
        .get("frameworks")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    let package_manager = ctx
        .get("packageManager")
        .and_then(|v| v.as_str())
        .unwrap_or("npm")
        .to_string();

    let test_framework = ctx
        .get("testFramework")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let linter = ctx
        .get("linter")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let has_ci = ctx.get("hasCi").and_then(|v| v.as_bool()).unwrap_or(false);

    let current_branch = ctx
        .get("currentBranch")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let folder_id = ctx
        .get("folderId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(ProjectContext {
        project_path,
        project_type,
        language,
        frameworks,
        package_manager,
        test_framework,
        linter,
        has_ci,
        current_branch,
        folder_id,
    })
}

fn parse_provider(s: &str) -> AgentProvider {
    match s.to_lowercase().as_str() {
        "claude" => AgentProvider::Claude,
        "codex" => AgentProvider::Codex,
        "gemini" => AgentProvider::Gemini,
        "opencode" => AgentProvider::Opencode,
        _ => AgentProvider::Claude,
    }
}

fn parse_optimization_options(value: Option<&serde_json::Value>) -> OptimizationOptions {
    let opts = value.cloned().unwrap_or(json!({}));
    let defaults = OptimizationOptions::default();

    OptimizationOptions {
        max_iterations: opts
            .get("maxIterations")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(defaults.max_iterations),
        target_score: opts
            .get("targetScore")
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.target_score),
        min_improvement: opts
            .get("minImprovement")
            .and_then(|v| v.as_f64())
            .unwrap_or(defaults.min_improvement),
        timeout_seconds: opts
            .get("timeoutSeconds")
            .and_then(|v| v.as_u64())
            .unwrap_or(defaults.timeout_seconds),
        verbose: opts
            .get("verbose")
            .and_then(|v| v.as_bool())
            .unwrap_or(defaults.verbose),
        dry_run: opts
            .get("dryRun")
            .and_then(|v| v.as_bool())
            .unwrap_or(defaults.dry_run),
    }
}

// Helper: Generate system prompt based on task, context, and provider
fn generate_system_prompt(task: &TaskSpec, context: &ProjectContext, provider: AgentProvider) -> String {
    let project_type = &context.project_type;
    let frameworks = if context.frameworks.is_empty() {
        String::new()
    } else {
        format!(" using {}", context.frameworks.join(", "))
    };

    let base = format!(
        r#"You are working on a {} project{} in {}.

Task: {}
Type: {:?}

Follow best practices for {} development."#,
        project_type,
        frameworks,
        context.language,
        task.description,
        task.task_type,
        context.language
    );

    // Provider-specific additions
    match provider {
        AgentProvider::Claude => {
            format!("{}\n\nUse your reasoning capabilities to plan before implementing.", base)
        }
        AgentProvider::Codex => {
            format!("{}\n\nGenerate efficient, well-tested code.", base)
        }
        AgentProvider::Gemini => {
            format!("{}\n\nAnalyze the problem thoroughly before coding.", base)
        }
        AgentProvider::Opencode => {
            format!("{}\n\nFollow OpenCode conventions and patterns.", base)
        }
    }
}

// Helper: Generate instructions file content
fn generate_instructions(task: &TaskSpec, context: &ProjectContext) -> String {
    let mut content = format!(
        r#"# Project: {}

## Task
{}

"#,
        context.project_path, task.description
    );

    if !task.acceptance_criteria.is_empty() {
        content.push_str("## Acceptance Criteria\n");
        for criterion in &task.acceptance_criteria {
            content.push_str(&format!("- {}\n", criterion));
        }
        content.push('\n');
    }

    if !task.constraints.is_empty() {
        content.push_str("## Constraints\n");
        for constraint in &task.constraints {
            content.push_str(&format!("- {}\n", constraint));
        }
        content.push('\n');
    }

    if !task.relevant_files.is_empty() {
        content.push_str("## Relevant Files\n");
        for file in &task.relevant_files {
            content.push_str(&format!("- {}\n", file));
        }
    }

    content
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_provider() {
        assert!(matches!(parse_provider("claude"), AgentProvider::Claude));
        assert!(matches!(parse_provider("CODEX"), AgentProvider::Codex));
        assert!(matches!(parse_provider("Gemini"), AgentProvider::Gemini));
        assert!(matches!(parse_provider("opencode"), AgentProvider::Opencode));
        assert!(matches!(parse_provider("unknown"), AgentProvider::Claude));
    }

    #[test]
    fn test_parse_task_spec() {
        let task_json = json!({
            "id": "task-1",
            "taskType": "feature",
            "description": "Add user auth",
            "acceptanceCriteria": ["Must have login", "Must have logout"],
            "relevantFiles": ["src/auth.ts"]
        });

        let task = parse_task_spec(Some(&task_json)).unwrap();
        assert_eq!(task.id, "task-1");
        assert!(matches!(task.task_type, TaskType::Feature));
        assert_eq!(task.description, "Add user auth");
        assert_eq!(task.acceptance_criteria.len(), 2);
    }

    #[test]
    fn test_parse_project_context() {
        let ctx_json = json!({
            "projectPath": "/path/to/project",
            "language": "typescript",
            "frameworks": ["next.js", "react"]
        });

        let ctx = parse_project_context(Some(&ctx_json)).unwrap();
        assert_eq!(ctx.project_path, "/path/to/project");
        assert_eq!(ctx.language, "typescript");
        assert_eq!(ctx.frameworks.len(), 2);
    }
}
