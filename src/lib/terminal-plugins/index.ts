/**
 * Terminal Plugins - Extensible terminal type system
 *
 * This module provides a plugin-based architecture for different terminal types.
 *
 * Built-in plugins:
 * - Shell: Standard bash/zsh terminal
 * - Agent: AI agent running as shell (exits when agent exits)
 * - FileViewer: Read/edit markdown files (CLAUDE.md, etc.)
 * - Browser: In-app headless browser pane
 * - LoopAgent: Chat-first agent with loop scheduling
 *
 * ## Migration in progress (A0 → A2)
 *
 * The plugin interface is being split into server-safe (lifecycle) and
 * client-only (React rendering) halves so server code can import plugins
 * without pulling in Lucide/React. Prefer the split surfaces for new code:
 *
 * ```typescript
 * // Server-side
 * import { TerminalTypeServerRegistry } from "@/lib/terminal-plugins/server";
 * import { initializeServerPlugins } from "@/lib/terminal-plugins/init-server";
 *
 * // Client-side
 * import { TerminalTypeClientRegistry } from "@/lib/terminal-plugins/client";
 * import { initializeClientPlugins } from "@/lib/terminal-plugins/init-client";
 * ```
 *
 * The legacy `TerminalTypeRegistry` + combined `TerminalTypePlugin` still
 * work and are populated alongside the new registries by
 * `initializeBuiltInPlugins()` — see `README.md` for the migration path.
 */

// Legacy combined registry (deprecated — kept for back-compat during A0→A2).
export { TerminalTypeRegistry, PluginRegistryError } from "./registry";
export type {
  PluginRegistrationOptions,
  TerminalTypeRegistryType,
} from "./registry";

// New split registries.
export {
  TerminalTypeServerRegistry,
  ServerPluginRegistryError,
} from "./server";
export type {
  ServerPluginRegistrationOptions,
  ServerPluginMetadata,
  TerminalTypeServerRegistryType,
} from "./server";

export {
  TerminalTypeClientRegistry,
  ClientPluginRegistryError,
} from "./client";
export type {
  ClientPluginRegistrationOptions,
  ClientPluginMetadata,
  TerminalTypeClientRegistryType,
} from "./client";

// Event bus (unchanged).
export { SessionEventBus } from "./event-bus";
export type {
  Subscription,
  EventFilter,
  SessionEventBusType,
} from "./event-bus";

// Legacy combined plugin exports.
export { ShellPlugin, createShellPlugin } from "./plugins/shell-plugin";
export { AgentPlugin, createAgentPlugin } from "./plugins/agent-plugin";
export {
  FileViewerPlugin,
  createFileViewerPlugin,
} from "./plugins/file-viewer-plugin";

// Split-half plugin exports.
export { ShellServerPlugin, createShellServerPlugin } from "./plugins/shell-plugin-server";
export { ShellClientPlugin } from "./plugins/shell-plugin-client";
export { AgentServerPlugin, createAgentServerPlugin } from "./plugins/agent-plugin-server";
export { AgentClientPlugin } from "./plugins/agent-plugin-client";
export {
  FileViewerServerPlugin,
  createFileViewerServerPlugin,
} from "./plugins/file-viewer-plugin-server";
export { FileViewerClientPlugin } from "./plugins/file-viewer-plugin-client";
export { BrowserServerPlugin } from "./plugins/browser-plugin-server";
export { BrowserClientPlugin } from "./plugins/browser-plugin-client";
export {
  LoopAgentServerPlugin,
  createLoopAgentServerPlugin,
} from "./plugins/loop-agent-plugin-server";
export { LoopAgentClientPlugin } from "./plugins/loop-agent-plugin-client";
export { IssuesServerPlugin } from "./plugins/issues-plugin-server";
export type { IssuesSessionMetadata } from "./plugins/issues-plugin-server";
export { IssuesClientPlugin } from "./plugins/issues-plugin-client";
export { PRsServerPlugin } from "./plugins/prs-plugin-server";
export type { PRsSessionMetadata } from "./plugins/prs-plugin-server";
export { PRsClientPlugin } from "./plugins/prs-plugin-client";
export { RecordingsServerPlugin } from "./plugins/recordings-plugin-server";
export type { RecordingsSessionMetadata } from "./plugins/recordings-plugin-server";
export { RecordingsClientPlugin } from "./plugins/recordings-plugin-client";
export { SettingsServerPlugin } from "./plugins/settings-plugin-server";
export type { SettingsSessionMetadata } from "./plugins/settings-plugin-server";
export { SettingsClientPlugin } from "./plugins/settings-plugin-client";
export { ProfilesServerPlugin } from "./plugins/profiles-plugin-server";
export type {
  ProfilesSessionMetadata,
  ProfilesActiveTab,
} from "./plugins/profiles-plugin-server";
export { ProfilesClientPlugin } from "./plugins/profiles-plugin-client";

// Initialization functions.
export { initializeBuiltInPlugins } from "./init";
export { initializeServerPlugins } from "./init-server";
export { initializeClientPlugins } from "./init-client";
