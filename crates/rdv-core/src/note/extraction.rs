//! Insight extraction from notes.
//!
//! Analyzes session notes to extract patterns, conventions, gotchas, and skills.
//! Uses frequency-based confidence scoring and categorization.

use std::collections::HashMap;
use std::sync::Arc;

use crate::error::Result;
use crate::types::{
    Note, NoteType, SdkInsightType, InsightApplicability, NewSdkInsight,
};

#[cfg(feature = "db")]
use crate::db::Database;

/// Configuration for insight extraction.
#[derive(Debug, Clone)]
pub struct ExtractionConfig {
    /// Minimum number of notes referencing a concept to create an insight.
    pub min_note_frequency: usize,
    /// Base confidence for single-note insights.
    pub base_confidence: f64,
    /// Confidence boost per additional note referencing the same concept.
    pub frequency_boost: f64,
    /// Maximum confidence score.
    pub max_confidence: f64,
    /// Minimum content length to consider a note for extraction.
    pub min_content_length: usize,
    /// Enable keyword-based extraction.
    pub use_keywords: bool,
    /// Enable tag-based grouping.
    pub use_tags: bool,
}

impl Default for ExtractionConfig {
    fn default() -> Self {
        Self {
            min_note_frequency: 1,
            base_confidence: 0.5,
            frequency_boost: 0.1,
            max_confidence: 0.95,
            min_content_length: 10,
            use_keywords: true,
            use_tags: true,
        }
    }
}

/// Result of insight extraction.
#[derive(Debug, Clone)]
pub struct ExtractionResult {
    /// Number of notes analyzed.
    pub notes_analyzed: usize,
    /// Number of insights generated.
    pub insights_generated: usize,
    /// Insights by type.
    pub by_type: HashMap<SdkInsightType, usize>,
    /// Average confidence of generated insights.
    pub avg_confidence: f64,
    /// The extracted insights.
    pub insights: Vec<ExtractedInsight>,
}

impl ExtractionResult {
    /// Create an empty result.
    pub fn empty() -> Self {
        Self {
            notes_analyzed: 0,
            insights_generated: 0,
            by_type: HashMap::new(),
            avg_confidence: 0.0,
            insights: vec![],
        }
    }
}

/// A candidate insight before being saved to the database.
#[derive(Debug, Clone)]
pub struct ExtractedInsight {
    /// Suggested insight type.
    pub insight_type: SdkInsightType,
    /// Suggested applicability scope.
    pub applicability: InsightApplicability,
    /// Short descriptive title.
    pub title: String,
    /// Full description.
    pub description: String,
    /// Applicability context (e.g., "typescript", "react").
    pub applicability_context: Option<String>,
    /// Source note IDs that contributed to this insight.
    pub source_note_ids: Vec<String>,
    /// Confidence score (0.0 to 1.0).
    pub confidence: f64,
    /// Tags/keywords associated with this insight.
    pub tags: Vec<String>,
}

impl ExtractedInsight {
    /// Convert to NewSdkInsight for database storage.
    pub fn to_new_insight(&self, user_id: &str, folder_id: Option<&str>) -> NewSdkInsight {
        NewSdkInsight {
            user_id: user_id.to_string(),
            folder_id: folder_id.map(String::from),
            insight_type: self.insight_type,
            applicability: self.applicability,
            title: self.title.clone(),
            description: self.description.clone(),
            applicability_context: self.applicability_context.clone(),
            source_notes: self.source_note_ids.clone(),
            source_sessions: vec![],
            confidence: self.confidence,
        }
    }
}

/// Keywords that suggest specific insight types.
struct InsightKeywords {
    conventions: Vec<&'static str>,
    patterns: Vec<&'static str>,
    anti_patterns: Vec<&'static str>,
    gotchas: Vec<&'static str>,
    best_practices: Vec<&'static str>,
    skills: Vec<&'static str>,
}

