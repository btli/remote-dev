/**
 * CrossSessionLearningService - Aggregates learnings across agent sessions.
 *
 * This service is the integration point for the cross-session learning system:
 * 1. Listens for session end events (task_complete, session_end, error, stall)
 * 2. Analyzes sessions using SessionEndAnalysisService
 * 3. Updates ProjectKnowledge with extracted learnings
 * 4. Provides knowledge injection for new sessions
 *
 * Architecture:
 * - Orchestrators call this service when they detect session events
 * - Master Control aggregates learnings across all folders
 * - Folder Controls aggregate learnings within their scope
 */

import type { AgentProvider } from "@/types/agent";
import type {
  SessionEndAnalysis,
  SessionLearning,
  SessionImprovement,
} from "./session-end-analysis-service";
import { SessionEndAnalysisService, type SessionEndContext } from "./session-end-analysis-service";
import { processTaskComplete, type SessionAnalysis } from "./orchestrator-intelligence-service";
import type { IProjectKnowledgeRepository } from "@/application/ports/task-ports";
import type { ProjectKnowledge, LearnedPattern, SkillDefinition } from "@/domain/entities/ProjectKnowledge";
import { projectKnowledgeRepository } from "@/infrastructure/container";

/**
 * Result of processing a session for learning
 */
export interface LearningExtractionResult {
  sessionId: string;
  folderId: string | null;
  projectPath: string;
  agentProvider: AgentProvider;

  // Analysis results
  endAnalysis: SessionEndAnalysis;
  scrollbackAnalysis: SessionAnalysis | null;

  // Knowledge updates
  patternsAdded: number;
  skillsAdded: number;
  gotchasAdded: number;
  configUpdated: boolean;

  // Aggregation
  aggregatedToProject: boolean;
  aggregatedToGlobal: boolean;
}

/**
 * Knowledge summary for injection into new sessions
 */
export interface KnowledgeSummary {
  // High-confidence patterns
  patterns: Array<{
    type: string;
    description: string;
    confidence: number;
  }>;

  // Gotchas to avoid
  gotchas: Array<{
    description: string;
    context: string;
  }>;

  // Skills that have worked well
  skills: Array<{
    name: string;
    description: string;
    command?: string;
  }>;

  // Agent performance insights
  recommendedAgent: AgentProvider | null;
  agentNotes: string | null;

  // Tech stack context
  techStack: string[];
  conventions: string[];
}

/**
 * Cross-session learning aggregation service
 */
export class CrossSessionLearningService {
  private readonly endAnalysisService: SessionEndAnalysisService;
  private readonly knowledgeRepository: IProjectKnowledgeRepository;

  constructor(repository?: IProjectKnowledgeRepository) {
    this.endAnalysisService = new SessionEndAnalysisService();
    this.knowledgeRepository = repository ?? projectKnowledgeRepository;
  }

