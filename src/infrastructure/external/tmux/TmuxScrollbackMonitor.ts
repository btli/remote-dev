/**
 * TmuxScrollbackMonitor - Implementation of IScrollbackMonitor using tmux capture-pane.
 *
 * This gateway monitors terminal scrollback buffers to detect stalled sessions.
 * It uses tmux's capture-pane command to retrieve terminal content and compares
 * snapshots over time to determine if a session has stalled.
 */

import * as crypto from "crypto";
import * as TmuxService from "@/services/tmux-service";
import type { IScrollbackMonitor } from "@/application/ports/IScrollbackMonitor";
import type { ScrollbackSnapshot, StallDetectionResult } from "@/types/orchestrator";

export class TmuxScrollbackMonitor implements IScrollbackMonitor {
  /**
   * Capture the current scrollback buffer for a session.
   * Returns a snapshot with content hash for quick comparison.
   */
  async captureScrollback(
    tmuxSessionName: string,
    lines?: number
  ): Promise<ScrollbackSnapshot> {
    // Use tmux service to capture output
    const content = await TmuxService.captureOutput(tmuxSessionName, lines ?? 10000);

    // Calculate hash for quick comparison
    const hash = this.hashContent(content);

    // Count non-empty lines
    const lineCount = content.split("\n").filter(line => line.trim().length > 0).length;

    // Extract session ID from tmux session name (format: rdv-{uuid})
    const sessionId = tmuxSessionName.replace("rdv-", "");

    return {
      sessionId,
      timestamp: new Date(),
      content,
      hash,
      lineCount,
    };
  }

  /**
   * Compare two scrollback snapshots to detect changes.
   * Returns true if the content has changed, false if identical.
   */
  hasChanged(snapshot1: ScrollbackSnapshot, snapshot2: ScrollbackSnapshot): boolean {
    // Quick comparison using hash
    return snapshot1.hash !== snapshot2.hash;
  }

  /**
   * Detect if a session is stalled by comparing current and previous snapshots.
   * A session is considered stalled if the scrollback hasn't changed within
   * the configured threshold period.
   */
  async detectStall(
    tmuxSessionName: string,
    previousSnapshot: ScrollbackSnapshot | null,
    stallThresholdSeconds: number
  ): Promise<StallDetectionResult> {
    // Capture current scrollback
    const currentSnapshot = await this.captureScrollback(tmuxSessionName);

    // Extract session ID
    const sessionId = tmuxSessionName.replace("rdv-", "");

    // If no previous snapshot, this is the first check - not stalled
    if (!previousSnapshot) {
      return {
        sessionId,
        isStalled: false,
        lastActivity: currentSnapshot.timestamp,
        unchangedDuration: 0,
        confidence: 1.0,
      };
    }

    // Check if content has changed
    const contentChanged = this.hasChanged(previousSnapshot, currentSnapshot);

    if (contentChanged) {
      // Content changed - session is active
      return {
        sessionId,
        isStalled: false,
        lastActivity: currentSnapshot.timestamp,
        unchangedDuration: 0,
        confidence: 1.0,
      };
    }

    // Content unchanged - calculate how long it's been unchanged
    const unchangedDuration = Math.floor(
      (currentSnapshot.timestamp.getTime() - previousSnapshot.timestamp.getTime()) / 1000
    );

    // Check if duration exceeds threshold
    const isStalled = unchangedDuration >= stallThresholdSeconds;

    // Calculate confidence based on factors:
    // 1. Duration beyond threshold (higher = more confident)
    // 2. Line count (empty buffer = low confidence)
    let confidence = 0.7; // Base confidence

    if (isStalled) {
      // Increase confidence the longer it's been stalled
      const extraTime = unchangedDuration - stallThresholdSeconds;
      const extraMinutes = extraTime / 60;
      confidence = Math.min(1.0, 0.7 + (extraMinutes * 0.05)); // +0.05 per minute over threshold
    }

    // Reduce confidence if buffer is empty or very small
    if (currentSnapshot.lineCount < 5) {
      confidence *= 0.5;
    }

    // Build reason string
    let reason: string | undefined;
    if (isStalled) {
      const minutes = Math.floor(unchangedDuration / 60);
      reason = `No terminal activity detected for ${minutes} minutes (threshold: ${Math.floor(stallThresholdSeconds / 60)} minutes)`;
    }

    return {
      sessionId,
      isStalled,
      lastActivity: previousSnapshot.timestamp,
      unchangedDuration,
      confidence,
      reason,
    };
  }

  /**
   * Get the hash of scrollback content for quick comparison.
   * Uses MD5 for speed (not security).
   */
  hashContent(content: string): string {
    return crypto.createHash("md5").update(content).digest("hex");
  }

  /**
   * Extract recent activity indicators from scrollback.
   * Returns timestamps, command prompts, or other activity markers.
   */
  async extractActivityMarkers(
    snapshot: ScrollbackSnapshot
  ): Promise<{
    lastCommandPrompt?: string;
    lastOutputTimestamp?: Date;
    hasActiveProcess: boolean;
  }> {
    const lines = snapshot.content.split("\n");
    const nonEmptyLines = lines.filter(line => line.trim().length > 0);

    // Look for common shell prompts in the last few lines
    // This is a heuristic - different shells have different prompts
    const promptPatterns = [
      /^\$\s*$/,           // Basic $ prompt
      /^%\s*$/,           // Zsh % prompt
      /^>\s*$/,           // Windows/PowerShell prompt
      /^#\s*$/,           // Root prompt
      /^.*@.*:\S+[#$%>]\s*$/, // user@host:path$ style
    ];

    let lastCommandPrompt: string | undefined;
    for (let i = nonEmptyLines.length - 1; i >= Math.max(0, nonEmptyLines.length - 10); i--) {
      const line = nonEmptyLines[i];
      if (promptPatterns.some(pattern => pattern.test(line))) {
        lastCommandPrompt = line;
        break;
      }
    }

    // Heuristic: If the last line is not a prompt and not empty, there might be an active process
    const lastLine = nonEmptyLines[nonEmptyLines.length - 1] || "";
    const hasActiveProcess =
      lastLine.length > 0 &&
      !promptPatterns.some(pattern => pattern.test(lastLine));

    return {
      lastCommandPrompt,
      lastOutputTimestamp: snapshot.timestamp,
      hasActiveProcess,
    };
  }
}
