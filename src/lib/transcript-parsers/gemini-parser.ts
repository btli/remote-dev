/**
 * Gemini CLI Transcript Parser.
 *
 * Parses Google Gemini CLI logs.
 * Note: This is a stub implementation - Gemini CLI log format needs research.
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

export class GeminiTranscriptParser implements TranscriptParser {
  private readonly geminiDir: string;

  constructor() {
    // Gemini CLI typically stores config/logs in ~/.gemini
    this.geminiDir = path.join(homedir(), ".gemini");
  }

  async canParse(transcriptPath: string): Promise<boolean> {
    return (
      transcriptPath.includes(".gemini") &&
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

    // Basic line parsing - actual implementation would parse Gemini format
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Gemini may use different field names
        const role = entry.role ?? entry.author ?? "assistant";
        const content = entry.content ?? entry.text ?? entry.parts?.[0]?.text;

        if (content) {
          messages.push({
            role: role === "model" ? "assistant" : (role as "user" | "assistant" | "system"),
            content: typeof content === "string" ? content : JSON.stringify(content),
            timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
          });
        }

        // Check for function calls (Gemini's tool use)
        if (entry.functionCall || entry.tool_use) {
          const fc = entry.functionCall ?? entry.tool_use;
          toolCalls.push({
            id: fc.id ?? crypto.randomUUID(),
            name: fc.name ?? "unknown",
            input: fc.args ?? fc.input ?? {},
            success: true,
            timestamp: new Date(),
          });
        }
      } catch {
        // Plain text handling
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
      agentProvider: "gemini",
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
      const files = await fs.readdir(this.geminiDir);
      const transcripts: string[] = [];

      for (const file of files) {
        if (file.endsWith(".jsonl") || file.endsWith(".log")) {
          transcripts.push(path.join(this.geminiDir, file));
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
