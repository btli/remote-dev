//! Learning extraction and knowledge management.
//!
//! Extracts patterns, conventions, and learnings from session transcripts.
//! Stores learnings in project knowledge files for future reference.

use crate::error::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{debug, info, warn};

/// A learning extracted from a session transcript.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Learning {
    /// Unique ID
    pub id: String,
    /// Type of learning (convention, pattern, skill, tool, gotcha)
    pub learning_type: LearningType,
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

/// Type of learning.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LearningType {
    /// Code style, naming patterns, architecture decisions
    Convention,
    /// Recurring solutions, workflows, best practices
    Pattern,
    /// Reusable capabilities, verified code snippets
    Skill,
    /// MCP tool definitions, automation scripts
    Tool,
    /// Pitfalls, warnings, things that broke
    Gotcha,
}

impl std::fmt::Display for LearningType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LearningType::Convention => write!(f, "convention"),
            LearningType::Pattern => write!(f, "pattern"),
            LearningType::Skill => write!(f, "skill"),
            LearningType::Tool => write!(f, "tool"),
            LearningType::Gotcha => write!(f, "gotcha"),
        }
    }
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
    /// Get the path to the knowledge file for a folder.
    pub fn knowledge_path(folder: &Path) -> PathBuf {
        folder
            .join(".remote-dev")
            .join("knowledge")
            .join("project-knowledge.json")
    }

    /// Load project knowledge from a folder.
    pub fn load(folder: &Path) -> Result<Self> {
        let path = Self::knowledge_path(folder);
        if path.exists() {
            let content = fs::read_to_string(&path)?;
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

    /// Save project knowledge to a folder.
    pub fn save(&self, folder: &Path) -> Result<()> {
        let path = Self::knowledge_path(folder);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        fs::write(&path, content)?;
        debug!("Saved project knowledge to {:?}", path);
        Ok(())
    }

    /// Add a learning to the knowledge base.
    pub fn add_learning(&mut self, learning: Learning) {
        self.learnings.push(learning);
        self.updated_at = Utc::now();
    }

    /// Get learnings by type.
    pub fn learnings_by_type(&self, learning_type: &LearningType) -> Vec<&Learning> {
        self.learnings
            .iter()
            .filter(|l| &l.learning_type == learning_type)
            .collect()
    }
}

/// Transcript analysis result.
#[derive(Debug, Default)]
pub struct TranscriptAnalysis {
    pub line_count: usize,
    pub tool_calls: usize,
    pub error_patterns: usize,
    pub commands: usize,
    pub patterns: Vec<String>,
    pub errors: Vec<String>,
}

/// Analyze transcript content for patterns and learnings.
pub fn analyze_transcript(content: &str) -> TranscriptAnalysis {
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

        // Detect patterns (case-insensitive)
        let lower_line = line.to_lowercase();
        if lower_line.contains("pattern")
            || lower_line.contains("convention")
            || lower_line.contains("always")
            || lower_line.contains("never")
            || lower_line.contains("should")
        {
            if analysis.patterns.len() < 10 {
                analysis.patterns.push(line.to_string());
            }
        }
    }

    analysis
}

/// Extract learnings from transcript analysis.
pub fn extract_learnings(
    analysis: &TranscriptAnalysis,
    session_id: Option<&str>,
    folder_path: Option<&str>,
) -> Vec<Learning> {
    let mut learnings = Vec::new();
    let now = Utc::now();

    // Extract error-based learnings (gotchas)
    if !analysis.errors.is_empty() {
        learnings.push(Learning {
            id: uuid::Uuid::new_v4().to_string(),
            learning_type: LearningType::Gotcha,
            title: format!(
                "Encountered {} error(s) during session",
                analysis.error_patterns
            ),
            description: analysis.errors.join("\n"),
            source_session: session_id.map(String::from),
            source_folder: folder_path.map(String::from),
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
            learning_type: LearningType::Pattern,
            title: pattern.chars().take(80).collect::<String>(),
            description: pattern.clone(),
            source_session: session_id.map(String::from),
            source_folder: folder_path.map(String::from),
            confidence,
            tags: vec!["pattern".to_string()],
            created_at: now,
            validated_at: None,
            application_count: 0,
        });
    }

    learnings
}

/// Result of session learning extraction.
#[derive(Debug)]
pub struct SessionLearningResult {
    pub session_id: String,
    pub project_path: Option<String>,
    pub learnings_count: usize,
    pub transcript_saved: bool,
    pub knowledge_updated: bool,
}

