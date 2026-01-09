/**
 * Codex CLI Transcript Parser.
 *
 * Parses OpenAI Codex CLI logs.
 * Note: This is a stub implementation - Codex CLI log format needs research.
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

export class CodexTranscriptParser implements TranscriptParser {
  private readonly codexDir: string;

  constructor() {
    // Codex CLI typically stores logs in ~/.codex
    this.codexDir = path.join(homedir(), ".codex");
  }

  async canParse(transcriptPath: string): Promise<boolean> {
    // Codex logs may use different extensions
    return (
      transcriptPath.includes(".codex") &&
      (transcriptPath.endsWith(".jsonl") || transcriptPath.endsWith(".log"))
    );
  }

  async parse(
    transcriptPath: string,
    options?: { sessionId?: string; projectPath?: string }
  ): Promise<ParsedTranscript> {
    // Stub implementation - returns minimal parsed transcript
    const content = await fs.readFile(transcriptPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    const messages: TranscriptMessage[] = [];
    const toolCalls: ToolCall[] = [];
    const commandsRun: string[] = [];
    const filesRead: string[] = [];
    const filesModified: string[] = [];
    const errorsEncountered: TranscriptError[] = [];

    const startedAt = new Date();

    // Basic line parsing - actual implementation would parse Codex format
    for (const line of lines) {
      try {
        // Attempt to parse as JSON if possible
        const entry = JSON.parse(line);

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
      } catch {
        // If not JSON, treat as plain text message
        if (line.startsWith(">")) {
          messages.push({
            role: "user",
            content: line.substring(1).trim(),
            timestamp: new Date(),
          });
        } else if (line.trim()) {
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
      agentProvider: "codex",
      projectPath: options?.projectPath ?? "",
      messages,
      toolCalls,
      commandsRun,
      filesRead,
      filesModified,
      errorsEncountered,
      totalTurns: messages.filter((m) => m.role === "assistant").length,
      totalTokens: 0, // Would need Codex-specific token counting
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
      const files = await fs.readdir(this.codexDir);
      const transcripts: string[] = [];

      for (const file of files) {
        if (file.endsWith(".jsonl") || file.endsWith(".log")) {
          transcripts.push(path.join(this.codexDir, file));
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
}
