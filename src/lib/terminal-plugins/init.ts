/**
 * Initialize built-in terminal type plugins
 *
 * This module registers all built-in plugins with the registry.
 * Call initializeBuiltInPlugins() at application startup.
 */

import { TerminalTypeRegistry } from "./registry";
import { ShellPlugin } from "./plugins/shell-plugin";
import { AgentPlugin } from "./plugins/agent-plugin";
import { FileViewerPlugin } from "./plugins/file-viewer-plugin";

let initialized = false;

/**
 * Initialize and register all built-in terminal type plugins
 *
 * This should be called once at application startup.
 * Safe to call multiple times - subsequent calls are no-ops.
 */
export function initializeBuiltInPlugins(): void {
  if (initialized) {
    console.log("[TerminalPlugins] Already initialized, skipping");
    return;
  }

  console.log("[TerminalPlugins] Initializing built-in plugins...");

  // Register built-in plugins
  // Order matters for UI display - higher priority first
  TerminalTypeRegistry.register(ShellPlugin, { builtIn: true });
  TerminalTypeRegistry.register(AgentPlugin, { builtIn: true });
  TerminalTypeRegistry.register(FileViewerPlugin, { builtIn: true });

  // Set default type to shell
  TerminalTypeRegistry.setDefaultType("shell");

  initialized = true;

  const stats = TerminalTypeRegistry.getStats();
  console.log(
    `[TerminalPlugins] Initialized ${stats.totalPlugins} plugins ` +
      `(${stats.builtInPlugins} built-in, default: ${stats.defaultType})`
  );
}

/**
 * Check if plugins have been initialized
 */
export function isPluginsInitialized(): boolean {
  return initialized;
}

/**
 * Reset initialization state (for testing)
 */
export function resetPluginInitialization(): void {
  initialized = false;
  TerminalTypeRegistry.clear();
}