/// Save transcript for a session.
pub fn save_transcript(
    session_id: &str,
    content: &str,
    project_path: Option<&Path>,
) -> Result<PathBuf> {
    // Determine transcript directory
    let transcript_dir = if let Some(proj) = project_path {
        proj.join(".remote-dev").join("transcripts")
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(home)
            .join(".remote-dev")
            .join("transcripts")
    };

    fs::create_dir_all(&transcript_dir)?;

    let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
    let short_id = &session_id[..8.min(session_id.len())];
    let filename = format!("{}-{}.txt", short_id, timestamp);
    let path = transcript_dir.join(&filename);

    fs::write(&path, content)?;
    info!("Saved transcript to {:?}", path);

    Ok(path)
}

/// Extract learnings from a session on close.
///
/// This captures the scrollback, analyzes it, and saves learnings.
pub fn extract_session_learnings(
    session_id: &str,
    scrollback: &str,
    project_path: Option<&Path>,
    save_transcript_file: bool,
) -> Result<SessionLearningResult> {
    let mut result = SessionLearningResult {
        session_id: session_id.to_string(),
        project_path: project_path.map(|p| p.to_string_lossy().to_string()),
        learnings_count: 0,
        transcript_saved: false,
        knowledge_updated: false,
    };

    // Skip if scrollback is too short
    if scrollback.lines().count() < 10 {
        debug!(
            "Skipping learning extraction for session {} - scrollback too short",
            &session_id[..8.min(session_id.len())]
        );
        return Ok(result);
    }

    // Optionally save transcript
    if save_transcript_file {
        match save_transcript(session_id, scrollback, project_path) {
            Ok(_) => result.transcript_saved = true,
            Err(e) => warn!("Failed to save transcript: {}", e),
        }
    }

    // Analyze the scrollback
    let analysis = analyze_transcript(scrollback);

    // Extract learnings
    let learnings = extract_learnings(
        &analysis,
        Some(session_id),
        project_path.map(|p| p.to_string_lossy().to_string()).as_deref(),
    );

    result.learnings_count = learnings.len();

    // Save to project knowledge if we have learnings and a project path
    if !learnings.is_empty() {
        if let Some(proj) = project_path {
            match ProjectKnowledge::load(proj) {
                Ok(mut knowledge) => {
                    for learning in learnings {
                        knowledge.add_learning(learning);
                    }
                    if let Err(e) = knowledge.save(proj) {
                        warn!("Failed to save project knowledge: {}", e);
                    } else {
                        result.knowledge_updated = true;
                    }
                }
                Err(e) => warn!("Failed to load project knowledge: {}", e),
            }
        }
    }

    info!(
        "Learning extraction for session {}: {} learnings, transcript_saved={}, knowledge_updated={}",
        &session_id[..8.min(session_id.len())],
        result.learnings_count,
        result.transcript_saved,
        result.knowledge_updated
    );

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_analyze_transcript_empty() {
        let analysis = analyze_transcript("");
        assert_eq!(analysis.line_count, 0);
        assert_eq!(analysis.tool_calls, 0);
    }

    #[test]
    fn test_analyze_transcript_errors() {
        let content = "Line 1\nError: something failed\nLine 3";
        let analysis = analyze_transcript(content);
        assert_eq!(analysis.line_count, 3);
        assert_eq!(analysis.error_patterns, 1);
        assert_eq!(analysis.errors.len(), 1);
    }

    #[test]
    fn test_analyze_transcript_patterns() {
        let content = "You should always use async\nNever block the main thread";
        let analysis = analyze_transcript(content);
        assert_eq!(analysis.patterns.len(), 2);
    }

    #[test]
    fn test_extract_learnings_from_errors() {
        let analysis = TranscriptAnalysis {
            errors: vec!["Error: test".to_string()],
            error_patterns: 1,
            ..Default::default()
        };
        let learnings = extract_learnings(&analysis, Some("test-123"), None);
        assert_eq!(learnings.len(), 1);
        assert_eq!(learnings[0].learning_type, LearningType::Gotcha);
    }

    #[test]
    fn test_learning_type_display() {
        assert_eq!(LearningType::Convention.to_string(), "convention");
        assert_eq!(LearningType::Gotcha.to_string(), "gotcha");
    }
}
