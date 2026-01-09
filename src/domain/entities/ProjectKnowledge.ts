/**
 * ProjectKnowledge - Domain entity representing learned knowledge about a project.
 *
 * ProjectKnowledge stores:
 * - Tech stack and dependencies
 * - Conventions and patterns
 * - Agent performance metrics
 * - Learned patterns from past tasks
 * - Skill and tool definitions
 *
 * This entity is immutable - state changes return a new ProjectKnowledge instance.
 *
 * Invariants:
 * - Must be associated with a folder
 * - Must have valid tech stack array
 * - Confidence scores must be between 0 and 1
 */

import { InvalidValueError } from "../errors/DomainError";
import type { AgentProviderType } from "@/types/session";

export interface ProjectKnowledgeProps {
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
}

export interface Convention {
  id: string;
  category: "code_style" | "naming" | "architecture" | "testing" | "git" | "other";
  description: string;
  examples: string[];
  confidence: number;
  source: "detected" | "manual" | "learned";
  createdAt: Date;
}

export interface AgentPerformanceMap {
  [taskType: string]: {
    [agent: string]: {
      successRate: number;
      avgDuration: number;
      totalTasks: number;
    };
  };
}

export interface LearnedPattern {
  id: string;
  type: "success" | "failure" | "gotcha" | "optimization";
  description: string;
  context: string;
  confidence: number;
  usageCount: number;
  lastUsedAt: Date;
  createdAt: Date;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  command: string;
  steps: SkillStep[];
  triggers: string[];
  scope: "project" | "global";
  verified: boolean;
  usageCount: number;
  createdAt: Date;
}

export interface SkillStep {
  type: "command" | "read" | "write" | "ask" | "skill";
  action: string;
  condition?: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  implementation: {
    type: "command" | "script" | "api";
    code: string;
  };
  triggers: string[];
  confidence: number;
  verified: boolean;
  createdAt: Date;
}

export interface ProjectKnowledgeMetadata {
  projectName: string | null;
  projectPath: string | null;
  framework: string | null;
  packageManager: string | null;
  testRunner: string | null;
  linter: string | null;
  buildTool: string | null;
}

export interface CreateProjectKnowledgeProps {
  id?: string;
  folderId: string;
  userId: string;
  techStack?: string[];
  metadata?: Partial<ProjectKnowledgeMetadata>;
}

export class ProjectKnowledge {
  private constructor(private readonly props: ProjectKnowledgeProps) {
    this.validateInvariants();
  }

  private validateInvariants(): void {
    if (!this.props.id || typeof this.props.id !== "string") {
      throw new InvalidValueError(
        "ProjectKnowledge.id",
        this.props.id,
        "Must be a non-empty string"
      );
    }
    if (!this.props.folderId || typeof this.props.folderId !== "string") {
      throw new InvalidValueError(
        "ProjectKnowledge.folderId",
        this.props.folderId,
        "Must be a non-empty string"
      );
    }
    if (!Array.isArray(this.props.techStack)) {
      throw new InvalidValueError(
        "ProjectKnowledge.techStack",
        this.props.techStack,
        "Must be an array"
      );
    }
  }

