/**
 * Initialize built-in client-side terminal type plugins.
 *
 * Must only be called from browser/client code — registers React components
 * and Lucide icons. Pairs with `init-server.ts` on the server side.
 *
 * @see ./init-server.ts
 */

import { TerminalTypeClientRegistry } from "./client";
import { ShellClientPlugin } from "./plugins/shell-plugin-client";
import { AgentClientPlugin } from "./plugins/agent-plugin-client";
import { FileViewerClientPlugin } from "./plugins/file-viewer-plugin-client";
import { BrowserClientPlugin } from "./plugins/browser-plugin-client";
import { LoopAgentClientPlugin } from "./plugins/loop-agent-plugin-client";
import { SettingsClientPlugin } from "./plugins/settings-plugin-client";
import { RecordingsClientPlugin } from "./plugins/recordings-plugin-client";
import { PRsClientPlugin } from "./plugins/prs-plugin-client";
import { IssuesClientPlugin } from "./plugins/issues-plugin-client";
import { ProfilesClientPlugin } from "./plugins/profiles-plugin-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("PluginInit.Client");

let initialized = false;

/**
 * Initialize and register all built-in client-side plugins.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initializeClientPlugins(): void {
  if (initialized) {
    log.debug("Client plugins already initialized, skipping");
    return;
  }

  log.info("Initializing client-side terminal type plugins");

  TerminalTypeClientRegistry.register(ShellClientPlugin, { builtIn: true });
  TerminalTypeClientRegistry.register(AgentClientPlugin, { builtIn: true });
  TerminalTypeClientRegistry.register(FileViewerClientPlugin, { builtIn: true });
  TerminalTypeClientRegistry.register(BrowserClientPlugin, { builtIn: true });
  TerminalTypeClientRegistry.register(LoopAgentClientPlugin, { builtIn: true });
  TerminalTypeClientRegistry.register(SettingsClientPlugin, { builtIn: true });
  TerminalTypeClientRegistry.register(RecordingsClientPlugin, { builtIn: true });
  TerminalTypeClientRegistry.register(PRsClientPlugin, { builtIn: true });
  TerminalTypeClientRegistry.register(IssuesClientPlugin, { builtIn: true });
  TerminalTypeClientRegistry.register(ProfilesClientPlugin, { builtIn: true });

  TerminalTypeClientRegistry.setDefaultType("shell");

  initialized = true;

  const stats = TerminalTypeClientRegistry.getStats();
  log.info("Client plugins initialized", {
    totalPlugins: stats.totalPlugins,
    builtInPlugins: stats.builtInPlugins,
    defaultType: stats.defaultType,
  });
}

/** Check if client plugins have been initialized */
export function isClientPluginsInitialized(): boolean {
  return initialized;
}

/** Reset client plugin initialization (for tests) */
export function resetClientPluginInitialization(): void {
  initialized = false;
  TerminalTypeClientRegistry.clear();
}
