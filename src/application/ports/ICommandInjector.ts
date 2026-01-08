/**
 * ICommandInjector - Port for command injection into terminal sessions.
 *
 * This interface defines the contract for injecting commands into running
 * terminal sessions. The infrastructure layer will provide the concrete
 * implementation using tmux send-keys.
 */

import type { CommandInjectionResult } from "@/types/orchestrator";

export interface ICommandInjector {
  /**
   * Inject a command into a terminal session.
   * Returns a result with success status and metadata.
   */
  injectCommand(
    tmuxSessionName: string,
    command: string,
    pressEnter?: boolean
  ): Promise<CommandInjectionResult>;

  /**
   * Validate a command before injection.
   * Checks for dangerous patterns, shell injection risks, etc.
   * Returns validation result with error message if invalid.
   */
  validateCommand(command: string): Promise<{
    valid: boolean;
    reason?: string;
    dangerous?: boolean;
  }>;

  /**
   * Send a control character to a session (e.g., Ctrl-C, Ctrl-D).
   * Returns success status.
   */
  sendControlChar(
    tmuxSessionName: string,
    controlChar: "C-c" | "C-d" | "C-z"
  ): Promise<boolean>;

  /**
   * Check if a session exists and is ready for command injection.
   * Returns true if the session is alive and accepting input.
   */
  isSessionReady(tmuxSessionName: string): Promise<boolean>;

  /**
   * Get the current pane content (visible area) to verify command execution.
   * Useful for confirming the command was actually executed.
   */
  getCurrentPaneContent(tmuxSessionName: string): Promise<string>;
}
