/**
 * TmuxGatewayImpl - Implementation of TmuxGateway using existing TmuxService.
 *
 * This adapter wraps the existing TmuxService to implement the TmuxGateway interface.
 * This allows gradual migration without rewriting the tmux integration.
 */

import * as os from "node:os";
import type {
  TmuxGateway,
  TmuxSessionInfo,
  CreateTmuxSessionOptions,
  TmuxHook,
} from "@/application/ports/TmuxGateway";
import { TmuxEnvironment } from "@/domain/value-objects/TmuxEnvironment";
import * as TmuxService from "@/services/tmux-service";
import { buildAgentExitHookCommand } from "@/services/agent-exit-hook";
import { prepareAgentLaunch } from "@/services/agent-launch-preparation";

export class TmuxGatewayImpl implements TmuxGateway {
  /**
   * Create a new tmux session.
   * TmuxService.createSession requires a cwd (remote-dev-ipbo) — fall back to
   * home when the port's optional workingDirectory is absent.
   */
  async createSession(options: CreateTmuxSessionOptions): Promise<void> {
    await TmuxService.createSession(
      options.sessionName,
      options.workingDirectory ?? os.homedir(),
      undefined,
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

  async getSessionPresence(
    sessionName: string,
  ): Promise<import("@/application/ports/TmuxGateway").TmuxSessionPresence> {
    return TmuxService.getSessionPresence(sessionName);
  }

  async stopSessionAndConfirmAbsent(sessionName: string): Promise<boolean> {
    return TmuxService.stopSessionAndConfirmAbsent(sessionName);
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

  async replaceAgentProcess(sessionName: string, command: string): Promise<void> {
    // Kill/respawn the old pane, bind the new generation's pane-died callback,
    // then exec the command so the agent (not a parent shell) owns pane life.
    const env = await TmuxService.getSessionEnvironment(sessionName);
    const sessionId = env.RDV_SESSION_ID;
    const generation = Number(env.RDV_AGENT_GENERATION);
    if (!sessionId || !Number.isSafeInteger(generation) || generation < 0) {
      throw new Error("Missing lifecycle session/generation for agent restart");
    }
    // Kill the prior generation first. If hook repair then fails, the durable
    // error state cannot coexist with an untracked old agent still running.
    // The fresh bootstrap shell inherits the new generation/key but no agent
    // command is launched until preparation succeeds.
    const paneId = await TmuxService.respawnPane(sessionName);
    await prepareAgentLaunch(env);
    await TmuxService.configureAgentPaneLifecycle(
      sessionName,
      buildAgentExitHookCommand({
        sessionId,
        tmuxSessionName: sessionName,
        generation,
        terminalSocket: env.RDV_TERMINAL_SOCKET,
        terminalPort: env.RDV_TERMINAL_PORT,
      }),
      paneId,
    );
    await TmuxService.launchCommand(sessionName, command, {
      replaceShell: true,
      targetPane: paneId,
    });
  }

  /**
   * Detach all clients from a tmux session.
   * Note: TmuxService doesn't have a detach method, so this is a no-op.
   * The actual detachment happens when the WebSocket connection closes.
   */
  async detachSession(sessionName: string): Promise<void> {
    // Tmux sessions are automatically detached when the PTY closes.
    // This is a no-op for compatibility with the interface.
    void sessionName; // Parameter required by interface but unused
  }

  /**
   * Generate a unique tmux session name for a session ID.
   */
  generateSessionName(sessionId: string): string {
    return TmuxService.generateSessionName(sessionId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Environment Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set environment variables at the tmux session level.
   */
  async setEnvironment(
    sessionName: string,
    vars: TmuxEnvironment
  ): Promise<void> {
    await TmuxService.setSessionEnvironment(sessionName, vars.toRecord());
  }

  /**
   * Get environment variables from a tmux session.
   */
  async getEnvironment(sessionName: string): Promise<TmuxEnvironment> {
    const env = await TmuxService.getSessionEnvironment(sessionName);
    return TmuxEnvironment.create(env);
  }

  /**
   * Unset environment variables from a tmux session.
   */
  async unsetEnvironment(sessionName: string, keys: string[]): Promise<void> {
    await TmuxService.unsetSessionEnvironment(sessionName, keys);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Hooks Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set a hook on a tmux session.
   */
  async setHook(sessionName: string, hook: TmuxHook): Promise<void> {
    await TmuxService.setHook(sessionName, hook.name, hook.command);
  }

  /**
   * Remove a hook from a tmux session.
   */
  async removeHook(sessionName: string, hookName: string): Promise<void> {
    await TmuxService.removeHook(
      sessionName,
      hookName as TmuxService.TmuxHookName
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Options Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set a tmux session option.
   */
  async setOption(
    sessionName: string,
    option: string,
    value: string
  ): Promise<void> {
    await TmuxService.setOption(sessionName, option, value);
  }

  /**
   * Get a tmux session option value.
   */
  async getOption(sessionName: string, option: string): Promise<string | null> {
    return TmuxService.getOption(sessionName, option);
  }
}
