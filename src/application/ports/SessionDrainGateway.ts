/**
 * SessionDrainGateway - Port interface for notifying connected clients
 * of a pending update and querying active session count.
 *
 * The implementation communicates with the terminal server process
 * to broadcast drain warnings and read session state.
 */

export interface DrainStatus {
  activeSessions: number;
  activeAgentSessions: number;
}

export interface SessionDrainGateway {
  /**
   * Notify all connected terminal clients that a restart is imminent.
   * Returns the current active session and agent session counts.
   *
   * @param countdownSeconds - Seconds until the restart will occur
   * @param version - Version being deployed
   */
  notifyDrain(countdownSeconds: number, version: string): Promise<DrainStatus>;

  /**
   * Query the current active session count without broadcasting.
   */
  getActiveSessionCount(): Promise<DrainStatus>;
}
