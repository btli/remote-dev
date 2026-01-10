/**
 * Episode Store - LanceDB-based storage for episodic memory
 *
 * Stores task experiences with embeddings for similarity search.
 * Enables retrieval of relevant past experiences for new tasks.
 */

import * as lancedb from "@lancedb/lancedb";
import type { Table } from "@lancedb/lancedb";
import { embeddingService } from "@/services/embedding-service";
import {
  Episode,
  type EpisodeProps,
  type EpisodeType,
  type EpisodeOutcome,
} from "@/domain/entities/Episode";
import path from "path";
import fs from "fs/promises";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface EpisodeVector {
  id: string;
  taskId: string;
  folderId: string;
  type: EpisodeType;
  outcome: EpisodeOutcome;
  taskDescription: string;
  result: string;
  learnings: string; // Combined whatWorked + whatFailed + keyInsights
  vector: number[];
  qualityScore: number;
  userRating: number | null;
  duration: number;
  errorCount: number;
  toolCallCount: number;
  tags: string; // JSON array
  propsJson: string; // Full EpisodeProps as JSON
  createdAt: number;
  updatedAt: number;
}

export interface EpisodeSearchResult {
  episode: Episode;
  score: number; // Similarity score 0-1
  relevanceReason: string;
}

export interface EpisodeSearchOptions {
  limit?: number;
  minScore?: number;
  types?: EpisodeType[];
  outcomes?: EpisodeOutcome[];
  folderId?: string;
  minQualityScore?: number;
  preferRecent?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DIR = "data/lance";
const TABLE_NAME = "episodes";
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_MIN_SCORE = 0.4;

// ─────────────────────────────────────────────────────────────────────────────
// Episode Store
// ─────────────────────────────────────────────────────────────────────────────

export class EpisodeStore {
  private db: lancedb.Connection | null = null;
  private table: Table | null = null;
  private readonly dbPath: string;
  private initPromise: Promise<void> | null = null;

  constructor(folderId?: string) {
    // Per-folder or global storage
    this.dbPath = folderId
      ? path.join(process.cwd(), DATA_DIR, folderId)
      : path.join(process.cwd(), DATA_DIR, "global");
  }

  /**
   * Initialize the LanceDB connection.
   */
  private async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await fs.mkdir(this.dbPath, { recursive: true });
      this.db = await lancedb.connect(this.dbPath);

