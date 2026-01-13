/**
 * SessionContextInjectionService - Inject memory context into agent sessions
 *
 * Before an agent starts, this service retrieves relevant memories and formats
 * them as context that can be injected into the agent's environment.
 *
 * Context injection methods:
 * 1. CLAUDE.md append: Add memory context section to project config
 * 2. Environment variable: Set REMOTE_DEV_CONTEXT with JSON payload
 * 3. Context file: Write .remote-dev/context.md in project directory
 *
 * Memory retrieval uses semantic matching to find:
 * - Relevant patterns for the project type
 * - Known gotchas and common issues
 * - User conventions and preferences
 * - Recent session observations
 */
import { db } from "@/db";
import {
  sdkMemoryEntries,
  sdkNotes,
  sdkInsights,
  sessionFolders,
  terminalSessions,
  type MemoryTierType,
  type MemoryContentType,
  type NoteType,
  type InsightType,
  type InsightApplicability,
} from "@/db/schema";
import { eq, and, desc, gte, or, isNull, like, inArray, asc } from "drizzle-orm";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";

/**
 * Error class for context injection operations
 */
export class ContextInjectionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly sessionId?: string
  ) {
    super(message);
    this.name = "ContextInjectionError";
  }
}

/**
 * Memory entry for context formatting
 */
interface MemoryForContext {
  id: string;
  tier: MemoryTierType;
  contentType: MemoryContentType;
  content: string;
  name: string | null;
  relevance: number | null;
  confidence: number | null;
}

/**
 * Note entry for context formatting
 */
interface NoteForContext {
  id: string;
  type: NoteType;
  title: string | null;
  content: string;
  tags: string[];
  priority: number | null;
  pinned: boolean;
}

/**
 * Insight entry for context formatting
 */
interface InsightForContext {
  id: string;
  type: InsightType;
  applicability: InsightApplicability;
  title: string;
  description: string;
  confidence: number;
  applicationCount: number | null;
  verified: boolean;
}

/**
 * Context section categories
 */
interface ContextSections {
  /** Known patterns and conventions */
  patterns: MemoryForContext[];
  /** Known pitfalls and gotchas */
  gotchas: MemoryForContext[];
  /** User preferences and conventions */
  conventions: MemoryForContext[];
  /** Recent observations from this folder */
  recentObservations: MemoryForContext[];
  /** Learned skills and procedures */
  skills: MemoryForContext[];
  /** Relevant notes (pinned, high-priority, or recent) */
  notes: NoteForContext[];
  /** Active insights for this folder */
  insights: InsightForContext[];
}

/**
 * Formatted context ready for injection
 */
export interface InjectionContext {
  /** Markdown-formatted context for config files */
  markdown: string;
  /** JSON payload for environment variable */
  json: string;
  /** Summary statistics */
  stats: {
    totalMemories: number;
    patterns: number;
    gotchas: number;
    conventions: number;
    skills: number;
    observations: number;
    notes: number;
    insights: number;
  };
}

/**
 * Context injection options
 */
export interface ContextInjectionOptions {
  /** Maximum memories to include per category */
  maxPerCategory?: number;
  /** Minimum relevance score (0-1) */
  minRelevance?: number;
  /** Minimum confidence score (0-1) */
  minConfidence?: number;
  /** Include recent observations */
  includeObservations?: boolean;
  /** Include skills */
  includeSkills?: boolean;
  /** Include notes */
  includeNotes?: boolean;
  /** Include insights */
  includeInsights?: boolean;
  /** Custom keywords to boost relevance */
  keywords?: string[];
}

