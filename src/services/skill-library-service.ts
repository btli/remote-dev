/**
 * SkillLibraryService - Manages the skill library.
 *
 * Provides:
 * - CRUD operations for skills
 * - Skill retrieval by trigger patterns
 * - Skill search by similarity (using embeddings)
 * - Skill promotion (project → global)
 */

import {
  Skill,
  type SkillProps,
  type CreateSkillProps,
  type SkillScope,
} from "@/domain/entities/Skill";
import type { EmbeddingService } from "@/infrastructure/external/embeddings/EmbeddingService";

export interface SkillSearchResult {
  skill: Skill;
  score: number; // Similarity score 0-1
  matchType: "trigger" | "semantic" | "name";
}

/**
 * In-memory skill library (should be backed by DB in production).
 */
export class SkillLibraryService {
  private skills: Map<string, Skill> = new Map();
  private skillsByProject: Map<string, Set<string>> = new Map();
  private globalSkillIds: Set<string> = new Set();

  // Cache embeddings for semantic search
  private skillEmbeddings: Map<string, number[]> = new Map();

  constructor(private readonly embeddingService?: EmbeddingService) {}

  /**
   * Add a skill to the library.
   */
  async addSkill(props: CreateSkillProps): Promise<Skill> {
    const skill = Skill.create(props);
    await this.saveSkill(skill);
    return skill;
  }

  /**
   * Get a skill by ID.
   */
  async getSkill(skillId: string): Promise<Skill | null> {
    return this.skills.get(skillId) ?? null;
  }

  /**
   * Get all skills for a project (including global).
   */
  async getSkillsForProject(projectPath: string): Promise<Skill[]> {
    const projectSkillIds = this.skillsByProject.get(projectPath) ?? new Set();
    const allSkillIds = new Set([...projectSkillIds, ...this.globalSkillIds]);

    return Array.from(allSkillIds)
      .map((id) => this.skills.get(id))
      .filter((s): s is Skill => s !== undefined && s.enabled);
  }

  /**
   * Get all global skills.
   */
  async getGlobalSkills(): Promise<Skill[]> {
    return Array.from(this.globalSkillIds)
      .map((id) => this.skills.get(id))
      .filter((s): s is Skill => s !== undefined && s.enabled);
  }

  /**
   * Find skills by trigger pattern.
   */
  async findByTrigger(input: string, projectPath?: string): Promise<SkillSearchResult[]> {
    const skills = projectPath
      ? await this.getSkillsForProject(projectPath)
      : await this.getGlobalSkills();

    return skills
      .filter((skill) => skill.matchesTrigger(input))
      .map((skill) => ({
        skill,
        score: 1.0, // Exact trigger match
        matchType: "trigger" as const,
      }));
  }

