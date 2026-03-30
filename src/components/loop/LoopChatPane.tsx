"use client";

/**
 * LoopChatPane — Main orchestrator for loop agent sessions
 *
 * Assembles the chat-first UI for loop sessions:
 * - Hidden Terminal component maintaining WebSocket/PTY connection
 * - Output parser converting terminal output to chat messages
 * - Message list with auto-scroll
 * - Chat input bar for user messages
 * - Status bar with agent status and terminal toggle
 * - Terminal drawer for raw terminal view
 * - Loop scheduler for monitoring sessions
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, type TerminalRef } from "@/components/terminal/Terminal";
import { LoopMessageBubble } from "./LoopMessageBubble";
import { LoopChatInput } from "./LoopChatInput";
import { LoopStatusBar } from "./LoopStatusBar";
import { TerminalDrawer } from "./TerminalDrawer";
import { useLoopOutputParser } from "@/hooks/useLoopOutputParser";
import { useLoopScheduler } from "@/hooks/useLoopScheduler";
import { useSessionContext } from "@/contexts/SessionContext";
import type { TerminalSession } from "@/types/session";
import type { ChatMessage, LoopAgentMetadata } from "@/types/loop-agent";
import type { ConnectionStatus } from "@/types/terminal";

/** Maximum number of messages to keep in the chat — prevents unbounded memory growth for long-running sessions */
const MAX_MESSAGES = 2000;

function getInputPlaceholder(agentExited: boolean, isMonitoring: boolean): string {
  if (agentExited) return "Agent has exited — restart to continue";
  if (isMonitoring) return "Send a message between iterations...";
  return "Type a message...";
}

interface LoopChatPaneProps {
  session: TerminalSession;
  wsUrl: string;
  fontSize?: number;
  fontFamily?: string;
  scrollback?: number;
  tmuxHistoryLimit?: number;
  isActive?: boolean;
  environmentVars?: Record<string, string> | null;
  onAgentActivityStatus?: (sessionId: string, status: string) => void;
  onAgentTodosUpdated?: (sessionId: string) => void;
  onSessionRenamed?: (sessionId: string, name: string) => void;
  onNotification?: (notification: Record<string, unknown>) => void;
  onSessionStatus?: (
    sessionId: string,
    key: string,
    indicator: import("@/types/terminal-type").SessionStatusIndicator | null
  ) => void;
  onSessionProgress?: (
    sessionId: string,
    progress: import("@/types/terminal-type").SessionProgress | null
  ) => void;
  onSessionClose?: (sessionId: string) => void;
  onAgentStateChange?: (
    sessionId: string,
    state: "running" | "exited" | "restarting" | "closed"
  ) => void;
}

