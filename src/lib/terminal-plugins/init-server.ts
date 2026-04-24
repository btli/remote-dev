/**
 * Initialize built-in server-side terminal type plugins.
 *
 * Safe to call from any server context — pulls in no React/Lucide code.
 * Pairs with `init-client.ts` on the browser side.
 *
 * @see ./init-client.ts
 */

import { TerminalTypeServerRegistry } from "./server";
import { ShellServerPlugin } from "./plugins/shell-plugin-server";
import { AgentServerPlugin } from "./plugins/agent-plugin-server";
import { FileViewerServerPlugin } from "./plugins/file-viewer-plugin-server";
import { BrowserServerPlugin } from "./plugins/browser-plugin-server";
import { LoopAgentServerPlugin } from "./plugins/loop-agent-plugin-server";
import { SettingsServerPlugin } from "./plugins/settings-plugin-server";
import { RecordingsServerPlugin } from "./plugins/recordings-plugin-server";
import { PRsServerPlugin } from "./plugins/prs-plugin-server";
import { IssuesServerPlugin } from "./plugins/issues-plugin-server";
import { ProfilesServerPlugin } from "./plugins/profiles-plugin-server";
import { PortManagerServerPlugin } from "./plugins/port-manager-plugin-server";
import { createLogger } from "@/lib/logger";

const log = createLogger("PluginInit.Server");

let initialized = false;

/**
 * Initialize and register all built-in server-side plugins.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initializeServerPlugins(): void {
  if (initialized) {
    log.debug("Server plugins already initialized, skipping");
    return;
  }

  log.info("Initializing server-side terminal type plugins");

  TerminalTypeServerRegistry.register(ShellServerPlugin, { builtIn: true });
  TerminalTypeServerRegistry.register(AgentServerPlugin, { builtIn: true });
  TerminalTypeServerRegistry.register(FileViewerServerPlugin, { builtIn: true });
  TerminalTypeServerRegistry.register(BrowserServerPlugin, { builtIn: true });
  TerminalTypeServerRegistry.register(LoopAgentServerPlugin, { builtIn: true });
  TerminalTypeServerRegistry.register(SettingsServerPlugin, { builtIn: true });
  TerminalTypeServerRegistry.register(RecordingsServerPlugin, { builtIn: true });
  TerminalTypeServerRegistry.register(PRsServerPlugin, { builtIn: true });
  TerminalTypeServerRegistry.register(IssuesServerPlugin, { builtIn: true });
  TerminalTypeServerRegistry.register(ProfilesServerPlugin, { builtIn: true });
  TerminalTypeServerRegistry.register(PortManagerServerPlugin, { builtIn: true });

  TerminalTypeServerRegistry.setDefaultType("shell");

  initialized = true;

  const stats = TerminalTypeServerRegistry.getStats();
  log.info("Server plugins initialized", {
    totalPlugins: stats.totalPlugins,
    builtInPlugins: stats.builtInPlugins,
    defaultType: stats.defaultType,
  });
}

/** Check if server plugins have been initialized */
export function isServerPluginsInitialized(): boolean {
  return initialized;
}

/** Reset server plugin initialization (for tests) */
export function resetServerPluginInitialization(): void {
  initialized = false;
  TerminalTypeServerRegistry.clear();
}
