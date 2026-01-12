//! SSE Broadcaster for session events.
//!
//! Uses tokio::sync::broadcast for efficient fan-out to multiple SSE clients.
//! Each connected client receives events for their user's sessions only.

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use tracing::debug;

/// Maximum number of events to buffer before dropping oldest events.
/// If a slow client can't keep up, they'll miss events (acceptable for UI updates).
const CHANNEL_CAPACITY: usize = 256;

/// Type of session event
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionEventType {
    /// Session was created
    Created,
    /// Session was updated (name, status, folder, etc.)
    Updated,
    /// Session was deleted/closed
    Deleted,
    /// Session status changed (active, suspended, closed)
    StatusChanged,
    /// Sessions were reordered
    Reordered,
}

/// A session event to broadcast to connected clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEvent {
    /// Type of event
    #[serde(rename = "type")]
    pub event_type: SessionEventType,
    /// User ID (for filtering - clients only receive their events)
    pub user_id: String,
    /// Session ID (optional for reorder events)
    pub session_id: Option<String>,
    /// Session data (optional - included for created/updated events)
    pub session: Option<SessionEventData>,
    /// Timestamp of the event
    pub timestamp: i64,
}

/// Session data included in events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionEventData {
    pub id: String,
    pub name: String,
    pub tmux_session_name: String,
    pub status: String,
    pub project_path: Option<String>,
    pub folder_id: Option<String>,
    pub worktree_branch: Option<String>,
    pub agent_provider: Option<String>,
    pub is_orchestrator_session: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// SSE Broadcaster that manages the broadcast channel.
#[derive(Debug)]
pub struct SseBroadcaster {
    /// Sender side of the broadcast channel
    sender: broadcast::Sender<SessionEvent>,
}

impl Default for SseBroadcaster {
    fn default() -> Self {
        Self::new()
    }
}

impl SseBroadcaster {
    /// Create a new broadcaster with the default capacity.
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self { sender }
    }

    /// Subscribe to receive session events.
    /// Returns a receiver that will get all broadcasted events.
    pub fn subscribe(&self) -> broadcast::Receiver<SessionEvent> {
        self.sender.subscribe()
    }

    /// Broadcast an event to all subscribers.
    /// Returns the number of active subscribers that received the event.
    pub fn broadcast(&self, event: SessionEvent) -> usize {
        match self.sender.send(event) {
            Ok(count) => {
                debug!("Broadcasted session event to {} subscribers", count);
                count
            }
            Err(_) => {
                // No active subscribers - this is fine
                debug!("No active SSE subscribers");
                0
            }
        }
    }

    /// Broadcast a session created event.
    pub fn session_created(&self, user_id: &str, session: SessionEventData) {
        let event = SessionEvent {
            event_type: SessionEventType::Created,
            user_id: user_id.to_string(),
            session_id: Some(session.id.clone()),
            session: Some(session),
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        self.broadcast(event);
    }

    /// Broadcast a session updated event.
    pub fn session_updated(&self, user_id: &str, session: SessionEventData) {
        let event = SessionEvent {
            event_type: SessionEventType::Updated,
            user_id: user_id.to_string(),
            session_id: Some(session.id.clone()),
            session: Some(session),
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        self.broadcast(event);
    }

    /// Broadcast a session deleted event.
    pub fn session_deleted(&self, user_id: &str, session_id: &str) {
        let event = SessionEvent {
            event_type: SessionEventType::Deleted,
            user_id: user_id.to_string(),
            session_id: Some(session_id.to_string()),
            session: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        self.broadcast(event);
    }

    /// Broadcast a session status changed event.
    pub fn session_status_changed(&self, user_id: &str, session: SessionEventData) {
        let event = SessionEvent {
            event_type: SessionEventType::StatusChanged,
            user_id: user_id.to_string(),
            session_id: Some(session.id.clone()),
            session: Some(session),
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        self.broadcast(event);
    }

    /// Broadcast a sessions reordered event.
    pub fn sessions_reordered(&self, user_id: &str) {
        let event = SessionEvent {
            event_type: SessionEventType::Reordered,
            user_id: user_id.to_string(),
            session_id: None,
            session: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
        };
        self.broadcast(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_session_data() -> SessionEventData {
        SessionEventData {
            id: "test-session-1".to_string(),
            name: "Test Session".to_string(),
            tmux_session_name: "rdv-test1".to_string(),
            status: "active".to_string(),
            project_path: Some("/test/path".to_string()),
            folder_id: None,
            worktree_branch: None,
            agent_provider: Some("claude".to_string()),
            is_orchestrator_session: false,
            created_at: 1000000,
            updated_at: 1000000,
        }
    }

    #[tokio::test]
    async fn test_broadcaster_new() {
        let broadcaster = SseBroadcaster::new();
        // Should be able to create a broadcaster
        assert!(broadcaster.sender.receiver_count() == 0);
    }

    #[tokio::test]
    async fn test_broadcaster_subscribe() {
        let broadcaster = SseBroadcaster::new();
        let _rx1 = broadcaster.subscribe();
        let _rx2 = broadcaster.subscribe();
        // Should have 2 subscribers
        assert_eq!(broadcaster.sender.receiver_count(), 2);
    }

    #[tokio::test]
    async fn test_broadcaster_session_created() {
        let broadcaster = SseBroadcaster::new();
        let mut rx = broadcaster.subscribe();

        let session_data = create_test_session_data();
        broadcaster.session_created("user-1", session_data.clone());

        let event = rx.recv().await.unwrap();
        assert_eq!(event.event_type, SessionEventType::Created);
        assert_eq!(event.user_id, "user-1");
        assert_eq!(event.session_id, Some("test-session-1".to_string()));
        assert!(event.session.is_some());
    }

    #[tokio::test]
    async fn test_broadcaster_session_deleted() {
        let broadcaster = SseBroadcaster::new();
        let mut rx = broadcaster.subscribe();

        broadcaster.session_deleted("user-1", "session-to-delete");

        let event = rx.recv().await.unwrap();
        assert_eq!(event.event_type, SessionEventType::Deleted);
        assert_eq!(event.user_id, "user-1");
        assert_eq!(event.session_id, Some("session-to-delete".to_string()));
        assert!(event.session.is_none());
    }

    #[tokio::test]
    async fn test_broadcaster_sessions_reordered() {
        let broadcaster = SseBroadcaster::new();
        let mut rx = broadcaster.subscribe();

        broadcaster.sessions_reordered("user-1");

        let event = rx.recv().await.unwrap();
        assert_eq!(event.event_type, SessionEventType::Reordered);
        assert_eq!(event.user_id, "user-1");
        assert!(event.session_id.is_none());
        assert!(event.session.is_none());
    }

    #[tokio::test]
    async fn test_broadcaster_no_subscribers() {
        let broadcaster = SseBroadcaster::new();
        // Should not panic when no subscribers
        let count = broadcaster.broadcast(SessionEvent {
            event_type: SessionEventType::Created,
            user_id: "user-1".to_string(),
            session_id: Some("test".to_string()),
            session: None,
            timestamp: 0,
        });
        assert_eq!(count, 0);
    }

    #[tokio::test]
    async fn test_broadcaster_multiple_subscribers() {
        let broadcaster = SseBroadcaster::new();
        let mut rx1 = broadcaster.subscribe();
        let mut rx2 = broadcaster.subscribe();

        let session_data = create_test_session_data();
        broadcaster.session_created("user-1", session_data);

        // Both receivers should get the event
        let event1 = rx1.recv().await.unwrap();
        let event2 = rx2.recv().await.unwrap();

        assert_eq!(event1.session_id, event2.session_id);
    }
}
