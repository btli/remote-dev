/**
 * LanceKnowledgeStore - Vector storage for project knowledge using LanceDB
 *
 * Provides semantic search for patterns, gotchas, insights, commands, tools,
 * and agent experiences. Supports both folder-scoped and global knowledge.
 */

import * as lancedb from "@lancedb/lancedb";
import type { Table } from "@lancedb/lancedb";
import { embeddingService } from "@/services/embedding-service";
import path from "path";
import fs from "fs/promises";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type KnowledgeType =
  | "pattern"
  | "gotcha"
  | "insight"
  | "command"
  | "tool"
  | "agent";

export interface KnowledgeVector {
  id: string;
  type: KnowledgeType;
  content: string;
  vector: number[]; // LanceDB expects number[] not Float32Array
  confidence: number;
  usageCount: number;
  lastUsedAt: number;
  createdAt: number;
  evidence: string; // JSON array of task IDs
  folderId: string;
}

export interface KnowledgeSearchResult {
  id: string;
  type: KnowledgeType;
  content: string;
  confidence: number;
  usageCount: number;
  score: number; // Similarity score 0-1
  evidence: string[];
}

export interface AddKnowledgeInput {
  type: KnowledgeType;
  content: string;
  confidence: number;
  evidence?: string[];
  folderId: string;
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  types?: KnowledgeType[];
  folderId?: string; // If null, search global
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DIR = "data/lance";
const TABLE_NAME = "knowledge";
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_MIN_SCORE = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// LanceKnowledgeStore
// ─────────────────────────────────────────────────────────────────────────────

export class LanceKnowledgeStore {
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
   * Initialize the LanceDB connection and table.
   */
  private async initialize(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      // Ensure directory exists
      await fs.mkdir(this.dbPath, { recursive: true });

      // Connect to LanceDB
      this.db = await lancedb.connect(this.dbPath);

      // Check if table exists
      const tableNames = await this.db.tableNames();

      if (tableNames.includes(TABLE_NAME)) {
        // Open existing table
        this.table = await this.db.openTable(TABLE_NAME);
      }
      // If table doesn't exist, it will be created on first add
    })();

