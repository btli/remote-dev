/**
 * LoopAgentPlugin (client half) — chat-first React rendering for loop
 * agent sessions.
 *
 * @see ./loop-agent-plugin-server.ts for lifecycle.
 */

import { MessageCircle } from "lucide-react";
import type {
  TerminalTypeClientPlugin,
  TerminalTypeClientComponentProps,
} from "@/types/terminal-type-client";
import { LoopChatPane } from "@/components/loop/LoopChatPane";

/**
 * Loop agent session component — delegates to the existing `LoopChatPane`
 * and forwards all the cross-cutting callbacks SessionManager used to
 * pass inline.
 */
function LoopAgentSessionComponent({
  session,
  wsUrl,
  fontSize,
  fontFamily,
  scrollback,
  tmuxHistoryLimit,
  isActive,
  environmentVars,
  onAgentActivityStatus,
  onBeadsIssuesUpdated,
  onSessionRenamed,
  onNotification,
  onSessionStatus,
  onSessionProgress,
  onSessionClose,
  onPeerMessageCreated,
  onChannelMessageCreated,
  onThreadReplyCreated,
  onChannelCreated,
}: TerminalTypeClientComponentProps) {
  return (
    <LoopChatPane
      session={session}
      wsUrl={wsUrl ?? ""}
      fontSize={fontSize}
      fontFamily={fontFamily}
      scrollback={scrollback}
      tmuxHistoryLimit={tmuxHistoryLimit}
      isActive={isActive}
      environmentVars={environmentVars}
      onAgentActivityStatus={onAgentActivityStatus}
      onBeadsIssuesUpdated={onBeadsIssuesUpdated}
      onSessionRenamed={onSessionRenamed}
      onNotification={onNotification}
      onSessionStatus={onSessionStatus}
      onSessionProgress={onSessionProgress}
      onSessionClose={onSessionClose}
      onPeerMessageCreated={onPeerMessageCreated}
      onChannelMessageCreated={onChannelMessageCreated}
      onThreadReplyCreated={onThreadReplyCreated}
      onChannelCreated={onChannelCreated}
    />
  );
}

/** Default loop agent client plugin instance */
export const LoopAgentClientPlugin: TerminalTypeClientPlugin = {
  type: "loop",
  displayName: "Loop Agent",
  description: "Chat-first AI agent with loop scheduling",
  icon: MessageCircle,
  priority: 85,
  builtIn: true,
  component: LoopAgentSessionComponent,
};
