//! Session lifecycle management with memory integration.
//!
//! Provides higher-level session operations that integrate with the memory system.
//!
//! ## Lifecycle Hooks
//!
//! ```text
//! Session Start
//!   │
//!   ├─► Load relevant memories (folder + user)
//!   │
//!   ├─► Initialize short-term memory buffer
//!   │
//!   └─► Return SessionContext
//!
//! During Session
//!   │
//!   ├─► Capture observations to short-term memory
//!   │
//!   └─► Periodic consolidation checks
//!
//! Session End
//!   │
//!   ├─► Extract insights from scrollback
//!   │
//!   ├─► Promote valuable memories
//!   │
//!   └─► Cleanup expired entries
//! ```

mod lifecycle;

pub use lifecycle::*;
