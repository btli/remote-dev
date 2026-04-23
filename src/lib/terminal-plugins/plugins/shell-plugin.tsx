/**
 * ShellPlugin — Back-compat shim composing the server + client halves.
 *
 * @deprecated Use `ShellServerPlugin` from `./shell-plugin-server` and
 * `ShellClientPlugin` from `./shell-plugin-client` directly. This combined
 * shape exists so the legacy `TerminalTypePlugin` interface + `registry.ts`
 * keep working during the plugin split migration (task A0 → A2).
 */

import type { ReactNode } from "react";
import type {
  TerminalTypePlugin,
  TerminalRenderProps,
} from "@/types/terminal-type";
import type { TerminalSession } from "@/types/session";
import {
  createShellServerPlugin,
  type ShellPluginServerConfig,
} from "./shell-plugin-server";
import { ShellClientPlugin } from "./shell-plugin-client";

// Preserve the public API of the old file.
export type ShellPluginConfig = ShellPluginServerConfig;

/**
 * Create a shell plugin instance combining server + client halves.
 *
 * @deprecated Prefer `createShellServerPlugin` + `ShellClientPlugin`.
 */
export function createShellPlugin(
  config: ShellPluginConfig = {}
): TerminalTypePlugin {
  const server = createShellServerPlugin(config);
  const client = ShellClientPlugin;

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
      // Legacy marker payload — preserved for any consumer still reading
      // the switch-based SessionManager/TerminalTypeRenderer output. A2
      // will remove this and consumers will call
      // TerminalTypeClientRegistry.get(type).component instead.
      return {
        type: "terminal",
        session,
        props,
      } as unknown as ReactNode;
    },
  };
}

/** @deprecated see module docstring */
export const ShellPlugin: TerminalTypePlugin = createShellPlugin();

// Re-export the new halves for consumers that want to migrate now.
export {
  ShellServerPlugin,
  createShellServerPlugin,
} from "./shell-plugin-server";
export { ShellClientPlugin } from "./shell-plugin-client";
