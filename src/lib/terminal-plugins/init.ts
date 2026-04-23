/**
 * Initialize built-in terminal type plugins — back-compat entry point.
 *
 * This file preserves the original public API (`initializeBuiltInPlugins`,
 * `isPluginsInitialized`, `resetPluginInitialization`) while also wiring
 * the new split `TerminalTypeServerRegistry` + `TerminalTypeClientRegistry`.
 *
 * Prefer calling `initializeServerPlugins()` / `initializeClientPlugins()`
 * directly from the appropriate execution context — see:
 *
 * @see ./init-server.ts
 * @see ./init-client.ts
 */

import { TerminalTypeRegistry } from "./registry";
import { ShellPlugin } from "./plugins/shell-plugin";
import { AgentPlugin } from "./plugins/agent-plugin";
import { FileViewerPlugin } from "./plugins/file-viewer-plugin";
import { BrowserPlugin } from "./plugins/browser-plugin";
import { LoopAgentPlugin } from "./plugins/loop-agent-plugin";
import {
  initializeServerPlugins,
  resetServerPluginInitialization,
} from "./init-server";
import {
  initializeClientPlugins,
  resetClientPluginInitialization,
} from "./init-client";
import { createLogger } from "@/lib/logger";

const log = createLogger("PluginInit");

let initialized = false;

/**
 * Initialize and register all built-in terminal type plugins.
 *
 * This registers into all three registries:
 * - Legacy {@link TerminalTypeRegistry} (combined, deprecated)
 * - {@link TerminalTypeServerRegistry} (new, server-safe)
 * - {@link TerminalTypeClientRegistry} (new, React-aware)
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @deprecated Prefer `initializeServerPlugins()` on the server and
 * `initializeClientPlugins()` on the client. This combined entry point
 * will be removed once SessionManager/TerminalTypeRenderer migrate to the
 * split registries (task A2).
 */
export function initializeBuiltInPlugins(): void {
  if (initialized) {
    log.debug("Already initialized, skipping");
    return;
  }

  log.info("Initializing built-in plugins (legacy + split registries)");

  // Legacy combined registry — kept intact for existing consumers
  // (session-service.ts, SessionManager.tsx) that still use it.
  TerminalTypeRegistry.register(ShellPlugin, { builtIn: true });
  TerminalTypeRegistry.register(AgentPlugin, { builtIn: true });
  TerminalTypeRegistry.register(FileViewerPlugin, { builtIn: true });
  TerminalTypeRegistry.register(BrowserPlugin, { builtIn: true });
  TerminalTypeRegistry.register(LoopAgentPlugin, { builtIn: true });
  TerminalTypeRegistry.setDefaultType("shell");

  // New split registries.
  initializeServerPlugins();
  initializeClientPlugins();

  initialized = true;

  const stats = TerminalTypeRegistry.getStats();
  log.info("Legacy plugin registry populated", {
    totalPlugins: stats.totalPlugins,
    builtInPlugins: stats.builtInPlugins,
    defaultType: stats.defaultType,
  });
}

/** Check if legacy plugin initialization has run. */
export function isPluginsInitialized(): boolean {
  return initialized;
}

/** Reset all initialization state (legacy + new registries). For tests. */
export function resetPluginInitialization(): void {
  initialized = false;
  TerminalTypeRegistry.clear();
  resetServerPluginInitialization();
  resetClientPluginInitialization();
}
