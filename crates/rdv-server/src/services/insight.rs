//! InsightService - Manages orchestrator insights
//!
//! This service provides operations for querying and managing insights generated
//! by orchestrators during session monitoring. Insights include stall detection,
//! error patterns, and suggested actions.

use rdv_core::db::{Insight, InsightCounts, NewInsight};
use rdv_core::Database;
use std::sync::Arc;
use tracing::info;

/// InsightService manages orchestrator insights
pub struct InsightService {
    db: Arc<Database>,
}

impl InsightService {
    /// Create a new insight service
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// Get insight by ID
    pub fn get_insight(&self, insight_id: &str) -> Result<Option<Insight>, String> {
        self.db.get_insight(insight_id).map_err(|e| e.to_string())
    }

    /// List insights for an orchestrator
    pub fn list_insights(
        &self,
        orchestrator_id: &str,
        resolved: Option<bool>,
    ) -> Result<Vec<Insight>, String> {
        self.db
            .list_insights(orchestrator_id, resolved)
            .map_err(|e| e.to_string())
    }

    /// Create a new insight
    pub fn create_insight(&self, insight: &NewInsight) -> Result<String, String> {
        self.db.create_insight(insight).map_err(|e| e.to_string())
    }

    /// Resolve an insight
    pub fn resolve_insight(
        &self,
        insight_id: &str,
        resolved_by: Option<&str>,
    ) -> Result<bool, String> {
        let resolved = self
            .db
            .resolve_insight(insight_id, resolved_by)
            .map_err(|e| e.to_string())?;

        if resolved {
            info!(insight_id = %insight_id, "Insight resolved");
        }

        Ok(resolved)
    }

    /// Delete an insight
    pub fn delete_insight(&self, insight_id: &str) -> Result<bool, String> {
        let deleted = self
            .db
            .delete_insight(insight_id)
            .map_err(|e| e.to_string())?;

        if deleted {
            info!(insight_id = %insight_id, "Insight deleted");
        }

        Ok(deleted)
    }

    /// Get insight counts for an orchestrator
    pub fn get_insight_counts(&self, orchestrator_id: &str) -> Result<InsightCounts, String> {
        self.db
            .get_insight_counts(orchestrator_id)
            .map_err(|e| e.to_string())
    }

    /// Bulk resolve insights for a session
    pub fn resolve_session_insights(
        &self,
        session_id: &str,
        resolved_by: Option<&str>,
    ) -> Result<usize, String> {
        let count = self
            .db
            .resolve_session_insights(session_id, resolved_by)
            .map_err(|e| e.to_string())?;

        if count > 0 {
            info!(
                session_id = %session_id,
                count = count,
                "Bulk resolved session insights"
            );
        }

        Ok(count)
    }

    /// Cleanup old resolved insights
    pub fn cleanup_old_insights(&self, max_age_secs: i64) -> Result<usize, String> {
        let count = self
            .db
            .cleanup_old_insights(max_age_secs)
            .map_err(|e| e.to_string())?;

        if count > 0 {
            info!(count = count, "Cleaned up old resolved insights");
        }

        Ok(count)
    }
}
