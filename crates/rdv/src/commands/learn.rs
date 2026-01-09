//! Self-improvement and learning commands.
//!
//! The self-improvement system extracts knowledge from completed sessions:
//! - Transcript Analysis: Parse .jsonl transcripts from Claude Code sessions
//! - Learning Extraction: Identify patterns, conventions, gotchas
//! - Knowledge Storage: Persist learnings in project knowledge base
//! - Agent Instrumentation: Update CLAUDE.md and agent configs
//!
//! Learning types:
//! - `convention`: Code style, naming patterns, architecture decisions
//! - `pattern`: Recurring solutions, workflows, best practices
//! - `skill`: Reusable capabilities, verified code snippets
//! - `tool`: MCP tool definitions, automation scripts
//! - `gotcha`: Pitfalls, warnings, things that broke

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use colored::Colorize;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::cli::{LearnAction, LearnCommand};
use crate::config::Config;
use crate::tmux;

/// A learning extracted from a session transcript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Learning {
    /// Unique ID
    pub id: String,
    /// Type of learning (convention, pattern, skill, tool, gotcha)
    pub learning_type: String,
    /// Short title
    pub title: String,
    /// Detailed description
    pub description: String,
    /// Source session ID (if any)
    pub source_session: Option<String>,
    /// Source folder path
    pub source_folder: Option<String>,
    /// Confidence score (0.0 - 1.0)
    pub confidence: f64,
    /// Tags for categorization
    pub tags: Vec<String>,
    /// When this learning was created
    pub created_at: DateTime<Utc>,
    /// When this learning was last validated
    pub validated_at: Option<DateTime<Utc>>,
    /// Number of times this learning was applied
    pub application_count: u32,
}

/// Project knowledge base.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectKnowledge {
    /// Project name
    pub project_name: String,
    /// Project path
    pub project_path: String,
    /// List of learnings
    pub learnings: Vec<Learning>,
    /// Last updated timestamp
    pub updated_at: DateTime<Utc>,
    /// Version for schema migrations
    pub version: u32,
}

impl ProjectKnowledge {
    fn knowledge_path(folder: &std::path::Path) -> PathBuf {
        folder
            .join(".remote-dev")
            .join("knowledge")
            .join("project-knowledge.json")
    }

    pub fn load(folder: &std::path::Path) -> Result<Self> {
        let path = Self::knowledge_path(folder);
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(Self {
                project_name: folder
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "unknown".to_string()),
                project_path: folder.to_string_lossy().to_string(),
                learnings: Vec::new(),
                updated_at: Utc::now(),
                version: 1,
            })
        }
    }

    pub fn save(&self, folder: &std::path::Path) -> Result<()> {
        let path = Self::knowledge_path(folder);
        std::fs::create_dir_all(path.parent().unwrap())?;
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    pub fn add_learning(&mut self, learning: Learning) {
        self.learnings.push(learning);
        self.updated_at = Utc::now();
    }
}

