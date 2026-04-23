/**
 * Terminal Type System — Client-side plugin surface
 *
 * This module declares the React/UI half of the terminal type plugin
 * interface. It is allowed to import Lucide icons and React component types.
 * Server code (`session-service.ts`, etc.) must not import from this file.
 *
 * Companion file: `src/types/terminal-type-server.ts` for lifecycle logic.
 *
 * @see ./terminal-type-server.ts
 * @see ./terminal-type.ts (legacy combined interface, deprecated)
 */

import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type {
  TerminalType,
  TerminalRenderProps,
  ExitScreenInfo,
  SessionStatusIndicator,
  SessionProgress,
} from "./terminal-type";
import type { TerminalSession } from "./session";
import type { PeerChatMessage } from "./peer-chat";
import type { Channel } from "./channels";

// Re-export shared UI shapes from the legacy combined file.
export type {
  TerminalType,
  TerminalRenderProps,
  ExitScreenInfo,
  ExitScreenCallbacks,
  TerminalTypeOption,
  TerminalTypeConfigOption,
} from "./terminal-type";

/**
 * Props passed to a terminal type's main rendering component.
 *
 * These extend {@link TerminalRenderProps} with the session object plus the
 * cross-cutting callbacks that SessionManager passes uniformly to every
 * terminal type (status, progress, peer/channel events, …). Individual
 * plugin components pick the subset they actually need — all extras are
 * optional so plugin implementations stay focused.
 *
 * The `session` field and a handful of core terminal props (wsUrl, font,
 * dimensions) are the only strictly-required contract. Everything else is
 * additive.
 */
export interface TerminalTypeClientComponentProps extends TerminalRenderProps {
  /** The session being rendered */
  session: TerminalSession;

  /** xterm.js client-side scrollback buffer size */
  scrollback?: number;
  /** tmux server-side history-limit */
  tmuxHistoryLimit?: number;
  /** Whether native notifications should fire from this session */
  notificationsEnabled?: boolean;
  /** Whether the session is currently being recorded */
  isRecording?: boolean;
  /** Environment variables to inject into new terminal sessions */
  environmentVars?: Record<string, string> | null;

  /** Raw terminal output data callback (e.g. piped into a recording) */
  onOutput?: (data: string) => void;
  /** Terminal dimensions-change callback (e.g. piped into a recording) */
  onDimensionsChange?: (cols: number, rows: number) => void;

  /** Called when the user requests session close/delete from inside the pane */
  onSessionClose?: (sessionId: string) => void;
  /** Called when the user requests a restart from inside the pane */
  onSessionRestart?: () => Promise<void> | void;
  /** Called when the user deletes the session (optionally also removing worktree) */
  onSessionDelete?: (deleteWorktree?: boolean) => Promise<void> | void;
  /** Called when the pane wants to navigate the workspace to another session */
  onNavigateToSession?: (sessionId: string) => void;

  /** Called when agent activity status changes (from Claude Code hooks) */
  onAgentActivityStatus?: (sessionId: string, status: string) => void;
  /** Called when beads issues are updated */
  onBeadsIssuesUpdated?: (sessionId: string) => void;
  /** Called when an agent session is auto-titled from its .jsonl file */
  onSessionRenamed?: (
    sessionId: string,
    name: string,
    claudeSessionId?: string
  ) => void;
  /** Called when a notification is broadcast from the terminal server */
  onNotification?: (notification: Record<string, unknown>) => void;
  /** Called when a session status indicator is set or cleared */
  onSessionStatus?: (
    sessionId: string,
    key: string,
    indicator: SessionStatusIndicator | null
  ) => void;
  /** Called when session progress is updated or cleared */
  onSessionProgress?: (
    sessionId: string,
    progress: SessionProgress | null
  ) => void;
  /** Called when a peer message is created (broadcast from terminal server) */
  onPeerMessageCreated?: (folderId: string, message: PeerChatMessage) => void;
  /** Called when a channel message is created */
  onChannelMessageCreated?: (
    folderId: string,
    channelId: string,
    message: PeerChatMessage
  ) => void;
  /** Called when a thread reply is created */
  onThreadReplyCreated?: (
    folderId: string,
    parentMessageId: string,
    message: PeerChatMessage
  ) => void;
  /** Called when a new channel is created */
  onChannelCreated?: (folderId: string, channel: Channel) => void;

