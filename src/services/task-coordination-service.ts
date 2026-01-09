/**
 * TaskCoordinationService - Coordinates task assignment using beads and worktrees.
 *
 * Implements gastown-inspired coordination:
 * - Uses beads issues for task messaging
 * - Creates worktrees for task isolation
 * - Integrates with hooks for lifecycle events
 *
 * Workflow:
 * 1. Orchestrator creates beads issue for task
 * 2. Creates worktree for isolated work
 * 3. Spawns agent session in worktree
 * 4. Agent works on task, updates beads status
 * 5. On completion, hooks notify orchestrator
 * 6. Orchestrator processes transcript, cleans up
 */

import { BeadsClient, type BeadsIssue, type CreateIssueOptions } from "@/lib/beads-client";
import {
  createBranchWithWorktreeAndEnv,
  removeWorktree,
  sanitizeBranchName,
} from "@/services/worktree-service";
import type { AgentProvider } from "@/types/agent";

export interface TaskAssignment {
  issueId: string;
  title: string;
  description: string;
  worktreePath: string;
  branch: string;
  agentProvider: AgentProvider;
  createdAt: Date;
}

export interface TaskContext {
  projectPath: string;
  projectName: string;
  techStack?: string[];
  conventions?: string[];
  relatedFiles?: string[];
  acceptanceCriteria?: string[];
  constraints?: string[];
}

export interface AssignTaskOptions {
  title: string;
  description: string;
  type?: "task" | "bug" | "feature";
  priority?: number;
  agentProvider: AgentProvider;
  context: TaskContext;
  dependsOn?: string[]; // Other beads issue IDs
}

/**
 * Service for coordinating tasks between orchestrator and agents.
 */
export class TaskCoordinationService {
  private readonly beads: BeadsClient;

  constructor(workingDir?: string) {
    this.beads = new BeadsClient(workingDir);
  }

  /**
   * Assign a task to an agent.
   *
   * 1. Creates a beads issue with full context
   * 2. Creates a worktree for isolated work
   * 3. Returns assignment details for session creation
   */
  async assignTask(options: AssignTaskOptions): Promise<TaskAssignment> {
    const { title, description, type, priority, agentProvider, context, dependsOn } = options;

    // Build issue body with full context
    const issueBody = this.buildIssueBody(description, context);

    // Create beads issue
    const issueId = await this.beads.create({
      title,
      type: type ?? "task",
      priority: priority ?? 2,
      body: issueBody,
    });

    // Add dependencies if specified
    if (dependsOn && dependsOn.length > 0) {
      for (const depId of dependsOn) {
        await this.beads.addDependency(issueId, depId);
      }
    }

    // Create worktree for isolated work
    const branchName = `task/${sanitizeBranchName(issueId)}`;
    const { branch, worktreePath } = await createBranchWithWorktreeAndEnv(
      context.projectPath,
      branchName,
      { copyEnvFiles: true }
    );

    // Mark issue as in progress
    await this.beads.update(issueId, { status: "in_progress" });

    return {
      issueId,
      title,
      description,
      worktreePath,
      branch,
      agentProvider,
      createdAt: new Date(),
    };
  }

  /**
   * Complete a task.
   *
   * Called when agent finishes work (via hook or orchestrator detection).
   */
  async completeTask(
    issueId: string,
    options: {
      success: boolean;
      reason: string;
      keepWorktree?: boolean;
      repoPath?: string;
      worktreePath?: string;
    }
  ): Promise<void> {
    // Close the beads issue
    await this.beads.close(issueId, options.reason);

    // Optionally clean up worktree
    if (!options.keepWorktree && options.repoPath && options.worktreePath) {
      try {
        await removeWorktree(options.repoPath, options.worktreePath, true);
      } catch (error) {
        console.warn(`Failed to remove worktree: ${error}`);
        // Don't fail task completion if cleanup fails
      }
    }
  }

  /**
   * Report a blocker discovered during task execution.
   *
   * Creates a new high-priority issue and adds dependency.
   */
  async reportBlocker(
    currentIssueId: string,
    blocker: {
      title: string;
      description: string;
    }
  ): Promise<string> {
    // Create blocker issue with high priority
    const blockerId = await this.beads.create({
      title: `Blocker: ${blocker.title}`,
      type: "task",
      priority: 0, // P0 = highest
      body: blocker.description,
    });

    // Add dependency: current task depends on blocker resolution
    await this.beads.addDependency(currentIssueId, blockerId);

    return blockerId;
  }

  /**
   * Get ready tasks for an agent to work on.
   */
  async getReadyTasks(): Promise<BeadsIssue[]> {
    return this.beads.ready();
  }

  /**
   * Get blocked tasks that need attention.
   */
  async getBlockedTasks(): Promise<BeadsIssue[]> {
    return this.beads.blocked();
  }

  /**
   * Get tasks currently in progress.
   */
  async getInProgressTasks(): Promise<BeadsIssue[]> {
    return this.beads.list({ status: "in_progress" });
  }

  /**
   * Get task details.
   */
  async getTask(issueId: string): Promise<BeadsIssue | null> {
    return this.beads.show(issueId);
  }

  /**
   * Update task progress.
   */
  async updateProgress(issueId: string, progressNote: string): Promise<void> {
    await this.beads.update(issueId, { body: progressNote });
  }

  /**
   * Sync beads with remote.
   */
  async sync(): Promise<void> {
    await this.beads.sync();
  }

  /**
   * Build issue body with context for the agent.
   */
  private buildIssueBody(description: string, context: TaskContext): string {
    const sections: string[] = [];

    // Description
    sections.push("## Description");
    sections.push(description);
    sections.push("");

    // Project context
    sections.push("## Project Context");
    sections.push(`- **Path**: ${context.projectPath}`);
    sections.push(`- **Name**: ${context.projectName}`);
    if (context.techStack && context.techStack.length > 0) {
      sections.push(`- **Tech Stack**: ${context.techStack.join(", ")}`);
    }
    sections.push("");

    // Conventions
    if (context.conventions && context.conventions.length > 0) {
      sections.push("## Conventions");
      for (const convention of context.conventions) {
        sections.push(`- ${convention}`);
      }
      sections.push("");
    }

    // Related files
    if (context.relatedFiles && context.relatedFiles.length > 0) {
      sections.push("## Files to Reference");
      for (const file of context.relatedFiles) {
        sections.push(`- ${file}`);
      }
      sections.push("");
    }

    // Acceptance criteria
    if (context.acceptanceCriteria && context.acceptanceCriteria.length > 0) {
      sections.push("## Acceptance Criteria");
      for (const criterion of context.acceptanceCriteria) {
        sections.push(`- [ ] ${criterion}`);
      }
      sections.push("");
    }

    // Constraints
    if (context.constraints && context.constraints.length > 0) {
      sections.push("## Constraints");
      for (const constraint of context.constraints) {
        sections.push(`- ${constraint}`);
      }
      sections.push("");
    }

    // Instructions for agent
    sections.push("## Task Management");
    sections.push("Use beads (`bd`) for tracking:");
    sections.push("```bash");
    sections.push("bd show <this-issue-id>     # Review task");
    sections.push("bd close <id> --reason=...  # Complete task");
    sections.push("bd sync                     # Push changes");
    sections.push("```");

    return sections.join("\n");
  }
}

/**
 * Create a task coordination service for a project.
 */
export function createTaskCoordinator(projectPath?: string): TaskCoordinationService {
  return new TaskCoordinationService(projectPath);
}