pub async fn execute(cmd: LearnCommand, config: &Config) -> Result<()> {
    match cmd.action {
        LearnAction::Analyze { session_id, save } => analyze(&session_id, save, config).await,
        LearnAction::Extract { path } => extract(&path, config).await,
        LearnAction::Apply { path, dry_run } => apply(&path, dry_run, config).await,
        LearnAction::Show { path } => show(&path).await,
        LearnAction::List { r#type, folder } => list(r#type.as_deref(), folder.as_deref()).await,
    }
}

fn resolve_path(path: &str) -> PathBuf {
    let p = if path == "." {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from(path)
    };
    p.canonicalize().unwrap_or(p)
}

async fn analyze(session_id: &str, save: bool, config: &Config) -> Result<()> {
    println!(
        "{}",
        format!("Analyzing session {}...", session_id).cyan()
    );

    // Try to get transcript from tmux scrollback
    let scrollback = if tmux::session_exists(session_id)? {
        println!("  {} Capturing live session scrollback", "→".cyan());
        Some(tmux::capture_pane(session_id, Some(5000))?)
    } else {
        // Look for saved transcript
        let transcript_path = config
            .paths
            .transcripts_dir
            .join(format!("{}.jsonl", session_id));
        if transcript_path.exists() {
            println!(
                "  {} Loading saved transcript",
                "→".cyan()
            );
            Some(std::fs::read_to_string(&transcript_path)?)
        } else {
            None
        }
    };

    let Some(content) = scrollback else {
        println!(
            "{}",
            format!("Session '{}' not found and no saved transcript", session_id).red()
        );
        return Ok(());
    };

    // Analyze the content
    println!();
    println!("  {}", "Transcript Analysis:".cyan());

    let analysis = analyze_transcript_content(&content)?;

    // Display findings
    println!("  Lines analyzed: {}", analysis.line_count);
    println!("  Tool calls found: {}", analysis.tool_calls);
    println!("  Error patterns: {}", analysis.error_patterns);
    println!("  Commands executed: {}", analysis.commands);
    println!();

    // Extract learnings
    let learnings = extract_learnings_from_analysis(&analysis);

    if learnings.is_empty() {
        println!("  {}", "No significant learnings extracted".yellow());
    } else {
        println!(
            "  {} {} learning(s) extracted:",
            "✓".green(),
            learnings.len()
        );
        for learning in &learnings {
            println!(
                "    • [{}] {} ({:.0}% confidence)",
                learning.learning_type,
                learning.title,
                learning.confidence * 100.0
            );
        }

        if save {
            // Determine project folder
            let folder = std::env::current_dir().context("Failed to get current directory")?;
            let mut knowledge = ProjectKnowledge::load(&folder)?;

            for learning in learnings {
                knowledge.add_learning(learning);
            }

            knowledge.save(&folder)?;
            println!();
            println!(
                "  {} Saved to {:?}",
                "✓".green(),
                ProjectKnowledge::knowledge_path(&folder)
            );
        } else {
            println!();
            println!("  Run with --save to persist these learnings");
        }
    }

    Ok(())
}

/// Simple transcript analysis result.
#[derive(Debug, Default)]
struct TranscriptAnalysis {
    line_count: usize,
    tool_calls: usize,
    error_patterns: usize,
    commands: usize,
    patterns: Vec<String>,
    errors: Vec<String>,
}

fn analyze_transcript_content(content: &str) -> Result<TranscriptAnalysis> {
    let mut analysis = TranscriptAnalysis::default();

    for line in content.lines() {
        analysis.line_count += 1;

        // Detect tool calls (Claude Code format)
        if line.contains("tool_use") || line.contains("Tool:") || line.contains("→") {
            analysis.tool_calls += 1;
        }

        // Detect errors
        if line.to_lowercase().contains("error")
            || line.contains("failed")
            || line.contains("Error:")
            || line.contains("panic")
        {
            analysis.error_patterns += 1;
            if analysis.errors.len() < 5 {
                analysis.errors.push(line.to_string());
            }
        }

        // Detect command execution
        if line.contains("$ ") || line.starts_with("+ ") || line.contains("❯") {
            analysis.commands += 1;
        }

        // Detect patterns
        if line.contains("pattern")
            || line.contains("convention")
            || line.contains("always")
            || line.contains("never")
            || line.contains("should")
        {
            if analysis.patterns.len() < 10 {
                analysis.patterns.push(line.to_string());
            }
        }
    }

    Ok(analysis)
}

fn extract_learnings_from_analysis(analysis: &TranscriptAnalysis) -> Vec<Learning> {
    let mut learnings = Vec::new();
    let now = Utc::now();

    // Extract error-based learnings (gotchas)
    if !analysis.errors.is_empty() {
        learnings.push(Learning {
            id: uuid::Uuid::new_v4().to_string(),
            learning_type: "gotcha".to_string(),
            title: format!("Encountered {} error(s) during session", analysis.error_patterns),
            description: analysis.errors.join("\n"),
            source_session: None,
            source_folder: None,
            confidence: 0.6,
            tags: vec!["error".to_string(), "debugging".to_string()],
            created_at: now,
            validated_at: None,
            application_count: 0,
        });
    }

    // Extract pattern-based learnings
    for pattern in &analysis.patterns {
        let confidence = if pattern.contains("always") || pattern.contains("never") {
            0.8
        } else if pattern.contains("should") {
            0.7
        } else {
            0.5
        };

        learnings.push(Learning {
            id: uuid::Uuid::new_v4().to_string(),
            learning_type: "pattern".to_string(),
            title: pattern.chars().take(80).collect::<String>(),
            description: pattern.clone(),
            source_session: None,
            source_folder: None,
            confidence,
            tags: vec!["pattern".to_string()],
            created_at: now,
            validated_at: None,
            application_count: 0,
        });
    }

    learnings
}

async fn extract(path: &str, _config: &Config) -> Result<()> {
    let folder = resolve_path(path);
    println!(
        "{}",
        format!("Extracting learnings from {:?}...", folder).cyan()
    );

    // Look for transcripts in the folder
    let transcript_dir = folder.join(".remote-dev").join("transcripts");
    let knowledge_dir = folder.join(".remote-dev").join("knowledge");

    // Create directories if needed
    std::fs::create_dir_all(&knowledge_dir)?;

    if !transcript_dir.exists() {
        println!(
            "  {} No transcripts directory found at {:?}",
            "⚠".yellow(),
            transcript_dir
        );
        println!("  Transcripts are saved when sessions complete");
        return Ok(());
    }

    // Find all .jsonl files
    let transcripts: Vec<_> = std::fs::read_dir(&transcript_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|ext| ext == "jsonl").unwrap_or(false))
        .collect();

    if transcripts.is_empty() {
        println!("  No transcript files found");
        return Ok(());
    }

    let transcript_count = transcripts.len();
    println!("  Found {} transcript file(s)", transcript_count);

    let mut knowledge = ProjectKnowledge::load(&folder)?;
    let mut total_learnings = 0;

    for entry in &transcripts {
        let path = entry.path();
        println!(
            "  {} Analyzing {:?}",
            "→".cyan(),
            path.file_name().unwrap_or_default()
        );

        let content = std::fs::read_to_string(&path)?;
        let analysis = analyze_transcript_content(&content)?;
        let learnings = extract_learnings_from_analysis(&analysis);

        total_learnings += learnings.len();

        for learning in learnings {
            knowledge.add_learning(learning);
        }
    }

    knowledge.save(&folder)?;

    println!();
    println!(
        "  {} Extracted {} learning(s) from {} transcript(s)",
        "✓".green(),
        total_learnings,
        transcript_count
    );

    Ok(())
}