  /**
   * Called by plugin UI when the user requests "start working on this issue".
   * Consumed by the issues plugin. The terminal-type client contract keeps
   * this generic (`issue: unknown`) so server code (which does not import
   * the GitHub issues types) stays free of React/domain-UI dependencies.
   * SessionManager passes a handler that narrows the type and creates a
   * worktree + agent session.
   *
   * Wiring responsibility (C1 / wave 2b): SessionManager threads its
   * existing `handleCreateWorktreeFromIssue` through this prop.
   */
  onCreateWorktreeFromIssue?: (
    issue: unknown,
    repositoryId: string
  ) => void | Promise<void>;

  /**
   * Called by plugin UI when the user requests "checkout this PR's branch".
   * Consumed by the PRs plugin. Typed as `pr: unknown` to keep the terminal
   * type contract free of GitHub-specific types — SessionManager narrows
   * it at the wiring site (wave 2b).
   *
   * Wiring responsibility (C2 / wave 2b): SessionManager threads a handler
   * that creates a worktree / checks out the branch in an agent session.
   */
  onCheckoutBranch?: (
    pr: unknown,
    repositoryId: string
  ) => void | Promise<void>;

  /**
   * Optional ref-registration hook. Plugin components that expose an
   * imperative handle (e.g. `TerminalWithKeyboard` with its `focus()` API)
   * can call this with their ref so the parent can track and re-focus the
   * active session. Pass `null` to unregister on unmount.
   *
   * The ref type is intentionally unknown at the contract level — callers
   * that care about a specific shape should narrow it at the call site.
   */
  registerRef?: (sessionId: string, ref: unknown) => void;
}

/**
 * Props passed to a terminal type's exit screen component.
 */
export interface TerminalTypeExitScreenProps {
  session: TerminalSession;
  exitInfo: ExitScreenInfo;
  onRestart: () => void;
  onClose: () => void;
}

/**
 * Client-side terminal type plugin.
 *
 * Owns React rendering for a terminal type: the main component, the
 * optional exit screen, and all presentation metadata (icon, name,
 * description). Server lifecycle lives in {@link TerminalTypeServerPlugin}.
 */
export interface TerminalTypeClientPlugin {
  /** Unique identifier matching the server plugin's `type` */
  readonly type: TerminalType;

  /** Human-readable display name */
  readonly displayName: string;

  /** Short description of what this type does */
  readonly description: string;

  /** Icon displayed in sidebar and tabs */
  readonly icon: LucideIcon;

  /** Plugin priority (higher = listed first in UI). Default 0. */
  readonly priority?: number;

  /** Whether this plugin is a built-in type (cannot be unregistered) */
  readonly builtIn?: boolean;

  /**
   * The main React component rendered for sessions of this type.
   *
   * Components receive {@link TerminalTypeClientComponentProps} but may
   * accept additional optional props — callers pass only what the
   * component needs.
   */
  readonly component: ComponentType<TerminalTypeClientComponentProps>;

  /**
   * Optional React component rendered when the session's main process
   * exits. Only shown if the server plugin's `onSessionExit` returns
   * `showExitScreen: true`.
   */
  readonly exitScreen?: ComponentType<TerminalTypeExitScreenProps>;

  /**
   * Optional override for how a session's tab title should be derived.
   * Return `null` to fall back to the session's stored name.
   */
  deriveTitle?(session: TerminalSession): string | null;
}
