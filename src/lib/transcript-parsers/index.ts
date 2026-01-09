/**
 * Transcript Parsers Index.
 *
 * Exports all transcript parsers and provides a factory function
 * to get the appropriate parser for a given transcript file.
 */

export * from "./types";
export { ClaudeTranscriptParser } from "./claude-parser";
export { CodexTranscriptParser } from "./codex-parser";
export { GeminiTranscriptParser } from "./gemini-parser";
export { OpenCodeTranscriptParser } from "./opencode-parser";

import type { TranscriptParser } from "./types";
import { ClaudeTranscriptParser } from "./claude-parser";
import { CodexTranscriptParser } from "./codex-parser";
import { GeminiTranscriptParser } from "./gemini-parser";
import { OpenCodeTranscriptParser } from "./opencode-parser";

/**
 * All available transcript parsers.
 */
export const ALL_PARSERS: TranscriptParser[] = [
  new ClaudeTranscriptParser(),
  new CodexTranscriptParser(),
  new GeminiTranscriptParser(),
  new OpenCodeTranscriptParser(),
];

/**
 * Get a parser that can handle the given transcript file.
 */
export async function getParserForTranscript(
  transcriptPath: string
): Promise<TranscriptParser | null> {
  for (const parser of ALL_PARSERS) {
    if (await parser.canParse(transcriptPath)) {
      return parser;
    }
  }
  return null;
}