impl Default for InsightKeywords {
    fn default() -> Self {
        Self {
            conventions: vec![
                "convention", "naming", "style", "format", "structure",
                "always use", "we use", "standard", "rule",
            ],
            patterns: vec![
                "pattern", "approach", "technique", "method", "way to",
                "solution", "implementation", "workflow",
            ],
            anti_patterns: vec![
                "anti-pattern", "avoid", "don't", "never", "bad practice",
                "mistake", "wrong", "problematic",
            ],
            gotchas: vec![
                "gotcha", "pitfall", "trap", "watch out", "careful",
                "tricky", "bug", "issue", "problem", "error",
            ],
            best_practices: vec![
                "best practice", "recommended", "should", "better to",
                "prefer", "ideal", "optimal", "efficient",
            ],
            skills: vec![
                "how to", "to do", "steps", "procedure", "process",
                "command", "script", "tool",
            ],
        }
    }
}

/// Insight extraction service.
#[cfg(feature = "db")]
pub struct InsightExtractor {
    db: Arc<Database>,
    config: ExtractionConfig,
    keywords: InsightKeywords,
}

#[cfg(feature = "db")]
impl InsightExtractor {
    /// Create a new insight extractor.
    pub fn new(db: Arc<Database>, config: ExtractionConfig) -> Self {
        Self {
            db,
            config,
            keywords: InsightKeywords::default(),
        }
    }

    /// Extract insights from a user's notes.
    pub fn extract_from_user(&self, user_id: &str) -> Result<ExtractionResult> {
        use crate::types::NoteFilter;

        let filter = NoteFilter {
            user_id: user_id.to_string(),
            session_id: None,
            folder_id: None,
            note_type: None,
            archived: Some(false),
            pinned: None,
            limit: Some(500), // Limit for performance
        };

        let notes = self.db.list_notes_filtered(&filter)?;
        self.extract_from_notes(&notes)
    }

    /// Extract insights from a session's notes.
    pub fn extract_from_session(&self, user_id: &str, session_id: &str) -> Result<ExtractionResult> {
        use crate::types::NoteFilter;

        let filter = NoteFilter {
            user_id: user_id.to_string(),
            session_id: Some(session_id.to_string()),
            folder_id: None,
            note_type: None,
            archived: Some(false),
            pinned: None,
            limit: Some(200),
        };

        let notes = self.db.list_notes_filtered(&filter)?;
        self.extract_from_notes(&notes)
    }

    /// Extract insights from a folder's notes.
    pub fn extract_from_folder(&self, user_id: &str, folder_id: &str) -> Result<ExtractionResult> {
        use crate::types::NoteFilter;

        let filter = NoteFilter {
            user_id: user_id.to_string(),
            session_id: None,
            folder_id: Some(folder_id.to_string()),
            note_type: None,
            archived: Some(false),
            pinned: None,
            limit: Some(300),
        };

        let notes = self.db.list_notes_filtered(&filter)?;
        self.extract_from_notes(&notes)
    }

    /// Extract insights from a collection of notes.
    pub fn extract_from_notes(&self, notes: &[Note]) -> Result<ExtractionResult> {
        if notes.is_empty() {
            return Ok(ExtractionResult::empty());
        }

        let mut result = ExtractionResult {
            notes_analyzed: notes.len(),
            insights_generated: 0,
            by_type: HashMap::new(),
            avg_confidence: 0.0,
            insights: vec![],
        };

        // Group notes by type for type-specific extraction
        let mut by_type: HashMap<NoteType, Vec<&Note>> = HashMap::new();
        for note in notes {
            by_type.entry(note.note_type).or_default().push(note);
        }

        // Extract insights from decisions
        if let Some(decisions) = by_type.get(&NoteType::Decision) {
            self.extract_from_decisions(decisions, &mut result);
        }

        // Extract insights from gotchas
        if let Some(gotchas) = by_type.get(&NoteType::Gotcha) {
            self.extract_from_gotchas(gotchas, &mut result);
        }

        // Extract insights from patterns
        if let Some(patterns) = by_type.get(&NoteType::Pattern) {
            self.extract_from_patterns(patterns, &mut result);
        }

        // Extract insights from observations using keywords
        if let Some(observations) = by_type.get(&NoteType::Observation) {
            self.extract_from_observations(observations, &mut result);
        }

        // Extract tag-based insights if enabled
        if self.config.use_tags {
            self.extract_from_tags(notes, &mut result);
        }

        // Calculate average confidence
        if !result.insights.is_empty() {
            result.avg_confidence = result.insights.iter().map(|i| i.confidence).sum::<f64>()
                / result.insights.len() as f64;
        }

        Ok(result)
    }

