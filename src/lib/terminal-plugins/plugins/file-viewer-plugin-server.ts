/**
 * FileViewerPlugin (server half) — lifecycle for file-editor sessions.
 * No tmux, no shell command — metadata only.
 *
 * @see ./file-viewer-plugin-client.tsx for rendering.
 */

import type {
  TerminalTypeServerPlugin,
  SessionConfig,
  ExitBehavior,
  FileViewerMetadata,
} from "@/types/terminal-type-server";
import type { TerminalSession, CreateSessionInput } from "@/types/session";
import type { CreateTypedSessionInput } from "@/types/terminal-type";
import { createLogger } from "@/lib/logger";

const log = createLogger("FileViewerPlugin.Server");

/** Known agent config files */
export const AGENT_CONFIG_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  "OPENCODE.md",
  ".claude/settings.json",
  ".codex/settings.json",
] as const;

/** File viewer plugin configuration (currently unused server-side) */
export interface FileViewerPluginServerConfig {
  /** Reserved for future server-side file-viewer options */
  reserved?: never;
}

function isAgentConfigFile(filePath: string): boolean {
  const fileName = filePath.split("/").pop() ?? "";
  return AGENT_CONFIG_FILES.some(
    (cf) => fileName === cf || filePath.endsWith(`/${cf}`)
  );
}

/** Create a server-side file viewer plugin */
export function createFileViewerServerPlugin(
  _config: FileViewerPluginServerConfig = {}
): TerminalTypeServerPlugin {
  return {
    type: "file",
    priority: 80,
    builtIn: true,
    useTmux: false,

    createSession(input: CreateSessionInput): SessionConfig {
      const typedInput = input as CreateTypedSessionInput;
      const filePath = typedInput.filePath;

      if (!filePath) {
        throw new Error("File path is required for file viewer sessions");
      }

      const fileName = filePath.split("/").pop() ?? "Untitled";
      const metadata: FileViewerMetadata = {
        filePath,
        fileName,
        isAgentConfig: isAgentConfigFile(filePath),
        lastSavedAt: null,
        isDirty: false,
      };

      return {
        shellCommand: null,
        shellArgs: [],
        environment: {},
        cwd: input.projectPath,
        // File viewer never uses tmux
        useTmux: false,
        metadata,
      };
    },

    onSessionExit(): ExitBehavior {
      return {
        showExitScreen: false,
        canRestart: false,
        autoClose: true,
      };
    },

    onSessionClose(session: TerminalSession): void {
      log.debug("Closing file session", { sessionId: session.id });
    },

    validateInput(input: CreateSessionInput): string | null {
      if (!input.name?.trim()) {
        return "Session name is required";
      }
      const typedInput = input as CreateTypedSessionInput;
      if (!typedInput.filePath?.trim()) {
        return "File path is required for file viewer sessions";
      }
      return null;
    },

    canHandle(session: TerminalSession): boolean {
      return session.terminalType === "file";
    },
  };
}

/** Default file viewer server plugin instance */
export const FileViewerServerPlugin = createFileViewerServerPlugin();
