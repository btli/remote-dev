/**
 * Common types for transcript parsing.
 */

import type { AgentProvider } from "@/types/agent";

export interface ParsedTranscript {
  sessionId: string;
  agentProvider: AgentProvider;
  projectPath: string;

  // Conversation flow
  messages: TranscriptMessage[];
  toolCalls: ToolCall[];

  // Patterns
  commandsRun: string[];
  filesRead: string[];
  filesModified: string[];
  errorsEncountered: TranscriptError[];

  // Metrics
  totalTurns: number;
  totalTokens: number;
  duration: number; // seconds

  // Behavioral patterns
  backtracking: number; // Times agent undid work
  retries: number; // Same action repeated
  contextSwitches: number; // Changed approach
  toolFailures: number;

  // Timestamps
  startedAt: Date;
  endedAt: Date | null;
}

export interface TranscriptMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  tokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: unknown;
  success: boolean;
  error?: string;
  duration?: number;
  timestamp: Date;
}

export interface TranscriptError {
  type: "build" | "test" | "runtime" | "type" | "lint" | "other";
  message: string;
  source: string; // File or command
  resolved: boolean;
  turnsToResolve?: number;
  timestamp: Date;
}

export interface TranscriptParser {
  /**
   * Check if parser can handle this transcript.
   */
  canParse(transcriptPath: string): Promise<boolean>;

  /**
   * Parse a transcript file.
   */
  parse(
    transcriptPath: string,
    options?: {
      sessionId?: string;
      projectPath?: string;
    }
  ): Promise<ParsedTranscript>;

  /**
   * Find transcript files for a project.
   */
  findTranscripts(projectPath: string): Promise<string[]>;
}

/**
 * Error classification patterns.
 */
export const ERROR_PATTERNS = {
  type: [
    /error TS\d+/i,
    /Type '.*' is not assignable/i,
    /Property '.*' does not exist/i,
    /Cannot find name/i,
  ],
  build: [
    /Build failed/i,
    /Compilation failed/i,
    /error: /i,
    /ENOENT/i,
  ],
  test: [
    /FAIL/i,
    /AssertionError/i,
    /Expected.*but got/i,
    /test failed/i,
  ],
  lint: [
    /ESLint/i,
    /Prettier/i,
    /warning:/i,
    /error:/i,
  ],
  runtime: [
    /Error:/i,
    /Exception:/i,
    /Uncaught/i,
    /throw/i,
  ],
};

/**
 * Classify an error message.
 */
export function classifyError(message: string): TranscriptError["type"] {
  for (const [type, patterns] of Object.entries(ERROR_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return type as TranscriptError["type"];
      }
    }
  }
  return "other";
}
