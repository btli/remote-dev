//! API route modules.

pub mod events;
pub mod extensions;
pub mod folders;
pub mod health;
pub mod hooks;
pub mod insights;
pub mod knowledge;
pub mod logs;
pub mod memory;
pub mod meta;
pub mod notes;
pub mod orchestrators;
pub mod profiles;
pub mod sessions;
pub mod tokens;
pub mod worktrees;

use axum::{middleware, routing::get, Router};
use std::sync::Arc;

use crate::middleware::auth_middleware;
use crate::state::AppState;

/// Parse content type from string
pub fn parse_content_type(s: &str) -> Option<rdv_core::memory::ContentType> {
    rdv_core::memory::ContentType::from_str(s)
}

/// Create the main router with all routes
pub fn create_router(state: Arc<AppState>) -> Router {
    // Public routes (no auth)
    let public_routes = Router::new()
        .route("/health", get(health::health_check))
        .nest("/api", tokens::public_router());

    // Protected routes (require auth)
    let protected_routes = Router::new()
        .merge(sessions::router())
        .merge(folders::router())
        .merge(worktrees::router())
        .merge(orchestrators::router())
        .merge(knowledge::router())
        .merge(memory::router())
        .merge(meta::router())
        .merge(notes::router())
        .merge(insights::router())
        .merge(profiles::router())
        .merge(hooks::router())
        .merge(tokens::router())
        .merge(extensions::router())
        .merge(logs::router())
        // SSE endpoint for real-time session events
        .route("/events/sessions", get(events::session_events))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    Router::new()
        .merge(public_routes)
        .nest("/api", protected_routes)
        .with_state(state)
}