const DEFAULT_OPTIONS: Required<ContextInjectionOptions> = {
  maxPerCategory: 5,
  minRelevance: 0.4,
  minConfidence: 0.5,
  includeObservations: true,
  includeSkills: true,
  includeNotes: true,
  includeInsights: true,
  keywords: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Memory Retrieval
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve relevant memories for context injection
 */
export async function getMemoriesForContext(
  userId: string,
  folderId: string | null,
  options: ContextInjectionOptions = {}
): Promise<ContextSections> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Build base conditions
  const baseConditions = [
    eq(sdkMemoryEntries.userId, userId),
    or(
      isNull(sdkMemoryEntries.expiresAt),
      gte(sdkMemoryEntries.expiresAt, new Date())
    )!,
    gte(sdkMemoryEntries.confidence, opts.minConfidence),
    gte(sdkMemoryEntries.relevance, opts.minRelevance),
  ];

  // Scope to folder or include long-term globally
  if (folderId) {
    baseConditions.push(
      or(
        eq(sdkMemoryEntries.folderId, folderId),
        eq(sdkMemoryEntries.tier, "long_term")
      )!
    );
  }

  // Fetch memories by content type
  const fetchByType = async (
    contentTypes: MemoryContentType[],
    limit: number
  ): Promise<MemoryForContext[]> => {
    const entries = await db
      .select({
        id: sdkMemoryEntries.id,
        tier: sdkMemoryEntries.tier,
        contentType: sdkMemoryEntries.contentType,
        content: sdkMemoryEntries.content,
        name: sdkMemoryEntries.name,
        relevance: sdkMemoryEntries.relevance,
        confidence: sdkMemoryEntries.confidence,
      })
      .from(sdkMemoryEntries)
      .where(
        and(
          ...baseConditions,
          inArray(sdkMemoryEntries.contentType, contentTypes)
        )
      )
      .orderBy(desc(sdkMemoryEntries.relevance), desc(sdkMemoryEntries.confidence))
      .limit(limit);

    return entries.map((e) => ({
      ...e,
      tier: e.tier as MemoryTierType,
      contentType: e.contentType as MemoryContentType,
    }));
  };

  // Fetch each category
  const [patterns, gotchas, conventions, skills, recentObservations] =
    await Promise.all([
      fetchByType(["pattern"], opts.maxPerCategory),
      fetchByType(["gotcha"], opts.maxPerCategory),
      fetchByType(["convention"], opts.maxPerCategory),
      opts.includeSkills
        ? fetchByType(["skill"], opts.maxPerCategory)
        : Promise.resolve([]),
      opts.includeObservations
        ? fetchByType(["observation"], Math.ceil(opts.maxPerCategory / 2))
        : Promise.resolve([]),
    ]);

  // Fetch notes and insights
  const [notes, insights] = await Promise.all([
    opts.includeNotes
      ? getNotesForContext(userId, folderId, opts.maxPerCategory)
      : Promise.resolve([]),
    opts.includeInsights
      ? getInsightsForContext(userId, folderId, opts.minConfidence, opts.maxPerCategory)
      : Promise.resolve([]),
  ]);

  return {
    patterns,
    gotchas,
    conventions,
    skills,
    recentObservations,
    notes,
    insights,
  };
}

/**
 * Retrieve relevant notes for context injection
 *
 * Prioritizes:
 * 1. Pinned notes
 * 2. High-priority notes (priority >= 0.7)
 * 3. Recent notes (last 24 hours)
 *
 * Excludes archived notes.
 */
async function getNotesForContext(
  userId: string,
  folderId: string | null,
  limit: number
): Promise<NoteForContext[]> {
  // Build conditions - pinned or high priority or recent
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const baseConditions = [
    eq(sdkNotes.userId, userId),
    eq(sdkNotes.archived, false),
  ];

  // Scope to folder (notes don't have global scope like long-term memories)
  if (folderId) {
    baseConditions.push(eq(sdkNotes.folderId, folderId));
  }

  // Fetch pinned and high-priority notes first
  const notes = await db
    .select({
      id: sdkNotes.id,
      type: sdkNotes.type,
      title: sdkNotes.title,
      content: sdkNotes.content,
      tagsJson: sdkNotes.tagsJson,
      priority: sdkNotes.priority,
      pinned: sdkNotes.pinned,
      createdAt: sdkNotes.createdAt,
    })
    .from(sdkNotes)
    .where(
      and(
        ...baseConditions,
        or(
          eq(sdkNotes.pinned, true),
          gte(sdkNotes.priority, 0.7),
          gte(sdkNotes.createdAt, oneDayAgo)
        )
      )
    )
    .orderBy(
      desc(sdkNotes.pinned),
      desc(sdkNotes.priority),
      desc(sdkNotes.createdAt)
    )
    .limit(limit);

  return notes.map((n) => ({
    id: n.id,
    type: n.type as NoteType,
    title: n.title,
    content: n.content,
    tags: JSON.parse(n.tagsJson || "[]") as string[],
    priority: n.priority,
    pinned: n.pinned ?? false,
  }));
}

/**
 * Retrieve relevant insights for context injection
 *
 * Retrieves active insights that are either:
 * 1. Global (applicable everywhere)
 * 2. Scoped to this folder
 *
 * Prioritizes by confidence and application count.
 */
