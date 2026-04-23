/**
 * AgentPlugin — Back-compat shim composing the server + client halves.
 *
 * @deprecated Use `AgentServerPlugin` from `./agent-plugin-server` and
 * `AgentClientPlugin` from `./agent-plugin-client` directly. This combined
 * shape exists so the legacy `TerminalTypePlugin` interface + `registry.ts`
 * keep working during the plugin split migration (task A0 → A2).
 */

import type { ReactNode } from "react";
import type {
  TerminalTypePlugin,
  TerminalRenderProps,
  ExitScreenInfo,
  ExitScreenCallbacks,
} from "@/types/terminal-type";
import type { TerminalSession } from "@/types/session";
import {
  createAgentServerPlugin,
  type AgentPluginServerConfig,
} from "./agent-plugin-server";
import { AgentClientPlugin } from "./agent-plugin-client";

// Preserve the public API of the old file.
export type AgentPluginConfig = AgentPluginServerConfig;

/**
 * Create an agent plugin instance combining server + client halves.
 *
 * @deprecated Prefer `createAgentServerPlugin` + `AgentClientPlugin`.
 */
export function createAgentPlugin(
  config: AgentPluginConfig = {}
): TerminalTypePlugin {
  const server = createAgentServerPlugin(config);
  const client = AgentClientPlugin;

  return {
    type: client.type,
    displayName: client.displayName,
    description: client.description,
    icon: client.icon,
    priority: client.priority,
    builtIn: client.builtIn,
    createSession: server.createSession.bind(server),
    onSessionExit: server.onSessionExit?.bind(server),
    onSessionRestart: server.onSessionRestart?.bind(server),
    onSessionClose: server.onSessionClose?.bind(server),
    validateInput: server.validateInput?.bind(server),
    canHandle: server.canHandle?.bind(server),
    renderContent(
      session: TerminalSession,
      props: TerminalRenderProps
    ): ReactNode {
      return {
        type: "terminal",
        session,
        props,
      } as unknown as ReactNode;
    },
    renderExitScreen(
      session: TerminalSession,
      exitInfo: ExitScreenInfo,
      callbacks: ExitScreenCallbacks
    ): ReactNode {
      return {
        type: "agent-exit-screen",
        session,
        exitInfo,
        callbacks,
      } as unknown as ReactNode;
    },
  };
}

/** @deprecated see module docstring */
export const AgentPlugin: TerminalTypePlugin = createAgentPlugin();

// Re-export the new halves for consumers that want to migrate now.
export {
  AgentServerPlugin,
  createAgentServerPlugin,
} from "./agent-plugin-server";
export { AgentClientPlugin } from "./agent-plugin-client";
