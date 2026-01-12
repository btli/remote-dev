//! Server-Sent Events (SSE) route for real-time session updates.
//!
//! Provides an SSE endpoint that streams session events to connected clients.
//! Each client receives only events for their authenticated user.

use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
    Extension,
};
use futures::stream::Stream;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tracing::{debug, warn};

use crate::middleware::AuthContext;
use crate::sse::SessionEvent;
use crate::state::AppState;

/// SSE endpoint for session events.
///
/// Clients connect to this endpoint to receive real-time notifications
/// about session changes. Events are filtered by user ID so each client
/// only receives events for their own sessions.
///
/// # Response Format
///
/// Each SSE event has the format:
/// ```text
/// event: session
/// data: {"type":"created","user_id":"...","session_id":"...","session":{...},"timestamp":...}
/// ```
pub async fn session_events(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let user_id = auth.user_id().to_string();
    debug!("SSE client connected for user {}", &user_id[..8.min(user_id.len())]);

    // Subscribe to the broadcast channel
    let rx = state.sse_broadcaster.subscribe();

    // Convert to a stream, filtering events for this user only
    let stream = BroadcastStream::new(rx)
        .filter_map(move |result| {
            match result {
                Ok(event) => {
                    // Only send events for this user
                    if event.user_id == user_id {
                        // Serialize event to JSON
                        match serde_json::to_string(&event) {
                            Ok(json) => {
                                Some(Ok(Event::default()
                                    .event("session")
                                    .data(json)))
                            }
                            Err(e) => {
                                warn!("Failed to serialize SSE event: {}", e);
                                None
                            }
                        }
                    } else {
                        // Event is for a different user - skip it
                        None
                    }
                }
                Err(e) => {
                    // Lagged - we missed some events
                    // This is acceptable for UI updates - client can refresh if needed
                    warn!("SSE receiver lagged: {}", e);
                    None
                }
            }
        });

    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("ping")
        )
}

#[cfg(test)]
mod tests {
    // SSE tests would require more complex async test setup
    // Testing the broadcaster directly in sse/broadcaster.rs
}
