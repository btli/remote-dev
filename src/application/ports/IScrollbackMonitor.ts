/**
 * IScrollbackMonitor - Port for scrollback buffer monitoring.
 *
 * This interface defines the contract for monitoring terminal scrollback buffers
 * to detect stalled sessions. The infrastructure layer will provide the concrete
 * implementation using tmux capture-pane.
 */

import type { ScrollbackSnapshot, StallDetectionResult } from "@/types/orchestrator";

export interface IScrollbackMonitor {
  /**
   * Capture the current scrollback buffer for a session.
   * Returns a snapshot with content hash for comparison.
   */
  captureScrollback(
    tmuxSessionName: string,
    lines?: number
  ): Promise<ScrollbackSnapshot>;

  /**
   * Compare two scrollback snapshots to detect changes.
   * Returns true if the content has changed, false if identical.
   */
  hasChanged(snapshot1: ScrollbackSnapshot, snapshot2: ScrollbackSnapshot): boolean;

  /**
   * Detect if a session is stalled by comparing current and previous snapshots.
   * A session is considered stalled if the scrollback hasn't changed within
   * the configured threshold period.
   */
  detectStall(
    tmuxSessionName: string,
    previousSnapshot: ScrollbackSnapshot | null,
    stallThresholdSeconds: number
  ): Promise<StallDetectionResult>;

  /**
   * Get the hash of scrollback content for quick comparison.
   * Uses a fast hashing algorithm (e.g., MD5 or SHA-256).
   */
  hashContent(content: string): string;

  /**
   * Extract recent activity indicators from scrollback.
   * Returns timestamps, command prompts, or other activity markers.
   */
  extractActivityMarkers(
    snapshot: ScrollbackSnapshot
  ): Promise<{
    lastCommandPrompt?: string;
    lastOutputTimestamp?: Date;
    hasActiveProcess: boolean;
  }>;
}