  /**
   * Create new ProjectKnowledge for a folder.
   */
  static create(props: CreateProjectKnowledgeProps): ProjectKnowledge {
    const id = props.id ?? crypto.randomUUID();
    const now = new Date();

    return new ProjectKnowledge({
      id,
      folderId: props.folderId,
      userId: props.userId,
      techStack: props.techStack ?? [],
      conventions: [],
      agentPerformance: {},
      patterns: [],
      skills: [],
      tools: [],
      metadata: {
        projectName: props.metadata?.projectName ?? null,
        projectPath: props.metadata?.projectPath ?? null,
        framework: props.metadata?.framework ?? null,
        packageManager: props.metadata?.packageManager ?? null,
        testRunner: props.metadata?.testRunner ?? null,
        linter: props.metadata?.linter ?? null,
        buildTool: props.metadata?.buildTool ?? null,
      },
      lastScannedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Reconstitute from persisted data.
   */
  static reconstitute(props: ProjectKnowledgeProps): ProjectKnowledge {
    return new ProjectKnowledge(props);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────────────────────

  get id(): string {
    return this.props.id;
  }

  get folderId(): string {
    return this.props.folderId;
  }

  get userId(): string {
    return this.props.userId;
  }

  get techStack(): string[] {
    return [...this.props.techStack];
  }

  get conventions(): Convention[] {
    return [...this.props.conventions];
  }

  get agentPerformance(): AgentPerformanceMap {
    return { ...this.props.agentPerformance };
  }

  get patterns(): LearnedPattern[] {
    return [...this.props.patterns];
  }

  get skills(): SkillDefinition[] {
    return [...this.props.skills];
  }

  get tools(): ToolDefinition[] {
    return [...this.props.tools];
  }

  get metadata(): ProjectKnowledgeMetadata {
    return { ...this.props.metadata };
  }

  get lastScannedAt(): Date | null {
    return this.props.lastScannedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Domain Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Update tech stack.
   */
  updateTechStack(techStack: string[]): ProjectKnowledge {
    return this.withUpdates({ techStack });
  }

  /**
   * Add a technology to the stack.
   */
  addTech(tech: string): ProjectKnowledge {
    if (this.props.techStack.includes(tech)) {
      return this;
    }
    return this.withUpdates({
      techStack: [...this.props.techStack, tech],
    });
  }

  /**
   * Add a convention.
   */
  addConvention(convention: Omit<Convention, "id" | "createdAt">): ProjectKnowledge {
    const newConvention: Convention = {
      ...convention,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    return this.withUpdates({
      conventions: [...this.props.conventions, newConvention],
    });
  }

  /**
   * Record agent performance for a task.
   */
  recordAgentPerformance(
    taskType: string,
    agent: AgentProviderType,
    success: boolean,
    duration: number
  ): ProjectKnowledge {
    const performance = { ...this.props.agentPerformance };

    if (!performance[taskType]) {
      performance[taskType] = {};
    }

    if (!performance[taskType][agent]) {
      performance[taskType][agent] = {
        successRate: 0,
        avgDuration: 0,
        totalTasks: 0,
      };
    }

    const current = performance[taskType][agent];
    const newTotal = current.totalTasks + 1;
    const newSuccessRate =
      (current.successRate * current.totalTasks + (success ? 1 : 0)) / newTotal;
    const newAvgDuration = (current.avgDuration * current.totalTasks + duration) / newTotal;

    performance[taskType][agent] = {
      successRate: newSuccessRate,
      avgDuration: newAvgDuration,
      totalTasks: newTotal,
    };

    return this.withUpdates({ agentPerformance: performance });
  }

  /**
   * Add a learned pattern.
   */
  addPattern(pattern: Omit<LearnedPattern, "id" | "usageCount" | "lastUsedAt" | "createdAt">): ProjectKnowledge {
    const newPattern: LearnedPattern = {
      ...pattern,
      id: crypto.randomUUID(),
      usageCount: 0,
      lastUsedAt: new Date(),
      createdAt: new Date(),
    };
    return this.withUpdates({
      patterns: [...this.props.patterns, newPattern],
    });
  }

  /**
   * Increment pattern usage.
   */
  usePattern(patternId: string): ProjectKnowledge {
    const patterns = this.props.patterns.map((p) =>
      p.id === patternId
        ? { ...p, usageCount: p.usageCount + 1, lastUsedAt: new Date() }
        : p
    );
    return this.withUpdates({ patterns });
  }

  /**
   * Add a skill definition.
   */
  addSkill(skill: Omit<SkillDefinition, "id" | "usageCount" | "createdAt">): ProjectKnowledge {
    const newSkill: SkillDefinition = {
      ...skill,
      id: crypto.randomUUID(),
      usageCount: 0,
      createdAt: new Date(),
    };
    return this.withUpdates({
      skills: [...this.props.skills, newSkill],
    });
  }

  /**
   * Add a tool definition.
   */
  addTool(tool: Omit<ToolDefinition, "id" | "createdAt">): ProjectKnowledge {
    const newTool: ToolDefinition = {
      ...tool,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    return this.withUpdates({
      tools: [...this.props.tools, newTool],
    });
  }

  /**
   * Update metadata from project scan.
   */
  updateMetadata(metadata: Partial<ProjectKnowledgeMetadata>): ProjectKnowledge {
    return this.withUpdates({
      metadata: { ...this.props.metadata, ...metadata },
      lastScannedAt: new Date(),
    });
  }

  /**
   * Mark as scanned.
   */
  markScanned(): ProjectKnowledge {
    return this.withUpdates({ lastScannedAt: new Date() });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get recommended agent for a task type.
   */
  getRecommendedAgent(taskType: string): AgentProviderType | null {
    const typePerf = this.props.agentPerformance[taskType];
    if (!typePerf) return null;

    let bestAgent: AgentProviderType | null = null;
    let bestScore = -1;

    for (const [agent, perf] of Object.entries(typePerf)) {
      // Score = success rate * (1 - normalized duration penalty)
      const score = perf.successRate * (perf.totalTasks >= 3 ? 1 : 0.5);
      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent as AgentProviderType;
      }
    }

    return bestAgent;
  }

  /**
   * Get conventions by category.
   */
  getConventionsByCategory(category: Convention["category"]): Convention[] {
    return this.props.conventions.filter((c) => c.category === category);
  }

  /**
   * Get high-confidence patterns.
   */
  getHighConfidencePatterns(threshold = 0.7): LearnedPattern[] {
    return this.props.patterns.filter((p) => p.confidence >= threshold);
  }

  /**
   * Get verified skills.
   */
  getVerifiedSkills(): SkillDefinition[] {
    return this.props.skills.filter((s) => s.verified);
  }

  /**
   * Find skill by command.
   */
  findSkillByCommand(command: string): SkillDefinition | undefined {
    return this.props.skills.find((s) => s.command === command);
  }

  /**
   * Find tool by name.
   */
  findToolByName(name: string): ToolDefinition | undefined {
    return this.props.tools.find((t) => t.name === name);
  }

  /**
   * Check if knowledge is stale (not scanned in 24 hours).
   */
  isStale(): boolean {
    if (!this.props.lastScannedAt) return true;
    const hoursSinceLastScan =
      (Date.now() - this.props.lastScannedAt.getTime()) / (1000 * 60 * 60);
    return hoursSinceLastScan > 24;
  }

  /**
   * Check if this belongs to a user.
   */
  belongsTo(userId: string): boolean {
    return this.props.userId === userId;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private withUpdates(updates: Partial<ProjectKnowledgeProps>): ProjectKnowledge {
    return new ProjectKnowledge({
      ...this.props,
      ...updates,
      updatedAt: new Date(),
    });
  }

  /**
   * Convert to plain object for serialization.
   */
  toPlainObject(): ProjectKnowledgeProps {
    return { ...this.props };
  }
}
