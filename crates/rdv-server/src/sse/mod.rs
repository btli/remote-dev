//! Server-Sent Events (SSE) module for real-time session updates.
//!
//! This module provides a broadcast-based SSE system that allows multiple
//! clients to receive real-time notifications when sessions are created,
//! updated, or deleted.

mod broadcaster;

pub use broadcaster::{SessionEvent, SessionEventData, SseBroadcaster};
