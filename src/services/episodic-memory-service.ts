/**
 * Episodic Memory Service - High-level interface for episodic memory
 *
 * Provides context injection, experience retrieval, and memory management
 * for AI agents to learn from past task experiences.
 */

import { Episode, type EpisodeReflection } from "@/domain/entities/Episode";
import {
  getEpisodeStore,
  type EpisodeStore,
  type EpisodeSearchOptions,
  type EpisodeSearchResult,
} from "@/infrastructure/vector/episode-store";
import {
  getEpisodeRecorder,
  type EpisodeRecorderService,
} from "./episode-recorder-service";
import {
  generateHindsight,
  applyHindsight,
  analyzeEpisodePatterns,
  type HindsightAnalysis,
} from "./hindsight-generator-service";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextInjection {
  hasRelevantExperience: boolean;
  successApproaches: string[];
  warnings: string[];
  insights: string[];
  contextText: string;
}

export interface LearningOutcome {
  patterns: string[];
  recommendations: string[];
  avoidances: string[];
}

export interface MemoryStats {
  totalEpisodes: number;
  successRate: number;
  avgQualityScore: number;
  topInsights: string[];
  commonFailures: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

class EpisodicMemoryService {
  private store: EpisodeStore;
  private recorder: EpisodeRecorderService;

