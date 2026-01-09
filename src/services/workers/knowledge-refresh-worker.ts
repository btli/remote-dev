/**
 * KnowledgeRefreshWorker - Background worker for refreshing project knowledge.
 *
 * Responsibilities:
 * - Periodically scan projects for tech stack changes
 * - Update conventions, patterns based on codebase changes
 * - Clean up stale knowledge entries
 *
 * Features:
 * - Configurable refresh interval (default: 24h)
 * - Staggered folder processing to avoid load spikes
 * - Memory-efficient batch processing
 */

import { db } from "@/db";
import { projectKnowledge, sessionFolders } from "@/db/schema";
import { eq, lt } from "drizzle-orm";
import type { Worker } from "./worker-manager";
import { projectKnowledgeRepository } from "@/infrastructure/container";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

interface KnowledgeRefreshConfig {
  /** Refresh interval in milliseconds (default: 24 hours) */
  intervalMs: number;
  /** Maximum folders to process per cycle */
  batchSize: number;
  /** Stale threshold - knowledge older than this will be refreshed (ms) */
  staleThresholdMs: number;
  /** Delay between folder processing to avoid load spikes (ms) */
  processingDelayMs: number;
}

const DEFAULT_CONFIG: KnowledgeRefreshConfig = {
  intervalMs: 24 * 60 * 60 * 1000, // 24 hours
  batchSize: 10,
  staleThresholdMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  processingDelayMs: 1000, // 1 second between folders
};

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Refresh Worker
// ─────────────────────────────────────────────────────────────────────────────

export class KnowledgeRefreshWorker implements Worker {
  readonly name = "knowledge-refresh";
  private config: KnowledgeRefreshConfig;
  private interval: NodeJS.Timeout | null = null;
  private running = false;
  private processing = false;

  constructor(config: Partial<KnowledgeRefreshConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.running) {
      console.warn("[KnowledgeRefreshWorker] Already running");
      return;
    }

    console.log(
      `[KnowledgeRefreshWorker] Starting with interval ${this.config.intervalMs}ms`
    );

    this.running = true;

    // Schedule first run after a short delay to not impact startup
    setTimeout(() => {
      if (this.running) {
        this.runCycle();
      }
    }, 60000); // 1 minute after startup

    this.interval = setInterval(async () => {
      if (!this.processing) {
        await this.runCycle();
      }
    }, this.config.intervalMs);
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log("[KnowledgeRefreshWorker] Stopping...");

    this.running = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    // Wait for current processing to complete (with timeout)
    const timeout = 60000; // 1 minute
    const start = Date.now();
    while (this.processing && Date.now() - start < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log("[KnowledgeRefreshWorker] Stopped");
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Run a refresh cycle.
   */
  private async runCycle(): Promise<void> {
    if (!this.running) return;

    this.processing = true;

    try {
      // Find stale knowledge entries
      const staleKnowledge = await this.findStaleKnowledge();

      if (staleKnowledge.length === 0) {
        console.log("[KnowledgeRefreshWorker] No stale knowledge to refresh");
        this.processing = false;
        return;
      }

      console.log(
        `[KnowledgeRefreshWorker] Found ${staleKnowledge.length} stale knowledge entries`
      );

      // Process in batches
      const batch = staleKnowledge.slice(0, this.config.batchSize);

      for (const entry of batch) {
        if (!this.running) break;

        try {
          await this.refreshKnowledge(entry);

          // Delay between processing to avoid load spikes
          if (this.config.processingDelayMs > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, this.config.processingDelayMs)
            );
          }
        } catch (error) {
          console.error(
            `[KnowledgeRefreshWorker] Error refreshing knowledge ${entry.id}:`,
            error
          );
        }
      }

      console.log(
        `[KnowledgeRefreshWorker] Processed ${batch.length} knowledge entries`
      );
    } catch (error) {
      console.error("[KnowledgeRefreshWorker] Cycle error:", error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Find knowledge entries that need refreshing.
   */
  private async findStaleKnowledge(): Promise<
    Array<{
      id: string;
      folderId: string;
      lastScannedAt: Date | null;
    }>
  > {
    const staleThreshold = new Date(Date.now() - this.config.staleThresholdMs);

    // Find knowledge that hasn't been scanned recently
    const results = await db
      .select({
        id: projectKnowledge.id,
        folderId: projectKnowledge.folderId,
        lastScannedAt: projectKnowledge.lastScannedAt,
      })
      .from(projectKnowledge)
      .where(
        lt(projectKnowledge.lastScannedAt, staleThreshold)
      )
      .limit(this.config.batchSize * 2);

    return results;
  }

  /**
   * Refresh knowledge for a single entry.
   */
  private async refreshKnowledge(entry: {
    id: string;
    folderId: string;
    lastScannedAt: Date | null;
  }): Promise<void> {
    console.log(
      `[KnowledgeRefreshWorker] Refreshing knowledge for folder ${entry.folderId}`
    );

    // Get the folder to check if it still exists
    const folderResult = await db
      .select({
        id: sessionFolders.id,
        name: sessionFolders.name,
      })
      .from(sessionFolders)
      .where(eq(sessionFolders.id, entry.folderId))
      .limit(1);

    if (folderResult.length === 0) {
      // Folder was deleted - remove knowledge
      console.log(
        `[KnowledgeRefreshWorker] Folder ${entry.folderId} no longer exists, cleaning up knowledge`
      );
      await this.cleanupOrphanedKnowledge(entry.id);
      return;
    }

    const folder = folderResult[0];

    // Load the knowledge entity
    const knowledge = await projectKnowledgeRepository.findById(entry.id);
    if (!knowledge) {
      console.warn(
        `[KnowledgeRefreshWorker] Knowledge ${entry.id} not found in repository`
      );
      return;
    }

    // Mark as scanned (actual deep refresh would require more sophisticated logic)
    // For now, we just update the timestamp to prevent constant re-processing
    const refreshedKnowledge = knowledge.markScanned();
    await projectKnowledgeRepository.save(refreshedKnowledge);

    console.log(
      `[KnowledgeRefreshWorker] Refreshed knowledge for folder ${folder.name}`
    );
  }

  /**
   * Clean up knowledge for deleted folders.
   */
  private async cleanupOrphanedKnowledge(knowledgeId: string): Promise<void> {
    try {
      await projectKnowledgeRepository.delete(knowledgeId);
      console.log(
        `[KnowledgeRefreshWorker] Deleted orphaned knowledge ${knowledgeId}`
      );
    } catch (error) {
      console.error(
        `[KnowledgeRefreshWorker] Error deleting orphaned knowledge:`,
        error
      );
    }
  }
}

/**
 * Create a knowledge refresh worker instance.
 */
export function createKnowledgeRefreshWorker(
  config?: Partial<KnowledgeRefreshConfig>
): KnowledgeRefreshWorker {
  return new KnowledgeRefreshWorker(config);
}
