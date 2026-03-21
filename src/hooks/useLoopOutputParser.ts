/**
 * useLoopOutputParser — Parses raw terminal output into structured chat messages
 *
 * Buffers incoming chunks until complete lines are available.
 * Attempts JSON.parse() on each line (Claude Code stream-json format).
 * Falls back to ANSI-stripped text blocks for non-JSON output.
 *
 * Used by LoopChatPane to convert hidden terminal output into chat bubbles.
 */

import { useCallback, useEffect, useRef } from "react";
import type {
  ChatMessage,
  ChatMessageRole,
  StreamJsonEvent,
} from "@/types/loop-agent";

/** ANSI escape sequence regex — covers CSI, OSC, and single-char escapes */
const ANSI_REGEX =
  /(\u009B|\u001B\[)[0-?]*[ -/]*[@-~]|\u001B[@-Z\\-_]|\u001B\][\s\S]*?\u0007|\u001B\(B/g;

/** Strip ANSI escape sequences from a string */
function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, "");
}

/** Generate a unique message ID */
function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Extract text content from a stream-json message's content array */
function extractTextContent(event: StreamJsonEvent): string | null {
  const text = event.message?.content
    ?.filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
  return text?.trim() ? text : null;
}

/**
 * Parse a stream-json event into a ChatMessage (or null if not displayable)
 */
function parseStreamJsonEvent(event: StreamJsonEvent): ChatMessage | null {
  const now = new Date();

  switch (event.type) {
    case "assistant": {
      const text = extractTextContent(event);
      if (!text) return null;
      return {
        id: generateId(),
        role: "agent",
        kind: "text",
        content: text,
        timestamp: now,
      };
    }

    case "tool_use": {
      return {
        id: generateId(),
        role: "agent",
        kind: "tool_call",
        content: event.tool_name
          ? `Using ${event.tool_name}`
          : "Using tool",
        toolName: event.tool_name,
        isCollapsed: true,
        timestamp: now,
      };
    }

    case "tool_result": {
      return {
        id: generateId(),
        role: "agent",
        kind: "tool_result",
        content: stripAnsi(event.content ?? ""),
        toolName: event.tool_name,
        isCollapsed: true,
        timestamp: now,
      };
    }

    case "user": {
      // Skip user events — user messages are added optimistically by the chat
      // input handler. Parsing them here would create duplicates.
      return null;
    }

    case "result": {
      if (!event.result?.trim()) return null;
      return {
        id: generateId(),
        role: "agent",
        kind: "text",
        content: event.result,
        timestamp: now,
      };
    }

    case "system": {
      if (event.subtype === "init") return null;
      const text = extractTextContent(event);
      if (!text) return null;
      return {
        id: generateId(),
        role: "system",
        kind: "text",
        content: text,
        timestamp: now,
      };
    }

    default:
      return null;
  }
}

/**
 * Try to parse a line as JSON (stream-json format)
 * Returns a ChatMessage if successful, null otherwise
 */
function tryParseJsonLine(line: string): ChatMessage | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;

  try {
    const event = JSON.parse(trimmed) as StreamJsonEvent;
    if (!event.type) return null;
    return parseStreamJsonEvent(event);
  } catch {
    return null;
  }
}

/**
 * Create a text message from a raw terminal line
 */
function createTextMessage(text: string): ChatMessage | null {
  const stripped = stripAnsi(text).trim();
  if (!stripped) return null;

  // Detect user input echoed back (lines starting with ❯ or > prompt)
  const role: ChatMessageRole = /^[❯>$#]\s/.test(stripped)
    ? "user"
    : "agent";

  return {
    id: generateId(),
    role,
    kind: "text",
    content: stripped,
    timestamp: new Date(),
  };
}

interface UseLoopOutputParserOptions {
  /** Called when new messages are parsed from output */
  onMessages: (messages: ChatMessage[]) => void;
  /** Whether to use stream-json parsing (Claude) or text fallback */
  useStreamJson?: boolean;
}

/**
 * Hook that parses raw terminal output chunks into structured chat messages
 *
 * Usage:
 *   const { handleOutput, reset } = useLoopOutputParser({
 *     onMessages: (msgs) => setMessages(prev => [...prev, ...msgs]),
 *   });
 *
 *   // In Terminal onOutput callback:
 *   onOutput={handleOutput}
 */
export function useLoopOutputParser({
  onMessages,
  useStreamJson = true,
}: UseLoopOutputParserOptions) {
  /** Line buffer for incomplete chunks */
  const lineBufferRef = useRef<string>("");
  /** Debounce timer for text-mode batching */
  const textBatchRef = useRef<string[]>([]);
  const textTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Flush accumulated text lines as a single message */
  const flushTextBatch = useCallback(() => {
    const batch = textBatchRef.current;
    textBatchRef.current = [];
    textTimerRef.current = null;

    if (batch.length === 0) return;

    const combined = batch.join("\n");
    const msg = createTextMessage(combined);
    if (msg) {
      onMessages([msg]);
    }
  }, [onMessages]);

  /** Process a raw output chunk from the terminal */
  const handleOutput = useCallback(
    (data: string) => {
      const buffer = lineBufferRef.current + data;
      const lines = buffer.split("\n");

      // Last element is incomplete (no trailing newline) — keep in buffer
      lineBufferRef.current = lines.pop() ?? "";

      const messages: ChatMessage[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        if (useStreamJson) {
          // Try JSON parse first
          const jsonMsg = tryParseJsonLine(line);
          if (jsonMsg) {
            messages.push(jsonMsg);
            continue;
          }
        }

        // Text fallback — batch lines and debounce into single messages
        textBatchRef.current.push(line);
        if (textTimerRef.current) clearTimeout(textTimerRef.current);
        textTimerRef.current = setTimeout(flushTextBatch, 100);
      }

      if (messages.length > 0) {
        onMessages(messages);
      }
    },
    [onMessages, useStreamJson, flushTextBatch]
  );

  /** Reset the parser state (e.g., on session restart) */
  const reset = useCallback(() => {
    lineBufferRef.current = "";
    textBatchRef.current = [];
    if (textTimerRef.current) {
      clearTimeout(textTimerRef.current);
      textTimerRef.current = null;
    }
  }, []);

  // Clean up pending debounce timer on unmount
  useEffect(() => {
    return () => {
      if (textTimerRef.current) {
        clearTimeout(textTimerRef.current);
      }
    };
  }, []);

  return { handleOutput, reset };
}
