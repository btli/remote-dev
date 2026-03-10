/**
 * ServiceRestarter - Port interface for restarting the application service.
 */

export interface ServiceRestarter {
  /**
   * Restart the service processes.
   * The implementation should ensure the HTTP response is flushed before restarting.
   *
   * @param delayMs - Delay in milliseconds before sending SIGTERM (allows HTTP response to flush)
   */
  restart(delayMs?: number): void;

  /**
   * Check if the current environment supports managed restarts.
   * Returns false in development mode where the service manager is not running.
   */
  isRestartSupported(): boolean;
}
