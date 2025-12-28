/**
 * TmuxGatewayImpl - Implementation of TmuxGateway using existing TmuxService.
 *
 * This adapter wraps the existing TmuxService to implement the TmuxGateway interface.
 * This allows gradual migration without rewriting the tmux integration.
 */

import type {
  TmuxGateway,
  TmuxSessionInfo,
  CreateTmuxSessionOptions,
} from "@/application/ports/TmuxGateway";
import * as TmuxService from "@/services/tmux-service";

export class TmuxGatewayImpl implements TmuxGateway {
  /**
   * Create a new tmux session.
   */
  async createSession(options: CreateTmuxSessionOptions): Promise<void> {
    await TmuxService.createSession(
      options.sessionName,
      options.workingDirectory,
      options.startupCommand,
      options.environment
    );
  }

  /**
   * Kill (terminate) a tmux session.
   */
  async killSession(sessionName: string): Promise<void> {
    await TmuxService.killSession(sessionName);
  }

  /**
   * Check if a tmux session exists.
   */
  async sessionExists(sessionName: string): Promise<boolean> {
    return TmuxService.sessionExists(sessionName);
  }

  /**
   * Get information about a tmux session.
   * Returns minimal info as TmuxService doesn't expose detailed session data.
   */
  async getSessionInfo(sessionName: string): Promise<TmuxSessionInfo | null> {
    const exists = await TmuxService.sessionExists(sessionName);
    if (!exists) {
      return null;
    }

    // TmuxService only exposes existence check, not detailed info.
    // Return only what we can confirm.
    return {
      name: sessionName,
      // created, attached, windows are not available from TmuxService
    };
  }

  /**
   * List all tmux sessions on the system.
   */
  async listSessions(): Promise<TmuxSessionInfo[]> {
    const sessions = await TmuxService.listSessions();
    return sessions.map((s) => ({
      name: s.name,
      created: s.created,
      attached: s.attached,
      windows: s.windowCount,
    }));
  }

  /**
   * Send keys to a tmux session.
   */
  async sendKeys(sessionName: string, keys: string): Promise<void> {
    await TmuxService.sendKeys(sessionName, keys);
  }

  /**
   * Detach all clients from a tmux session.
   * Note: TmuxService doesn't have a detach method, so this is a no-op.
   * The actual detachment happens when the WebSocket connection closes.
   */
  async detachSession(_sessionName: string): Promise<void> {
    // Tmux sessions are automatically detached when the PTY closes.
    // This is a no-op for compatibility with the interface.
  }

  /**
   * Generate a unique tmux session name for a session ID.
   */
  generateSessionName(sessionId: string): string {
    return TmuxService.generateSessionName(sessionId);
  }
}
