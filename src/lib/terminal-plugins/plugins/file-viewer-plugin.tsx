/**
 * FileViewerPlugin - Markdown file editor terminal type
 *
 * This plugin provides a split-pane editor for viewing/editing markdown files
 * like CLAUDE.md, AGENTS.md, etc. No tmux session is created - it's pure React.
 *
 * Features:
 * - Split view: raw text (Monaco/textarea) | markdown preview
 * - Auto-detect agent config files (CLAUDE.md, AGENTS.md, etc.)
 * - Auto-save on blur with manual save button
 * - Syntax highlighting for markdown
 */

import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import type {
  TerminalTypePlugin,
  TerminalRenderProps,
  SessionConfig,
  ExitBehavior,
  CreateTypedSessionInput,
  FileViewerMetadata,
} from "@/types/terminal-type";
import type { TerminalSession, CreateSessionInput } from "@/types/session";

// Re-export FileViewerMetadata for consumers that imported from here
export type { FileViewerMetadata } from "@/types/terminal-type";

/**
 * Known agent config files
 */
export const AGENT_CONFIG_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  "OPENCODE.md",
  ".claude/settings.json",
  ".codex/settings.json",
] as const;

/**
 * File viewer plugin configuration
 */
export interface FileViewerPluginConfig {
  /** Auto-save delay in ms (0 = disabled) */
  autoSaveDelay?: number;
  /** Default split ratio (0-1, portion for editor) */
  defaultSplitRatio?: number;
  /** Enable syntax highlighting */
  syntaxHighlighting?: boolean;
}

/**
 * Check if a file is a known agent config file
 */
function isAgentConfigFile(filePath: string): boolean {
  const fileName = filePath.split("/").pop() ?? "";
  return AGENT_CONFIG_FILES.some(
    (cf) => fileName === cf || filePath.endsWith(`/${cf}`)
  );
}

/**
 * Create a file viewer plugin instance
 */
export function createFileViewerPlugin(
  config: FileViewerPluginConfig = {}
): TerminalTypePlugin {
  return {
    type: "file",
    displayName: "File Editor",
    description: "Edit markdown files with live preview",
    icon: FileText,
    priority: 80, // Third priority
    builtIn: true,

    createSession(
      input: CreateSessionInput,
      _session: Partial<TerminalSession>
    ): SessionConfig {
      // Extract file path from input
      const typedInput = input as CreateTypedSessionInput;
      const filePath = typedInput.filePath;

      if (!filePath) {
        throw new Error("File path is required for file viewer sessions");
      }

      const fileName = filePath.split("/").pop() ?? "Untitled";

      // Create metadata to store with session
      const metadata: FileViewerMetadata = {
        filePath,
        fileName,
        isAgentConfig: isAgentConfigFile(filePath),
        lastSavedAt: null,
        isDirty: false,
      };

      return {
        // No shell command - this is not a terminal session
        shellCommand: null,
        shellArgs: [],
        environment: {},
        cwd: input.projectPath,
        // IMPORTANT: No tmux for file viewer
        useTmux: false,
        metadata,
      };
    },

    onSessionExit(
      _session: TerminalSession,
      _exitCode: number | null
    ): ExitBehavior {
      // File viewer sessions don't "exit" in the traditional sense
      // Closing is a user action, not a process exit
      return {
        showExitScreen: false,
        canRestart: false,
        autoClose: true,
      };
    },

    onSessionClose(session: TerminalSession): void {
      // Could prompt for save here if dirty
      // For now, just log
      console.log(`[FileViewerPlugin] Closing file session: ${session.id}`);
    },

    renderContent(
      session: TerminalSession,
      props: TerminalRenderProps
    ): ReactNode {
      // Return a marker that the UI layer will interpret
      // The actual MarkdownEditor component is rendered by TerminalTypeRenderer
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
      // File viewer plugin handles sessions with file type metadata
      // This would be checked via a terminalType field once added to schema
      return false; // Will be updated when terminalType is added
    },
  };
}

/**
 * Default file viewer plugin instance
 */
export const FileViewerPlugin = createFileViewerPlugin();