    /// Extract insights from decision notes.
    fn extract_from_decisions(&self, notes: &[&Note], result: &mut ExtractionResult) {
        for note in notes {
            if note.content.len() < self.config.min_content_length {
                continue;
            }

            let insight_type = self.classify_content(&note.content);
            let applicability = self.determine_applicability(note);
            let confidence = self.calculate_confidence(1);

            let title = note.title.clone().unwrap_or_else(|| {
                truncate_to_title(&note.content, 80)
            });

            result.insights.push(ExtractedInsight {
                insight_type,
                applicability,
                title,
                description: note.content.clone(),
                applicability_context: self.extract_context(&note.content),
                source_note_ids: vec![note.id.clone()],
                confidence,
                tags: self.extract_note_tags(note),
            });

            *result.by_type.entry(insight_type).or_insert(0) += 1;
        }
        result.insights_generated = result.insights.len();
    }

    /// Extract insights from gotcha notes.
    fn extract_from_gotchas(&self, notes: &[&Note], result: &mut ExtractionResult) {
        for note in notes {
            if note.content.len() < self.config.min_content_length {
                continue;
            }

            // Gotcha notes become Gotcha insights
            let insight_type = SdkInsightType::Gotcha;
            let applicability = self.determine_applicability(note);
            let confidence = self.calculate_confidence(1) + 0.1; // Gotchas get a slight boost

            let title = note.title.clone().unwrap_or_else(|| {
                truncate_to_title(&note.content, 80)
            });

            result.insights.push(ExtractedInsight {
                insight_type,
                applicability,
                title,
                description: note.content.clone(),
                applicability_context: self.extract_context(&note.content),
                source_note_ids: vec![note.id.clone()],
                confidence: confidence.min(self.config.max_confidence),
                tags: self.extract_note_tags(note),
            });

            *result.by_type.entry(insight_type).or_insert(0) += 1;
        }
        result.insights_generated = result.insights.len();
    }

    /// Extract insights from pattern notes.
    fn extract_from_patterns(&self, notes: &[&Note], result: &mut ExtractionResult) {
        for note in notes {
            if note.content.len() < self.config.min_content_length {
                continue;
            }

            // Pattern notes become Pattern insights
            let insight_type = SdkInsightType::Pattern;
            let applicability = self.determine_applicability(note);
            let confidence = self.calculate_confidence(1);

            let title = note.title.clone().unwrap_or_else(|| {
                truncate_to_title(&note.content, 80)
            });

            result.insights.push(ExtractedInsight {
                insight_type,
                applicability,
                title,
                description: note.content.clone(),
                applicability_context: self.extract_context(&note.content),
                source_note_ids: vec![note.id.clone()],
                confidence,
                tags: self.extract_note_tags(note),
            });

            *result.by_type.entry(insight_type).or_insert(0) += 1;
        }
        result.insights_generated = result.insights.len();
    }

    /// Extract insights from observation notes using keyword analysis.
    fn extract_from_observations(&self, notes: &[&Note], result: &mut ExtractionResult) {
        if !self.config.use_keywords {
            return;
        }

        for note in notes {
            if note.content.len() < self.config.min_content_length {
                continue;
            }

            // Only extract if content has strong keyword signals
            let insight_type = self.classify_content(&note.content);
            let keyword_strength = self.keyword_strength(&note.content, insight_type);

            if keyword_strength < 0.3 {
                continue; // Not enough keyword signal
            }

            let applicability = self.determine_applicability(note);
            let confidence = self.calculate_confidence(1) * keyword_strength;

            let title = note.title.clone().unwrap_or_else(|| {
                truncate_to_title(&note.content, 80)
            });

            result.insights.push(ExtractedInsight {
                insight_type,
                applicability,
                title,
                description: note.content.clone(),
                applicability_context: self.extract_context(&note.content),
                source_note_ids: vec![note.id.clone()],
                confidence: confidence.max(0.3).min(self.config.max_confidence),
                tags: self.extract_note_tags(note),
            });

            *result.by_type.entry(insight_type).or_insert(0) += 1;
        }
        result.insights_generated = result.insights.len();
    }