async function getInsightsForContext(
  userId: string,
  folderId: string | null,
  minConfidence: number,
  limit: number
): Promise<InsightForContext[]> {
  const baseConditions = [
    eq(sdkInsights.userId, userId),
    eq(sdkInsights.active, true),
    gte(sdkInsights.confidence, minConfidence),
  ];

  // Include global insights and folder-scoped insights
  if (folderId) {
    baseConditions.push(
      or(
        eq(sdkInsights.applicability, "global"),
        eq(sdkInsights.folderId, folderId)
      )!
    );
  } else {
    // Without folder scope, only include global insights
    baseConditions.push(eq(sdkInsights.applicability, "global"));
  }

  const insights = await db
    .select({
      id: sdkInsights.id,
      type: sdkInsights.type,
      applicability: sdkInsights.applicability,
      title: sdkInsights.title,
      description: sdkInsights.description,
      confidence: sdkInsights.confidence,
      applicationCount: sdkInsights.applicationCount,
      verified: sdkInsights.verified,
    })
    .from(sdkInsights)
    .where(and(...baseConditions))
    .orderBy(
      desc(sdkInsights.verified),
      desc(sdkInsights.confidence),
      desc(sdkInsights.applicationCount)
    )
    .limit(limit);

  return insights.map((i) => ({
    id: i.id,
    type: i.type as InsightType,
    applicability: i.applicability as InsightApplicability,
    title: i.title,
    description: i.description,
    confidence: i.confidence,
    applicationCount: i.applicationCount,
    verified: i.verified ?? false,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format context sections as markdown
 */
function formatContextAsMarkdown(sections: ContextSections): string {
  const lines: string[] = [];

  lines.push("# Memory Context");
  lines.push("");
  lines.push("> Auto-generated from Remote Dev memory system.");
  lines.push("> This section contains relevant patterns, conventions, and known issues.");
  lines.push("");

  // Patterns
  if (sections.patterns.length > 0) {
    lines.push("## Patterns");
    lines.push("");
    for (const pattern of sections.patterns) {
      const title = pattern.name || "Pattern";
      lines.push(`### ${title}`);
      lines.push("");
      lines.push(pattern.content);
      lines.push("");
    }
  }

  // Conventions
  if (sections.conventions.length > 0) {
    lines.push("## Conventions");
    lines.push("");
    for (const convention of sections.conventions) {
      const title = convention.name || "Convention";
      lines.push(`- **${title}**: ${convention.content}`);
    }
    lines.push("");
  }

  // Gotchas
  if (sections.gotchas.length > 0) {
    lines.push("## Known Gotchas");
    lines.push("");
    lines.push("> Pay attention to these known issues and pitfalls.");
    lines.push("");
    for (const gotcha of sections.gotchas) {
      const title = gotcha.name || "Warning";
      lines.push(`- ⚠️ **${title}**: ${gotcha.content}`);
    }
    lines.push("");
  }

  // Skills
  if (sections.skills.length > 0) {
    lines.push("## Available Skills");
    lines.push("");
    for (const skill of sections.skills) {
      const title = skill.name || "Skill";
      lines.push(`- **${title}**: ${skill.content}`);
    }
    lines.push("");
  }

  // Recent Observations (brief)
  if (sections.recentObservations.length > 0) {
    lines.push("## Recent Observations");
    lines.push("");
    for (const obs of sections.recentObservations) {
      // Truncate long observations
      const content =
        obs.content.length > 200
          ? obs.content.slice(0, 200) + "..."
          : obs.content;
      lines.push(`- ${content}`);
    }
    lines.push("");
  }

  // Notes (pinned and high-priority)
  if (sections.notes.length > 0) {
    lines.push("## Important Notes");
    lines.push("");
    for (const note of sections.notes) {
      const prefix = note.pinned ? "📌 " : "";
      const title = note.title || note.type;
      const tags = note.tags.length > 0 ? ` [${note.tags.join(", ")}]` : "";
      lines.push(`- ${prefix}**${title}**${tags}: ${note.content}`);
    }
    lines.push("");
  }

  // Insights (verified and high-confidence)
  if (sections.insights.length > 0) {
    lines.push("## Learned Insights");
    lines.push("");
    lines.push("> These insights were learned from previous sessions.");
    lines.push("");
    for (const insight of sections.insights) {
      const verified = insight.verified ? "✓ " : "";
      const typeIcon = getInsightTypeIcon(insight.type);
      lines.push(`- ${typeIcon} ${verified}**${insight.title}**: ${insight.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get icon for insight type
 */
function getInsightTypeIcon(type: InsightType): string {
  switch (type) {
    case "convention": return "📐";
    case "pattern": return "🔄";
    case "anti_pattern": return "🚫";
    case "skill": return "🛠️";
    case "gotcha": return "⚠️";
    case "best_practice": return "✨";
    case "dependency": return "🔗";
    case "performance": return "⚡";
    default: return "💡";
  }
}

/**
 * Format context sections as JSON
 */
function formatContextAsJson(sections: ContextSections): string {
  const payload = {
    patterns: sections.patterns.map((p) => ({
      name: p.name,
      content: p.content,
      confidence: p.confidence,
    })),
    conventions: sections.conventions.map((c) => ({
      name: c.name,
      content: c.content,
    })),
    gotchas: sections.gotchas.map((g) => ({
      name: g.name,
      content: g.content,
    })),
    skills: sections.skills.map((s) => ({
      name: s.name,
      content: s.content,
    })),
    observations: sections.recentObservations.map((o) => o.content),
    notes: sections.notes.map((n) => ({
      type: n.type,
      title: n.title,
      content: n.content,
      tags: n.tags,
      pinned: n.pinned,
    })),
    insights: sections.insights.map((i) => ({
      type: i.type,
      title: i.title,
      description: i.description,
      confidence: i.confidence,
      verified: i.verified,
    })),
  };

  return JSON.stringify(payload);
}

/**
 * Build injection context from memory sections
 */
export function buildInjectionContext(sections: ContextSections): InjectionContext {
  return {
    markdown: formatContextAsMarkdown(sections),
    json: formatContextAsJson(sections),
    stats: {
      totalMemories:
        sections.patterns.length +
        sections.gotchas.length +
        sections.conventions.length +
        sections.skills.length +
        sections.recentObservations.length +
        sections.notes.length +
        sections.insights.length,
      patterns: sections.patterns.length,
      gotchas: sections.gotchas.length,
      conventions: sections.conventions.length,
      skills: sections.skills.length,
      observations: sections.recentObservations.length,
      notes: sections.notes.length,
      insights: sections.insights.length,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Injection Methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write context to .remote-dev/context.md in project directory
 */
export async function writeContextFile(
  projectPath: string,
  context: InjectionContext
): Promise<string> {
  const contextDir = join(projectPath, ".remote-dev");
  const contextPath = join(contextDir, "context.md");

  // Ensure directory exists
  if (!existsSync(contextDir)) {
    await mkdir(contextDir, { recursive: true });
  }

  // Write context file
  await writeFile(contextPath, context.markdown, "utf-8");

  return contextPath;
}

/**
 * Get environment variable payload for context injection
 */
export function getContextEnvVar(context: InjectionContext): {
  name: string;
  value: string;
} {
  return {
    name: "REMOTE_DEV_MEMORY_CONTEXT",
    value: context.json,
  };
}

/**
 * Generate a CLAUDE.md memory section that can be appended
 */
export function getClaudeMdSection(context: InjectionContext): string {
  if (context.stats.totalMemories === 0) {
    return "";
  }

  return `
<!-- Remote Dev Memory Context - Auto-generated -->
${context.markdown}
<!-- End Remote Dev Memory Context -->
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prepare context for a new session
 *
 * Call this before session creation to retrieve and format memory context.
 * Returns context that can be injected via multiple methods.
 */
export async function prepareSessionContext(
  userId: string,
  folderId: string | null,
  projectPath: string | null,
  options?: ContextInjectionOptions
): Promise<InjectionContext> {
  const sections = await getMemoriesForContext(userId, folderId, options);
  const context = buildInjectionContext(sections);

  console.log(
    `[ContextInjection] Prepared context: ${context.stats.totalMemories} items ` +
      `(${context.stats.patterns}P/${context.stats.gotchas}G/${context.stats.conventions}C/${context.stats.skills}S/` +
      `${context.stats.notes}N/${context.stats.insights}I)`
  );

  return context;
}

/**
 * Inject context into a session's project directory
 *
 * Writes context file and returns environment variable for agent.
 */
export async function injectContextForSession(
  userId: string,
  folderId: string | null,
  projectPath: string,
  options?: ContextInjectionOptions
): Promise<{
  contextFilePath: string;
  envVar: { name: string; value: string };
  stats: InjectionContext["stats"];
}> {
  const context = await prepareSessionContext(userId, folderId, projectPath, options);

  // Skip if no context
  if (context.stats.totalMemories === 0) {
    return {
      contextFilePath: "",
      envVar: { name: "REMOTE_DEV_MEMORY_CONTEXT", value: "{}" },
      stats: context.stats,
    };
  }

  // Write context file
  const contextFilePath = await writeContextFile(projectPath, context);

  // Get env var
  const envVar = getContextEnvVar(context);

  return {
    contextFilePath,
    envVar,
    stats: context.stats,
  };
}

/**
 * Get context for display in UI (without side effects)
 */
export async function getSessionContextPreview(
  userId: string,
  folderId: string | null,
  options?: ContextInjectionOptions
): Promise<InjectionContext> {
  const sections = await getMemoriesForContext(userId, folderId, options);
  return buildInjectionContext(sections);
}