async fn apply(path: &str, dry_run: bool, _config: &Config) -> Result<()> {
    let folder = resolve_path(path);
    println!(
        "{}",
        format!("Applying learnings to {:?}...", folder).cyan()
    );
    if dry_run {
        println!("  {} Dry run - no changes will be made", "→".cyan());
    }

    // Load project knowledge
    let knowledge = ProjectKnowledge::load(&folder)?;

    if knowledge.learnings.is_empty() {
        println!("  No learnings to apply");
        println!("  Run `rdv learn extract` first to gather learnings");
        return Ok(());
    }

    println!("  Found {} learning(s)", knowledge.learnings.len());

    // Generate CLAUDE.md content
    let claude_md_path = folder.join("CLAUDE.md");
    let existing_content = if claude_md_path.exists() {
        std::fs::read_to_string(&claude_md_path)?
    } else {
        String::new()
    };

    // Build new section
    let mut new_section = String::new();
    new_section.push_str("\n\n## Learned Patterns\n\n");
    new_section.push_str("<!-- Auto-generated by rdv learn apply -->\n\n");

    // Group by type
    let conventions: Vec<_> = knowledge
        .learnings
        .iter()
        .filter(|l| l.learning_type == "convention")
        .collect();
    let patterns: Vec<_> = knowledge
        .learnings
        .iter()
        .filter(|l| l.learning_type == "pattern")
        .collect();
    let gotchas: Vec<_> = knowledge
        .learnings
        .iter()
        .filter(|l| l.learning_type == "gotcha")
        .collect();

    if !conventions.is_empty() {
        new_section.push_str("### Conventions\n\n");
        for learning in conventions {
            new_section.push_str(&format!("- {}\n", learning.title));
        }
        new_section.push('\n');
    }

    if !patterns.is_empty() {
        new_section.push_str("### Patterns\n\n");
        for learning in patterns {
            new_section.push_str(&format!("- {}\n", learning.title));
        }
        new_section.push('\n');
    }

    if !gotchas.is_empty() {
        new_section.push_str("### Gotchas\n\n");
        for learning in gotchas {
            new_section.push_str(&format!("- ⚠️ {}\n", learning.title));
        }
        new_section.push('\n');
    }

    // Show diff
    println!();
    println!("  {}", "Changes to CLAUDE.md:".cyan());
    println!("{}", "─".repeat(60));
    for line in new_section.lines() {
        println!("  + {}", line.green());
    }
    println!("{}", "─".repeat(60));

    if dry_run {
        println!();
        println!("  Run without --dry-run to apply changes");
    } else {
        // Check if we already have a learned patterns section
        let updated_content = if existing_content.contains("## Learned Patterns") {
            // Replace existing section
            let parts: Vec<_> = existing_content.split("## Learned Patterns").collect();
            if parts.len() >= 2 {
                // Find end of section (next ## or end of file)
                let rest = parts[1];
                let section_end = rest.find("\n## ").unwrap_or(rest.len());
                format!("{}## Learned Patterns{}", parts[0], new_section)
                    + &rest[section_end..]
            } else {
                existing_content.clone() + &new_section
            }
        } else {
            existing_content + &new_section
        };

        std::fs::write(&claude_md_path, updated_content)?;
        println!();
        println!(
            "  {} Applied to {:?}",
            "✓".green(),
            claude_md_path
        );
    }

    Ok(())
}

