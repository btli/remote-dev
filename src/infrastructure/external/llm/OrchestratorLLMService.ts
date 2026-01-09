/**
 * OrchestratorLLMService - LLM integration for orchestrator intelligence.
 *
 * Implements IOrchestratorLLMGateway using terminal-based interaction.
 * Instead of direct API calls, this service will inject prompts into
 * a dedicated orchestrator agent session and parse responses.
 *
 * Provides:
 * - Natural language task parsing
 * - Execution planning
 * - Transcript analysis
 * - Context generation
 * - Session progress monitoring
 *
 * NOTE: This is a stub implementation. The actual LLM interaction
 * will happen via tmux sessions to leverage subscription-based usage.
 */

import { TaskType } from "@/domain/value-objects/TaskType";
import type { Task } from "@/domain/entities/Task";
import type { ProjectKnowledge } from "@/domain/entities/ProjectKnowledge";
import type {
  IOrchestratorLLMGateway,
  ParsedTask,
  ExecutionPlan,
  TaskAnalysis,
  TranscriptChunk,
} from "@/application/ports/task-ports";
import type { AgentProviderType } from "@/types/session";

/**
 * LLM service for orchestrator intelligence.
 *
 * This implementation provides sensible defaults and heuristics.
 * For full LLM-powered analysis, the orchestrator will delegate
 * to its dedicated agent session.
 */
export class OrchestratorLLMService implements IOrchestratorLLMGateway {
  /**
   * Parse natural language input into a structured task.
   * Uses heuristics for basic parsing; complex tasks should use agent session.
   */
  async parseTaskFromNaturalLanguage(
    input: string,
    context: {
      projectKnowledge?: ProjectKnowledge;
      recentTasks?: Task[];
      beadsContext?: string;
    }
  ): Promise<ParsedTask> {
    // Basic heuristic parsing
    const lowerInput = input.toLowerCase();

    // Detect task type from keywords
    let type = TaskType.fromString("feature");
    if (lowerInput.includes("fix") || lowerInput.includes("bug") || lowerInput.includes("error")) {
      type = TaskType.fromString("bug");
    } else if (lowerInput.includes("refactor") || lowerInput.includes("clean")) {
      type = TaskType.fromString("refactor");
    } else if (lowerInput.includes("test") || lowerInput.includes("spec")) {
      type = TaskType.fromString("test");
    } else if (lowerInput.includes("doc") || lowerInput.includes("readme")) {
      type = TaskType.fromString("documentation");
    } else if (lowerInput.includes("research") || lowerInput.includes("investigate")) {
      type = TaskType.fromString("research");
    } else if (lowerInput.includes("review") || lowerInput.includes("check")) {
      type = TaskType.fromString("review");
    }

    // Detect beads issue ID
    const beadsMatch = input.match(/beads-[a-z0-9]+/i);
    const beadsIssueId = beadsMatch?.[0];

    // Suggest agents based on task type and project knowledge
    let suggestedAgents: AgentProviderType[] = ["claude"];
    if (context.projectKnowledge) {
      const recommended = context.projectKnowledge.getRecommendedAgent(type.toString());
      if (recommended) {
        suggestedAgents = [recommended as AgentProviderType];
      }
    }

    return {
      description: input.trim(),
      type,
      confidence: 0.7, // Heuristic parsing has moderate confidence
      reasoning: "Parsed using keyword heuristics. For complex tasks, orchestrator will delegate to agent.",
      suggestedAgents,
      beadsIssueId,
    };
  }