  /**
   * Process a session end event and extract learnings.
   *
   * This is the main entry point called by orchestrators when sessions end.
   */
  async processSessionEnd(
    sessionId: string,
    tmuxSessionName: string,
    folderId: string | null,
    projectPath: string,
    agentProvider: AgentProvider,
    endType: "task_complete" | "session_end" | "user_closed" | "error" | "stall_detected",
    context?: {
      reason?: string;
      errorMessage?: string;
      stallDuration?: number;
    }
  ): Promise<LearningExtractionResult> {
    // Step 1: Run session end analysis
    const endContext: SessionEndContext = {
      sessionId,
      projectPath,
      agentProvider,
      endType,
      reason: context?.reason,
      errorContext: context?.errorMessage
        ? { message: context.errorMessage }
        : undefined,
      stallContext: context?.stallDuration
        ? { duration: context.stallDuration, lastActivity: "" }
        : undefined,
    };

    const endAnalysis = await this.endAnalysisService.analyze(endContext);

    // Step 2: Run scrollback analysis (for task_complete and session_end)
    let scrollbackAnalysis: SessionAnalysis | null = null;
    let configUpdated = false;

    if (endType === "task_complete" || endType === "session_end") {
      try {
        const result = await processTaskComplete(
          sessionId,
          tmuxSessionName,
          projectPath,
          agentProvider,
          folderId ? "folder" : "master"
        );
        configUpdated = result.configUpdated;

        // We don't have direct access to the analysis, but we know it ran
        if (result.analyzed && result.patternsFound > 0) {
          // Create a minimal SessionAnalysis from the result
          scrollbackAnalysis = {
            sessionId,
            projectPath,
            agent: agentProvider,
            duration: 0,
            filesModified: [],
            commandsRun: [],
            errorsEncountered: [],
            errorsFixes: [],
            patterns: [],
            gotchas: [],
            insights: [],
          };
        }
      } catch (error) {
        console.error(`[CrossSessionLearning] Scrollback analysis failed:`, error);
      }
    }

    // Step 3: Update ProjectKnowledge
    let patternsAdded = 0;
    let skillsAdded = 0;
    let gotchasAdded = 0;
    let aggregatedToProject = false;

    if (folderId) {
      try {
        const knowledge = await this.knowledgeRepository.findByFolderId(folderId);
        if (knowledge) {
          const updated = await this.aggregateLearningsToKnowledge(
            knowledge,
            endAnalysis,
            agentProvider
          );
          await this.knowledgeRepository.save(updated);

          patternsAdded = endAnalysis.learnings.filter((l) => l.type === "pattern").length;
          skillsAdded = endAnalysis.improvements.filter((i) => i.type === "skill").length;
          gotchasAdded = endAnalysis.improvements.filter((i) => i.type === "gotcha").length;
          aggregatedToProject = true;
        }
      } catch (error) {
        console.error(`[CrossSessionLearning] Knowledge update failed:`, error);
      }
    }

    return {
      sessionId,
      folderId,
      projectPath,
      agentProvider,
      endAnalysis,
      scrollbackAnalysis,
      patternsAdded,
      skillsAdded,
      gotchasAdded,
      configUpdated,
      aggregatedToProject,
      aggregatedToGlobal: false, // Master Control handles global aggregation
    };
  }

  /**
   * Aggregate learnings from analysis into ProjectKnowledge.
   */
  private async aggregateLearningsToKnowledge(
    knowledge: ProjectKnowledge,
    analysis: SessionEndAnalysis,
    agentProvider: AgentProvider
  ): Promise<ProjectKnowledge> {
    let updated = knowledge;

    // Add patterns from learnings
    for (const learning of analysis.learnings) {
      if (learning.type === "pattern" || learning.type === "command") {
        updated = updated.addPattern({
          type: learning.type === "command" ? "success" : "success",
          description: learning.description,
          context: learning.evidence,
          confidence: learning.confidence,
        });
      }
    }

    // Add gotchas from improvements
    for (const improvement of analysis.improvements) {
      if (improvement.type === "gotcha" || improvement.type === "prevention") {
        updated = updated.addPattern({
          type: "gotcha",
          description: improvement.title,
          context: improvement.description,
          confidence: improvement.priority === "high" ? 0.9 : improvement.priority === "medium" ? 0.7 : 0.5,
        });
      }

      if (improvement.type === "skill") {
        updated = updated.addSkill({
          name: improvement.title,
          description: improvement.description,
          command: improvement.action ?? "",
          triggers: [],
          steps: [],
          scope: "project",
          verified: false,
        });
      }
    }

    // Record agent performance
    const taskType = this.inferTaskType(analysis);
    updated = updated.recordAgentPerformance(
      taskType,
      agentProvider as "claude" | "codex" | "gemini" | "opencode",
      analysis.outcome === "success" || analysis.outcome === "completed",
      analysis.analysisDuration
    );

    return updated;
  }

  /**
   * Get knowledge summary for injection into a new session.
   */
  async getKnowledgeForNewSession(
    folderId: string | null,
    taskDescription?: string
  ): Promise<KnowledgeSummary | null> {
    if (!folderId) {
      return null;
    }

    const knowledge = await this.knowledgeRepository.findByFolderId(folderId);
    if (!knowledge) {
      return null;
    }

    // Get high-confidence patterns
    const patterns = knowledge.patterns
      .filter((p) => p.confidence >= 0.6)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10)
      .map((p) => ({
        type: p.type,
        description: p.description,
        confidence: p.confidence,
      }));

    // Get gotchas
    const gotchas = knowledge.patterns
      .filter((p) => p.type === "gotcha")
      .slice(0, 5)
      .map((p) => ({
        description: p.description,
        context: p.context,
      }));

