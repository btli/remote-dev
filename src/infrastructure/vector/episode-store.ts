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
  type CompressedSummary,
  type TrajectoryStep,
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

/** Token threshold for triggering compression (approximate tokens) */
const COMPRESSION_TOKEN_THRESHOLD = 8000;
/** Target token count after compression */
const COMPRESSION_TARGET_TOKENS = 2000;
/** Minimum actions to keep after compression */
const MIN_ACTIONS_TO_KEEP = 3;
/** Default rolling window size for recent actions */
const DEFAULT_ROLLING_WINDOW_ACTIONS = 5;
/** Default rolling window size for recent observations */
const DEFAULT_ROLLING_WINDOW_OBSERVATIONS = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Token Counting & Importance Scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate token count for text (approximately 4 characters per token for English).
 * This is a heuristic - can be replaced with tiktoken for exact counts.
 */
function estimateTokens(text: string): number {
  if (!text) return 0;
  // Average ~4 chars per token for English/code mixed content
  return Math.ceil(text.length / 4);
}

/**
 * Calculate token count for an episode's trajectory.
 */
function calculateTrajectoryTokens(trajectory: EpisodeProps["trajectory"]): number {
  let tokens = 0;

  for (const action of trajectory.actions) {
    tokens += estimateTokens(action.action);
    tokens += estimateTokens(action.tool || "");
    tokens += estimateTokens(action.input || "");
    tokens += estimateTokens(action.output || "");
  }

  for (const obs of trajectory.observations) {
    tokens += estimateTokens(obs);
  }

  for (const decision of trajectory.decisions) {
    tokens += estimateTokens(decision.context);
    tokens += estimateTokens(decision.chosen);
    tokens += estimateTokens(decision.reasoning);
    for (const opt of decision.options) {
      tokens += estimateTokens(opt);
    }
  }

  for (const pivot of trajectory.pivots) {
    tokens += estimateTokens(pivot.fromApproach);
    tokens += estimateTokens(pivot.toApproach);
    tokens += estimateTokens(pivot.reason);
  }

  return tokens;
}

/**
 * Calculate importance score for a trajectory step.
 * Higher scores = more important to keep.
 */
function calculateActionImportance(
  action: EpisodeProps["trajectory"]["actions"][0],
  index: number,
  totalActions: number
): number {
  let score = 0;

  // Errors are critically important
  if (!action.success) {
    score += 100;
  }

  // First and last actions are important for context
  if (index === 0) {
    score += 50;
  }
  if (index === totalActions - 1) {
    score += 50;
  }

  // Actions with tool usage are more significant
  if (action.tool) {
    score += 20;
  }

  // Longer duration suggests more significant operation
  if (action.duration > 5000) {
    score += 15;
  }

  // Actions with output are more informative
  if (action.output && action.output.length > 100) {
    score += 10;
  }

  return score;
}

/**
 * Generate a summary of compressed actions.
 */
function generateActionSummary(compressedActions: TrajectoryStep[]): string {
  if (compressedActions.length === 0) return "";

  const toolCounts = new Map<string, number>();
  let successCount = 0;
  let failCount = 0;
  let totalDuration = 0;

  for (const action of compressedActions) {
    if (action.tool) {
      toolCounts.set(action.tool, (toolCounts.get(action.tool) || 0) + 1);
    }
    if (action.success) {
      successCount++;
    } else {
      failCount++;
    }
    totalDuration += action.duration;
  }

  const parts: string[] = [];
  parts.push(`${compressedActions.length} actions`);

  if (toolCounts.size > 0) {
    const toolSummary = Array.from(toolCounts.entries())
      .map(([tool, count]) => `${tool}×${count}`)
      .join(", ");
    parts.push(`tools: ${toolSummary}`);
  }

  parts.push(`${successCount}✓ ${failCount}✗`);
  parts.push(`${Math.round(totalDuration / 1000)}s total`);

  return parts.join("; ");
}

/**
 * Extract errors from compressed actions.
 */
