/**
 * ShellPlugin (client half) — React rendering for standard shell sessions.
 *
 * Renders via `TerminalWithKeyboard`, which wraps xterm.js with the mobile
 * input bar + session-ended overlay used by every tmux-backed session type
 * (shell and agent). This plugin is dispatched from
 * `SessionManager.tsx` via the client registry.
 *
 * @see ./shell-plugin-server.ts for lifecycle.
 */

import dynamic from "next/dynamic";
import { Terminal as TerminalIcon } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import type { TerminalWithKeyboardRef } from "@/components/terminal/TerminalWithKeyboard";

// Dynamically import TerminalWithKeyboard to avoid SSR issues with xterm.
const TerminalWithKeyboard = dynamic(
  () =>
    import("@/components/terminal/TerminalWithKeyboard").then(
      (mod) => mod.TerminalWithKeyboard
    ),
  { ssr: false }
);

/**
 * Shell session component. Mirrors the historical SessionManager default
 * branch — passes the full set of cross-cutting callbacks through to
 * `TerminalWithKeyboard`.
 */
function ShellSessionComponent(props: TerminalTypeClientComponentProps) {
  const {
    session,
    wsUrl,
    fontSize,
    fontFamily,
    scrollback,
    tmuxHistoryLimit,
    notificationsEnabled,
    isRecording,
    isActive,
    environmentVars,
    onOutput,
    onDimensionsChange,
    onSessionRestart,
    onSessionDelete,
    onAgentActivityStatus,
    onBeadsIssuesUpdated,
    onSessionRenamed,
    onNotification,
    onSessionStatus,
    onSessionProgress,
    onPeerMessageCreated,
    onChannelMessageCreated,
    onThreadReplyCreated,
    onChannelCreated,
    registerRef,
  } = props;

  return (
    <TerminalWithKeyboard
      ref={(ref: TerminalWithKeyboardRef | null) => {
        registerRef?.(session.id, ref);
      }}
      sessionId={session.id}
      tmuxSessionName={session.tmuxSessionName}
      sessionName={session.name}
      projectPath={session.projectPath}
      session={session}
      wsUrl={wsUrl ?? undefined}
      fontSize={fontSize}
      fontFamily={fontFamily}
      scrollback={scrollback}
      tmuxHistoryLimit={tmuxHistoryLimit}
      notificationsEnabled={notificationsEnabled}
      isRecording={isRecording}
      isActive={isActive}
      environmentVars={environmentVars}
      onOutput={onOutput}
      onDimensionsChange={onDimensionsChange}
      onSessionRestart={
        onSessionRestart
          ? async () => {
              await onSessionRestart();
            }
          : undefined
      }
      onSessionDelete={
        onSessionDelete
          ? async (deleteWorktree) => {
              await onSessionDelete(deleteWorktree);
            }
          : undefined
      }
      onAgentActivityStatus={onAgentActivityStatus}
      onBeadsIssuesUpdated={onBeadsIssuesUpdated}
      onSessionRenamed={onSessionRenamed}
      onNotification={onNotification}
      onSessionStatus={onSessionStatus}
      onSessionProgress={onSessionProgress}
      onPeerMessageCreated={onPeerMessageCreated}
      onChannelMessageCreated={onChannelMessageCreated}
      onThreadReplyCreated={onThreadReplyCreated}
      onChannelCreated={onChannelCreated}
    />
  );
}

/** Default shell client plugin instance */
export const ShellClientPlugin: TerminalTypeClientPlugin = {
  type: "shell",
  displayName: "Terminal",
  description: "Standard terminal with your default shell",
  icon: TerminalIcon,
  priority: 100,
  builtIn: true,
  component: ShellSessionComponent,
};
