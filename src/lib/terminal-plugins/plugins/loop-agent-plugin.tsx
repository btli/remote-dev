/**
 * LoopAgentPlugin — Back-compat shim composing the server + client halves.
 *
 * @deprecated Use `LoopAgentServerPlugin` from `./loop-agent-plugin-server`
 * and `LoopAgentClientPlugin` from `./loop-agent-plugin-client`. This
 * combined shape exists so the legacy `TerminalTypePlugin` interface +
 * `registry.ts` keep working during the plugin split migration (A0 → A2).
 */

import type { ReactNode } from "react";
import type {
  TerminalTypePlugin,
  TerminalRenderProps,
} from "@/types/terminal-type";
import type { TerminalSession } from "@/types/session";
import { createLoopAgentServerPlugin } from "./loop-agent-plugin-server";
import { LoopAgentClientPlugin } from "./loop-agent-plugin-client";

/**
 * Create a loop agent plugin instance combining server + client halves.
 *
 * @deprecated Prefer `createLoopAgentServerPlugin` + `LoopAgentClientPlugin`.
 */
export function createLoopAgentPlugin(): TerminalTypePlugin {
  const server = createLoopAgentServerPlugin();
  const client = LoopAgentClientPlugin;

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
        type: "loop-chat",
        session,
        props,
      } as unknown as ReactNode;
    },
  };
}

/** @deprecated see module docstring */
export const LoopAgentPlugin: TerminalTypePlugin = createLoopAgentPlugin();

// Re-export the new halves for early migration.
export {
  LoopAgentServerPlugin,
  createLoopAgentServerPlugin,
} from "./loop-agent-plugin-server";
export { LoopAgentClientPlugin } from "./loop-agent-plugin-client";