export function LoopChatPane({
  session,
  wsUrl,
  fontSize = 14,
  fontFamily = "'JetBrainsMono Nerd Font Mono', monospace",
  scrollback = 10000,
  tmuxHistoryLimit = 50000,
  isActive = false,
  environmentVars,
  onAgentActivityStatus,
  onAgentTodosUpdated,
  onSessionRenamed,
  onNotification,
  onSessionStatus,
  onSessionProgress,
  onSessionClose,
  onAgentStateChange,
}: LoopChatPaneProps) {
  const { getAgentActivityStatus } = useSessionContext();
  const activityStatus = getAgentActivityStatus(session.id);

  const terminalRef = useRef<TerminalRef>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [terminalVisible, setTerminalVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentIteration, setCurrentIteration] = useState(0);
  const [isUserScrolled, setIsUserScrolled] = useState(false);
  const [agentExited, setAgentExited] = useState(false);
  const [hasGreeted, setHasGreeted] = useState(false);

  // Extract loop config from session metadata
  const metadata = session.typeMetadata as LoopAgentMetadata | null;
  const loopConfig = metadata?.loopConfig ?? {
    loopType: "conversational" as const,
  };
  const isMonitoring = loopConfig.loopType === "monitoring";
  const useStreamJson = (session.agentProvider ?? "claude") === "claude";

  // Parse terminal output into chat messages
  const { handleOutput, reset: resetParser } = useLoopOutputParser({
    onMessages: useCallback((newMessages: ChatMessage[]) => {
      setMessages((prev) => {
        const combined = [...prev, ...newMessages];
        // Cap message list to prevent unbounded memory growth
        if (combined.length > MAX_MESSAGES) {
          return combined.slice(combined.length - MAX_MESSAGES);
        }
        return combined;
      });
    }, []),
    useStreamJson,
  });

  // Send a message to the agent via WebSocket
  const sendMessage = useCallback(
    (text: string) => {
      const ws = terminalRef.current?.getWebSocket();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data: `${text}\n` }));
      }
    },
    []
  );

  // Handle user sending a chat message
  const handleUserSend = useCallback(
    (text: string) => {
      // Add user message optimistically
      const userMsg: ChatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        kind: "text",
        content: text,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsUserScrolled(false);

      // Send to agent
      sendMessage(text);
    },
    [sendMessage]
  );

  // Loop scheduler for monitoring mode
  useLoopScheduler({
    enabled: isMonitoring && !isPaused && !agentExited,
    intervalSeconds: loopConfig.intervalSeconds ?? 300,
    prompt: loopConfig.promptTemplate ?? "",
    agentStatus: activityStatus,
    maxIterations: loopConfig.maxIterations,
    currentIteration,
    sendMessage,
    onPromptFired: useCallback(
      (iterationNumber: number) => {
        setCurrentIteration(iterationNumber);
        // Add iteration marker to chat
        const marker: ChatMessage = {
          id: `iter-${iterationNumber}`,
          role: "system",
          kind: "iteration_marker",
          content: `Iteration ${iterationNumber}`,
          iterationNumber,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, marker]);
      },
      []
    ),
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (!isUserScrolled && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [messages, isUserScrolled]);

  // Track user scroll position
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setIsUserScrolled(!isAtBottom);
  }, []);

  // Handle agent exit
  const handleAgentExited = useCallback(
    (exitCode: number | null, exitedAt: string) => {
      setAgentExited(true);
      const isSuccess = exitCode === 0;
      const msg: ChatMessage = {
        id: `exit-${Date.now()}`,
        role: "system",
        kind: isSuccess ? "text" : "error",
        content: isSuccess
          ? "Agent completed successfully"
          : `Agent exited with code ${exitCode ?? "unknown"}`,
        timestamp: new Date(exitedAt),
      };
      setMessages((prev) => [...prev, msg]);
      onAgentStateChange?.(session.id, "exited");
    },
    [session.id, onAgentStateChange]
  );

  // Handle agent restart
  const handleRestart = useCallback(() => {
    setAgentExited(false);
    resetParser();
    onAgentStateChange?.(session.id, "restarting");
    terminalRef.current?.restartAgent();
  }, [session.id, onAgentStateChange, resetParser]);

  // Handle agent restarted
  const handleAgentRestarted = useCallback(() => {
    setAgentExited(false);
    const msg: ChatMessage = {
      id: `restart-${Date.now()}`,
      role: "system",
      kind: "text",
      content: "Agent restarted",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, msg]);
    onAgentStateChange?.(session.id, "running");
  }, [session.id, onAgentStateChange]);

  // Handle terminal connection status for initial greeting
  const handleStatusChange = useCallback(
    (status: ConnectionStatus) => {
      if (status === "connected" && !hasGreeted) {
        setHasGreeted(true);
        const greeting: ChatMessage = {
          id: "greeting",
          role: "system",
          kind: "text",
          content: isMonitoring
            ? `Monitoring loop started — firing every ${loopConfig.intervalSeconds ?? 300}s`
            : "Connected — send a message to start",
          timestamp: new Date(),
        };
        setMessages((prev) => [greeting, ...prev]);
      }
    },
    [hasGreeted, isMonitoring, loopConfig.intervalSeconds]
  );

  return (
    <div className="flex flex-col h-full w-full bg-background">
      {/* Status bar */}
      <LoopStatusBar
        sessionName={session.name}
        loopType={loopConfig.loopType ?? "conversational"}
        activityStatus={activityStatus}
        currentIteration={currentIteration}
        terminalVisible={terminalVisible}
        onToggleTerminal={() => setTerminalVisible((v) => !v)}
        isPaused={isPaused}
        onTogglePause={
          isMonitoring ? () => setIsPaused((v) => !v) : undefined
        }
      />

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-h-0 relative">
        {/* Message list */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
          onScroll={handleScroll}
        >
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground/40 text-sm">
              {isMonitoring
                ? "Waiting for first iteration..."
                : "Send a message to begin"}
            </div>
          )}
          {messages.map((msg) => (
            <LoopMessageBubble key={msg.id} message={msg} />
          ))}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />

          {/* Typing indicator */}
          {(activityStatus === "running" ||
            activityStatus === "compacting") && (
            <div className="flex items-center gap-2 pl-8">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
        </div>

        {/* Terminal drawer */}
        <TerminalDrawer
          visible={terminalVisible}
          onClose={() => setTerminalVisible(false)}
        >
          <Terminal
            ref={terminalRef}
            sessionId={session.id}
            tmuxSessionName={session.tmuxSessionName}
            sessionName={session.name}
            projectPath={session.projectPath}
            wsUrl={wsUrl}
            fontSize={fontSize}
            fontFamily={fontFamily}
            scrollback={scrollback}
            tmuxHistoryLimit={tmuxHistoryLimit}
            isActive={isActive}
            environmentVars={environmentVars}
            terminalType="agent"
            onStatusChange={handleStatusChange}
            onOutput={handleOutput}
            onAgentExited={handleAgentExited}
            onAgentRestarted={handleAgentRestarted}
            onAgentActivityStatus={onAgentActivityStatus}
            onAgentTodosUpdated={onAgentTodosUpdated}
            onSessionRenamed={onSessionRenamed}
            onNotification={onNotification}
            onSessionStatus={onSessionStatus}
            onSessionProgress={onSessionProgress}
          />
        </TerminalDrawer>
      </div>

      {/* Input bar */}
      <LoopChatInput
        onSend={handleUserSend}
        disabled={agentExited}
        placeholder={getInputPlaceholder(agentExited, isMonitoring)}
      />

      {/* Agent exited overlay - restart and close options */}
      {agentExited && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2">
          <button
            type="button"
            onClick={handleRestart}
            className="flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2 text-sm shadow-lg hover:bg-card/80 transition-colors"
          >
            <span className="text-primary">Restart Agent</span>
          </button>
          {onSessionClose && (
            <button
              type="button"
              onClick={() => onSessionClose(session.id)}
              className="flex items-center gap-2 bg-card border border-border rounded-full px-4 py-2 text-sm shadow-lg hover:bg-card/80 transition-colors"
            >
              <span className="text-muted-foreground">Close</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
