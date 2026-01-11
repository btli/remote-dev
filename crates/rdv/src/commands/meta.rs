//! Meta-agent configuration optimization commands.
//!
//! Provides CLI access to the meta-agent BUILD → TEST → IMPROVE loop:
//! - `rdv meta optimize` - Run optimization on a task
//! - `rdv meta benchmark` - Test configuration effectiveness
//! - `rdv meta suggest` - Get config suggestions from context
//!
//! Uses rdv-server API for all operations.

use anyhow::{bail, Result};
use colored::Colorize;
use serde::{Deserialize, Serialize};

use rdv_core::client::ApiClient;

use crate::cli::{MetaCommand, MetaAction};
use crate::config::Config;

// ─────────────────────────────────────────────────────────────────────────────
// API Types (matching Next.js API)
// ─────────────────────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskSpec {
    id: String,
    task_type: String,
    description: String,
    acceptance_criteria: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    complexity: Option<f64>,
    relevant_files: Vec<String>,
    constraints: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    beads_issue_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectContext {
    project_path: String,
    project_type: String,
    language: String,
    frameworks: Vec<String>,
    package_manager: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    test_framework: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    linter: Option<String>,
    has_ci: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    folder_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentConfig {
    id: String,
    name: String,
    provider: String,
    task_spec: TaskSpec,
    project_context: ProjectContext,
    system_prompt: String,
    instructions_file: String,
    version: i32,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizationOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    max_iterations: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_score: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_improvement: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout_seconds: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    verbose: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dry_run: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    r#async: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizationRequest {
    task_description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_path: Option<String>,
    options: OptimizationOptions,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizationSnapshot {
    iteration: i32,
    score: f64,
    config_version: i32,
    suggestions_applied: i32,
    iteration_duration_ms: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizationResult {
    config: AgentConfig,
    iterations: i32,
    final_score: f64,
    score_history: Vec<f64>,
    iteration_history: Vec<OptimizationSnapshot>,
    total_duration_ms: i64,
    reached_target: bool,
    stop_reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobResponse {
    job_id: String,
    status: String,
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobStatusResponse {
    job_id: String,
    status: String,
    progress: Option<i32>,
    current_iteration: Option<i32>,
    max_iterations: Option<i32>,
    current_score: Option<f64>,
    target_score: Option<f64>,
    result: Option<OptimizationResult>,
    error: Option<String>,
    created_at: String,
    started_at: Option<String>,
    completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    id: String,
    session_id: Option<String>,
    folder_id: Option<String>,
    task_description: String,
    provider: String,
    status: String,
    iterations: Option<i32>,
    final_score: Option<f64>,
    created_at: String,
    completed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkRequest {
    config_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    task_description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    runs: Option<i32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkResult {
    config_id: String,
    runs: i32,
    scores: Vec<f64>,
    average_score: f64,
    min_score: f64,
    max_score: f64,
    std_dev: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SuggestRequest {
    context: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Suggestion {
    category: String,
    description: String,
    rationale: String,
    confidence: f64,
    #[serde(default)]
    implementation: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SuggestResponse {
    suggestions: Vec<Suggestion>,
    context_used: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Command Execution
// ─────────────────────────────────────────────────────────────────────────────

pub async fn execute(cmd: MetaCommand, config: &Config) -> Result<()> {
    match cmd.action {
        MetaAction::Optimize {
            task,
            provider,
            iterations,
            target_score,
            r#async,
            verbose,
            dry_run,
        } => {
            optimize(
                &task,
                provider.as_deref(),
                iterations,
                target_score,
                r#async,
                verbose,
                dry_run,
                config,
            )
            .await
        }
        MetaAction::Benchmark { config_id, runs } => {
            benchmark(&config_id, runs, config).await
        }
        MetaAction::Suggest {
            context,
            provider,
            project_path,
        } => {
            suggest(&context, provider.as_deref(), project_path.as_deref(), config).await
        }
        MetaAction::Status { job_id } => status(&job_id, config).await,
        MetaAction::History { limit } => history(limit, config).await,
    }
}

async fn optimize(
    task: &str,
    provider: Option<&str>,
    iterations: Option<i32>,
    target_score: Option<f64>,
    async_mode: bool,
    verbose: bool,
    dry_run: bool,
    _config: &Config,
) -> Result<()> {
    println!(
        "{} {}",
        "Meta-Agent Optimization".cyan().bold(),
        if dry_run { "(dry run)" } else { "" }
    );
    println!("Task: {}", task.yellow());
    println!();

    let client = match ApiClient::new() {
        Ok(c) => c,
        Err(e) => {
            bail!(
                "Cannot connect to rdv-server: {}. Run 'rdv auth login' first.",
                e
            );
        }
    };

    // Get current directory as project path
    let project_path = std::env::current_dir()?.to_string_lossy().to_string();

    let request = OptimizationRequest {
        task_description: task.to_string(),
        project_path: Some(project_path),
        options: OptimizationOptions {
            max_iterations: iterations,
            target_score,
            min_improvement: None,
            timeout_seconds: None,
            verbose: Some(verbose),
            dry_run: Some(dry_run),
            r#async: Some(async_mode),
            session_id: None,
            folder_id: None,
            provider: provider.map(|s| s.to_string()),
        },
    };

    let response: serde_json::Value = client
        .post("/api/sdk/meta", &request)
        .await?;

    if async_mode {
        // Async mode - returns job ID
        let job: JobResponse = serde_json::from_value(response)?;
        println!("{} Job started", "✓".green());
        println!("  Job ID: {}", job.job_id.cyan());
        println!("  Status: {}", job.status);
        println!();
        println!(
            "Track progress with: {} {}",
            "rdv meta status".yellow(),
            job.job_id
        );
    } else {
        // Sync mode - returns full result
        let result: OptimizationResult = serde_json::from_value(response)?;
        display_optimization_result(&result);
    }

    Ok(())
}

fn display_optimization_result(result: &OptimizationResult) {
    println!("{}", "═".repeat(60).cyan());
    println!(
        "{} {}",
        "Optimization Complete".green().bold(),
        if result.reached_target {
            "✓ Target reached"
        } else {
            "⚠ Stopped early"
        }
    );
    println!("{}", "═".repeat(60).cyan());
    println!();

    // Summary
    println!("{}", "Summary".cyan().bold());
    println!("  Iterations: {}", result.iterations);
    println!("  Final Score: {:.2}%", result.final_score * 100.0);
    println!(
        "  Duration: {:.1}s",
        result.total_duration_ms as f64 / 1000.0
    );
    println!(
        "  Stop Reason: {}",
        match result.stop_reason.as_str() {
            "target_reached" => "Target score reached".green().to_string(),
            "max_iterations" => "Max iterations reached".yellow().to_string(),
            "no_improvement" => "No further improvement".yellow().to_string(),
            "timeout" => "Timeout".red().to_string(),
            "error" => "Error occurred".red().to_string(),
            other => other.to_string(),
        }
    );
    println!();

    // Score history
    if !result.score_history.is_empty() {
        println!("{}", "Score History".cyan().bold());
        for (i, score) in result.score_history.iter().enumerate() {
            let bar_len = (score * 30.0) as usize;
            let bar = "█".repeat(bar_len);
            let change = if i > 0 {
                let prev = result.score_history[i - 1];
                let diff = score - prev;
                if diff > 0.0 {
                    format!(" (+{:.1}%)", diff * 100.0).green().to_string()
                } else if diff < 0.0 {
                    format!(" ({:.1}%)", diff * 100.0).red().to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            };
            println!(
                "  {:2}. {} {:.1}%{}",
                i + 1,
                bar.blue(),
                score * 100.0,
                change
            );
        }
        println!();
    }

    // Config info
    println!("{}", "Config".cyan().bold());
    println!("  ID: {}", result.config.id);
    println!("  Version: {}", result.config.version);
    println!("  Provider: {}", result.config.provider);
    println!();
}

async fn benchmark(config_id: &str, runs: Option<i32>, _config: &Config) -> Result<()> {
    println!("{}", "Meta-Agent Benchmark".cyan().bold());
    println!("Config ID: {}", config_id.yellow());
    println!("Runs: {}", runs.unwrap_or(3));
    println!();

    let client = match ApiClient::new() {
        Ok(c) => c,
        Err(e) => {
            bail!(
                "Cannot connect to rdv-server: {}. Run 'rdv auth login' first.",
                e
            );
        }
    };

    let request = BenchmarkRequest {
        config_id: config_id.to_string(),
        task_description: None,
        runs,
    };

    let result: BenchmarkResult = client
        .post("/api/sdk/meta/benchmark", &request)
        .await?;

    println!("{}", "═".repeat(60).cyan());
    println!("{}", "Benchmark Results".green().bold());
    println!("{}", "═".repeat(60).cyan());
    println!();

    println!("{}", "Scores".cyan().bold());
    for (i, score) in result.scores.iter().enumerate() {
        let bar_len = (score * 30.0) as usize;
        let bar = "█".repeat(bar_len);
        println!("  Run {:2}: {} {:.1}%", i + 1, bar.blue(), score * 100.0);
    }
    println!();

    println!("{}", "Statistics".cyan().bold());
    println!("  Average: {:.2}%", result.average_score * 100.0);
    println!("  Min: {:.2}%", result.min_score * 100.0);
    println!("  Max: {:.2}%", result.max_score * 100.0);
    println!("  Std Dev: {:.2}%", result.std_dev * 100.0);
    println!();

    Ok(())
}

async fn suggest(
    context: &str,
    provider: Option<&str>,
    project_path: Option<&str>,
    _config: &Config,
) -> Result<()> {
    println!("{}", "Meta-Agent Suggestions".cyan().bold());
    println!();

    let client = match ApiClient::new() {
        Ok(c) => c,
        Err(e) => {
            bail!(
                "Cannot connect to rdv-server: {}. Run 'rdv auth login' first.",
                e
            );
        }
    };

    // Use provided path or current directory
    let path = project_path
        .map(|s| s.to_string())
        .unwrap_or_else(|| std::env::current_dir().unwrap().to_string_lossy().to_string());

    let request = SuggestRequest {
        context: context.to_string(),
        provider: provider.map(|s| s.to_string()),
        project_path: Some(path),
    };

    let response: SuggestResponse = client
        .post("/api/sdk/meta/suggest", &request)
        .await?;

    if response.suggestions.is_empty() {
        println!("{}", "No suggestions found for the given context.".yellow());
        return Ok(());
    }

    println!(
        "{} {} suggestions found",
        "✓".green(),
        response.suggestions.len()
    );
    println!();

    for (i, suggestion) in response.suggestions.iter().enumerate() {
        let confidence_bar = "█".repeat((suggestion.confidence * 10.0) as usize);
        let confidence_color = if suggestion.confidence >= 0.8 {
            confidence_bar.green()
        } else if suggestion.confidence >= 0.6 {
            confidence_bar.yellow()
        } else {
            confidence_bar.red()
        };

        println!(
            "{}. {} {}",
            (i + 1).to_string().cyan().bold(),
            suggestion.category.to_uppercase().magenta(),
            confidence_color
        );
        println!("   {}", suggestion.description);
        println!("   {}: {}", "Rationale".dimmed(), suggestion.rationale);
        if let Some(ref impl_hint) = suggestion.implementation {
            println!("   {}: {}", "Implementation".dimmed(), impl_hint);
        }
        println!();
    }

    Ok(())
}

async fn status(job_id: &str, _config: &Config) -> Result<()> {
    let client = match ApiClient::new() {
        Ok(c) => c,
        Err(e) => {
            bail!(
                "Cannot connect to rdv-server: {}. Run 'rdv auth login' first.",
                e
            );
        }
    };

    let status: JobStatusResponse = client
        .get(&format!("/api/sdk/meta/status/{}", job_id))
        .await?;

    println!("{}", "Optimization Job Status".cyan().bold());
    println!();
    println!("Job ID: {}", status.job_id.yellow());
    println!("Status: {}", format_status(&status.status));
    println!("Created: {}", status.created_at);

    if let Some(ref started) = status.started_at {
        println!("Started: {}", started);
    }

    if let Some(ref completed) = status.completed_at {
        println!("Completed: {}", completed);
    }

    if let Some(progress) = status.progress {
        println!();
        let bar_len = (progress as f64 / 100.0 * 40.0) as usize;
        let bar = format!(
            "[{}{}] {}%",
            "█".repeat(bar_len),
            "░".repeat(40 - bar_len),
            progress
        );
        println!("Progress: {}", bar.cyan());
    }

    if let Some(current) = status.current_iteration {
        if let Some(max) = status.max_iterations {
            println!("Iteration: {}/{}", current, max);
        }
    }

    if let Some(score) = status.current_score {
        println!("Current Score: {:.2}%", score * 100.0);
    }

    if let Some(target) = status.target_score {
        println!("Target Score: {:.2}%", target * 100.0);
    }

    if let Some(ref error) = status.error {
        println!();
        println!("{}", "Error".red().bold());
        println!("  {}", error);
    }

    if let Some(ref result) = status.result {
        println!();
        display_optimization_result(result);
    }

    Ok(())
}

fn format_status(status: &str) -> colored::ColoredString {
    match status {
        "pending" => status.yellow(),
        "running" => status.cyan(),
        "completed" => status.green(),
        "failed" => status.red(),
        _ => status.normal(),
    }
}

async fn history(limit: Option<i32>, _config: &Config) -> Result<()> {
    let client = match ApiClient::new() {
        Ok(c) => c,
        Err(e) => {
            bail!(
                "Cannot connect to rdv-server: {}. Run 'rdv auth login' first.",
                e
            );
        }
    };

    let query = limit
        .map(|l| format!("?limit={}", l))
        .unwrap_or_default();

    let entries: Vec<HistoryEntry> = client
        .get(&format!("/api/sdk/meta/history{}", query))
        .await?;

    if entries.is_empty() {
        println!("{}", "No optimization history found.".yellow());
        return Ok(());
    }

    println!("{}", "Optimization History".cyan().bold());
    println!("{}", "═".repeat(80).cyan());

    for entry in entries {
        let status_str = format_status(&entry.status);
        let score_str = entry
            .final_score
            .map(|s| format!("{:.1}%", s * 100.0))
            .unwrap_or_else(|| "-".to_string());
        let iterations_str = entry
            .iterations
            .map(|i| i.to_string())
            .unwrap_or_else(|| "-".to_string());

        println!(
            "{} {} {} score={} iters={}",
            entry.id[..8].yellow(),
            entry.provider.cyan(),
            status_str,
            score_str,
            iterations_str
        );
        println!(
            "   {} ({})",
            entry.task_description.chars().take(60).collect::<String>(),
            entry.created_at
        );
        println!();
    }

    Ok(())
}
