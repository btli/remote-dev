/**
 * SDK Memory Types - Hierarchical Working Memory System
 *
 * Defines the three-tier memory architecture inspired by the Confucius Code Agent (CCA) paper:
 * - Short-term memory: Recent commands, tool results, observations
 * - Working memory: Current task context, active files, hypotheses
 * - Long-term memory: Project knowledge, conventions, learned patterns
 *
 * Each tier has different retention policies and retrieval characteristics.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Memory Entry Types
// ─────────────────────────────────────────────────────────────────────────────

/** Base properties for all memory entries */
export interface BaseMemoryEntry {
  /** Unique identifier for the memory entry */
  id: string;
  /** Session that created this entry */
  sessionId: string;
  /** User that owns this entry */
  userId: string;
  /** Optional folder context */
  folderId: string | null;
  /** When this entry was created */
  createdAt: Date;
  /** When this entry was last accessed */
  lastAccessedAt: Date;
  /** Number of times this entry has been accessed */
  accessCount: number;
  /** Content hash for deduplication */
  contentHash: string;
  /** Vector embedding for semantic search (stored separately) */
  embeddingId: string | null;
}

/** Memory entry content types */
export type MemoryContentType =
  | "command"
  | "tool_result"
  | "observation"
  | "file_context"
  | "hypothesis"
  | "plan"
  | "convention"
  | "pattern"
  | "gotcha"
  | "skill";

/** Short-term memory entry - recent commands, results, observations */
export interface ShortTermEntry extends BaseMemoryEntry {
  tier: "short_term";
  contentType: "command" | "tool_result" | "observation";
  content: string;
  /** Source command or tool that generated this */
  source: string | null;
  /** Relevance score (0-1) based on recency and frequency */
  relevance: number;
  /** Time-to-live in seconds (default: 3600 = 1 hour) */
  ttl: number;
  /** Associated metadata */
  metadata: ShortTermMetadata;
}

export interface ShortTermMetadata {
  /** Command that generated this (for tool results) */
  command?: string;
  /** Exit code (for command results) */
  exitCode?: number;
  /** Execution duration in ms */
  durationMs?: number;
  /** Tags for filtering */
  tags?: string[];
}

/** Working memory entry - current task context, active files, hypotheses */
export interface WorkingEntry extends BaseMemoryEntry {
  tier: "working";
  contentType: "file_context" | "hypothesis" | "plan";
  content: string;
  /** Task ID this is associated with */
  taskId: string | null;
  /** Priority within working memory (higher = more important) */
  priority: number;
  /** Confidence score for hypotheses (0-1) */
  confidence: number;
  /** Associated metadata */
  metadata: WorkingMetadata;
}

export interface WorkingMetadata {
  /** File path for file_context type */
  filePath?: string;
  /** Line range for file context */
  lineRange?: { start: number; end: number };
  /** Related file paths */
  relatedFiles?: string[];
  /** Dependencies on other working entries */
  dependsOn?: string[];
  /** Status: active, validated, invalidated */
  status?: "active" | "validated" | "invalidated";
}

/** Long-term memory entry - project knowledge, conventions, patterns */
export interface LongTermEntry extends BaseMemoryEntry {
  tier: "long_term";
  contentType: "convention" | "pattern" | "gotcha" | "skill";
  /** Human-readable name for this knowledge */
  name: string;
  /** Detailed description */
  description: string;
  /** Structured content (code snippets, examples, etc.) */
  content: string;
  /** Confidence score (0-1) based on validation */
  confidence: number;
  /** Source sessions that contributed to this knowledge */
  sourceSessions: string[];
  /** Applicability conditions */
  applicability: LongTermApplicability;
  /** Associated metadata */
  metadata: LongTermMetadata;
}

export interface LongTermApplicability {
  /** Project types this applies to (e.g., "nextjs", "fastapi") */
  projectTypes?: string[];
  /** Task types this applies to (e.g., "feature", "bugfix") */
  taskTypes?: string[];
  /** File patterns this applies to (e.g., "*.tsx", "src/services/*") */
  filePatterns?: string[];
  /** Conditions that must be true for this to apply */
  conditions?: string[];
}

export interface LongTermMetadata {
  /** Code snippet examples */
  examples?: string[];
  /** Counter-examples (what NOT to do) */
  antiPatterns?: string[];
  /** Related knowledge entries */
  relatedKnowledge?: string[];
  /** External documentation links */
  docLinks?: string[];
  /** When this was last validated */
  lastValidatedAt?: Date;
  /** Number of times this was successfully applied */
  successCount?: number;
  /** Number of times this led to issues */
  failureCount?: number;
}

/** Union type for all memory entries */
export type MemoryEntry = ShortTermEntry | WorkingEntry | LongTermEntry;

/** Memory tier type */
export type MemoryTier = "short_term" | "working" | "long_term";

// ─────────────────────────────────────────────────────────────────────────────
// Memory Operations
// ─────────────────────────────────────────────────────────────────────────────

/** Input for storing a new memory entry */
export interface StoreMemoryInput {
  sessionId: string;
  userId: string;
  folderId?: string | null;
  tier: MemoryTier;
  contentType: MemoryContentType;
  content: string;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  taskId?: string;
  priority?: number;
  confidence?: number;
  ttl?: number;
}

