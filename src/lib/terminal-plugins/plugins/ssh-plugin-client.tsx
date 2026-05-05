/**
 * SshPlugin (client half) — React rendering for SSH terminal sessions.
 *
 * Like the agent plugin, the SSH session is a tmux-backed PTY connected
 * via WebSocket to the terminal server. We reuse the shared
 * `TerminalWithKeyboard` component for rendering and adapt the standalone
 * `AgentExitScreen` for the SSH-disconnected exit overlay.
 *
 * @see ./ssh-plugin-server.ts for lifecycle.
 */

import dynamic from "next/dynamic";
import { Server } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
  TerminalTypeExitScreenProps,
} from "@/types/terminal-type-client";
import type { TerminalSession } from "@/types/session";
import type { TerminalWithKeyboardRef } from "@/components/terminal/TerminalWithKeyboard";
import { AgentExitScreen } from "@/components/terminal/AgentExitScreen";

// Dynamically import TerminalWithKeyboard to avoid SSR issues with xterm.
const TerminalWithKeyboard = dynamic(
  () =>
    import("@/components/terminal/TerminalWithKeyboard").then(
      (mod) => mod.TerminalWithKeyboard
    ),
  { ssr: false }
);

function SshSessionComponent(props: TerminalTypeClientComponentProps) {
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

function SshExitScreenAdapter({
  session,
  exitInfo,
  onRestart,
  onClose,
}: TerminalTypeExitScreenProps) {
  // Reuse AgentExitScreen visuals; the copy difference ("SSH disconnected")
  // is small enough to fold into a future variant prop.
  return (
    <AgentExitScreen
      sessionId={session.id}
      sessionName={`SSH disconnected — ${session.name}`}
      exitCode={exitInfo.exitCode}
      exitedAt={exitInfo.exitedAt.toISOString()}
      restartCount={session.agentRestartCount ?? 0}
      onRestart={onRestart}
      onClose={onClose}
    />
  );
}

function deriveTitle(session: TerminalSession): string | null {
  const meta = session.typeMetadata as { host?: string; user?: string } | null;
  if (meta?.host && meta?.user) return `${meta.user}@${meta.host}`;
  return null;
}

export const SshClientPlugin: TerminalTypeClientPlugin = {
  type: "ssh",
  displayName: "SSH",
  description: "Connect to a remote host over SSH",
  icon: Server,
  priority: 80,
  builtIn: true,
  component: SshSessionComponent,
  exitScreen: SshExitScreenAdapter,
  deriveTitle,
};
