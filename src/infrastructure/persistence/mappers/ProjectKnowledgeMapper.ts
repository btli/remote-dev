/**
 * ProjectKnowledgeMapper - Maps between database records and ProjectKnowledge domain entity.
 *
 * Handles conversion of:
 * - Database records (from Drizzle queries) → ProjectKnowledge domain entities
 * - ProjectKnowledge domain entities → Database record format (for inserts/updates)
 */

import {
  ProjectKnowledge,
  type ProjectKnowledgeProps,
  type Convention,
  type AgentPerformanceMap,
  type LearnedPattern,
  type SkillDefinition,
  type ToolDefinition,
  type ProjectKnowledgeMetadata,
} from "@/domain/entities/ProjectKnowledge";

/**
 * Raw database record type from Drizzle query.
 * Matches the projectKnowledge schema.
 */
export interface ProjectKnowledgeDbRecord {
  id: string;
  folderId: string;
  userId: string;
  techStackJson: string;
  conventionsJson: string;
  agentPerformanceJson: string;
  patternsJson: string;
  skillsJson: string;
  toolsJson: string;
  metadataJson: string;
  lastScannedAt: Date | number | null;
  createdAt: Date | number;
  updatedAt: Date | number;
}

/**
 * Format for database insert/update operations.
 */