    // Get verified skills
    const skills = knowledge.skills
      .filter((s) => s.verified || s.usageCount > 0)
      .slice(0, 5)
      .map((s) => ({
        name: s.name,
        description: s.description,
        command: s.command,
      }));

    // Get recommended agent
    let recommendedAgent: AgentProvider | null = null;
    let agentNotes: string | null = null;

    if (taskDescription) {
      const taskType = this.inferTaskTypeFromDescription(taskDescription);
      const recommended = knowledge.getRecommendedAgent(taskType);
      if (recommended) {
        recommendedAgent = recommended as AgentProvider;
        const perf = knowledge.agentPerformance[taskType]?.[recommended];
        if (perf) {
          agentNotes = `${recommended} has ${(perf.successRate * 100).toFixed(0)}% success rate for ${taskType} tasks`;
        }
      }
    }

    // Get conventions
    const conventions = knowledge.conventions
      .filter((c) => c.confidence >= 0.7)
      .slice(0, 5)
      .map((c) => `${c.category}: ${c.description}`);

    return {
      patterns,
      gotchas,
      skills,
      recommendedAgent,
      agentNotes,
      techStack: knowledge.techStack,
      conventions,
    };
  }

  /**
   * Generate knowledge context string for session initialization.
   *
   * This can be injected into agent startup prompts or CLAUDE.md.
   */
  async generateKnowledgeContext(
    folderId: string | null,
    taskDescription?: string
  ): Promise<string | null> {
    const summary = await this.getKnowledgeForNewSession(folderId, taskDescription);
    if (!summary) {
      return null;
    }

    const lines: string[] = [];

    // Tech stack
    if (summary.techStack.length > 0) {
      lines.push(`## Tech Stack\n${summary.techStack.join(", ")}\n`);
    }

    // Conventions
    if (summary.conventions.length > 0) {
      lines.push(`## Conventions`);
      for (const conv of summary.conventions) {
        lines.push(`- ${conv}`);
      }
      lines.push("");
    }

    // Patterns
    if (summary.patterns.length > 0) {
      lines.push(`## Learned Patterns`);
      for (const pattern of summary.patterns) {
        lines.push(`- [${pattern.type}] ${pattern.description}`);
      }
      lines.push("");
    }

    // Gotchas
    if (summary.gotchas.length > 0) {
      lines.push(`## Gotchas to Avoid`);
      for (const gotcha of summary.gotchas) {
        lines.push(`- ${gotcha.description}`);
        if (gotcha.context) {
          lines.push(`  - Context: ${gotcha.context}`);
        }
      }
      lines.push("");
    }

    // Skills
    if (summary.skills.length > 0) {
      lines.push(`## Available Skills`);
      for (const skill of summary.skills) {
        lines.push(`- **${skill.name}**: ${skill.description}`);
        if (skill.command) {
          lines.push(`  - Command: \`${skill.command}\``);
        }
      }
      lines.push("");
    }

    // Agent recommendation
    if (summary.recommendedAgent && summary.agentNotes) {
      lines.push(`## Agent Recommendation`);
      lines.push(`${summary.agentNotes}`);
      lines.push("");
    }

    if (lines.length === 0) {
      return null;
    }

    return lines.join("\n");
  }

  /**
   * Aggregate learnings across multiple folders (Master Control use).
   *
   * Called by Master Control to identify cross-project patterns.
   */
  async aggregateCrossProjectPatterns(
    userId: string
  ): Promise<{
    commonPatterns: LearnedPattern[];
    universalGotchas: LearnedPattern[];
    topSkills: SkillDefinition[];
  }> {
    const allKnowledge = await this.knowledgeRepository.findByUserId(userId);

    // Collect all patterns
    const patternCounts = new Map<string, { count: number; pattern: LearnedPattern }>();
    const gotchaCounts = new Map<string, { count: number; gotcha: LearnedPattern }>();
    const skillCounts = new Map<string, { count: number; skill: SkillDefinition }>();

    for (const knowledge of allKnowledge) {
      // Count patterns
      for (const pattern of knowledge.patterns) {
        if (pattern.type !== "gotcha") {
          const key = pattern.description.toLowerCase().slice(0, 50);
          const existing = patternCounts.get(key);
          if (existing) {
            existing.count++;
            existing.pattern = {
              ...existing.pattern,
              confidence: Math.min(1, existing.pattern.confidence + 0.1),
            };
          } else {
            patternCounts.set(key, { count: 1, pattern: { ...pattern } });
          }
        } else {
          // Count gotchas
          const key = pattern.description.toLowerCase().slice(0, 50);
          const existing = gotchaCounts.get(key);
          if (existing) {
            existing.count++;
          } else {
            gotchaCounts.set(key, { count: 1, gotcha: { ...pattern } });
          }
        }
      }

      // Count skills
      for (const skill of knowledge.skills) {
        const key = skill.name.toLowerCase();
        const existing = skillCounts.get(key);
        if (existing) {
          existing.count++;
          existing.skill = {
            ...existing.skill,
            usageCount: existing.skill.usageCount + skill.usageCount,
          };
        } else {
          skillCounts.set(key, { count: 1, skill: { ...skill } });
        }
      }
    }

    // Patterns seen in 2+ projects are common
    const commonPatterns = Array.from(patternCounts.values())
      .filter((p) => p.count >= 2)
      .map((p) => ({
        ...p.pattern,
        confidence: Math.min(1, p.pattern.confidence + 0.2),
      }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10);

    // Gotchas seen in 2+ projects are universal
    const universalGotchas = Array.from(gotchaCounts.values())
      .filter((g) => g.count >= 2)
      .map((g) => g.gotcha)
      .slice(0, 5);

    // Most used skills across projects
    const topSkills = Array.from(skillCounts.values())
      .filter((s) => s.count >= 2 || s.skill.usageCount >= 5)
      .map((s) => s.skill)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);

    return {
      commonPatterns,
      universalGotchas,
      topSkills,
    };
  }

  /**
   * Infer task type from analysis outcome.
   */
  private inferTaskType(analysis: SessionEndAnalysis): string {
    // Look at the issues and learnings to infer task type
    const hasTestingIssues = analysis.issues.some((i) =>
      i.description.toLowerCase().includes("test")
    );
    const hasErrorFixes = analysis.learnings.some((l) =>
      l.type === "error_handling"
    );

    if (hasTestingIssues) return "test";
    if (hasErrorFixes) return "bug";
    return "feature"; // Default
  }

  /**
   * Infer task type from task description.
   */
  private inferTaskTypeFromDescription(description: string): string {
    const lower = description.toLowerCase();

    if (lower.includes("test") || lower.includes("spec")) return "test";
    if (lower.includes("fix") || lower.includes("bug") || lower.includes("error")) return "bug";
    if (lower.includes("refactor") || lower.includes("clean")) return "refactor";
    if (lower.includes("doc") || lower.includes("readme")) return "documentation";
    if (lower.includes("review") || lower.includes("pr")) return "review";

    return "feature"; // Default
  }
}

