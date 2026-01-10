//! API route modules.

pub mod folders;
pub mod health;
pub mod knowledge;
pub mod orchestrators;
pub mod sessions;
pub mod worktrees;

use axum::{middleware, routing::get, Router};
use std::sync::Arc;

use crate::middleware::auth_middleware;
use crate::state::AppState;

/// Create the main router with all routes
pub fn create_router(state: Arc<AppState>) -> Router {
    // Public routes (no auth)
    let public_routes = Router::new().route("/health", get(health::health_check));

    // Protected routes (require auth)
    let protected_routes = Router::new()
        .merge(sessions::router())
        .merge(folders::router())
        .merge(worktrees::router())
        .merge(orchestrators::router())
        .merge(knowledge::router())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    Router::new()
        .merge(public_routes)
        .nest("/api", protected_routes)
        .with_state(state)
}
