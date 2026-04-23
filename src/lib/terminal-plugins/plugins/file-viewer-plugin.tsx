/**
 * FileViewerPlugin — Back-compat shim composing the server + client halves.
 *
 * @deprecated Use `FileViewerServerPlugin` from `./file-viewer-plugin-server`
 * and `FileViewerClientPlugin` from `./file-viewer-plugin-client`. This
 * combined shape exists so the legacy `TerminalTypePlugin` interface +
 * `registry.ts` keep working during the plugin split migration (A0 → A2).
 */

import type { ReactNode } from "react";
import type {
  TerminalTypePlugin,
  TerminalRenderProps,
} from "@/types/terminal-type";
import type { TerminalSession } from "@/types/session";
import {
  createFileViewerServerPlugin,
  type FileViewerPluginServerConfig,
} from "./file-viewer-plugin-server";
import { FileViewerClientPlugin } from "./file-viewer-plugin-client";

// Preserve exported symbols from the old module.
export { AGENT_CONFIG_FILES } from "./file-viewer-plugin-server";
export type { FileViewerMetadata } from "@/types/terminal-type";

/** File viewer plugin configuration — carried for API compatibility. */
export interface FileViewerPluginConfig extends FileViewerPluginServerConfig {
  /** Auto-save delay in ms (0 = disabled) — applied client-side. */
  autoSaveDelay?: number;
  /** Default split ratio (0–1) — applied client-side. */
  defaultSplitRatio?: number;
  /** Enable syntax highlighting — applied client-side. */
  syntaxHighlighting?: boolean;
}

/**
 * Create a file viewer plugin instance combining server + client halves.
 *
 * @deprecated Prefer `createFileViewerServerPlugin` + `FileViewerClientPlugin`.
 */
export function createFileViewerPlugin(
  config: FileViewerPluginConfig = {}
): TerminalTypePlugin {
  const server = createFileViewerServerPlugin(config);
  const client = FileViewerClientPlugin;

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
        type: "file-viewer",
        session,
        props,
        config: {
          autoSaveDelay: config.autoSaveDelay ?? 2000,
          defaultSplitRatio: config.defaultSplitRatio ?? 0.5,
          syntaxHighlighting: config.syntaxHighlighting ?? true,
        },
      } as unknown as ReactNode;
    },
  };
}

/** @deprecated see module docstring */
export const FileViewerPlugin: TerminalTypePlugin = createFileViewerPlugin();

// Re-export the new halves for early migration.
export { FileViewerServerPlugin } from "./file-viewer-plugin-server";
export { FileViewerClientPlugin } from "./file-viewer-plugin-client";