    /// Extract insights based on shared tags across notes.
    fn extract_from_tags(&self, notes: &[Note], result: &mut ExtractionResult) {
        // Group notes by tag
        let mut by_tag: HashMap<String, Vec<&Note>> = HashMap::new();
        for note in notes {
            let tags: Vec<String> = serde_json::from_str(&note.tags_json).unwrap_or_default();
            for tag in tags {
                by_tag.entry(tag).or_default().push(note);
            }
        }

        // Create insights for tags with multiple notes
        for (tag, tag_notes) in by_tag {
            if tag_notes.len() < self.config.min_note_frequency + 1 {
                continue; // Need more than min_frequency notes
            }

            // Skip common/generic tags
            if ["bug", "fix", "todo", "note", "important"].contains(&tag.as_str()) {
                continue;
            }

            let insight_type = self.tag_to_insight_type(&tag);
            let confidence = self.calculate_confidence(tag_notes.len());
            let source_ids: Vec<String> = tag_notes.iter().map(|n| n.id.clone()).collect();

            // Combine descriptions from source notes
            let combined_description = tag_notes
                .iter()
                .take(3)
                .map(|n| format!("- {}", truncate_to_title(&n.content, 100)))
                .collect::<Vec<_>>()
                .join("\n");

            result.insights.push(ExtractedInsight {
                insight_type,
                applicability: InsightApplicability::Folder,
                title: format!("Recurring theme: {}", tag),
                description: format!(
                    "Found {} notes related to '{}':\n{}",
                    tag_notes.len(),
                    tag,
                    combined_description
                ),
                applicability_context: Some(tag.clone()),
                source_note_ids: source_ids,
                confidence: confidence.min(self.config.max_confidence),
                tags: vec![tag],
            });

            *result.by_type.entry(insight_type).or_insert(0) += 1;
        }
        result.insights_generated = result.insights.len();
    }

    /// Classify content into an insight type based on keywords.
    fn classify_content(&self, content: &str) -> SdkInsightType {
        let lower = content.to_lowercase();

        // Check each category in order of specificity
        if self.keywords.anti_patterns.iter().any(|kw| lower.contains(kw)) {
            return SdkInsightType::AntiPattern;
        }
        if self.keywords.gotchas.iter().any(|kw| lower.contains(kw)) {
            return SdkInsightType::Gotcha;
        }
        if self.keywords.best_practices.iter().any(|kw| lower.contains(kw)) {
            return SdkInsightType::BestPractice;
        }
        if self.keywords.conventions.iter().any(|kw| lower.contains(kw)) {
            return SdkInsightType::Convention;
        }
        if self.keywords.skills.iter().any(|kw| lower.contains(kw)) {
            return SdkInsightType::Skill;
        }
        if self.keywords.patterns.iter().any(|kw| lower.contains(kw)) {
            return SdkInsightType::Pattern;
        }

        // Default to pattern
        SdkInsightType::Pattern
    }

    /// Calculate keyword strength for a given insight type.
    fn keyword_strength(&self, content: &str, insight_type: SdkInsightType) -> f64 {
        let lower = content.to_lowercase();
        let keywords = match insight_type {
            SdkInsightType::Convention => &self.keywords.conventions,
            SdkInsightType::Pattern => &self.keywords.patterns,
            SdkInsightType::AntiPattern => &self.keywords.anti_patterns,
            SdkInsightType::Gotcha => &self.keywords.gotchas,
            SdkInsightType::BestPractice => &self.keywords.best_practices,
            SdkInsightType::Skill => &self.keywords.skills,
            _ => return 0.5, // Default for types without keywords
        };

        let matches = keywords.iter().filter(|kw| lower.contains(*kw)).count();
        (matches as f64 * 0.3).min(1.0)
    }