async fn show(path: &str) -> Result<()> {
    let folder = resolve_path(path);
    println!(
        "{}",
        format!("Project Knowledge: {:?}", folder).cyan().bold()
    );
    println!("{}", "─".repeat(60));

    let knowledge = ProjectKnowledge::load(&folder)?;

    println!("  Project: {}", knowledge.project_name);
    println!("  Path: {}", knowledge.project_path);
    println!(
        "  Last updated: {}",
        knowledge.updated_at.format("%Y-%m-%d %H:%M:%S")
    );
    println!("  Total learnings: {}", knowledge.learnings.len());

    if knowledge.learnings.is_empty() {
        println!();
        println!("  No learnings yet");
        println!("  Run `rdv learn analyze <session>` to start learning");
        return Ok(());
    }

    // Group by type
    let mut by_type: std::collections::HashMap<&str, Vec<&Learning>> =
        std::collections::HashMap::new();
    for learning in &knowledge.learnings {
        by_type
            .entry(&learning.learning_type)
            .or_default()
            .push(learning);
    }

    println!();
    for (learning_type, learnings) in by_type {
        let type_color = match learning_type {
            "convention" => "Convention".blue(),
            "pattern" => "Pattern".green(),
            "skill" => "Skill".cyan(),
            "tool" => "Tool".magenta(),
            "gotcha" => "Gotcha".red(),
            _ => learning_type.normal(),
        };

        println!("  {} ({}):", type_color, learnings.len());
        for learning in learnings {
            let confidence = format!("{:.0}%", learning.confidence * 100.0);
            println!(
                "    • {} [{}]",
                learning.title,
                confidence.yellow()
            );
        }
        println!();
    }

    Ok(())
}

async fn list(type_filter: Option<&str>, folder_filter: Option<&str>) -> Result<()> {
    println!("{}", "Learnings".cyan().bold());
    println!("{}", "─".repeat(60));

    // Get default folder
    let folder = folder_filter
        .map(|f| resolve_path(f))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let knowledge = ProjectKnowledge::load(&folder)?;

    let filtered: Vec<_> = knowledge
        .learnings
        .iter()
        .filter(|l| {
            if let Some(t) = type_filter {
                l.learning_type == t
            } else {
                true
            }
        })
        .collect();

    if let Some(t) = type_filter {
        println!("  Filter: type={}", t);
    }
    if let Some(f) = folder_filter {
        println!("  Filter: folder={}", f);
    }
    println!("  Results: {} learning(s)", filtered.len());
    println!();

    if filtered.is_empty() {
        println!("  No learnings found");
        return Ok(());
    }

    for learning in filtered {
        let type_badge = match learning.learning_type.as_str() {
            "convention" => "[CONV]".blue(),
            "pattern" => "[PTRN]".green(),
            "skill" => "[SKIL]".cyan(),
            "tool" => "[TOOL]".magenta(),
            "gotcha" => "[GTCH]".red(),
            _ => format!("[{}]", learning.learning_type).normal(),
        };

        println!(
            "  {} {} ({:.0}%)",
            type_badge,
            learning.title,
            learning.confidence * 100.0
        );
        if !learning.tags.is_empty() {
            println!("      Tags: {}", learning.tags.join(", "));
        }
    }

    Ok(())
}