    return this.initPromise;
  }

  /**
   * Ensure table exists, creating it with sample data if needed.
   */
  private async ensureTable(sampleEntry: KnowledgeVector): Promise<Table> {
    if (this.table) return this.table;

    if (!this.db) {
      throw new Error("LanceDB not initialized");
    }

    // Create table with first entry (LanceDB infers schema from data)
    this.table = await this.db.createTable(
      TABLE_NAME,
      [sampleEntry as unknown as Record<string, unknown>]
    );

    return this.table;
  }

  /**
   * Add a new knowledge entry.
   */
  async add(input: AddKnowledgeInput): Promise<string> {
    await this.initialize();

    // Generate embedding
    const { vector } = await embeddingService.embed(input.content);

    const id = crypto.randomUUID();
    const now = Date.now();

    const entry: KnowledgeVector = {
      id,
      type: input.type,
      content: input.content,
      vector: Array.from(vector),
      confidence: input.confidence,
      usageCount: 0,
      lastUsedAt: now,
      createdAt: now,
      evidence: JSON.stringify(input.evidence || []),
      folderId: input.folderId,
    };

    // Check if table exists before ensuring
    const tableExisted = this.table !== null;

    // Ensure table exists (create with this entry if needed)
    await this.ensureTable(entry);

    // If table was just created, entry is already added via createTable
    if (tableExisted && this.table) {
      await this.table.add([entry as unknown as Record<string, unknown>]);
    }

    return id;
  }

  /**
   * Add multiple knowledge entries in batch.
   */
  async addBatch(inputs: AddKnowledgeInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];

    await this.initialize();

    // Generate embeddings in batch
    const contents = inputs.map((i) => i.content);
    const { vectors } = await embeddingService.embedBatch(contents);

    const now = Date.now();
    const ids: string[] = [];

    const entries: KnowledgeVector[] = inputs.map((input, index) => {
      const id = crypto.randomUUID();
      ids.push(id);

      return {
        id,
        type: input.type,
        content: input.content,
        vector: Array.from(vectors[index]),
        confidence: input.confidence,
        usageCount: 0,
        lastUsedAt: now,
        createdAt: now,
        evidence: JSON.stringify(input.evidence || []),
        folderId: input.folderId,
      };
    });

    // Check if table exists before ensuring
    const tableExisted = this.table !== null;

    // Ensure table exists (create with first entry if needed)
    await this.ensureTable(entries[0]);

    if (!this.table) {
      throw new Error("Failed to initialize LanceDB table");
    }

    // If table was just created, first entry is already added
    const entriesToAdd = tableExisted
      ? entries
      : entries.slice(1);

    if (entriesToAdd.length > 0) {
      await this.table.add(
        entriesToAdd as unknown as Record<string, unknown>[]
      );
    }

    return ids;
  }

  /**
   * Search for similar knowledge entries.
   */
  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<KnowledgeSearchResult[]> {
    await this.initialize();

    if (!this.table) {
      throw new Error("LanceDB table not initialized");
    }

    const {
      limit = DEFAULT_SEARCH_LIMIT,
      minScore = DEFAULT_MIN_SCORE,
      types,
      folderId,
    } = options;

    // Generate query embedding
    const { vector } = await embeddingService.embed(query);

    // Build search query
    let searchQuery = this.table
      .search(Array.from(vector))
      .limit(limit * 2); // Over-fetch to filter by score

    // Apply type filter if specified
    if (types && types.length > 0) {
      const typeFilter = types.map((t) => `type = '${t}'`).join(" OR ");
      searchQuery = searchQuery.where(`(${typeFilter})`);
    }

    // Apply folder filter if specified
    if (folderId) {
      searchQuery = searchQuery.where(`folderId = '${folderId}'`);
    }

    // Execute search
    const results = await searchQuery.toArray();

    // Filter by minimum score and map to result format
    const filtered: KnowledgeSearchResult[] = [];

    for (const row of results) {
      // LanceDB returns _distance (lower is better) or _score (higher is better)
      // Convert distance to similarity: score = 1 - distance/2 (for L2)
      // For cosine distance: score = 1 - distance
      const distance = row._distance ?? 0;
      const score = Math.max(0, 1 - distance);

      if (score >= minScore) {
        filtered.push({
          id: row.id,
          type: row.type as KnowledgeType,
          content: row.content,
          confidence: row.confidence,
          usageCount: row.usageCount,
          score,
          evidence: JSON.parse(row.evidence || "[]"),
        });
      }

      if (filtered.length >= limit) break;
    }

    return filtered;
  }

  /**
   * Get knowledge entry by ID.
   */
  async get(id: string): Promise<KnowledgeVector | null> {
    await this.initialize();

    if (!this.table) {
      throw new Error("LanceDB table not initialized");
    }

    const results = await this.table.search([]).where(`id = '${id}'`).toArray();

    if (results.length === 0) return null;

    return results[0] as unknown as KnowledgeVector;
  }

  /**
   * Update usage count and last used timestamp.
   */
  async recordUsage(id: string): Promise<void> {
    await this.initialize();

    if (!this.table) {
      throw new Error("LanceDB table not initialized");
    }

    // Get current entry
    const entry = await this.get(id);
    if (!entry) return;

    // Update with new values
    await this.table.update({
      where: `id = '${id}'`,
      values: {
        usageCount: entry.usageCount + 1,
        lastUsedAt: Date.now(),
      },
    });
  }

  /**
   * Update confidence score.
   */
  async updateConfidence(id: string, confidence: number): Promise<void> {
    await this.initialize();

    if (!this.table) {
      throw new Error("LanceDB table not initialized");
    }

    await this.table.update({
      where: `id = '${id}'`,
      values: { confidence },
    });
  }

  /**
   * Add evidence to an entry.
   */
  async addEvidence(id: string, taskId: string): Promise<void> {
    await this.initialize();

    if (!this.table) {
      throw new Error("LanceDB table not initialized");
    }

    // Get current entry
    const entry = await this.get(id);
    if (!entry) return;

    // Add to evidence list
    const evidence = JSON.parse(entry.evidence || "[]") as string[];
    if (!evidence.includes(taskId)) {
      evidence.push(taskId);
    }

    await this.table.update({
      where: `id = '${id}'`,
      values: { evidence: JSON.stringify(evidence) },
    });
  }

  /**
   * Delete a knowledge entry.
   */
  async delete(id: string): Promise<void> {
    await this.initialize();

    if (!this.table) {
      throw new Error("LanceDB table not initialized");
    }

    await this.table.delete(`id = '${id}'`);
  }

  /**
   * Delete entries older than a certain date with zero usage.
   */
  async cleanupUnused(olderThanDays: number = 365): Promise<number> {
    await this.initialize();

    if (!this.table) {
      throw new Error("LanceDB table not initialized");
    }

    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    // Count before
    const before = await this.table.countRows();

    // Delete unused entries
    await this.table.delete(`usageCount = 0 AND createdAt < ${cutoff}`);

    // Count after
    const after = await this.table.countRows();

    return before - after;
  }

  /**
   * Get statistics about the knowledge store.
   */
  async getStats(): Promise<{
    totalEntries: number;
    byType: Record<KnowledgeType, number>;
    avgConfidence: number;
    avgUsageCount: number;
  }> {
    await this.initialize();

    if (!this.table) {
      throw new Error("LanceDB table not initialized");
    }

    const totalEntries = await this.table.countRows();

    if (totalEntries === 0) {
      return {
        totalEntries: 0,
        byType: {
          pattern: 0,
          gotcha: 0,
          insight: 0,
          command: 0,
          tool: 0,
          agent: 0,
        },
        avgConfidence: 0,
        avgUsageCount: 0,
      };
    }

    // Get all entries for stats (in production, use aggregation)
    const entries = await this.table.search([]).limit(10000).toArray();

    const byType: Record<KnowledgeType, number> = {
      pattern: 0,
      gotcha: 0,
      insight: 0,
      command: 0,
      tool: 0,
      agent: 0,
    };

    let totalConfidence = 0;
    let totalUsageCount = 0;

    for (const entry of entries) {
      const type = entry.type as KnowledgeType;
      byType[type] = (byType[type] || 0) + 1;
      totalConfidence += entry.confidence;
      totalUsageCount += entry.usageCount;
    }

    return {
      totalEntries,
      byType,
      avgConfidence: totalConfidence / totalEntries,
      avgUsageCount: totalUsageCount / totalEntries,
    };
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    // LanceDB connections don't need explicit closing in most cases
    this.db = null;
    this.table = null;
    this.initPromise = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory function
// ─────────────────────────────────────────────────────────────────────────────

const storeCache = new Map<string, LanceKnowledgeStore>();

/**
 * Get a knowledge store for a folder (or global).
 */
export function getKnowledgeStore(folderId?: string): LanceKnowledgeStore {
  const key = folderId || "global";

  if (!storeCache.has(key)) {
    storeCache.set(key, new LanceKnowledgeStore(folderId));
  }

  return storeCache.get(key)!;
}

/**
 * Get the global knowledge store.
 */
export function getGlobalKnowledgeStore(): LanceKnowledgeStore {
  return getKnowledgeStore();
}
