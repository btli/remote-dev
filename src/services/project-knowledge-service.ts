/**
 * ProjectKnowledgeService - Manages project knowledge learned from task execution.
 *
 * Provides CRUD operations and knowledge indexing for:
 * - Tech stack detection
 * - Code conventions
 * - Agent performance tracking
 * - Success/failure patterns
 * - Extracted skills and tools
 */

import type {
  ProjectKnowledge,
  Convention,
  LearnedPattern,
  SkillDefinition,
  ToolDefinition,
} from "@/domain/entities/ProjectKnowledge";
import type { IProjectKnowledgeRepository, TaskAnalysis } from "@/application/ports/task-ports";
import { embeddingService } from "@/infrastructure/external/embeddings";

export interface KnowledgeSearchResult {
  type: "convention" | "pattern" | "skill" | "tool";
  item: Convention | LearnedPattern | SkillDefinition | ToolDefinition;
  score: number;
}

/**
 * Service for managing and querying project knowledge.
 */
export class ProjectKnowledgeService {
  constructor(private readonly repository: IProjectKnowledgeRepository) {}

  /**
   * Get knowledge for a folder, creating if it doesn't exist.
   */
  async getOrCreateForFolder(
    folderId: string,
    userId: string,
    folderPath: string
  ): Promise<ProjectKnowledge> {
    const existing = await this.repository.findByFolderId(folderId);
    if (existing) {
      return existing;
    }

    // Create new knowledge entry with detected tech stack
    const techStack = await this.detectTechStack(folderPath);

    const { ProjectKnowledge: PKClass } = await import("@/domain/entities/ProjectKnowledge");
    const knowledge = PKClass.create({
      folderId,
      userId,
      techStack,
      metadata: {
        projectPath: folderPath,
      },
    });

    await this.repository.save(knowledge);
    return knowledge;
  }

