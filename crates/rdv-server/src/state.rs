//! Application state.

use std::sync::Arc;

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    // TODO: Add database connection
    // TODO: Add service token
    // TODO: Add terminal connections map
}

impl AppState {
    /// Create new application state
    pub fn new() -> Arc<Self> {
        Arc::new(Self {})
    }
}