    /// Determine applicability scope based on note context.
    fn determine_applicability(&self, note: &Note) -> InsightApplicability {
        // If session-specific, start with Session scope
        if note.session_id.is_some() && note.folder_id.is_none() {
            return InsightApplicability::Session;
        }

        // If folder-specific
        if note.folder_id.is_some() {
            return InsightApplicability::Folder;
        }

        // Check content for language/framework mentions
        let lower = note.content.to_lowercase();
        if lower.contains("typescript") || lower.contains("javascript") || lower.contains("rust")
            || lower.contains("python") || lower.contains("go ")
        {
            return InsightApplicability::Language;
        }

        if lower.contains("react") || lower.contains("next.js") || lower.contains("vue")
            || lower.contains("angular") || lower.contains("fastapi")
        {
            return InsightApplicability::Framework;
        }

        // Default to folder scope
        InsightApplicability::Folder
    }

    /// Extract technology context from content.
    fn extract_context(&self, content: &str) -> Option<String> {
        let lower = content.to_lowercase();

        // Language detection
        let languages = ["typescript", "javascript", "rust", "python", "go", "java", "ruby"];
        for lang in languages {
            if lower.contains(lang) {
                return Some(lang.to_string());
            }
        }

        // Framework detection
        let frameworks = ["react", "next.js", "vue", "angular", "fastapi", "django", "express"];
        for fw in frameworks {
            if lower.contains(fw) {
                return Some(fw.to_string());
            }
        }

        None
    }

    /// Calculate confidence score based on frequency.
    fn calculate_confidence(&self, frequency: usize) -> f64 {
        let boost = (frequency.saturating_sub(1) as f64) * self.config.frequency_boost;
        (self.config.base_confidence + boost).min(self.config.max_confidence)
    }

    /// Convert a tag to an insight type.
    fn tag_to_insight_type(&self, tag: &str) -> SdkInsightType {
        let lower = tag.to_lowercase();
        if lower.contains("convention") || lower.contains("style") {
            SdkInsightType::Convention
        } else if lower.contains("pattern") {
            SdkInsightType::Pattern
        } else if lower.contains("gotcha") || lower.contains("pitfall") || lower.contains("warn") {
            SdkInsightType::Gotcha
        } else if lower.contains("best") || lower.contains("practice") {
            SdkInsightType::BestPractice
        } else if lower.contains("skill") || lower.contains("how") {
            SdkInsightType::Skill
        } else {
            SdkInsightType::Pattern
        }
    }

    /// Extract tags from a note.
    fn extract_note_tags(&self, note: &Note) -> Vec<String> {
        serde_json::from_str(&note.tags_json).unwrap_or_default()
    }

    /// Save extracted insights to the database.
    pub fn save_insights(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        insights: &[ExtractedInsight],
    ) -> Result<Vec<String>> {
        let mut saved_ids = Vec::new();

        for insight in insights {
            let new_insight = insight.to_new_insight(user_id, folder_id);
            match self.db.create_sdk_insight(&new_insight) {
                Ok(id) => saved_ids.push(id),
                Err(e) => {
                    tracing::warn!("Failed to save insight: {}", e);
                }
            }
        }

        Ok(saved_ids)
    }
}

/// Truncate text to create a title.
fn truncate_to_title(s: &str, max_len: usize) -> String {
    // Get first line
    let first_line = s.lines().next().unwrap_or(s);

    if first_line.len() <= max_len {
        first_line.to_string()
    } else {
        format!("{}...", &first_line[..max_len.saturating_sub(3)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extraction_config_default() {
        let config = ExtractionConfig::default();
        assert_eq!(config.min_note_frequency, 1);
        assert_eq!(config.base_confidence, 0.5);
    }

    #[test]
    fn test_extraction_result_empty() {
        let result = ExtractionResult::empty();
        assert_eq!(result.notes_analyzed, 0);
        assert_eq!(result.insights_generated, 0);
    }

    #[test]
    fn test_truncate_to_title() {
        assert_eq!(truncate_to_title("Short title", 50), "Short title");
        assert_eq!(truncate_to_title("This is a very long title that should be truncated", 20), "This is a very lo...");
    }

    #[test]
    fn test_insight_keywords_default() {
        let keywords = InsightKeywords::default();
        assert!(!keywords.conventions.is_empty());
        assert!(!keywords.patterns.is_empty());
        assert!(!keywords.gotchas.is_empty());
    }
}
