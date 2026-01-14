//! Service layer for rdv-server
//!
//! Contains business logic services that coordinate domain operations.

pub mod consolidation;
pub mod distillation;
pub mod insight;
pub mod monitoring;

pub use consolidation::{ConsolidationConfig, ConsolidationResult, ConsolidationService};
pub use distillation::{
    DistillationConfig, DistillationResult, DistillationStatus, TrajectoryDistillationService,
};
pub use insight::InsightService;
pub use monitoring::MonitoringService;