  constructor(folderId?: string) {
    this.store = getEpisodeStore(folderId);
    this.recorder = getEpisodeRecorder(folderId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Context Injection
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get relevant experience context for a new task.
   */
  async getContextForTask(
    taskDescription: string,
    options: EpisodeSearchOptions = {}
  ): Promise<ContextInjection> {
    const {
      successfulApproaches,
      warningsFromFailures,
      relevantInsights,
    } = await this.store.findSimilarExperiences(taskDescription, options);

    if (
      successfulApproaches.length === 0 &&
      warningsFromFailures.length === 0
    ) {
      return {
        hasRelevantExperience: false,
        successApproaches: [],
        warnings: [],
        insights: [],
        contextText: "",
      };
    }

    // Build context text
    const contextParts: string[] = [];

    if (successfulApproaches.length > 0) {
      contextParts.push("## Relevant Past Successes\n");
      for (const result of successfulApproaches) {
        contextParts.push(result.episode.getContextForSimilarTask());
        contextParts.push("");
      }
    }

    if (warningsFromFailures.length > 0) {
      contextParts.push("## Warnings from Past Failures\n");
      for (const result of warningsFromFailures) {
        contextParts.push(`⚠️ Similar task failed previously:`);
        contextParts.push(result.episode.getContextForSimilarTask());
        contextParts.push("");
      }
    }

    if (relevantInsights.length > 0) {
      contextParts.push("## Key Insights from Experience\n");
      for (const insight of relevantInsights) {
        contextParts.push(`- 💡 ${insight}`);
      }
    }

    return {
      hasRelevantExperience: true,
      successApproaches: successfulApproaches.map((r) =>
        r.episode.reflection.whatWorked.join("; ")
      ),
      warnings: warningsFromFailures.flatMap((r) =>
        r.episode.reflection.whatFailed
      ),
      insights: relevantInsights,
      contextText: contextParts.join("\n"),
    };
  }

  /**
   * Generate a concise context prompt for injection.
   */
  async generateContextPrompt(
    taskDescription: string,
    maxLength: number = 1000
  ): Promise<string> {
    const context = await this.getContextForTask(taskDescription);

    if (!context.hasRelevantExperience) {
      return "";
    }

    let prompt = "Based on past experience:\n";

    // Add success hints
    if (context.successApproaches.length > 0) {
      prompt += "\n✓ What worked before:\n";
      for (const approach of context.successApproaches.slice(0, 2)) {
        prompt += `  - ${approach.slice(0, 200)}\n`;
      }
    }

    // Add warnings
    if (context.warnings.length > 0) {
      prompt += "\n⚠️ Avoid (caused failures):\n";
      for (const warning of context.warnings.slice(0, 2)) {
        prompt += `  - ${warning}\n`;
      }
    }

    // Add insights
    if (context.insights.length > 0) {
      prompt += "\n💡 Key insights:\n";
      for (const insight of context.insights.slice(0, 2)) {
        prompt += `  - ${insight}\n`;
      }
    }

    // Truncate if too long
    if (prompt.length > maxLength) {
      prompt = prompt.slice(0, maxLength - 3) + "...";
    }

    return prompt;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Recording
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Start recording a new episode.
   */
  startRecording(
    taskId: string,
    folderId: string,
    taskDescription: string,
    agentProvider?: string
  ): string {
    const sessionId = this.recorder.startRecording(taskId, folderId);
    this.recorder.setContext(sessionId, {
      taskDescription,
      agentProvider,
    });
    return sessionId;
  }

  /**
   * Record an action during task execution.
   */
  recordAction(
    sessionId: string,
    action: string,
    tool?: string,
    success: boolean = true,
    duration: number = 0
  ): void {
    this.recorder.recordAction(sessionId, {
      action,
      tool,
      success,
      duration,
    });
  }

  /**
   * Record a decision.
   */
  recordDecision(
    sessionId: string,
    context: string,
    options: string[],
    chosen: string,
    reasoning: string
  ): void {
    this.recorder.recordDecision(sessionId, {
      context,
      options,
      chosen,
      reasoning,
    });
  }

  /**
   * Complete a recording with reflection.
   */
  async completeRecording(
    sessionId: string,
    success: boolean,
    result: string,
    reflection: EpisodeReflection,
    tags: string[] = []
  ): Promise<Episode> {
    return this.recorder.completeRecording(
      sessionId,
      success ? "success" : "failure",
      result,
      reflection,
      tags
    );
  }

  /**
   * Cancel a recording.
   */
  cancelRecording(sessionId: string): void {
    this.recorder.cancelRecording(sessionId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Retrieval
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Search for similar episodes.
   */
  async search(
    query: string,
    options?: EpisodeSearchOptions
  ): Promise<EpisodeSearchResult[]> {
    return this.store.search(query, options);
  }

  /**
   * Get episode by ID.
   */
  async getEpisode(id: string): Promise<Episode | null> {
    return this.store.get(id);
  }

  /**
   * Get episodes for a task.
   */
  async getEpisodesForTask(taskId: string): Promise<Episode[]> {
    return this.store.getByTaskId(taskId);
  }

  /**
   * Get recent episodes.
   */
  async getRecentEpisodes(limit: number = 5): Promise<Episode[]> {
    return this.store.getRecent(limit);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Learning & Analysis
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Extract learning outcomes from episodes.
   */
  async extractLearnings(
    query: string,
    options?: EpisodeSearchOptions
  ): Promise<LearningOutcome> {
    const results = await this.store.search(query, {
      ...options,
      limit: 10,
    });

    const patterns: Set<string> = new Set();
    const recommendations: Set<string> = new Set();
    const avoidances: Set<string> = new Set();

    for (const result of results) {
      const episode = result.episode;

      // Extract patterns from successful episodes
      if (episode.isSuccess()) {
        for (const insight of episode.reflection.keyInsights) {
          patterns.add(insight);
        }
        for (const worked of episode.reflection.whatWorked) {
          recommendations.add(worked);
        }
      }

      // Extract avoidances from failed episodes
      if (episode.isFailed()) {
        for (const failed of episode.reflection.whatFailed) {
          avoidances.add(failed);
        }
      }
    }

    return {
      patterns: Array.from(patterns).slice(0, 5),
      recommendations: Array.from(recommendations).slice(0, 5),
      avoidances: Array.from(avoidances).slice(0, 5),
    };
  }

  /**
   * Get memory statistics.
   */
  async getStats(): Promise<MemoryStats> {
    const stats = await this.store.getStats();

    // Get top insights from recent successful episodes
    const recentSuccesses = await this.store.search("", {
      outcomes: ["success"],
      limit: 20,
      minQualityScore: 50,
    });

    const insightCounts = new Map<string, number>();
    const failureCounts = new Map<string, number>();

    for (const result of recentSuccesses) {
      for (const insight of result.episode.reflection.keyInsights) {
        insightCounts.set(insight, (insightCounts.get(insight) || 0) + 1);
      }
    }

    // Get common failures
    const recentFailures = await this.store.search("", {
      outcomes: ["failure"],
      limit: 20,
    });

    for (const result of recentFailures) {
      for (const failure of result.episode.reflection.whatFailed) {
        failureCounts.set(failure, (failureCounts.get(failure) || 0) + 1);
      }
    }

    // Sort by frequency
    const topInsights = Array.from(insightCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([insight]) => insight);

    const commonFailures = Array.from(failureCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([failure]) => failure);

    // Calculate success rate
    const successRate =
      stats.totalEpisodes > 0
        ? (stats.byOutcome.success / stats.totalEpisodes) * 100
        : 0;

    return {
      totalEpisodes: stats.totalEpisodes,
      successRate: Math.round(successRate * 10) / 10,
      avgQualityScore: Math.round(stats.avgQualityScore * 10) / 10,
      topInsights,
      commonFailures,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Memory Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add user feedback to an episode.
   */
  async addFeedback(
    episodeId: string,
    rating: number,
    feedback?: string
  ): Promise<Episode | null> {
    const episode = await this.store.get(episodeId);
    if (!episode) return null;

    const updated = episode.withUserFeedback(rating, feedback);
    await this.store.update(updated);
    return updated;
  }

  /**
   * Add tags to an episode.
   */
  async addTags(episodeId: string, tags: string[]): Promise<Episode | null> {
    const episode = await this.store.get(episodeId);
    if (!episode) return null;

    const updated = episode.withTags(tags);
    await this.store.update(updated);
    return updated;
  }

  /**
   * Compress old episodes using token-aware, importance-scored compression.
   *
   * @param options Compression options
   * @returns Number of episodes compressed
   */
  async compressOldEpisodes(options: {
    olderThanDays?: number;
    tokenThreshold?: number;
    targetTokens?: number;
    limit?: number;
  } = {}): Promise<number> {
    return this.store.compressOldEpisodes(options);
  }

  /**
   * Get compression statistics.
   */
  async getCompressionStats(): Promise<{
    totalEpisodes: number;
    compressedEpisodes: number;
    totalTokensSaved: number;
    avgCompressionRatio: number;
  }> {
    return this.store.getCompressionStats();
  }

  /**
   * Delete an episode.
   */
  async deleteEpisode(id: string): Promise<void> {
    return this.store.delete(id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hindsight Generation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Generate hindsight analysis for an episode.
   * Returns structured analysis of what worked, what failed, and recommendations.
   */
  async generateHindsight(episodeId: string): Promise<HindsightAnalysis | null> {
    const episode = await this.store.get(episodeId);
    if (!episode) return null;

    return generateHindsight(episode);
  }

  /**
   * Apply auto-generated hindsight to an episode's reflection.
   * Merges with existing reflection data (doesn't overwrite user-provided data).
   */
  async applyHindsight(episodeId: string): Promise<Episode | null> {
    const episode = await this.store.get(episodeId);
    if (!episode) return null;

    const updated = applyHindsight(episode);
    await this.store.update(updated);
    return updated;
  }

  /**
   * Analyze patterns across multiple episodes.
   * Useful for identifying common success/failure patterns.
   */
  async analyzePatterns(options?: EpisodeSearchOptions): Promise<{
    commonSuccessPatterns: string[];
    commonFailurePatterns: string[];
    recommendations: string[];
  }> {
    const results = await this.store.search("", {
      ...options,
      limit: 50, // Analyze up to 50 episodes
    });

    const episodes = results.map((r) => r.episode);
    return analyzeEpisodePatterns(episodes);
  }

  /**
   * Complete a recording with auto-generated hindsight.
   * Generates reflection automatically if not provided.
   */
  async completeRecordingWithHindsight(
    sessionId: string,
    success: boolean,
    result: string,
    reflection?: Partial<EpisodeReflection>,
    tags: string[] = []
  ): Promise<Episode> {
    // First complete the recording with minimal reflection
    const episode = await this.recorder.completeRecording(
      sessionId,
      success ? "success" : "failure",
      result,
      {
        whatWorked: reflection?.whatWorked || [],
        whatFailed: reflection?.whatFailed || [],
        keyInsights: reflection?.keyInsights || [],
        wouldDoDifferently: reflection?.wouldDoDifferently,
        userRating: reflection?.userRating,
        userFeedback: reflection?.userFeedback,
      },
      tags
    );

    // Apply hindsight to fill in gaps
    return applyHindsight(episode);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Promotion to Long-Term Memory
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Identify episodes that should be promoted to patterns.
   */
  async identifyPromotableEpisodes(): Promise<Episode[]> {
    // Find high-quality, frequently-relevant episodes
    const results = await this.store.search("", {
      minQualityScore: 70,
      limit: 20,
    });

    // Filter to episodes with multiple similar experiences
    const promotable: Episode[] = [];

    for (const result of results) {
      const episode = result.episode;

      // Check if there are similar episodes (same pattern)
      const similar = await this.store.search(
        episode.context.taskDescription,
        { limit: 5 }
      );

      // If multiple similar episodes with consistent outcomes, promote
      if (similar.length >= 3) {
        const allSuccess = similar.every((s) => s.episode.isSuccess());
        const allFailed = similar.every((s) => s.episode.isFailed());

        if (allSuccess || allFailed) {
          promotable.push(episode);
        }
      }
    }

    return promotable;
  }

  /**
   * Get pattern candidates from episodes for promotion to LanceKnowledgeStore.
   */
  async extractPatternCandidates(): Promise<Array<{
    pattern: string;
    confidence: number;
    evidence: string[];
  }>> {
    const promotable = await this.identifyPromotableEpisodes();
    const patterns: Array<{
      pattern: string;
      confidence: number;
      evidence: string[];
    }> = [];

    for (const episode of promotable) {
      if (episode.isSuccess() && episode.reflection.keyInsights.length > 0) {
        for (const insight of episode.reflection.keyInsights) {
          patterns.push({
            pattern: insight,
            confidence: episode.getQualityScore() / 100,
            evidence: [episode.id],
          });
        }
      }
    }

    return patterns;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

const memoryCache = new Map<string, EpisodicMemoryService>();

export function getEpisodicMemory(folderId?: string): EpisodicMemoryService {
  const key = folderId || "global";

  if (!memoryCache.has(key)) {
    memoryCache.set(key, new EpisodicMemoryService(folderId));
  }

  return memoryCache.get(key)!;
}

export { EpisodicMemoryService };
