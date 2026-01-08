/**
 * TmuxCommandInjector - Implementation of ICommandInjector using tmux send-keys.
 *
 * This gateway allows orchestrators to inject commands into running terminal sessions.
 * It includes validation to prevent dangerous commands and provides control character
 * support for interrupting processes.
 */

import * as crypto from "crypto";
import * as TmuxService from "@/services/tmux-service";
import { execFile } from "@/lib/exec";
import type { ICommandInjector } from "@/application/ports/ICommandInjector";
import type { CommandInjectionResult } from "@/types/orchestrator";

export class TmuxCommandInjector implements ICommandInjector {
  // Patterns for dangerous commands that should be blocked
  private readonly DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+\/(?!\w)/i,                    // rm -rf / (root deletion)
    /:\(\)\{.*\|.*&\s*\};:/,                   // Fork bomb
    /dd\s+if=/i,                                // dd command (can overwrite disks)
    /mkfs\./i,                                  // Format filesystem
    />\s*\/dev\/sd[a-z]/i,                     // Write to raw disk device
    /curl.*\|\s*(?:bash|sh)/i,                 // Curl pipe to shell
    /wget.*\|\s*(?:bash|sh)/i,                 // Wget pipe to shell
    /chmod\s+777\s+\//i,                       // Chmod 777 on root
    /chown\s+.*\s+\//i,                        // Chown on root
  ];

  // Patterns for potentially dangerous commands that require extra caution
  private readonly CAUTION_PATTERNS = [
    /rm\s+-rf/i,                               // rm -rf (any path)
    /sudo\s+rm/i,                              // sudo rm
    /chmod\s+[-+]?[0-7]{3,4}/i,               // chmod with numeric permissions
    /chown/i,                                  // chown
    /kill\s+-9/i,                              // kill -9
    /pkill/i,                                  // pkill
    /killall/i,                                // killall
  ];

  /**
   * Inject a command into a terminal session.
   * Returns a result with success status and metadata.
   */
  async injectCommand(
    tmuxSessionName: string,
    command: string,
    pressEnter?: boolean
  ): Promise<CommandInjectionResult> {
    const timestamp = new Date();
    const auditLogId = crypto.randomUUID();

    try {
      // Validate session exists
      const sessionReady = await this.isSessionReady(tmuxSessionName);
      if (!sessionReady) {
        return {
          success: false,
          sessionId: tmuxSessionName.replace("rdv-", ""),
          command,
          timestamp,
          auditLogId,
          error: "Session does not exist or is not ready",
        };
      }

      // Send command via tmux
      await TmuxService.sendKeys(tmuxSessionName, command, pressEnter ?? true);

      return {
        success: true,
        sessionId: tmuxSessionName.replace("rdv-", ""),
        command,
        timestamp,
        auditLogId,
      };
    } catch (error) {
      return {
        success: false,
        sessionId: tmuxSessionName.replace("rdv-", ""),
        command,
        timestamp,
        auditLogId,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Validate a command before injection.
   * Checks for dangerous patterns, shell injection risks, etc.
   * Returns validation result with error message if invalid.
   */
  async validateCommand(command: string): Promise<{
    valid: boolean;
    reason?: string;
    dangerous?: boolean;
  }> {
    // Empty command
    if (!command || command.trim().length === 0) {
      return {
        valid: false,
        reason: "Command cannot be empty",
      };
    }

    // Check for dangerous patterns
    for (const pattern of this.DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return {
          valid: false,
          reason: "Command contains dangerous pattern that could cause system damage",
          dangerous: true,
        };
      }
    }

    // Check for caution patterns
    for (const pattern of this.CAUTION_PATTERNS) {
      if (pattern.test(command)) {
        return {
          valid: true, // Allow but flag as dangerous
          reason: "Command contains potentially dangerous operations - use with caution",
          dangerous: true,
        };
      }
    }

    // Check for extremely long commands (potential DoS)
    if (command.length > 10000) {
      return {
        valid: false,
        reason: "Command exceeds maximum length (10000 characters)",
      };
    }

    // Check for null bytes (shell injection)
    if (command.includes("\0")) {
      return {
        valid: false,
        reason: "Command contains null bytes",
        dangerous: true,
      };
    }

    return {
      valid: true,
    };
  }

  /**
   * Send a control character to a session (e.g., Ctrl-C, Ctrl-D).
   * Returns success status.
   */
  async sendControlChar(
    tmuxSessionName: string,
    controlChar: "C-c" | "C-d" | "C-z"
  ): Promise<boolean> {
    try {
      // Validate session exists
      const sessionReady = await this.isSessionReady(tmuxSessionName);
      if (!sessionReady) {
        return false;
      }

      // Send control character via tmux
      // Note: tmux uses special key names for control chars
      await execFile("tmux", [
        "send-keys",
        "-t",
        tmuxSessionName,
        controlChar,
      ]);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a session exists and is ready for command injection.
   * Returns true if the session is alive and accepting input.
   */
  async isSessionReady(tmuxSessionName: string): Promise<boolean> {
    try {
      return await TmuxService.sessionExists(tmuxSessionName);
    } catch {
      return false;
    }
  }

  /**
   * Get the current pane content (visible area) to verify command execution.
   * Useful for confirming the command was actually executed.
   */
  async getCurrentPaneContent(tmuxSessionName: string): Promise<string> {
    try {
      return await TmuxService.capturePane(tmuxSessionName);
    } catch (error) {
      throw new Error(`Failed to capture pane content: ${(error as Error).message}`);
    }
  }
}
