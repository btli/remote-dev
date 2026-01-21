/**
 * SessionEventBus - Event-driven communication for terminal session lifecycle
 *
 * Provides loose coupling between plugins and the core system.
 * Plugins can subscribe to events and react to session lifecycle changes.
 */

import type {
  SessionEvent,
  SessionEventType,
  SessionEventHandler,
  TerminalType,
} from "@/types/terminal-type";

/**
 * Subscription handle returned when subscribing to events
 */
export interface Subscription {
  /** Unique subscription ID */
  id: string;
  /** Event type being subscribed to */
  eventType: SessionEventType | "*";
  /** Unsubscribe from this event */
  unsubscribe: () => void;
}

/**
 * Event filter for selective subscription
 */
export interface EventFilter {
  /** Only receive events for specific terminal type */
  terminalType?: TerminalType;
  /** Only receive events for specific session ID */
  sessionId?: string;
}

/**
 * Internal subscription entry
 */
interface SubscriptionEntry {
  id: string;
  handler: SessionEventHandler;
  filter?: EventFilter;
}

/**
 * SessionEventBus - Singleton event bus for session lifecycle events
 *
 * Features:
 * - Subscribe to specific event types or all events (*)
 * - Filter events by terminal type or session ID
 * - Async event handlers with error isolation
 * - Event history for debugging
 */
class SessionEventBusImpl {
  private subscriptions = new Map<SessionEventType | "*", SubscriptionEntry[]>();
  private eventHistory: SessionEvent[] = [];
  private maxHistorySize = 100;
  private subscriptionCounter = 0;

  /**
   * Subscribe to session events
   *
   * @param eventType - Event type to subscribe to, or "*" for all events
   * @param handler - Callback function for events
   * @param filter - Optional filter to narrow events
   * @returns Subscription handle with unsubscribe method
   */
  subscribe(
    eventType: SessionEventType | "*",
    handler: SessionEventHandler,
    filter?: EventFilter
  ): Subscription {
    const id = `sub_${++this.subscriptionCounter}`;

    const entry: SubscriptionEntry = { id, handler, filter };

    const existing = this.subscriptions.get(eventType) ?? [];
    this.subscriptions.set(eventType, [...existing, entry]);

    return {
      id,
      eventType,
      unsubscribe: () => this.unsubscribe(eventType, id),
    };
  }

  /**
   * Unsubscribe from events
   */
  private unsubscribe(eventType: SessionEventType | "*", subscriptionId: string): void {
    const entries = this.subscriptions.get(eventType);
    if (entries) {
      this.subscriptions.set(
        eventType,
        entries.filter((e) => e.id !== subscriptionId)
      );
    }
  }

  /**
   * Emit a session event to all subscribers
   *
   * Events are processed asynchronously. Handler errors are logged but don't
   * prevent other handlers from receiving the event.
   *
   * @param event - The event to emit
   */
  async emit(event: SessionEvent): Promise<void> {
    // Add to history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Get handlers for this specific event type and wildcard handlers
    const specificHandlers = this.subscriptions.get(event.type) ?? [];
    const wildcardHandlers = this.subscriptions.get("*") ?? [];
    const allHandlers = [...specificHandlers, ...wildcardHandlers];

    // Process handlers concurrently
    const results = await Promise.allSettled(
      allHandlers.map(async (entry) => {
        // Apply filter
        if (!this.matchesFilter(event, entry.filter)) {
          return;
        }

        try {
          await entry.handler(event);
        } catch (error) {
          console.error(
            `[EventBus] Handler error for ${event.type}:`,
            error
          );
          // Re-throw to be captured by allSettled
          throw error;
        }
      })
    );

    // Log any failures (but don't throw)
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      console.warn(
        `[EventBus] ${failures.length}/${results.length} handlers failed for ${event.type}`
      );
    }
  }

  /**
   * Check if an event matches a filter
   */
  private matchesFilter(event: SessionEvent, filter?: EventFilter): boolean {
    if (!filter) return true;

    if (filter.terminalType && event.terminalType !== filter.terminalType) {
      return false;
    }

    if (filter.sessionId && event.sessionId !== filter.sessionId) {
      return false;
    }

    return true;
  }

  /**
   * Get recent event history for debugging
   */
  getHistory(limit?: number): SessionEvent[] {
    const count = limit ?? this.maxHistorySize;
    return this.eventHistory.slice(-count);
  }

  /**
   * Get history for a specific session
   */
  getSessionHistory(sessionId: string): SessionEvent[] {
    return this.eventHistory.filter((e) => e.sessionId === sessionId);
  }

  /**
   * Clear all subscriptions (useful for testing)
   */
  clearAll(): void {
    this.subscriptions.clear();
    this.eventHistory = [];
    this.subscriptionCounter = 0;
  }

  /**
   * Get subscription count for debugging
   */
  getSubscriptionCount(): number {
    let count = 0;
    for (const entries of this.subscriptions.values()) {
      count += entries.length;
    }
    return count;
  }

  // ============= Helper methods for emitting common events =============

  /**
   * Emit session created event
   */
  emitCreated(
    sessionId: string,
    terminalType: TerminalType
  ): Promise<void> {
    return this.emit({
      type: "session:created",
      sessionId,
      terminalType,
      timestamp: new Date(),
    });
  }

  /**
   * Emit session attached event (WebSocket connected)
   */
  emitAttached(
    sessionId: string,
    terminalType: TerminalType
  ): Promise<void> {
    return this.emit({
      type: "session:attached",
      sessionId,
      terminalType,
      timestamp: new Date(),
    });
  }

  /**
   * Emit session detached event (WebSocket disconnected)
   */
  emitDetached(
    sessionId: string,
    terminalType: TerminalType
  ): Promise<void> {
    return this.emit({
      type: "session:detached",
      sessionId,
      terminalType,
      timestamp: new Date(),
    });
  }

  /**
   * Emit session exited event (main process exited)
   */
  emitExited(
    sessionId: string,
    terminalType: TerminalType,
    exitCode: number | null
  ): Promise<void> {
    return this.emit({
      type: "session:exited",
      sessionId,
      terminalType,
      timestamp: new Date(),
      data: { exitCode },
    });
  }

  /**
   * Emit session restarted event
   */
  emitRestarted(
    sessionId: string,
    terminalType: TerminalType
  ): Promise<void> {
    return this.emit({
      type: "session:restarted",
      sessionId,
      terminalType,
      timestamp: new Date(),
    });
  }

  /**
   * Emit session closed event
   */
  emitClosed(
    sessionId: string,
    terminalType: TerminalType
  ): Promise<void> {
    return this.emit({
      type: "session:closed",
      sessionId,
      terminalType,
      timestamp: new Date(),
    });
  }

  /**
   * Emit session error event
   */
  emitError(
    sessionId: string,
    terminalType: TerminalType,
    error: Error
  ): Promise<void> {
    return this.emit({
      type: "session:error",
      sessionId,
      terminalType,
      timestamp: new Date(),
      data: { error },
    });
  }
}

// Export singleton instance
export const SessionEventBus = new SessionEventBusImpl();

// Export type for testing/mocking
export type SessionEventBusType = typeof SessionEventBus;