  /**
   * Generate an execution plan for a task.
   * Uses project knowledge and heuristics for planning.
   */
  async planTaskExecution(
    task: Task,
    context: {
      projectKnowledge?: ProjectKnowledge;
      availableAgents: AgentProviderType[];
      folderPath: string;
      gitStatus?: string;
    }
  ): Promise<ExecutionPlan> {
    const taskType = task.type.toString();

    // Select agent based on project knowledge or default
    let selectedAgent: AgentProviderType = context.availableAgents[0] ?? "claude";
    if (context.projectKnowledge) {
      const recommended = context.projectKnowledge.getRecommendedAgent(taskType);
      if (recommended && context.availableAgents.includes(recommended as AgentProviderType)) {
        selectedAgent = recommended as AgentProviderType;
      }
    }

    // Determine isolation strategy based on task type
    let isolationStrategy: "worktree" | "branch" | "none" = "none";
    let branchName: string | undefined;

    if (taskType === "feature" || taskType === "refactor") {
      isolationStrategy = "worktree";
      const slug = task.description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 30);
      branchName = `${taskType}/${slug}`;
    } else if (taskType === "bug") {
      isolationStrategy = "branch";
      const slug = task.description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 30);
      branchName = `fix/${slug}`;
    }

    // Generate context to inject
    const contextParts: string[] = [
      `Task: ${task.description}`,
      `Type: ${taskType}`,
    ];

    if (context.projectKnowledge) {
      const conventions = context.projectKnowledge.getConventionsByCategory("code_style");
      if (conventions.length > 0) {
        contextParts.push(`\nCode conventions to follow:`);
        conventions.slice(0, 3).forEach((c) => {
          contextParts.push(`- ${c.description}`);
        });
      }
    }

    if (context.gitStatus) {
      contextParts.push(`\nGit status:\n${context.gitStatus}`);
    }

    return {
      taskId: task.id,
      selectedAgent,
      isolationStrategy,
      branchName,
      contextToInject: contextParts.join("\n"),
      estimatedTokens: 50000, // Default estimate
      reasoning: `Selected ${selectedAgent} with ${isolationStrategy} isolation based on task type and project conventions.`,
    };
  }

  /**
   * Analyze task transcript to extract learnings.
   * Returns a basic analysis; full analysis requires agent delegation.
   */
  async analyzeTaskTranscript(
    task: Task,
    transcript: TranscriptChunk[],
    _context: {
      projectKnowledge?: ProjectKnowledge;
      executionPlan?: ExecutionPlan;
    }
  ): Promise<TaskAnalysis> {
    // Extract basic info from transcript
    const filesModified: string[] = [];
    const learnings: string[] = [];

    // Look for file modifications in transcript
    const filePatterns = [
      /(?:created?|modifie?d?|update?d?|wrote?|edit(?:ed)?)\s+(?:file\s+)?[`"']?([^\s`"']+\.[a-z]+)[`"']?/gi,
      /(?:src|lib|components?)\/[^\s]+\.[a-z]+/gi,
    ];

    for (const chunk of transcript) {
      for (const pattern of filePatterns) {
        const matches = chunk.content.matchAll(pattern);
        for (const match of matches) {
          const file = match[1] ?? match[0];
          if (!filesModified.includes(file)) {
            filesModified.push(file);
          }
        }
      }
    }

    // Determine success based on last messages
    const lastChunks = transcript.slice(-5);
    const hasError = lastChunks.some(
      (c) =>
        c.content.toLowerCase().includes("error") ||
        c.content.toLowerCase().includes("failed") ||
        c.content.toLowerCase().includes("cannot")
    );
    const hasSuccess = lastChunks.some(
      (c) =>
        c.content.toLowerCase().includes("complete") ||
        c.content.toLowerCase().includes("success") ||
        c.content.toLowerCase().includes("done")
    );

    const success = hasSuccess && !hasError;

    return {
      taskId: task.id,
      success,
      summary: success
        ? `Task completed. Modified ${filesModified.length} files.`
        : "Task may have encountered issues. Review transcript for details.",
      filesModified: filesModified.slice(0, 20),
      learnings,
      conventions: [],
      patterns: [],
      suggestedSkills: [],
      suggestedTools: [],
    };
  }

  /**
   * Generate context injection prompt for agent.
   */
  async generateContextInjection(
    task: Task,
    executionPlan: ExecutionPlan,
    context: {
      projectKnowledge?: ProjectKnowledge;
      relevantConventions?: string[];
      relevantPatterns?: string[];
    }
  ): Promise<string> {
    const parts: string[] = [
      `# Task Assignment`,
      ``,
      `## Objective`,
      task.description,
      ``,
      `## Task Type`,
      task.type.toString(),
      ``,
    ];

    if (context.projectKnowledge) {
      parts.push(`## Project Context`);
      parts.push(`- Tech Stack: ${context.projectKnowledge.techStack.join(", ")}`);
      if (context.projectKnowledge.metadata.framework) {
        parts.push(`- Framework: ${context.projectKnowledge.metadata.framework}`);
      }
      parts.push(``);
    }

    if (context.relevantConventions?.length) {
      parts.push(`## Conventions to Follow`);
      context.relevantConventions.forEach((c) => parts.push(`- ${c}`));
      parts.push(``);
    }

    if (context.relevantPatterns?.length) {
      parts.push(`## Relevant Patterns`);
      context.relevantPatterns.forEach((p) => parts.push(`- ${p}`));
      parts.push(``);
    }

    parts.push(`## Instructions`);
    parts.push(`1. Analyze the codebase to understand the current implementation`);
    parts.push(`2. Plan your approach before making changes`);
    parts.push(`3. Implement the changes following project conventions`);
    parts.push(`4. Test your changes if applicable`);
    parts.push(`5. Summarize what you did when complete`);

    return parts.join("\n");
  }

  /**
   * Analyze session scrollback to determine task progress.
   * Uses heuristics for basic analysis.
   */
  async analyzeSessionProgress(
    _task: Task,
    scrollbackContent: string,
    _context: {
      previousAnalysis?: string;
      executionPlan?: ExecutionPlan;
    }
  ): Promise<{
    status: "working" | "blocked" | "completed" | "failed" | "idle";
    progress: number;
    currentActivity: string;
    blockedReason?: string;
    suggestedIntervention?: string;
  }> {
    const lines = scrollbackContent.split("\n");
    const recentLines = lines.slice(-50).join("\n").toLowerCase();
    const lower = recentLines; // Use for progress estimation

    // Check for completion indicators
    if (
      recentLines.includes("task complete") ||
      recentLines.includes("successfully") ||
      recentLines.includes("all done") ||
      recentLines.includes("finished")
    ) {
      return {
        status: "completed",
        progress: 100,
        currentActivity: "Task completed",
      };
    }

    // Check for failure indicators
    if (
      recentLines.includes("fatal error") ||
      recentLines.includes("cannot proceed") ||
      recentLines.includes("aborting")
    ) {
      return {
        status: "failed",
        progress: 0,
        currentActivity: "Task failed",
        blockedReason: "Encountered fatal error",
        suggestedIntervention: "Review error messages and restart task",
      };
    }

    // Check for blocked indicators
    if (
      recentLines.includes("waiting for") ||
      recentLines.includes("blocked by") ||
      recentLines.includes("need help") ||
      recentLines.includes("stuck")
    ) {
      return {
        status: "blocked",
        progress: 50,
        currentActivity: "Waiting for input or blocked",
        blockedReason: "Agent appears to need assistance",
        suggestedIntervention: "Check if agent needs clarification or permissions",
      };
    }

    // Check for idle (no recent activity)
    const lastLine = lines[lines.length - 1]?.trim() ?? "";
    if (lastLine.endsWith("$") || lastLine.endsWith(">") || lastLine === "") {
      return {
        status: "idle",
        progress: 50,
        currentActivity: "Agent appears idle at prompt",
        suggestedIntervention: "Agent may be waiting for input",
      };
    }

    // Default: assume working
    // Estimate progress based on content length and patterns
    let progress = 30;
    if (lower.includes("analyzing") || lower.includes("reading")) progress = 20;
    if (lower.includes("planning") || lower.includes("designing")) progress = 30;
    if (lower.includes("implementing") || lower.includes("writing")) progress = 50;
    if (lower.includes("testing") || lower.includes("verifying")) progress = 80;

    return {
      status: "working",
      progress,
      currentActivity: "Agent is actively working on task",
    };
  }
}
