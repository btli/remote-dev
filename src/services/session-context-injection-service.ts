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
  sessionFolders,
  terminalSessions,
  type MemoryTierType,
  type MemoryContentType,
} from "@/db/schema";
import { eq, and, desc, gte, or, isNull, like, inArray } from "drizzle-orm";
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
  /** Custom keywords to boost relevance */
  keywords?: string[];
}

const DEFAULT_OPTIONS: Required<ContextInjectionOptions> = {
  maxPerCategory: 5,
  minRelevance: 0.4,
  minConfidence: 0.5,
  includeObservations: true,
  includeSkills: true,
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

  return {
    patterns,
    gotchas,
    conventions,
    skills,
    recentObservations,
  };
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

  return lines.join("\n");
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
        sections.recentObservations.length,
      patterns: sections.patterns.length,
      gotchas: sections.gotchas.length,
      conventions: sections.conventions.length,
      skills: sections.skills.length,
      observations: sections.recentObservations.length,
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
    `[ContextInjection] Prepared context: ${context.stats.totalMemories} memories ` +
      `(${context.stats.patterns}P/${context.stats.gotchas}G/${context.stats.conventions}C/${context.stats.skills}S)`
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
