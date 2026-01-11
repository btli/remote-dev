/**
 * SessionMemoryService - Bridges orchestrator monitoring with memory capture
 *
 * This service integrates the hierarchical memory system with session monitoring:
 * - Auto-captures relevant session outputs (errors, patterns, gotchas) to memory
 * - Surfaces relevant memories when generating orchestrator insights
 * - Links memories to sessions and folders for scoped retrieval
 *
 * Memory Flow:
 * Session Activity → Error/Pattern Detection → Memory Storage → Insight Enrichment
 */
import { db } from "@/db";
import {
  sdkMemoryEntries,
  type MemoryTierType,
  type MemoryContentType,
} from "@/db/schema";
import { eq, and, desc, gte, or, isNull, like } from "drizzle-orm";
import { createHash } from "crypto";
import type { ScrollbackSnapshot } from "@/types/orchestrator";

/**
 * Error class for session memory operations
 */
export class SessionMemoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly sessionId?: string
  ) {
    super(message);
    this.name = "SessionMemoryError";
  }
}

/**
 * Memory entry input for storing observations
 */
export interface StoreMemoryInput {
  userId: string;
  sessionId?: string | null;
  folderId?: string | null;
  tier: MemoryTierType;
  contentType: MemoryContentType;
  content: string;
  name?: string;
  description?: string;
  taskId?: string;
  priority?: number;
  confidence?: number;
  relevance?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Retrieved memory entry
 */
export interface MemoryEntry {
  id: string;
  tier: MemoryTierType;
  contentType: MemoryContentType;
  content: string;
  name: string | null;
  description: string | null;
  sessionId: string | null;
  folderId: string | null;
  taskId: string | null;
  accessCount: number;
  relevance: number | null;
  confidence: number | null;
  createdAt: Date;
}

/**
 * Context for insight enrichment
 */
export interface InsightContext {
  relevantMemories: MemoryEntry[];
  previousPatterns: MemoryEntry[];
  knownGotchas: MemoryEntry[];
  sessionHistory: MemoryEntry[];
}

/**
 * Pattern detected in scrollback
 */
interface DetectedPattern {
  type: MemoryContentType;
  content: string;
  confidence: number;
  relevance: number;
  name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Storage Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute content hash for deduplication
 */
function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Compute expiry time for TTL-based entries
 */
function computeExpiresAt(tier: MemoryTierType, customTtl?: number): Date | null {
  if (tier === "long_term") return null;

  // Default TTLs: short_term = 5 min, working = 24 hours
  const ttlSeconds = customTtl ?? (tier === "short_term" ? 300 : 86400);
  return new Date(Date.now() + ttlSeconds * 1000);
}

/**
 * Store a memory entry linked to a session
 *
 * Handles deduplication - if identical content exists, updates access count instead.
 */
export async function storeSessionMemory(input: StoreMemoryInput): Promise<string> {
  const contentHash = computeContentHash(input.content);

  // Check for existing entry with same content hash
  const existing = await db
    .select()
    .from(sdkMemoryEntries)
    .where(
      and(
        eq(sdkMemoryEntries.userId, input.userId),
        eq(sdkMemoryEntries.contentHash, contentHash),
        eq(sdkMemoryEntries.tier, input.tier)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update access count for existing entry
    await db
      .update(sdkMemoryEntries)
      .set({
        accessCount: existing[0].accessCount + 1,
        lastAccessedAt: new Date(),
        updatedAt: new Date(),
        // Update relevance if new relevance is higher
        relevance: input.relevance && input.relevance > (existing[0].relevance ?? 0)
          ? input.relevance
          : existing[0].relevance,
      })
      .where(eq(sdkMemoryEntries.id, existing[0].id));

    return existing[0].id;
  }

  // Create new entry
  const [entry] = await db
    .insert(sdkMemoryEntries)
    .values({
      userId: input.userId,
      sessionId: input.sessionId,
      folderId: input.folderId || null,
      tier: input.tier,
      contentType: input.contentType,
      content: input.content,
      contentHash,
      name: input.name || null,
      description: input.description || null,
      taskId: input.taskId || null,
      priority: input.priority ?? 0,
      confidence: input.confidence ?? 0.5,
      relevance: input.relevance ?? 0.5,
      ttlSeconds: input.tier === "short_term" ? 300 : input.tier === "working" ? 86400 : null,
      expiresAt: computeExpiresAt(input.tier),
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    })
    .returning({ id: sdkMemoryEntries.id });

  return entry.id;
}

/**
 * Store an error observation from session scrollback
 */
export async function storeErrorObservation(
  userId: string,
  sessionId: string | null,
  folderId: string | null,
  errorContent: string,
  metadata?: {
    errorType?: string;
    stackTrace?: string;
    command?: string;
  }
): Promise<string> {
  return storeSessionMemory({
    userId,
    sessionId,
    folderId,
    tier: "short_term",
    contentType: "observation",
    content: errorContent,
    name: metadata?.errorType ? `Error: ${metadata.errorType}` : "Error detected",
    confidence: 0.8,
    relevance: 0.7,
    metadata,
  });
}

/**
 * Store a pattern learned from session activity
 */
export async function storePatternObservation(
  userId: string,
  sessionId: string | null,
  folderId: string | null,
  pattern: string,
  patternName: string,
  confidence: number = 0.7
): Promise<string> {
  return storeSessionMemory({
    userId,
    sessionId,
    folderId,
    tier: "working",
    contentType: "pattern",
    content: pattern,
    name: patternName,
    confidence,
    relevance: 0.6,
  });
}

/**
 * Store a gotcha (known pitfall) from session experience
 */
export async function storeGotcha(
  userId: string,
  sessionId: string | null,
  folderId: string | null,
  gotcha: string,
  description: string
): Promise<string> {
  return storeSessionMemory({
    userId,
    sessionId,
    folderId,
    tier: "long_term",
    contentType: "gotcha",
    content: gotcha,
    name: "Gotcha",
    description,
    confidence: 0.9,
    relevance: 0.8,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Retrieval Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get relevant memories for a session
 *
 * Retrieves memories from all tiers, prioritizing:
 * 1. Session-specific memories
 * 2. Folder-scoped memories
 * 3. User-level long-term memories
 */
export async function getRelevantMemoriesForSession(
  userId: string,
  sessionId: string | null,
  folderId: string | null,
  limit: number = 20
): Promise<MemoryEntry[]> {
  const conditions = [
    eq(sdkMemoryEntries.userId, userId),
    // Exclude expired entries
    or(
      isNull(sdkMemoryEntries.expiresAt),
      gte(sdkMemoryEntries.expiresAt, new Date())
    )!,
  ];

  // Get session and folder memories
  const sessionCondition = or(
    sessionId ? eq(sdkMemoryEntries.sessionId, sessionId) : undefined,
    folderId ? eq(sdkMemoryEntries.folderId, folderId) : undefined,
    eq(sdkMemoryEntries.tier, "long_term") // Always include long-term
  );

  if (sessionCondition) {
    conditions.push(sessionCondition);
  }

  const entries = await db
    .select()
    .from(sdkMemoryEntries)
    .where(and(...conditions))
    .orderBy(
      desc(sdkMemoryEntries.relevance),
      desc(sdkMemoryEntries.lastAccessedAt)
    )
    .limit(limit);

  return entries.map(mapToMemoryEntry);
}

/**
 * Get memories by content type for a folder
 */
export async function getMemoriesByType(
  userId: string,
  folderId: string | null,
  contentType: MemoryContentType,
  limit: number = 10
): Promise<MemoryEntry[]> {
  const conditions = [
    eq(sdkMemoryEntries.userId, userId),
    eq(sdkMemoryEntries.contentType, contentType),
    or(
      isNull(sdkMemoryEntries.expiresAt),
      gte(sdkMemoryEntries.expiresAt, new Date())
    )!,
  ];

  if (folderId) {
    conditions.push(
      or(
        eq(sdkMemoryEntries.folderId, folderId),
        eq(sdkMemoryEntries.tier, "long_term")
      )!
    );
  }

  const entries = await db
    .select()
    .from(sdkMemoryEntries)
    .where(and(...conditions))
    .orderBy(desc(sdkMemoryEntries.relevance))
    .limit(limit);

  return entries.map(mapToMemoryEntry);
}

/**
 * Search memories by content
 */
export async function searchMemories(
  userId: string,
  query: string,
  folderId?: string | null,
  limit: number = 10
): Promise<MemoryEntry[]> {
  const conditions = [
    eq(sdkMemoryEntries.userId, userId),
    or(
      isNull(sdkMemoryEntries.expiresAt),
      gte(sdkMemoryEntries.expiresAt, new Date())
    )!,
    like(sdkMemoryEntries.content, `%${query}%`),
  ];

  if (folderId) {
    conditions.push(
      or(
        eq(sdkMemoryEntries.folderId, folderId),
        eq(sdkMemoryEntries.tier, "long_term")
      )!
    );
  }

  const entries = await db
    .select()
    .from(sdkMemoryEntries)
    .where(and(...conditions))
    .orderBy(desc(sdkMemoryEntries.relevance))
    .limit(limit);

  return entries.map(mapToMemoryEntry);
}

/**
 * Map database row to MemoryEntry
 */
function mapToMemoryEntry(row: typeof sdkMemoryEntries.$inferSelect): MemoryEntry {
  return {
    id: row.id,
    tier: row.tier as MemoryTierType,
    contentType: row.contentType as MemoryContentType,
    content: row.content,
    name: row.name,
    description: row.description,
    sessionId: row.sessionId,
    folderId: row.folderId,
    taskId: row.taskId,
    accessCount: row.accessCount,
    relevance: row.relevance,
    confidence: row.confidence,
    createdAt: row.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Insight Enrichment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get context for enriching an orchestrator insight
 *
 * Retrieves relevant memories, previous patterns, known gotchas, and session
 * history to provide context for insight generation.
 */
export async function getInsightContext(
  userId: string,
  sessionId: string | null,
  folderId: string | null
): Promise<InsightContext> {
  const [relevantMemories, previousPatterns, knownGotchas, sessionHistory] =
    await Promise.all([
      getRelevantMemoriesForSession(userId, sessionId, folderId, 10),
      getMemoriesByType(userId, folderId, "pattern", 5),
      getMemoriesByType(userId, folderId, "gotcha", 5),
      getSessionHistoryMemories(userId, sessionId, 10),
    ]);

  return {
    relevantMemories,
    previousPatterns,
    knownGotchas,
    sessionHistory,
  };
}

/**
 * Get recent memories specifically for a session
 */
async function getSessionHistoryMemories(
  userId: string,
  sessionId: string | null,
  limit: number = 10
): Promise<MemoryEntry[]> {
  // If no sessionId, return empty array
  if (!sessionId) {
    return [];
  }

  const entries = await db
    .select()
    .from(sdkMemoryEntries)
    .where(
      and(
        eq(sdkMemoryEntries.userId, userId),
        eq(sdkMemoryEntries.sessionId, sessionId),
        or(
          isNull(sdkMemoryEntries.expiresAt),
          gte(sdkMemoryEntries.expiresAt, new Date())
        )!
      )
    )
    .orderBy(desc(sdkMemoryEntries.createdAt))
    .limit(limit);

  return entries.map(mapToMemoryEntry);
}

/**
 * Format insight context as text for inclusion in insights
 */
export function formatInsightContextAsText(context: InsightContext): string {
  const lines: string[] = [];

  if (context.knownGotchas.length > 0) {
    lines.push("⚠️ Known Gotchas:");
    for (const gotcha of context.knownGotchas.slice(0, 3)) {
      lines.push(`  - ${gotcha.content}`);
    }
    lines.push("");
  }

  if (context.previousPatterns.length > 0) {
    lines.push("📋 Relevant Patterns:");
    for (const pattern of context.previousPatterns.slice(0, 3)) {
      lines.push(`  - ${pattern.name || pattern.content.slice(0, 100)}`);
    }
    lines.push("");
  }

  if (context.sessionHistory.length > 0) {
    lines.push("📜 Recent Session Activity:");
    for (const memory of context.sessionHistory.slice(0, 5)) {
      const type = memory.contentType.replace("_", " ");
      lines.push(`  - [${type}] ${memory.content.slice(0, 80)}...`);
    }
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Scrollback Analysis and Pattern Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error patterns to detect in scrollback
 */
const ERROR_PATTERNS = [
  { regex: /error[:\s]/i, type: "error" as const, name: "Generic Error" },
  { regex: /Error:\s*(.+)/i, type: "error" as const, name: "Error Message" },
  { regex: /exception[:\s]/i, type: "error" as const, name: "Exception" },
  { regex: /failed[:\s]/i, type: "error" as const, name: "Failure" },
  { regex: /permission denied/i, type: "error" as const, name: "Permission Denied" },
  { regex: /command not found/i, type: "error" as const, name: "Command Not Found" },
  { regex: /no such file/i, type: "error" as const, name: "File Not Found" },
  { regex: /syntax error/i, type: "error" as const, name: "Syntax Error" },
  { regex: /type error/i, type: "error" as const, name: "Type Error" },
  { regex: /cannot find module/i, type: "error" as const, name: "Module Not Found" },
];

/**
 * Analyze scrollback for patterns worth storing
 */
export function analyzeScrollbackForPatterns(
  scrollback: ScrollbackSnapshot
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  const content = scrollback.content;
  const lines = content.split("\n");

  // Check for errors
  for (const line of lines) {
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.regex.test(line)) {
        patterns.push({
          type: "observation",
          content: line.trim(),
          confidence: 0.8,
          relevance: 0.7,
          name: pattern.name,
        });
        break; // Only match first pattern per line
      }
    }
  }

  // Limit to avoid flooding memory
  return patterns.slice(0, 5);
}

/**
 * Process scrollback and store relevant observations
 *
 * Call this when capturing scrollback for a potentially stalled session.
 * Extracts errors and patterns and stores them as short-term memories.
 */
export async function processScrollbackForMemory(
  userId: string,
  sessionId: string | null,
  folderId: string | null,
  scrollback: ScrollbackSnapshot
): Promise<string[]> {
  const patterns = analyzeScrollbackForPatterns(scrollback);
  const storedIds: string[] = [];

  for (const pattern of patterns) {
    try {
      const id = await storeSessionMemory({
        userId,
        sessionId,
        folderId,
        tier: "short_term",
        contentType: pattern.type,
        content: pattern.content,
        name: pattern.name,
        confidence: pattern.confidence,
        relevance: pattern.relevance,
        metadata: {
          source: "scrollback_analysis",
          sessionId: scrollback.sessionId,
          timestamp: scrollback.timestamp.toISOString(),
        },
      });
      storedIds.push(id);
    } catch (error) {
      console.error("[SessionMemoryService] Failed to store pattern:", error);
    }
  }

  return storedIds;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Lifecycle Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store session start context as working memory
 */
export async function onSessionStart(
  userId: string,
  sessionId: string | null,
  folderId: string | null,
  context: {
    projectPath?: string;
    workingDirectory?: string;
    startupCommand?: string;
  }
): Promise<string | null> {
  if (!context.projectPath && !context.workingDirectory) {
    return null;
  }

  const content = [
    context.projectPath && `Project: ${context.projectPath}`,
    context.workingDirectory && `Working Directory: ${context.workingDirectory}`,
    context.startupCommand && `Startup Command: ${context.startupCommand}`,
  ]
    .filter(Boolean)
    .join("\n");

  return storeSessionMemory({
    userId,
    sessionId,
    folderId,
    tier: "working",
    contentType: "file_context",
    content,
    name: "Session Context",
    confidence: 1.0,
    relevance: 0.5,
    metadata: context,
  });
}

/**
 * Promote important working memories to long-term on session close
 *
 * Identifies high-confidence patterns and gotchas that should persist.
 */
export async function onSessionClose(
  userId: string,
  sessionId: string | null
): Promise<number> {
  // If no sessionId, nothing to promote
  if (!sessionId) {
    return 0;
  }

  // Find high-value working memories from this session
  const candidates = await db
    .select()
    .from(sdkMemoryEntries)
    .where(
      and(
        eq(sdkMemoryEntries.userId, userId),
        eq(sdkMemoryEntries.sessionId, sessionId),
        eq(sdkMemoryEntries.tier, "working"),
        gte(sdkMemoryEntries.confidence, 0.8),
        gte(sdkMemoryEntries.accessCount, 2)
      )
    );

  let promoted = 0;

  for (const candidate of candidates) {
    // Promote patterns and gotchas with high confidence and access
    if (
      candidate.contentType === "pattern" ||
      candidate.contentType === "gotcha" ||
      candidate.contentType === "convention"
    ) {
      await db
        .update(sdkMemoryEntries)
        .set({
          tier: "long_term",
          ttlSeconds: null,
          expiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(sdkMemoryEntries.id, candidate.id));

      promoted++;
    }
  }

  return promoted;
}

/**
 * Clean up expired memories (call periodically)
 */
export async function cleanupExpiredMemories(): Promise<number> {
  const now = new Date();

  const result = await db
    .delete(sdkMemoryEntries)
    .where(
      and(
        gte(sdkMemoryEntries.expiresAt, new Date(0)), // Has expiry
        lt(sdkMemoryEntries.expiresAt, now) // Expired
      )
    )
    .returning({ id: sdkMemoryEntries.id });

  return result.length;
}

// Import lt for comparison
import { lt } from "drizzle-orm";
