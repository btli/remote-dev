/**
 * BrowserPlugin — Back-compat shim composing the server + client halves.
 *
 * @deprecated Use `BrowserServerPlugin` from `./browser-plugin-server` and
 * `BrowserClientPlugin` from `./browser-plugin-client` directly. This
 * combined shape exists so the legacy `TerminalTypePlugin` interface +
 * `registry.ts` keep working during the plugin split migration (A0 → A2).
 */

import type { ReactNode } from "react";
import type { TerminalTypePlugin } from "@/types/terminal-type";
import type { TerminalSession } from "@/types/session";
import { BrowserServerPlugin } from "./browser-plugin-server";
import { BrowserClientPlugin } from "./browser-plugin-client";

/** @deprecated see module docstring */
export const BrowserPlugin: TerminalTypePlugin = {
  type: BrowserClientPlugin.type,
  displayName: BrowserClientPlugin.displayName,
  description: BrowserClientPlugin.description,
  icon: BrowserClientPlugin.icon,
  priority: BrowserClientPlugin.priority,
  builtIn: BrowserClientPlugin.builtIn,
  createSession: BrowserServerPlugin.createSession.bind(BrowserServerPlugin),
  onSessionExit: BrowserServerPlugin.onSessionExit?.bind(BrowserServerPlugin),
  onSessionRestart: BrowserServerPlugin.onSessionRestart?.bind(
    BrowserServerPlugin
  ),
  onSessionClose: BrowserServerPlugin.onSessionClose?.bind(BrowserServerPlugin),
  validateInput: BrowserServerPlugin.validateInput?.bind(BrowserServerPlugin),
  canHandle: BrowserServerPlugin.canHandle?.bind(BrowserServerPlugin),
  renderContent(session: TerminalSession): ReactNode {
    return {
      type: "browser",
      session,
    } as unknown as ReactNode;
  },
};

// Re-export the new halves for early migration.
export { BrowserServerPlugin } from "./browser-plugin-server";
export { BrowserClientPlugin } from "./browser-plugin-client";