export interface ProjectKnowledgeDbInsert {
  id: string;
  folderId: string;
  userId: string;
  techStackJson: string;
  conventionsJson: string;
  agentPerformanceJson: string;
  patternsJson: string;
  skillsJson: string;
  toolsJson: string;
  metadataJson: string;
  lastScannedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectKnowledgeMapper {
  /**
   * Convert a database record to a ProjectKnowledge domain entity.
   */
  static toDomain(record: ProjectKnowledgeDbRecord): ProjectKnowledge {
    const techStack = parseJson<string[]>(record.techStackJson) ?? [];
    const conventionsRaw = parseJson<ConventionRaw[]>(record.conventionsJson) ?? [];
    const agentPerformance = parseJson<AgentPerformanceMap>(record.agentPerformanceJson) ?? {};
    const patternsRaw = parseJson<LearnedPatternRaw[]>(record.patternsJson) ?? [];
    const skillsRaw = parseJson<SkillDefinitionRaw[]>(record.skillsJson) ?? [];
    const toolsRaw = parseJson<ToolDefinitionRaw[]>(record.toolsJson) ?? [];
    const metadata = parseJson<ProjectKnowledgeMetadata>(record.metadataJson) ?? {
      projectName: null,
      projectPath: null,
      framework: null,
      packageManager: null,
      testRunner: null,
      linter: null,
      buildTool: null,
    };

    const props: ProjectKnowledgeProps = {
      id: record.id,
      folderId: record.folderId,
      userId: record.userId,
      techStack,
      conventions: conventionsRaw.map(deserializeConvention),
      agentPerformance,
      patterns: patternsRaw.map(deserializePattern),
      skills: skillsRaw.map(deserializeSkill),
      tools: toolsRaw.map(deserializeTool),
      metadata,
      lastScannedAt: record.lastScannedAt ? toDate(record.lastScannedAt) : null,
      createdAt: toDate(record.createdAt),
      updatedAt: toDate(record.updatedAt),
    };

    return ProjectKnowledge.reconstitute(props);
  }

  /**
   * Convert multiple database records to ProjectKnowledge domain entities.
   */
  static toDomainMany(records: ProjectKnowledgeDbRecord[]): ProjectKnowledge[] {
    return records.map((r) => ProjectKnowledgeMapper.toDomain(r));
  }

  /**
   * Convert a ProjectKnowledge domain entity to database insert format.
   */
  static toPersistence(knowledge: ProjectKnowledge): ProjectKnowledgeDbInsert {
    return {
      id: knowledge.id,
      folderId: knowledge.folderId,
      userId: knowledge.userId,
      techStackJson: JSON.stringify(knowledge.techStack),
      conventionsJson: JSON.stringify(knowledge.conventions.map(serializeConvention)),
      agentPerformanceJson: JSON.stringify(knowledge.agentPerformance),
      patternsJson: JSON.stringify(knowledge.patterns.map(serializePattern)),
      skillsJson: JSON.stringify(knowledge.skills.map(serializeSkill)),
      toolsJson: JSON.stringify(knowledge.tools.map(serializeTool)),
      metadataJson: JSON.stringify(knowledge.metadata),
      lastScannedAt: knowledge.lastScannedAt,
      createdAt: knowledge.createdAt,
      updatedAt: knowledge.updatedAt,
    };
  }

  /**
   * Convert ProjectKnowledge to API response format.
   */
  static toApiResponse(knowledge: ProjectKnowledge): {
    id: string;
    folderId: string;
    userId: string;
    techStack: string[];
    conventions: Convention[];
    agentPerformance: AgentPerformanceMap;
    patterns: LearnedPattern[];
    skills: SkillDefinition[];
    tools: ToolDefinition[];
    metadata: ProjectKnowledgeMetadata;
    lastScannedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id: knowledge.id,
      folderId: knowledge.folderId,
      userId: knowledge.userId,
      techStack: knowledge.techStack,
      conventions: knowledge.conventions,
      agentPerformance: knowledge.agentPerformance,
      patterns: knowledge.patterns,
      skills: knowledge.skills,
      tools: knowledge.tools,
      metadata: knowledge.metadata,
      lastScannedAt: knowledge.lastScannedAt,
      createdAt: knowledge.createdAt,
      updatedAt: knowledge.updatedAt,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw JSON types (with dates as strings)
// ─────────────────────────────────────────────────────────────────────────────

interface ConventionRaw {
  id: string;
  category: Convention["category"];
  description: string;
  examples: string[];
  confidence: number;
  source: Convention["source"];
  createdAt: string;
}

interface LearnedPatternRaw {
  id: string;
  type: LearnedPattern["type"];
  description: string;
  context: string;
  confidence: number;
  usageCount: number;
  lastUsedAt: string;
  createdAt: string;
}

interface SkillDefinitionRaw {
  id: string;
  name: string;
  description: string;
  command: string;
  steps: SkillDefinition["steps"];
  triggers: string[];
  scope: SkillDefinition["scope"];
  verified: boolean;
  usageCount: number;
  createdAt: string;
}

interface ToolDefinitionRaw {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  implementation: ToolDefinition["implementation"];
  triggers: string[];
  confidence: number;
  verified: boolean;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization helpers
// ─────────────────────────────────────────────────────────────────────────────

function deserializeConvention(raw: ConventionRaw): Convention {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
  };
}

function serializeConvention(conv: Convention): ConventionRaw {
  return {
    ...conv,
    createdAt: conv.createdAt.toISOString(),
  };
}

function deserializePattern(raw: LearnedPatternRaw): LearnedPattern {
  return {
    ...raw,
    lastUsedAt: new Date(raw.lastUsedAt),
    createdAt: new Date(raw.createdAt),
  };
}

function serializePattern(pattern: LearnedPattern): LearnedPatternRaw {
  return {
    ...pattern,
    lastUsedAt: pattern.lastUsedAt.toISOString(),
    createdAt: pattern.createdAt.toISOString(),
  };
}

function deserializeSkill(raw: SkillDefinitionRaw): SkillDefinition {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
  };
}

function serializeSkill(skill: SkillDefinition): SkillDefinitionRaw {
  return {
    ...skill,
    createdAt: skill.createdAt.toISOString(),
  };
}

function deserializeTool(raw: ToolDefinitionRaw): ToolDefinition {
  return {
    ...raw,
    createdAt: new Date(raw.createdAt),
  };
}

function serializeTool(tool: ToolDefinition): ToolDefinitionRaw {
  return {
    ...tool,
    createdAt: tool.createdAt.toISOString(),
  };
}

/**
 * Helper to convert string/number/Date to Date.
 */
function toDate(value: Date | string | number): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "number") {
    return new Date(value);
  }
  return new Date(value);
}

/**
 * Helper to safely parse JSON.
 */
function parseJson<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