// Singleton instance
let crossSessionLearningService: CrossSessionLearningService | null = null;

/**
 * Get the cross-session learning service singleton.
 */
export function getCrossSessionLearningService(): CrossSessionLearningService {
  if (!crossSessionLearningService) {
    crossSessionLearningService = new CrossSessionLearningService();
  }
  return crossSessionLearningService;
}

/**
 * Process a session end event (convenience function).
 *
 * Call this from orchestrator event handlers.
 */
export async function processSessionEndForLearning(
  sessionId: string,
  tmuxSessionName: string,
  folderId: string | null,
  projectPath: string,
  agentProvider: AgentProvider,
  endType: "task_complete" | "session_end" | "user_closed" | "error" | "stall_detected",
  context?: {
    reason?: string;
    errorMessage?: string;
    stallDuration?: number;
  }
): Promise<LearningExtractionResult> {
  return getCrossSessionLearningService().processSessionEnd(
    sessionId,
    tmuxSessionName,
    folderId,
    projectPath,
    agentProvider,
    endType,
    context
  );
}

/**
 * Get knowledge for a new session (convenience function).
 */
export async function getKnowledgeForSession(
  folderId: string | null,
  taskDescription?: string
): Promise<KnowledgeSummary | null> {
  return getCrossSessionLearningService().getKnowledgeForNewSession(
    folderId,
    taskDescription
  );
}

/**
 * Generate knowledge context for session startup (convenience function).
 */
export async function generateSessionKnowledgeContext(
  folderId: string | null,
  taskDescription?: string
): Promise<string | null> {
  return getCrossSessionLearningService().generateKnowledgeContext(
    folderId,
    taskDescription
  );
}