  /**
   * Find skills by name.
   */
  async findByName(name: string, projectPath?: string): Promise<Skill | null> {
    const skills = projectPath
      ? await this.getSkillsForProject(projectPath)
      : await this.getGlobalSkills();

    return skills.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  /**
   * Search skills by semantic similarity.
   */
  async searchSemantic(
    query: string,
    options?: {
      projectPath?: string;
      topK?: number;
      minScore?: number;
    }
  ): Promise<SkillSearchResult[]> {
    if (!this.embeddingService) {
      // Fall back to trigger matching if no embedding service
      return this.findByTrigger(query, options?.projectPath);
    }

    const { projectPath, topK = 5, minScore = 0.5 } = options ?? {};

    const skills = projectPath
      ? await this.getSkillsForProject(projectPath)
      : Array.from(this.skills.values()).filter((s) => s.enabled);

    if (skills.length === 0) {
      return [];
    }

    // Get query embedding
    const queryResult = await this.embeddingService.embed(query);

    // Score each skill
    const results: SkillSearchResult[] = [];
    for (const skill of skills) {
      let embedding = this.skillEmbeddings.get(skill.id);

      // Generate embedding if not cached
      if (!embedding) {
        const skillText = `${skill.name}: ${skill.description}. Triggers: ${skill.triggers.join(", ")}`;
        const embResult = await this.embeddingService.embed(skillText);
        embedding = embResult.embedding;
        this.skillEmbeddings.set(skill.id, embedding);
      }

      // Calculate cosine similarity
      const score = this.cosineSimilarity(queryResult.embedding, embedding);

      if (score >= minScore) {
        results.push({
          skill,
          score,
          matchType: "semantic",
        });
      }
    }

    // Sort by score descending and take top K
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Update a skill.
   */
  async updateSkill(
    skillId: string,
    updater: (skill: Skill) => Skill
  ): Promise<Skill | null> {
    const skill = this.skills.get(skillId);
    if (!skill) return null;

    const updated = updater(skill);
    await this.saveSkill(updated);

    // Invalidate embedding cache if description changed
    if (updated.description !== skill.description) {
      this.skillEmbeddings.delete(skillId);
    }

    return updated;
  }

  /**
   * Record skill execution result.
   */
  async recordExecution(
    skillId: string,
    success: boolean,
    duration: number
  ): Promise<Skill | null> {
    return this.updateSkill(skillId, (skill) =>
      success ? skill.recordSuccess(duration) : skill.recordFailure(duration)
    );
  }

  /**
   * Update skill verification.
   */
  async updateVerification(
    skillId: string,
    score: number
  ): Promise<Skill | null> {
    return this.updateSkill(skillId, (skill) =>
      skill.updateVerification(score)
    );
  }

  /**
   * Promote a skill to global scope.
   */
  async promoteToGlobal(skillId: string): Promise<Skill | null> {
    const skill = this.skills.get(skillId);
    if (!skill) return null;

    const promoted = skill.promoteToGlobal();
    await this.saveSkill(promoted);

    // Update indices
    if (skill.projectPath) {
      const projectSkills = this.skillsByProject.get(skill.projectPath);
      projectSkills?.delete(skillId);
    }
    this.globalSkillIds.add(skillId);

    return promoted;
  }

  /**
   * Delete a skill.
   */
  async deleteSkill(skillId: string): Promise<boolean> {
    const skill = this.skills.get(skillId);
    if (!skill) return false;

    this.skills.delete(skillId);
    this.skillEmbeddings.delete(skillId);

    if (skill.isGlobal) {
      this.globalSkillIds.delete(skillId);
    } else if (skill.projectPath) {
      const projectSkills = this.skillsByProject.get(skill.projectPath);
      projectSkills?.delete(skillId);
    }

    return true;
  }

  /**
   * Get candidates for promotion to global.
   *
   * Skills that are:
   * - Project-scoped
   * - Used in 3+ projects
   * - High success rate
   * - Verified
   */
  async getPromotionCandidates(): Promise<Skill[]> {
    const projectSkillUsage = new Map<string, Set<string>>();

    // Count projects per skill (by name, since IDs differ)
    for (const [projectPath, skillIds] of this.skillsByProject) {
      for (const skillId of skillIds) {
        const skill = this.skills.get(skillId);
        if (!skill) continue;

        const projects = projectSkillUsage.get(skill.name) ?? new Set();
        projects.add(projectPath);
        projectSkillUsage.set(skill.name, projects);
      }
    }

    const candidates: Skill[] = [];

    for (const [skillName, projects] of projectSkillUsage) {
      if (projects.size < 3) continue;

      // Find the best version of this skill
      const versions = Array.from(this.skills.values())
        .filter((s) => s.name === skillName && !s.isGlobal);

      const bestVersion = versions
        .filter((s) => s.isVerified && s.successRate >= 0.8)
        .sort((a, b) => b.metrics.usageCount - a.metrics.usageCount)[0];

      if (bestVersion) {
        candidates.push(bestVersion);
      }
    }

    return candidates;
  }

  /**
   * Get skill statistics.
   */
  async getStats(): Promise<{
    totalSkills: number;
    globalSkills: number;
    projectSkills: number;
    verifiedSkills: number;
    avgSuccessRate: number;
    mostUsedSkills: Array<{ skill: Skill; usageCount: number }>;
  }> {
    const allSkills = Array.from(this.skills.values());
    const enabledSkills = allSkills.filter((s) => s.enabled);

    const globalCount = this.globalSkillIds.size;
    const projectCount = enabledSkills.length - globalCount;
    const verifiedCount = enabledSkills.filter((s) => s.isVerified).length;

    const avgSuccessRate =
      enabledSkills.length > 0
        ? enabledSkills.reduce((sum, s) => sum + s.successRate, 0) / enabledSkills.length
        : 0;

    const mostUsed = enabledSkills
      .filter((s) => s.metrics.usageCount > 0)
      .sort((a, b) => b.metrics.usageCount - a.metrics.usageCount)
      .slice(0, 10)
      .map((skill) => ({ skill, usageCount: skill.metrics.usageCount }));

    return {
      totalSkills: enabledSkills.length,
      globalSkills: globalCount,
      projectSkills: projectCount,
      verifiedSkills: verifiedCount,
      avgSuccessRate,
      mostUsedSkills: mostUsed,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private async saveSkill(skill: Skill): Promise<void> {
    this.skills.set(skill.id, skill);

    if (skill.isGlobal) {
      this.globalSkillIds.add(skill.id);
    } else if (skill.projectPath) {
      const projectSkills = this.skillsByProject.get(skill.projectPath) ?? new Set();
      projectSkills.add(skill.id);
      this.skillsByProject.set(skill.projectPath, projectSkills);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Load skills from persisted storage.
   */
  async loadFromStorage(skills: SkillProps[]): Promise<void> {
    for (const props of skills) {
      const skill = Skill.reconstitute(props);
      await this.saveSkill(skill);
    }
  }

  /**
   * Export all skills for persistence.
   */
  async exportForStorage(): Promise<SkillProps[]> {
    return Array.from(this.skills.values()).map((s) => s.toPlainObject());
  }
}