/** Query for retrieving memory entries */
export interface MemoryQuery {
  /** Text query for semantic search */
  query?: string;
  /** Filter by session */
  sessionId?: string;
  /** Filter by user */
  userId?: string;
  /** Filter by folder */
  folderId?: string;
  /** Filter by tier(s) */
  tiers?: MemoryTier[];
  /** Filter by content type(s) */
  contentTypes?: MemoryContentType[];
  /** Filter by task */
  taskId?: string;
  /** Minimum relevance/confidence score */
  minScore?: number;
  /** Maximum number of results */
  limit?: number;
  /** Include expired entries */
  includeExpired?: boolean;
}

/** Result from memory retrieval */
export interface MemoryResult {
  entry: MemoryEntry;
  /** Relevance score from search (0-1) */
  score: number;
  /** Explanation of why this was returned */
  reason?: string;
}

/** Result from memory consolidation */
export interface ConsolidationResult {
  /** Number of entries promoted from short-term to working */
  promotedToWorking: number;
  /** Number of entries consolidated into long-term */
  consolidatedToLongTerm: number;
  /** Number of entries pruned (deleted) */
  pruned: number;
  /** New long-term entries created from consolidation */
  newKnowledge: LongTermEntry[];
  /** Duration of consolidation in ms */
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Store Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Interface for a memory store implementation.
 * Implementations may use SQLite, PostgreSQL, or other backends.
 */
export interface IMemoryStore {
  /** Store a new memory entry */
  store(input: StoreMemoryInput): Promise<MemoryEntry>;

  /** Retrieve memory entries matching a query */
  retrieve(query: MemoryQuery): Promise<MemoryResult[]>;

  /** Get a specific entry by ID */
  get(id: string): Promise<MemoryEntry | null>;

  /** Update an existing entry */
  update(id: string, updates: Partial<MemoryEntry>): Promise<MemoryEntry>;

  /** Delete an entry */
  delete(id: string): Promise<void>;

  /** Record access to an entry (updates lastAccessedAt and accessCount) */
  recordAccess(id: string): Promise<void>;

  /** Promote an entry to a higher tier */
  promote(id: string, targetTier: MemoryTier): Promise<MemoryEntry>;

  /** Run consolidation process */
  consolidate(userId: string, folderId?: string): Promise<ConsolidationResult>;

  /** Prune expired and low-relevance entries */
  prune(userId: string, options?: PruneOptions): Promise<number>;

  /** Get statistics about memory usage */
  getStats(userId: string, folderId?: string): Promise<MemoryStats>;
}

export interface PruneOptions {
  /** Only prune entries older than this (in seconds) */
  olderThan?: number;
  /** Only prune entries below this relevance score */
  maxRelevance?: number;
  /** Maximum entries to prune in one operation */
  limit?: number;
  /** Dry run - return count but don't delete */
  dryRun?: boolean;
}

export interface MemoryStats {
  /** Total entries by tier */
  countByTier: Record<MemoryTier, number>;
  /** Total entries by content type */
  countByType: Record<MemoryContentType, number>;
  /** Average relevance/confidence by tier */
  avgScoreByTier: Record<MemoryTier, number>;
  /** Storage size in bytes (estimated) */
  storageSizeBytes: number;
  /** Last consolidation timestamp */
  lastConsolidationAt: Date | null;
  /** Last prune timestamp */
  lastPruneAt: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchical Memory Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-level interface for the hierarchical memory system.
 * Wraps the memory store with semantic search and automatic tiering.
 */
export interface IHierarchicalMemory {
  /** Store to short-term memory */
  remember(content: string, options?: RememberOptions): Promise<ShortTermEntry>;

  /** Store to working memory */
  hold(content: string, options?: HoldOptions): Promise<WorkingEntry>;

  /** Store to long-term memory */
  learn(knowledge: LearnInput): Promise<LongTermEntry>;

  /** Context-aware retrieval across all tiers */
  recall(query: string, context?: RecallContext): Promise<MemoryResult[]>;

  /** Get relevant context for a task */
  getTaskContext(taskId: string): Promise<MemoryResult[]>;

  /** Get relevant context for a file */
  getFileContext(filePath: string): Promise<MemoryResult[]>;

  /** Run automatic consolidation */
  consolidate(): Promise<ConsolidationResult>;

  /** Clear working memory for a completed task */
  clearTask(taskId: string): Promise<number>;

  /** Get memory statistics */
  getStats(): Promise<MemoryStats>;
}

export interface RememberOptions {
  contentType?: "command" | "tool_result" | "observation";
  source?: string;
  metadata?: ShortTermMetadata;
  ttl?: number;
}

export interface HoldOptions {
  contentType?: "file_context" | "hypothesis" | "plan";
  taskId?: string;
  priority?: number;
  confidence?: number;
  metadata?: WorkingMetadata;
}

export interface LearnInput {
  name: string;
  description: string;
  content: string;
  contentType: "convention" | "pattern" | "gotcha" | "skill";
  confidence?: number;
  applicability?: LongTermApplicability;
  metadata?: LongTermMetadata;
}

export interface RecallContext {
  /** Current task ID */
  taskId?: string;
  /** Current file path */
  filePath?: string;
  /** Project type */
  projectType?: string;
  /** Minimum score threshold */
  minScore?: number;
  /** Maximum results per tier */
  limitPerTier?: number;
}
