/**
 * Terminal Plugins - Extensible terminal type system
 *
 * This module provides a plugin-based architecture for different terminal types.
 *
 * Built-in plugins:
 * - ShellPlugin: Standard bash/zsh terminal
 * - AgentPlugin: AI agent running as shell (exits when agent exits)
 * - FileViewerPlugin: Read/edit markdown files (CLAUDE.md, etc.)
 *
 * Usage:
 * ```typescript
 * import { TerminalTypeRegistry, SessionEventBus } from "@/lib/terminal-plugins";
 *
 * // Get a plugin
 * const plugin = TerminalTypeRegistry.get("agent");
 *
 * // Subscribe to events
 * const sub = SessionEventBus.subscribe("session:exited", (event) => {
 *   console.log(`Session ${event.sessionId} exited`);
 * });
 *
 * // Cleanup
 * sub.unsubscribe();
 * ```
 */

// Re-export core components
export { TerminalTypeRegistry, PluginRegistryError } from "./registry";
export type { PluginRegistrationOptions, TerminalTypeRegistryType } from "./registry";

export { SessionEventBus } from "./event-bus";
export type { Subscription, EventFilter, SessionEventBusType } from "./event-bus";

// Re-export plugins
export { ShellPlugin, createShellPlugin } from "./plugins/shell-plugin";
export { AgentPlugin, createAgentPlugin } from "./plugins/agent-plugin";
export { FileViewerPlugin, createFileViewerPlugin } from "./plugins/file-viewer-plugin";

// Initialization function
export { initializeBuiltInPlugins } from "./init";
