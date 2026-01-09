/**
 * Claude Code Transcript Parser.
 *
 * Parses Claude Code's JSONL conversation logs from:
 * ~/.claude/projects/{project-hash}/*.jsonl
 *
 * Note: This parser only reads files - no shell execution.
 */

import { promises as fs } from "fs";
import * as path from "path";
import { homedir } from "os";
import type {
  TranscriptParser,
  ParsedTranscript,
  TranscriptMessage,
  ToolCall,
  TranscriptError,
} from "./types";
import { classifyError } from "./types";

interface ClaudeJsonlEntry {
  type: "user" | "assistant" | "system" | "tool_use" | "tool_result";
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  };
  timestamp?: string;
  uuid?: string;
  toolUseId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
  costUSD?: number;
  durationMs?: number;
  cwd?: string;
  sessionId?: string;
}

export class ClaudeTranscriptParser implements TranscriptParser {
  private readonly claudeDir: string;

  constructor() {
    this.claudeDir = path.join(homedir(), ".claude");
  }

  async canParse(transcriptPath: string): Promise<boolean> {
    return transcriptPath.endsWith(".jsonl") &&
           transcriptPath.includes(".claude");
  }

  async parse(
    transcriptPath: string,
    options?: { sessionId?: string; projectPath?: string }
  ): Promise<ParsedTranscript> {
    const content = await fs.readFile(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const messages: TranscriptMessage[] = [];
    const toolCalls: ToolCall[] = [];
    const commandsRun: string[] = [];
    const filesRead = new Set<string>();
    const filesModified = new Set<string>();
    const errorsEncountered: TranscriptError[] = [];

    let totalTokens = 0;
    let startedAt: Date | null = null;
    let endedAt: Date | null = null;
    let projectPath = options?.projectPath ?? "";
    let sessionId = options?.sessionId ?? "";

    // Track for behavioral patterns
    const actionHistory: string[] = [];
    let backtracking = 0;
    let retries = 0;
    let contextSwitches = 0;
    let toolFailures = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ClaudeJsonlEntry;
        const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();

        // Track session info
        if (entry.sessionId) sessionId = entry.sessionId;
        if (entry.cwd) projectPath = entry.cwd;

        // Track timestamps
        if (!startedAt) startedAt = timestamp;
        endedAt = timestamp;

        // Parse by entry type
        switch (entry.type) {
          case "user":
          case "assistant":
          case "system": {
            const messageContent = this.extractMessageContent(entry.message?.content);
            if (messageContent) {
              messages.push({
                role: entry.type as "user" | "assistant" | "system",
                content: messageContent,
                timestamp,
              });

              // Check for errors in assistant messages
              if (entry.type === "assistant") {
                const errors = this.extractErrors(messageContent);
                for (const error of errors) {
                  errorsEncountered.push({
                    ...error,
                    timestamp,
                    resolved: false,
                  });
                }
              }
            }
            break;
          }

          case "tool_use": {
            const toolCall: ToolCall = {
              id: entry.toolUseId ?? crypto.randomUUID(),
              name: entry.toolName ?? "unknown",
              input: (entry.input as Record<string, unknown>) ?? {},
              success: true,
              timestamp,
            };
            toolCalls.push(toolCall);

            // Track specific tool patterns
            const toolName = entry.toolName?.toLowerCase() ?? "";
            const input = entry.input as Record<string, unknown>;

            if (toolName.includes("bash")) {
              const command = input.command as string;
              if (command) {
                commandsRun.push(command);
                actionHistory.push(`cmd:${command.substring(0, 50)}`);
              }
            }

            if (toolName.includes("read")) {
              const filePath = input.path as string ?? input.file_path as string;
              if (filePath) filesRead.add(filePath);
            }

            if (toolName.includes("write") || toolName.includes("edit")) {
              const filePath = input.path as string ?? input.file_path as string;
              if (filePath) filesModified.add(filePath);
            }
            break;
          }

          case "tool_result": {
            // Find corresponding tool call and update it
            if (entry.toolUseId) {
              const toolCall = toolCalls.find((tc) => tc.id === entry.toolUseId);
              if (toolCall) {
                toolCall.output = entry.output;
                toolCall.success = !entry.isError;
                toolCall.duration = entry.durationMs;

                if (entry.isError) {
                  toolFailures++;
                  const errorMsg = typeof entry.output === "string"
                    ? entry.output
                    : JSON.stringify(entry.output);
                  errorsEncountered.push({
                    type: classifyError(errorMsg),
                    message: errorMsg.substring(0, 500),
                    source: toolCall.name,
                    resolved: false,
                    timestamp,
                  });
                }
              }
            }
            break;
          }
        }

        // Track cost/tokens if available
        if (entry.costUSD) {
          // Rough estimate: $0.003 per 1K tokens
          totalTokens += Math.round((entry.costUSD / 0.003) * 1000);
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Detect behavioral patterns
    const patterns = this.detectBehavioralPatterns(actionHistory, errorsEncountered);
    backtracking = patterns.backtracking;
    retries = patterns.retries;
    contextSwitches = patterns.contextSwitches;

    // Mark resolved errors (if same error doesn't appear again)
    this.markResolvedErrors(errorsEncountered);

    const duration = startedAt && endedAt
      ? (endedAt.getTime() - startedAt.getTime()) / 1000
      : 0;

    return {
      sessionId,
      agentProvider: "claude",
      projectPath,
      messages,
      toolCalls,
      commandsRun,
      filesRead: Array.from(filesRead),
      filesModified: Array.from(filesModified),
      errorsEncountered,
      totalTurns: messages.filter((m) => m.role === "assistant").length,
      totalTokens,
      duration,
      backtracking,
      retries,
      contextSwitches,
      toolFailures,
      startedAt: startedAt ?? new Date(),
      endedAt,
    };
  }

  async findTranscripts(projectPath: string): Promise<string[]> {
    const projectsDir = path.join(this.claudeDir, "projects");

    try {
      const dirs = await fs.readdir(projectsDir);
      const transcripts: string[] = [];

      for (const dir of dirs) {
        const fullPath = path.join(projectsDir, dir);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
          // Check if this project matches
          const files = await fs.readdir(fullPath);
          for (const file of files) {
            if (file.endsWith(".jsonl")) {
              const filePath = path.join(fullPath, file);
              // Optionally filter by project path in content
              transcripts.push(filePath);
            }
          }
        }
      }

      // Sort by modification time (newest first)
      const withStats = await Promise.all(
        transcripts.map(async (t) => ({
          path: t,
          mtime: (await fs.stat(t)).mtime,
        }))
      );

      return withStats
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
        .map((s) => s.path);
    } catch {
      return [];
    }
  }

  private extractMessageContent(
    content: string | Array<{ type: string; text?: string }> | undefined
  ): string {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text)
        .join("\n");
    }
    return "";
  }

  private extractErrors(content: string): Omit<TranscriptError, "timestamp" | "resolved">[] {
    const errors: Omit<TranscriptError, "timestamp" | "resolved">[] = [];

    // Common error patterns
    const patterns = [
      { regex: /error TS\d+: (.+)/gi, type: "type" as const },
      { regex: /Error: (.+)/gi, type: "runtime" as const },
      { regex: /FAIL (.+)/gi, type: "test" as const },
      { regex: /Build failed: (.+)/gi, type: "build" as const },
    ];

    for (const { regex, type } of patterns) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        errors.push({
          type,
          message: match[1].substring(0, 200),
          source: "assistant",
        });
      }
    }

    return errors;
  }

  private detectBehavioralPatterns(
    actionHistory: string[],
    _errors: TranscriptError[]
  ): { backtracking: number; retries: number; contextSwitches: number } {
    let backtracking = 0;
    let retries = 0;
    let contextSwitches = 0;

    // Detect retries (same action repeated)
    const actionCounts = new Map<string, number>();
    for (const action of actionHistory) {
      const count = (actionCounts.get(action) ?? 0) + 1;
      actionCounts.set(action, count);
      if (count > 1) retries++;
    }

    // Detect backtracking (undo patterns)
    const undoPatterns = ["git checkout", "git reset", "rm ", "revert"];
    for (const action of actionHistory) {
      if (undoPatterns.some((p) => action.includes(p))) {
        backtracking++;
      }
    }

    // Detect context switches (changing approach)
    let lastFilePrefix = "";
    for (const action of actionHistory) {
      if (action.startsWith("cmd:")) {
        const currentPrefix = action.substring(0, 20);
        if (lastFilePrefix && !currentPrefix.includes(lastFilePrefix.substring(4, 10))) {
          contextSwitches++;
        }
        lastFilePrefix = currentPrefix;
      }
    }

    return { backtracking, retries, contextSwitches };
  }

  private markResolvedErrors(errors: TranscriptError[]): void {
    // Group errors by message
    const errorCounts = new Map<string, number>();
    for (const error of errors) {
      const key = error.message.substring(0, 100);
      errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
    }

    // Mark resolved if error appears only once (was fixed)
    for (const error of errors) {
      const key = error.message.substring(0, 100);
      if ((errorCounts.get(key) ?? 0) === 1) {
        error.resolved = true;
      }
    }
  }
}