  /**
   * Update knowledge from task analysis.
   */
  async updateFromTaskAnalysis(
    knowledgeId: string,
    analysis: TaskAnalysis,
    agentProvider: string,
    taskType: string,
    duration: number
  ): Promise<ProjectKnowledge> {
    const knowledge = await this.repository.findById(knowledgeId);
    if (!knowledge) {
      throw new Error(`ProjectKnowledge not found: ${knowledgeId}`);
    }

    let updated = knowledge;

    // Add conventions
    for (const conv of analysis.conventions) {
      updated = updated.addConvention({
        category: conv.category,
        description: conv.description,
        examples: conv.examples,
        confidence: conv.confidence,
        source: "learned",
      });
    }

    // Add patterns
    for (const pattern of analysis.patterns) {
      updated = updated.addPattern({
        type: pattern.type,
        description: pattern.description,
        context: pattern.context,
        confidence: pattern.confidence,
      });
    }

    // Add skills
    for (const skill of analysis.suggestedSkills) {
      updated = updated.addSkill({
        name: skill.name,
        description: skill.description,
        command: skill.command,
        triggers: skill.triggers,
        steps: [], // Skill steps need to be defined manually
        scope: "project",
        verified: false,
      });
    }

    // Add tools
    for (const tool of analysis.suggestedTools) {
      updated = updated.addTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        implementation: {
          type: "command",
          code: "", // Implementation needs to be defined manually
        },
        triggers: [],
        confidence: 0.5, // Default confidence for auto-suggested tools
        verified: false,
      });
    }

    // Update agent performance
    updated = updated.recordAgentPerformance(
      taskType,
      agentProvider as "claude" | "codex" | "gemini" | "opencode",
      analysis.success,
      duration
    );

    await this.repository.save(updated);
    return updated;
  }

  /**
   * Search knowledge using semantic similarity.
   */
  async searchKnowledge(
    knowledgeId: string,
    query: string,
    topK: number = 5
  ): Promise<KnowledgeSearchResult[]> {
    const knowledge = await this.repository.findById(knowledgeId);
    if (!knowledge) {
      return [];
    }

    // Build corpus from all knowledge items
    const corpus: Array<{ type: KnowledgeSearchResult["type"]; item: unknown; text: string }> = [];

    for (const conv of knowledge.conventions) {
      corpus.push({
        type: "convention",
        item: conv,
        text: `${conv.category}: ${conv.description}. Examples: ${conv.examples.join(", ")}`,
      });
    }

    for (const pattern of knowledge.patterns) {
      corpus.push({
        type: "pattern",
        item: pattern,
        text: `${pattern.type} pattern: ${pattern.description}. Context: ${pattern.context}`,
      });
    }

    for (const skill of knowledge.skills) {
      corpus.push({
        type: "skill",
        item: skill,
        text: `Skill ${skill.name}: ${skill.description}. Triggers: ${skill.triggers.join(", ")}`,
      });
    }

    for (const tool of knowledge.tools) {
      corpus.push({
        type: "tool",
        item: tool,
        text: `Tool ${tool.name}: ${tool.description}`,
      });
    }

    if (corpus.length === 0) {
      return [];
    }

    // Use embedding service for semantic search
    const similar = await embeddingService.findSimilar(
      query,
      corpus.map((c) => c.text),
      topK
    );

    return similar.map((s) => ({
      type: corpus[s.index].type,
      item: corpus[s.index].item as Convention | LearnedPattern | SkillDefinition | ToolDefinition,
      score: s.score,
    }));
  }

  /**
   * Get relevant conventions for a task type.
   */
  async getRelevantConventions(
    knowledgeId: string,
    taskType: string
  ): Promise<Convention[]> {
    const knowledge = await this.repository.findById(knowledgeId);
    if (!knowledge) {
      return [];
    }

    // Filter by category relevance to task type
    const categoryMap: Record<string, Convention["category"][]> = {
      feature: ["code_style", "naming", "architecture"],
      bug: ["code_style", "testing"],
      refactor: ["code_style", "architecture"],
      test: ["testing", "naming"],
      documentation: ["naming", "other"],
      research: ["other"],
      review: ["code_style", "testing", "architecture"],
      maintenance: ["code_style", "git"],
    };

    const relevantCategories = categoryMap[taskType] ?? ["code_style"];

    return knowledge.conventions
      .filter((c) => relevantCategories.includes(c.category))
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get patterns relevant to a task.
   */
  async getRelevantPatterns(
    knowledgeId: string,
    taskDescription: string,
    topK: number = 3
  ): Promise<LearnedPattern[]> {
    const knowledge = await this.repository.findById(knowledgeId);
    if (!knowledge) {
      return [];
    }

    if (knowledge.patterns.length === 0) {
      return [];
    }

    // Use semantic search to find relevant patterns
    const patternTexts = knowledge.patterns.map(
      (p) => `${p.type}: ${p.description}. ${p.context}`
    );

    const similar = await embeddingService.findSimilar(
      taskDescription,
      patternTexts,
      topK
    );

    return similar.map((s) => knowledge.patterns[s.index]);
  }

  /**
   * Detect tech stack from folder contents using ProjectMetadataService.
   * This provides comprehensive detection of languages, frameworks, and tools.
   */
  private async detectTechStack(folderPath: string): Promise<string[]> {
    try {
      const { ProjectMetadataService } = await import("./project-metadata-service");
      const metadataService = new ProjectMetadataService();
      const result = await metadataService.detect(folderPath);

      const techStack: string[] = [];

      // Add primary language
      if (result.primaryLanguage) {
        techStack.push(result.primaryLanguage);
      }

      // Add framework
      if (result.framework) {
        techStack.push(result.framework);
      }

      // Add package manager
      if (result.packageManager) {
        techStack.push(result.packageManager);
      }

      // Add common indicators
      if (result.hasDocker) techStack.push("docker");
      if (result.git) techStack.push("git");
      if (result.hasTypeScript) techStack.push("typescript");

      // Add test framework
      if (result.testFramework?.framework) {
        techStack.push(result.testFramework.framework);
      }

      return techStack;
    } catch {
      // Fallback to empty if detection fails
      return [];
    }
  }

  /**
   * Refresh tech stack for existing project knowledge.
   * Re-detects the tech stack from the folder and updates the knowledge.
   */
  async refreshTechStack(
    knowledgeId: string,
    folderPath: string
  ): Promise<ProjectKnowledge | null> {
    const knowledge = await this.repository.findById(knowledgeId);
    if (!knowledge) {
      return null;
    }

    const techStack = await this.detectTechStack(folderPath);
    const updated = knowledge.updateTechStack(techStack).markScanned();
    await this.repository.save(updated);
    return updated;
  }

  /**
   * Refresh tech stack by folder ID.
   */
  async refreshTechStackByFolderId(
    folderId: string,
    folderPath: string
  ): Promise<ProjectKnowledge | null> {
    const knowledge = await this.repository.findByFolderId(folderId);
    if (!knowledge) {
      return null;
    }

    const techStack = await this.detectTechStack(folderPath);
    const updated = knowledge.updateTechStack(techStack).markScanned();
    await this.repository.save(updated);
    return updated;
  }

  /**
   * Get knowledge by ID.
   */
  async getById(id: string): Promise<ProjectKnowledge | null> {
    return this.repository.findById(id);
  }

  /**
   * Get knowledge by folder ID.
   */
  async getByFolderId(folderId: string): Promise<ProjectKnowledge | null> {
    return this.repository.findByFolderId(folderId);
  }

  /**
   * Get all knowledge for a user.
   */
  async getAllForUser(userId: string): Promise<ProjectKnowledge[]> {
    return this.repository.findByUserId(userId);
  }

  /**
   * Delete knowledge entry.
   */
  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