      const tableNames = await this.db.tableNames();
      if (tableNames.includes(TABLE_NAME)) {
        this.table = await this.db.openTable(TABLE_NAME);
      }
    })();

    return this.initPromise;
  }

  /**
   * Ensure table exists.
   */
  private async ensureTable(sample: EpisodeVector): Promise<Table> {
    if (this.table) return this.table;

    if (!this.db) {
      throw new Error("LanceDB not initialized");
    }

    this.table = await this.db.createTable(
      TABLE_NAME,
      [sample as unknown as Record<string, unknown>]
    );

    return this.table;
  }

  /**
   * Generate embedding text for an episode.
   */
  private getEmbeddingText(episode: Episode): string {
    const parts = [
      episode.context.taskDescription,
      episode.outcome.result,
      ...episode.reflection.whatWorked,
      ...episode.reflection.whatFailed,
      ...episode.reflection.keyInsights,
    ];

    if (episode.reflection.wouldDoDifferently) {
      parts.push(episode.reflection.wouldDoDifferently);
    }

    return parts.join(" ");
  }

  /**
   * Convert Episode to vector record.
   */
  private async toVectorRecord(episode: Episode): Promise<EpisodeVector> {
    const embeddingText = this.getEmbeddingText(episode);
    const { vector } = await embeddingService.embed(embeddingText);

    const learnings = [
      ...episode.reflection.whatWorked.map((w) => `✓ ${w}`),
      ...episode.reflection.whatFailed.map((f) => `✗ ${f}`),
      ...episode.reflection.keyInsights.map((i) => `💡 ${i}`),
    ].join("; ");

    return {
      id: episode.id,
      taskId: episode.taskId,
      folderId: episode.folderId,
      type: episode.type,
      outcome: episode.outcome.outcome,
      taskDescription: episode.context.taskDescription,
      result: episode.outcome.result,
      learnings,
      vector: Array.from(vector),
      qualityScore: episode.getQualityScore(),
      userRating: episode.reflection.userRating ?? null,
      duration: episode.outcome.duration,
      errorCount: episode.outcome.errorCount,
      toolCallCount: episode.outcome.toolCallCount,
      tags: JSON.stringify(episode.tags),
      propsJson: JSON.stringify(episode.toProps()),
      createdAt: episode.createdAt.getTime(),
      updatedAt: episode.updatedAt.getTime(),
    };
  }

  /**
   * Store a new episode.
   */
  async store(episode: Episode): Promise<string> {
    await this.initialize();

    const record = await this.toVectorRecord(episode);

    // Check if table exists before ensuring
    const tableExisted = this.table !== null;
    await this.ensureTable(record);

    // If table was just created, entry is already added
    if (tableExisted && this.table) {
      await this.table.add([record as unknown as Record<string, unknown>]);
    }

    return episode.id;
  }

  /**
   * Search for similar episodes.
   */
  async search(
    query: string,
    options: EpisodeSearchOptions = {}
  ): Promise<EpisodeSearchResult[]> {
    await this.initialize();

    if (!this.table) {
      return [];
    }

    const {
      limit = DEFAULT_SEARCH_LIMIT,
      minScore = DEFAULT_MIN_SCORE,
      types,
      outcomes,
      folderId,
      minQualityScore,
      preferRecent = true,
    } = options;

    // Generate query embedding
    const { vector } = await embeddingService.embed(query);

    // Build search query
    let searchQuery = this.table
      .search(Array.from(vector))
      .limit(limit * 3); // Over-fetch to filter

    // Apply filters
    const filters: string[] = [];

    if (types && types.length > 0) {
      const typeFilter = types.map((t) => `type = '${t}'`).join(" OR ");
      filters.push(`(${typeFilter})`);
    }

    if (outcomes && outcomes.length > 0) {
      const outcomeFilter = outcomes.map((o) => `outcome = '${o}'`).join(" OR ");
      filters.push(`(${outcomeFilter})`);
    }

    if (folderId) {
      filters.push(`folderId = '${folderId}'`);
    }

    if (minQualityScore !== undefined) {
      filters.push(`qualityScore >= ${minQualityScore}`);
    }

    if (filters.length > 0) {
      searchQuery = searchQuery.where(filters.join(" AND "));
    }

    // Execute search
    const results = await searchQuery.toArray();

    // Process results
    const episodeResults: EpisodeSearchResult[] = [];

    for (const row of results) {
      const distance = row._distance ?? 0;
      let score = Math.max(0, 1 - distance);

      // Boost recent episodes if preferred
      if (preferRecent) {
        const ageInDays = (Date.now() - row.createdAt) / (1000 * 60 * 60 * 24);
        const recencyBoost = Math.max(0, 1 - ageInDays / 30) * 0.1;
        score += recencyBoost;
      }

      // Boost high-quality episodes
      const qualityBoost = (row.qualityScore / 100) * 0.1;
      score += qualityBoost;

      // Normalize score
      score = Math.min(1, score);

      if (score >= minScore) {
        try {
          const props = JSON.parse(row.propsJson) as EpisodeProps;
          // Restore dates
          props.createdAt = new Date(props.createdAt);
          props.updatedAt = new Date(props.updatedAt);

          const episode = Episode.fromProps(props);

          episodeResults.push({
            episode,
            score,
            relevanceReason: this.getRelevanceReason(row, score),
          });
        } catch (e) {
          console.error(`Failed to parse episode ${row.id}:`, e);
        }
      }

      if (episodeResults.length >= limit) break;
    }

    // Sort by score
    return episodeResults.sort((a, b) => b.score - a.score);
  }

  /**
   * Generate relevance reason for search result.
   */
  private getRelevanceReason(row: EpisodeVector, score: number): string {
    const parts: string[] = [];

    if (score > 0.8) {
      parts.push("Highly similar task");
    } else if (score > 0.6) {
      parts.push("Similar task");
    } else {
      parts.push("Related task");
    }

    if (row.outcome === "success") {
      parts.push("successful");
    } else if (row.outcome === "failure") {
      parts.push("failed");
    }

    if (row.qualityScore > 70) {
      parts.push("high quality learnings");
    }

    return parts.join(", ");
  }

  /**
   * Find similar past experiences for a new task.
   */
  async findSimilarExperiences(
    taskDescription: string,
    options: EpisodeSearchOptions = {}
  ): Promise<{
    successfulApproaches: EpisodeSearchResult[];
    warningsFromFailures: EpisodeSearchResult[];
    relevantInsights: string[];
  }> {
    // Search for successful episodes
    const successfulApproaches = await this.search(taskDescription, {
      ...options,
      outcomes: ["success"],
      limit: 3,
    });

    // Search for failed episodes
    const warningsFromFailures = await this.search(taskDescription, {
      ...options,
      outcomes: ["failure"],
      limit: 2,
    });

    // Extract unique insights
    const insightSet = new Set<string>();

    for (const result of [...successfulApproaches, ...warningsFromFailures]) {
      for (const insight of result.episode.reflection.keyInsights) {
        insightSet.add(insight);
      }
    }

    return {
      successfulApproaches,
      warningsFromFailures,
      relevantInsights: Array.from(insightSet).slice(0, 5),
    };
  }

  /**
   * Get episode by ID.
   */
  async get(id: string): Promise<Episode | null> {
    await this.initialize();

    if (!this.table) return null;

    const results = await this.table
      .search([])
      .where(`id = '${id}'`)
      .toArray();

    if (results.length === 0) return null;

    try {
      const props = JSON.parse(results[0].propsJson) as EpisodeProps;
      props.createdAt = new Date(props.createdAt);
      props.updatedAt = new Date(props.updatedAt);
      return Episode.fromProps(props);
    } catch {
      return null;
    }
  }

  /**
   * Update episode (e.g., add user feedback).
   * Uses delete-and-reinsert pattern for full record updates.
   */
  async update(episode: Episode): Promise<void> {
    await this.initialize();

    if (!this.table) {
      throw new Error("Episode table not initialized");
    }

    // Delete existing record
    await this.table.delete(`id = '${episode.id}'`);

    // Re-add with updated values
    const record = await this.toVectorRecord(episode);
    await this.table.add([record as unknown as Record<string, unknown>]);
  }

  /**
   * Delete episode.
   */
  async delete(id: string): Promise<void> {
    await this.initialize();

    if (!this.table) return;

    await this.table.delete(`id = '${id}'`);
  }

  /**
   * Get episodes by task ID.
   */
  async getByTaskId(taskId: string): Promise<Episode[]> {
    await this.initialize();

    if (!this.table) return [];

    const results = await this.table
      .search([])
      .where(`taskId = '${taskId}'`)
      .toArray();

    return results
      .map((row) => {
        try {
          const props = JSON.parse(row.propsJson) as EpisodeProps;
          props.createdAt = new Date(props.createdAt);
          props.updatedAt = new Date(props.updatedAt);
          return Episode.fromProps(props);
        } catch {
          return null;
        }
      })
      .filter((e): e is Episode => e !== null);
  }

  /**
   * Get recent episodes for context.
   */
  async getRecent(limit: number = 5, folderId?: string): Promise<Episode[]> {
    await this.initialize();

    if (!this.table) return [];

    let query = this.table.search([]).limit(limit);

    if (folderId) {
      query = query.where(`folderId = '${folderId}'`);
    }

    const results = await query.toArray();

    return results
      .map((row) => {
        try {
          const props = JSON.parse(row.propsJson) as EpisodeProps;
          props.createdAt = new Date(props.createdAt);
          props.updatedAt = new Date(props.updatedAt);
          return Episode.fromProps(props);
        } catch {
          return null;
        }
      })
      .filter((e): e is Episode => e !== null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get statistics about stored episodes.
   */
  async getStats(): Promise<{
    totalEpisodes: number;
    byType: Record<EpisodeType, number>;
    byOutcome: Record<EpisodeOutcome, number>;
    avgQualityScore: number;
    avgDuration: number;
  }> {
    await this.initialize();

    if (!this.table) {
      return {
        totalEpisodes: 0,
        byType: {
          task_execution: 0,
          error_recovery: 0,
          tool_discovery: 0,
          agent_interaction: 0,
          user_feedback: 0,
        },
        byOutcome: {
          success: 0,
          failure: 0,
          partial: 0,
          cancelled: 0,
        },
        avgQualityScore: 0,
        avgDuration: 0,
      };
    }

    const results = await this.table.search([]).limit(10000).toArray();

    const byType: Record<EpisodeType, number> = {
      task_execution: 0,
      error_recovery: 0,
      tool_discovery: 0,
      agent_interaction: 0,
      user_feedback: 0,
    };

    const byOutcome: Record<EpisodeOutcome, number> = {
      success: 0,
      failure: 0,
      partial: 0,
      cancelled: 0,
    };

    let totalQuality = 0;
    let totalDuration = 0;

    for (const row of results) {
      byType[row.type as EpisodeType] = (byType[row.type as EpisodeType] || 0) + 1;
      byOutcome[row.outcome as EpisodeOutcome] = (byOutcome[row.outcome as EpisodeOutcome] || 0) + 1;
      totalQuality += row.qualityScore;
      totalDuration += row.duration;
    }

    return {
      totalEpisodes: results.length,
      byType,
      byOutcome,
      avgQualityScore: results.length > 0 ? totalQuality / results.length : 0,
      avgDuration: results.length > 0 ? totalDuration / results.length : 0,
    };
  }

  /**
   * Compress old episodes (summarize trajectory).
   */
  async compressOldEpisodes(olderThanDays: number = 30): Promise<number> {
    await this.initialize();

    if (!this.table) return 0;

    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    // Get old episodes
    const results = await this.table
      .search([])
      .where(`createdAt < ${cutoff}`)
      .limit(1000)
      .toArray();

    let compressed = 0;

    for (const row of results) {
      try {
        const props = JSON.parse(row.propsJson) as EpisodeProps;

        // Compress trajectory by keeping only summary
        if (props.trajectory.actions.length > 10) {
          props.trajectory.actions = props.trajectory.actions.slice(0, 5);
          props.trajectory.observations = props.trajectory.observations.slice(0, 5);

          // Update stored record
          await this.table.update({
            where: `id = '${row.id}'`,
            values: {
              propsJson: JSON.stringify(props),
            },
          });

          compressed++;
        }
      } catch {
        // Skip invalid records
      }
    }

    return compressed;
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    this.db = null;
    this.table = null;
    this.initPromise = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

const storeCache = new Map<string, EpisodeStore>();

export function getEpisodeStore(folderId?: string): EpisodeStore {
  const key = folderId || "global";

  if (!storeCache.has(key)) {
    storeCache.set(key, new EpisodeStore(folderId));
  }

  return storeCache.get(key)!;
}

export function getGlobalEpisodeStore(): EpisodeStore {
  return getEpisodeStore();
}
