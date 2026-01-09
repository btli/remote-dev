/**
 * OpenCode Transcript Parser.
 *
 * Parses OpenCode CLI logs.
 * Note: This is a stub implementation - OpenCode log format needs research.
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

export class OpenCodeTranscriptParser implements TranscriptParser {
  private readonly openCodeDir: string;

  constructor() {
    // OpenCode stores config in ~/.config/opencode
    this.openCodeDir = path.join(homedir(), ".config", "opencode");
  }

  async canParse(transcriptPath: string): Promise<boolean> {
    return (
      transcriptPath.includes("opencode") &&
      (transcriptPath.endsWith(".jsonl") || transcriptPath.endsWith(".log"))
    );
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
    const filesRead: string[] = [];
    const filesModified: string[] = [];
    const errorsEncountered: TranscriptError[] = [];

    const startedAt = new Date();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // OpenCode may use OpenAI-style format
        if (entry.role && entry.content) {
          messages.push({
            role: entry.role as "user" | "assistant" | "system",
            content:
              typeof entry.content === "string"
                ? entry.content
                : JSON.stringify(entry.content),
            timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
          });
        }

        // Check for tool calls
        if (entry.tool_calls) {
          for (const tc of entry.tool_calls) {
            toolCalls.push({
              id: tc.id ?? crypto.randomUUID(),
              name: tc.function?.name ?? tc.name ?? "unknown",
              input: tc.function?.arguments
                ? JSON.parse(tc.function.arguments)
                : tc.input ?? {},
              success: true,
              timestamp: new Date(),
            });
          }
        }
      } catch {
        // Plain text fallback
        if (line.trim()) {
          messages.push({
            role: "assistant",
            content: line,
            timestamp: new Date(),
          });
        }
      }
    }

    return {
      sessionId: options?.sessionId ?? path.basename(transcriptPath, path.extname(transcriptPath)),
      agentProvider: "opencode",
      projectPath: options?.projectPath ?? "",
      messages,
      toolCalls,
      commandsRun,
      filesRead,
      filesModified,
      errorsEncountered,
      totalTurns: messages.filter((m) => m.role === "assistant").length,
      totalTokens: 0,
      duration: 0,
      backtracking: 0,
      retries: 0,
      contextSwitches: 0,
      toolFailures: 0,
      startedAt,
      endedAt: null,
    };
  }

  async findTranscripts(projectPath: string): Promise<string[]> {
    try {
      const logsDir = path.join(this.openCodeDir, "logs");
      const files = await fs.readdir(logsDir);
      const transcripts: string[] = [];

      for (const file of files) {
        if (file.endsWith(".jsonl") || file.endsWith(".log")) {
          transcripts.push(path.join(logsDir, file));
        }
      }

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
}
