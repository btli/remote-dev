//! Orchestrator management - monitoring and intervention with memory integration.
//!
//! Provides functionality for Master Control and Folder Control orchestrators,
//! enhanced with hierarchical memory for historical context and pattern learning.
//!
//! ## Memory-Enhanced Insights
//!
//! When generating insights, the orchestrator:
//! 1. Queries memory for similar past situations
//! 2. Includes relevant historical context
//! 3. Suggests actions based on what worked before
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────┐
//! │                     Orchestrator Service                        │
//! │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
//! │  │ Stall Detection │  │ Memory Query    │  │ Insight Gen     │ │
//! │  │ (scrollback)    │→→│ (find similar)  │→→│ (with history)  │ │
//! │  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
//! │           │                    │                    │          │
//! │           └────────────────────┴────────────────────┘          │
//! │                          │                                      │
//! │                   MemoryStore                                  │
//! └─────────────────────────────────────────────────────────────────┘
//! ```

mod insight;

pub use insight::*;
