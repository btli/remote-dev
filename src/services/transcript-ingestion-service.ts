/**
 * TranscriptIngestionService - Finds and loads agent transcripts.
 *
 * Responsibilities:
 * - Discover transcripts from all supported agents
 * - Parse transcripts into normalized format
 * - Track which transcripts have been processed
 * - Support incremental ingestion (only new transcripts)
 */

import { promises as fs } from "fs";
import * as path from "path";
import {
  type TranscriptParser,
  type ParsedTranscript,
  ALL_PARSERS,
  getParserForTranscript,
} from "@/lib/transcript-parsers";
import type { AgentProvider } from "@/types/agent";

export interface IngestionResult {
  transcripts: ParsedTranscript[];
  errors: Array<{
    path: string;
    error: string;
  }>;
  stats: {
    total: number;
    successful: number;
    failed: number;
    skipped: number;
  };
}

export interface IngestionOptions {
  /** Only ingest transcripts modified after this date */
  since?: Date;
  /** Limit to specific agent providers */
  providers?: AgentProvider[];
  /** Limit to specific project path */
  projectPath?: string;
  /** Maximum transcripts to process */
  limit?: number;
  /** Skip already processed transcripts */
  skipProcessed?: boolean;
}

/**
 * Service for ingesting agent transcripts.
 */
export class TranscriptIngestionService {
  private readonly parsers: TranscriptParser[];
  private processedPaths: Set<string> = new Set();

  constructor(parsers?: TranscriptParser[]) {
    this.parsers = parsers ?? ALL_PARSERS;
  }

  /**
   * Discover all available transcripts.
   */
  async discoverTranscripts(options?: IngestionOptions): Promise<string[]> {
    const allPaths: string[] = [];

    for (const parser of this.parsers) {
      try {
        const paths = await parser.findTranscripts(options?.projectPath ?? "");
        allPaths.push(...paths);
      } catch {
        // Continue with other parsers if one fails
      }
    }

    // Filter by modification date if specified
    if (options?.since) {
      const filteredPaths: string[] = [];
      for (const p of allPaths) {
        try {
          const stat = await fs.stat(p);
          if (stat.mtime >= options.since) {
            filteredPaths.push(p);
          }
        } catch {
          // Skip inaccessible files
        }
      }
      return filteredPaths;
    }

    return allPaths;
  }

  /**
   * Ingest transcripts from all supported agents.
   */
  async ingest(options?: IngestionOptions): Promise<IngestionResult> {
    const transcripts: ParsedTranscript[] = [];
    const errors: Array<{ path: string; error: string }> = [];
    let skipped = 0;

    // Discover all transcript paths
    let paths = await this.discoverTranscripts(options);

    // Filter out already processed if requested
    if (options?.skipProcessed) {
      const unprocessed = paths.filter((p) => !this.processedPaths.has(p));
      skipped = paths.length - unprocessed.length;
      paths = unprocessed;
    }

    // Apply limit
    if (options?.limit && paths.length > options.limit) {
      paths = paths.slice(0, options.limit);
    }

    // Parse each transcript
    for (const transcriptPath of paths) {
      try {
        const parser = await getParserForTranscript(transcriptPath);
        if (!parser) {
          errors.push({
            path: transcriptPath,
            error: "No suitable parser found",
          });
          continue;
        }

        const parsed = await parser.parse(transcriptPath, {
          projectPath: options?.projectPath,
        });

        // Filter by provider if specified
        if (
          options?.providers &&
          !options.providers.includes(parsed.agentProvider)
        ) {
          continue;
        }

        transcripts.push(parsed);
        this.processedPaths.add(transcriptPath);
      } catch (error) {
        errors.push({
          path: transcriptPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      transcripts,
      errors,
      stats: {
        total: paths.length + skipped,
        successful: transcripts.length,
        failed: errors.length,
        skipped,
      },
    };
  }

  /**
   * Ingest a single transcript file.
   */
  async ingestOne(
    transcriptPath: string,
    options?: { projectPath?: string }
  ): Promise<ParsedTranscript | null> {
    const parser = await getParserForTranscript(transcriptPath);
    if (!parser) {
      return null;
    }

    const parsed = await parser.parse(transcriptPath, options);
    this.processedPaths.add(transcriptPath);
    return parsed;
  }

  /**
   * Get the latest transcript for a session.
   */
  async getLatestForSession(
    sessionId: string,
    projectPath?: string
  ): Promise<ParsedTranscript | null> {
    const paths = await this.discoverTranscripts({ projectPath });

    for (const transcriptPath of paths) {
      const parser = await getParserForTranscript(transcriptPath);
      if (!parser) continue;

      const parsed = await parser.parse(transcriptPath, { projectPath });
      if (parsed.sessionId === sessionId) {
        return parsed;
      }
    }

    return null;
  }

  /**
   * Mark a transcript as processed without parsing.
   */
  markProcessed(transcriptPath: string): void {
    this.processedPaths.add(transcriptPath);
  }

  /**
   * Clear the processed paths cache.
   */
  clearProcessedCache(): void {
    this.processedPaths.clear();
  }

  /**
   * Get statistics about available transcripts.
   */
  async getStats(): Promise<{
    totalAvailable: number;
    totalProcessed: number;
    byProvider: Record<AgentProvider, number>;
  }> {
    const paths = await this.discoverTranscripts();
    const byProvider: Record<AgentProvider, number> = {
      claude: 0,
      codex: 0,
      gemini: 0,
      opencode: 0,
      all: 0, // Aggregate count
    };

    // Count by provider based on path patterns
    for (const p of paths) {
      if (p.includes(".claude")) {
        byProvider.claude++;
      } else if (p.includes(".codex") || p.includes("codex")) {
        byProvider.codex++;
      } else if (p.includes(".gemini") || p.includes("gemini")) {
        byProvider.gemini++;
      } else if (p.includes("opencode")) {
        byProvider.opencode++;
      }
    }

    // Set aggregate count
    byProvider.all = paths.length;

    return {
      totalAvailable: paths.length,
      totalProcessed: this.processedPaths.size,
      byProvider,
    };
  }
}
