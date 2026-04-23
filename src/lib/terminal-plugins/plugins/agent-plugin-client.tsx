/**
 * AgentPlugin (client half) — React rendering for AI agent sessions.
 *
 * Shares the same underlying `TerminalWithKeyboard` component as the shell
 * plugin — the historical SessionManager default branch handled both shell
 * and agent the same way, with agent-specific details (voice mic, exit
 * overlay) scoped inside `TerminalWithKeyboard` via `session.terminalType`.
 *
 * @see ./agent-plugin-server.ts for lifecycle.
 */

import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
  TerminalTypeExitScreenProps,
} from "@/types/terminal-type-client";
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

/**
 * Agent session component. Currently identical in shape to the shell
 * component — exit overlay, voice mic, and mobile UI are all handled by
 * `TerminalWithKeyboard` based on `session.terminalType`.
 */
function AgentSessionComponent(props: TerminalTypeClientComponentProps) {
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

/**
 * Standalone agent exit screen component adapter. Adapts the flat
 * `AgentExitScreen` props to the {@link TerminalTypeExitScreenProps}
 * contract so client plugins share a consistent exit-screen shape.
 */
function AgentExitScreenAdapter({
  session,
  exitInfo,
  onRestart,
  onClose,
}: TerminalTypeExitScreenProps) {
  return (
    <AgentExitScreen
      sessionId={session.id}
      sessionName={session.name}
      exitCode={exitInfo.exitCode}
      exitedAt={exitInfo.exitedAt.toISOString()}
      restartCount={session.agentRestartCount ?? 0}
      onRestart={onRestart}
      onClose={onClose}
    />
  );
}

/** Default agent client plugin instance */
export const AgentClientPlugin: TerminalTypeClientPlugin = {
  type: "agent",
  displayName: "AI Agent",
  description: "AI coding assistant (Claude, Codex, Gemini, etc.)",
  icon: Sparkles,
  priority: 90,
  builtIn: true,
  component: AgentSessionComponent,
  exitScreen: AgentExitScreenAdapter,
};
