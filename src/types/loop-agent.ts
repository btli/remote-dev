/**
 * Loop Agent Types — Chat-first agent sessions with loop scheduling
 *
 * Loop sessions render a conversational chat UI instead of raw terminal output.
 * The underlying agent still runs in tmux via PTY, but output is parsed into
 * structured messages displayed as chat bubbles.
 *
 * Two loop modes:
 * - "conversational": Long-running agent chat with anytime user interrupts
 * - "monitoring": Recurring prompt fired on an interval (e.g., every 5m)
 */

import type { AgentProviderType } from "./session";

/**
 * Loop session type
 */
export type LoopType = "conversational" | "monitoring";

/**
 * Chat message role
 */
export type ChatMessageRole = "user" | "agent" | "system";

/**
 * Chat message kind for rendering differentiation
 */
export type ChatMessageKind =
  | "text"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "iteration_marker"
  | "error";

/**
 * A structured chat message parsed from agent output
 */
export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  kind: ChatMessageKind;
  content: string;
  /** Tool name for tool_call/tool_result kinds */
  toolName?: string;
  /** Whether a tool call block is collapsed in the UI */
  isCollapsed?: boolean;
  /** Iteration number (for monitoring loops) */
  iterationNumber?: number;
  timestamp: Date;
}

/**
 * Loop configuration stored in session.typeMetadata
 */
export interface LoopConfig {
  loopType: LoopType;
  /** Interval in seconds for monitoring loops */
  intervalSeconds?: number;
  /** Prompt template to fire on each monitoring iteration */
  promptTemplate?: string;
  /** Maximum iterations for monitoring loops (null = unlimited) */
  maxIterations?: number;
  /** Whether to auto-restart the agent on exit */
  autoRestart?: boolean;
}

/**
 * Metadata stored with loop sessions in session.typeMetadata
 */
export interface LoopAgentMetadata {
  agentProvider: AgentProviderType;
  loopConfig: LoopConfig;
  currentIteration: number;
  /** Whether the terminal drawer is visible */
  terminalVisible: boolean;
}

/**
 * Stream-JSON event types from Claude Code --output-format stream-json
 */
export type StreamJsonEventType =
  | "system"
  | "assistant"
  | "user"
  | "tool_use"
  | "tool_result"
  | "result";

/**
 * A parsed event from Claude Code's stream-json output
 */
export interface StreamJsonEvent {
  type: StreamJsonEventType;
  /** For assistant/system: the text content */
  message?: {
    content?: Array<{
      type: "text" | "tool_use" | "tool_result" | "thinking";
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  /** For tool_use events */
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /** For tool_result events */
  content?: string;
  /** For result events */
  result?: string;
  subtype?: string;
}