function extractErrors(actions: TrajectoryStep[]): string[] {
  return actions
    .filter((a) => !a.success && a.output)
    .map((a) => a.output!.slice(0, 200))
    .slice(0, 5); // Keep at most 5 error messages
}

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
   * Compress episodes using token-aware, importance-scored compression.
   *
   * Unlike fixed truncation, this method:
   * 1. Measures token count before deciding to compress
   * 2. Uses importance scoring to keep high-value actions
   * 3. Generates summaries of compressed content
   * 4. Preserves error information
   *
   * @param options Compression options
   * @returns Number of episodes compressed
   */
  async compressOldEpisodes(options: {
    /** Only compress episodes older than this many days */
    olderThanDays?: number;
    /** Token threshold to trigger compression (default: 8000) */
    tokenThreshold?: number;
    /** Target token count after compression (default: 2000) */
    targetTokens?: number;
    /** Maximum episodes to process per call */
    limit?: number;
    /** Number of recent actions to preserve in rolling window */
    rollingWindowActions?: number;
    /** Number of recent observations to preserve in rolling window */
    rollingWindowObservations?: number;
  } = {}): Promise<number> {
    const {
      olderThanDays = 30,
      tokenThreshold = COMPRESSION_TOKEN_THRESHOLD,
      targetTokens = COMPRESSION_TARGET_TOKENS,
      limit = 1000,
      rollingWindowActions = DEFAULT_ROLLING_WINDOW_ACTIONS,
      rollingWindowObservations = DEFAULT_ROLLING_WINDOW_OBSERVATIONS,
    } = options;

    await this.initialize();

    if (!this.table) return 0;

    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    // Get old episodes that haven't been compressed yet
    const results = await this.table
      .search([])
      .where(`createdAt < ${cutoff}`)
      .limit(limit)
      .toArray();

    let compressed = 0;

    for (const row of results) {
      try {
        const props = JSON.parse(row.propsJson) as EpisodeProps;

        // Skip if already compressed
        if (props.trajectory.compressedSummary) {
          continue;
        }

        // Calculate current token count
        const currentTokens = calculateTrajectoryTokens(props.trajectory);

        // Only compress if above threshold
        if (currentTokens <= tokenThreshold) {
          continue;
        }

        const allActions = props.trajectory.actions;
        const allObservations = props.trajectory.observations;

        // ROLLING WINDOW: Extract most recent actions/observations to preserve in full
        const recentActionsCount = Math.min(rollingWindowActions, allActions.length);
        const recentObsCount = Math.min(rollingWindowObservations, allObservations.length);

        // Recent items are the last N items (most recent)
        const recentActions = allActions.slice(-recentActionsCount);
        const recentObservations = allObservations.slice(-recentObsCount);

        // Remaining actions/observations to be processed for importance-based compression
        const remainingActions = allActions.slice(0, -recentActionsCount || allActions.length);
        const remainingObservations = allObservations.slice(0, -recentObsCount || allObservations.length);

        // Score each remaining action by importance
        const scoredActions = remainingActions.map((action, index) => ({
          action,
          index,
          importance: calculateActionImportance(
            action,
            index,
            remainingActions.length
          ),
        }));

        // Sort by importance (descending)
        scoredActions.sort((a, b) => b.importance - a.importance);

        // Determine how many actions to keep from the remaining set
        // Account for tokens used by rolling window
        const rollingWindowTokens =
          calculateTrajectoryTokens({
            actions: recentActions,
            observations: recentObservations,
            decisions: [],
            pivots: [],
          });

        const adjustedTargetTokens = Math.max(
          targetTokens - rollingWindowTokens,
          MIN_ACTIONS_TO_KEEP * 100 // Minimum budget for importance-scored actions
        );

        let estimatedTokens = 0;
        const keepIndices = new Set<number>();

        for (const scored of scoredActions) {
          const actionTokens =
            estimateTokens(scored.action.action) +
            estimateTokens(scored.action.tool || "") +
            estimateTokens(scored.action.input || "") +
            estimateTokens(scored.action.output || "");

          if (estimatedTokens + actionTokens <= adjustedTargetTokens || keepIndices.size < MIN_ACTIONS_TO_KEEP) {
            keepIndices.add(scored.index);
            estimatedTokens += actionTokens;
          }

          if (estimatedTokens >= adjustedTargetTokens && keepIndices.size >= MIN_ACTIONS_TO_KEEP) {
            break;
          }
        }

        // Separate remaining actions to keep vs compress
        const keptActions: TrajectoryStep[] = [];
        const compressedActions: TrajectoryStep[] = [];

        remainingActions.forEach((action, index) => {
          if (keepIndices.has(index)) {
            keptActions.push(action);
          } else {
            compressedActions.push(action);
          }
        });

        // Compress remaining observations proportionally
        const obsRatio = remainingActions.length > 0
          ? keptActions.length / remainingActions.length
          : 0;
        const obsToKeep = Math.max(
          MIN_ACTIONS_TO_KEEP,
          Math.floor(remainingObservations.length * obsRatio)
        );
        const keptObservations = remainingObservations.slice(0, obsToKeep);
        const compressedObservations = remainingObservations.slice(obsToKeep);

        // Generate compression summary
        const compressedSummary: CompressedSummary = {
          compressedActionCount: compressedActions.length,
          compressedObservationCount: compressedObservations.length,
          actionSummary: generateActionSummary(compressedActions),
          keyOutcomes: compressedActions
            .filter((a) => a.output && a.success)
            .slice(0, 3)
            .map((a) => a.output!.slice(0, 100)),
          errorsEncountered: extractErrors(compressedActions),
          compressedAt: new Date(),
          originalTokenCount: currentTokens,
          compressedTokenCount: calculateTrajectoryTokens({
            ...props.trajectory,
            actions: keptActions,
            observations: keptObservations,
          }) + rollingWindowTokens,
        };

        // Update trajectory with compressed data + rolling window
        props.trajectory.actions = keptActions;
        props.trajectory.observations = keptObservations;
        props.trajectory.compressedSummary = compressedSummary;
        // Store rolling window: most recent items preserved in full
        props.trajectory.recentActions = recentActions.length > 0 ? recentActions : undefined;
        props.trajectory.recentObservations = recentObservations.length > 0 ? recentObservations : undefined;

        // Update stored record
        await this.table.update({
          where: `id = '${row.id}'`,
          values: {
            propsJson: JSON.stringify(props),
          },
        });

        compressed++;
      } catch (error) {
        // Log but continue with other records
        console.error(`Failed to compress episode ${row.id}:`, error);
      }
    }

    return compressed;
  }

  /**
   * Get compression statistics for episodes.
   */
  async getCompressionStats(): Promise<{
    totalEpisodes: number;
    compressedEpisodes: number;
    totalTokensSaved: number;
    avgCompressionRatio: number;
  }> {
    await this.initialize();

    if (!this.table) {
      return {
        totalEpisodes: 0,
        compressedEpisodes: 0,
        totalTokensSaved: 0,
        avgCompressionRatio: 0,
      };
    }

    const results = await this.table.search([]).limit(10000).toArray();

    let compressedCount = 0;
    let totalSaved = 0;
    let totalRatio = 0;

    for (const row of results) {
      try {
        const props = JSON.parse(row.propsJson) as EpisodeProps;
        if (props.trajectory.compressedSummary) {
          compressedCount++;
          const summary = props.trajectory.compressedSummary;
          totalSaved += summary.originalTokenCount - summary.compressedTokenCount;
          totalRatio += summary.compressedTokenCount / summary.originalTokenCount;
        }
      } catch {
        // Skip invalid records
      }
    }

    return {
      totalEpisodes: results.length,
      compressedEpisodes: compressedCount,
      totalTokensSaved: totalSaved,
      avgCompressionRatio: compressedCount > 0 ? totalRatio / compressedCount : 0,
    };
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
