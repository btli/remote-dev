/**
 * Application Ports for Task Operations
 *
 * These interfaces define the contracts between the application layer
 * and infrastructure layer for task-related operations.
 */

import type { Task, TaskProps, CreateTaskProps, TaskResult, TaskError } from "@/domain/entities/Task";
import type { Delegation, DelegationProps, CreateDelegationProps, DelegationResult, DelegationError } from "@/domain/entities/Delegation";
import type { ProjectKnowledge, ProjectKnowledgeProps, CreateProjectKnowledgeProps } from "@/domain/entities/ProjectKnowledge";
import type { TaskType } from "@/domain/value-objects/TaskType";
import type { AgentProviderType } from "@/types/session";

// ─────────────────────────────────────────────────────────────────────────────
// Task Repository
// ─────────────────────────────────────────────────────────────────────────────

export interface ITaskRepository {
  /**
   * Save a new or updated task.
   */
  save(task: Task): Promise<void>;

  /**
   * Find a task by ID.
   */
  findById(id: string): Promise<Task | null>;

  /**
   * Find all tasks for an orchestrator.
   */
  findByOrchestratorId(orchestratorId: string): Promise<Task[]>;

  /**
   * Find all tasks for a user.
   */
  findByUserId(userId: string): Promise<Task[]>;

  /**
   * Find tasks by status for an orchestrator.
   */
  findByStatus(orchestratorId: string, statuses: string[]): Promise<Task[]>;

  /**
   * Find tasks linked to a beads issue.
   */
  findByBeadsIssueId(beadsIssueId: string): Promise<Task | null>;

  /**
   * Delete a task.
   */
  delete(id: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Delegation Repository
// ─────────────────────────────────────────────────────────────────────────────

export interface IDelegationRepository {
  /**
   * Save a new or updated delegation.
   */
  save(delegation: Delegation): Promise<void>;

  /**
   * Find a delegation by ID.
   */
  findById(id: string): Promise<Delegation | null>;

  /**
   * Find delegation by task ID (usually one-to-one but could have history).
   */
  findByTaskId(taskId: string): Promise<Delegation[]>;

  /**
   * Find delegations by session ID.
   */
  findBySessionId(sessionId: string): Promise<Delegation[]>;

  /**
   * Find active (non-terminal) delegations.
   */
  findActive(): Promise<Delegation[]>;

  /**
   * Find delegations by status.
   */
  findByStatus(statuses: string[]): Promise<Delegation[]>;

  /**
   * Delete a delegation.
   */
  delete(id: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Knowledge Repository
// ─────────────────────────────────────────────────────────────────────────────

export interface IProjectKnowledgeRepository {
  /**
   * Save project knowledge.
   */
  save(knowledge: ProjectKnowledge): Promise<void>;

  /**
   * Find project knowledge by ID.
   */
  findById(id: string): Promise<ProjectKnowledge | null>;

  /**
   * Find project knowledge by folder ID.
   */
  findByFolderId(folderId: string): Promise<ProjectKnowledge | null>;

  /**
   * Find all project knowledge for a user.
   */
  findByUserId(userId: string): Promise<ProjectKnowledge[]>;

  /**
   * Delete project knowledge.
   */
  delete(id: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator LLM Gateway
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedTask {
  description: string;
  type: TaskType;
  confidence: number;
  reasoning: string;
  suggestedAgents: AgentProviderType[];
  estimatedDuration?: number;
  beadsIssueId?: string;
}

export interface ExecutionPlan {
  taskId: string;
  selectedAgent: AgentProviderType;
  isolationStrategy: "worktree" | "branch" | "none";
  worktreePath?: string;
  branchName?: string;
  contextToInject: string;
  estimatedTokens: number;
  reasoning: string;
}

export interface TaskAnalysis {
  taskId: string;
  success: boolean;
  summary: string;
  filesModified: string[];
  learnings: string[];
  conventions: Array<{
    category: "code_style" | "naming" | "architecture" | "testing" | "git" | "other";
    description: string;
    examples: string[];
    confidence: number;
  }>;
  patterns: Array<{
    type: "success" | "failure" | "gotcha" | "optimization";
    description: string;
    context: string;
    confidence: number;
  }>;
  suggestedSkills: Array<{
    name: string;
    description: string;
    command: string;
    triggers: string[];
  }>;
  suggestedTools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
}

export interface TranscriptChunk {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  toolCalls?: Array<{
    name: string;
    input: Record<string, unknown>;
    result?: unknown;
  }>;
}

export interface IOrchestratorLLMGateway {
  /**
   * Parse natural language input into a structured task.
   * Uses LLM to understand intent and classify task type.
   */
  parseTaskFromNaturalLanguage(
    input: string,
    context: {
      projectKnowledge?: ProjectKnowledge;
      recentTasks?: Task[];
      beadsContext?: string;
    }
  ): Promise<ParsedTask>;

  /**
   * Generate an execution plan for a task.
   * Selects agent, determines isolation strategy, prepares context.
   */
  planTaskExecution(
    task: Task,
    context: {
      projectKnowledge?: ProjectKnowledge;
      availableAgents: AgentProviderType[];
      folderPath: string;
      gitStatus?: string;
    }
  ): Promise<ExecutionPlan>;

  /**
   * Analyze task transcript to extract learnings.
   * Called after task completion to update project knowledge.
   */
  analyzeTaskTranscript(
    task: Task,
    transcript: TranscriptChunk[],
    context: {
      projectKnowledge?: ProjectKnowledge;
      executionPlan?: ExecutionPlan;
    }
  ): Promise<TaskAnalysis>;

  /**
   * Generate context injection prompt for agent.
   * Creates the initial prompt that will be injected into the agent session.
   */
  generateContextInjection(
    task: Task,
    executionPlan: ExecutionPlan,
    context: {
      projectKnowledge?: ProjectKnowledge;
      relevantConventions?: string[];
      relevantPatterns?: string[];
    }
  ): Promise<string>;

  /**
   * Analyze session scrollback to determine task progress.
   * Used by monitoring to understand what the agent is doing.
   */
  analyzeSessionProgress(
    task: Task,
    scrollbackContent: string,
    context: {
      previousAnalysis?: string;
      executionPlan?: ExecutionPlan;
    }
  ): Promise<{
    status: "working" | "blocked" | "completed" | "failed" | "idle";
    progress: number; // 0-100
    currentActivity: string;
    blockedReason?: string;
    suggestedIntervention?: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Gateway (for delegations)
// ─────────────────────────────────────────────────────────────────────────────

export interface ISessionGateway {
  /**
   * Spawn a new agent session for task execution.
   */
  spawnSession(config: {
    folderId: string;
    workingDirectory: string;
    agentProvider: AgentProviderType;
    worktreeId?: string;
    name?: string;
  }): Promise<{
    sessionId: string;
    tmuxSessionName: string;
  }>;

  /**
   * Inject context into a session (send keys to terminal).
   */
  injectContext(sessionId: string, context: string): Promise<void>;

  /**
   * Get session scrollback buffer for monitoring.
   */
  getScrollback(sessionId: string, lines?: number): Promise<string>;

  /**
   * Check if session is still active.
   */
  isSessionActive(sessionId: string): Promise<boolean>;

  /**
   * Get session transcript path (for post-mortem analysis).
   */
  getTranscriptPath(sessionId: string): Promise<string | null>;

  /**
   * Close a session.
   */
  closeSession(sessionId: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Worktree Gateway
// ─────────────────────────────────────────────────────────────────────────────

export interface IWorktreeGateway {
  /**
   * Create a worktree for isolated task execution.
   */
  createWorktree(config: {
    repoPath: string;
    branchName: string;
    taskId: string;
  }): Promise<{
    worktreeId: string;
    worktreePath: string;
  }>;

  /**
   * Remove a worktree after task completion.
   */
  removeWorktree(worktreeId: string): Promise<void>;

  /**
   * Get worktree status (changes, commits).
   */
  getWorktreeStatus(worktreeId: string): Promise<{
    hasChanges: boolean;
    commitCount: number;
    filesModified: string[];
  }>;

  /**
   * Merge worktree changes back to main branch.
   */
  mergeWorktree(worktreeId: string, options: {
    squash?: boolean;
    commitMessage?: string;
  }): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Beads Gateway (issue tracking coordination)
// ─────────────────────────────────────────────────────────────────────────────

export interface IBeadsGateway {
  /**
   * Create a beads issue for a task.
   */
  createIssue(config: {
    title: string;
    description: string;
    type: "task" | "bug" | "feature" | "epic";
    priority: 0 | 1 | 2 | 3 | 4;
    parentId?: string;
  }): Promise<string>; // Returns issue ID

  /**
   * Update beads issue status.
   */
  updateIssueStatus(issueId: string, status: "open" | "in_progress" | "closed"): Promise<void>;

  /**
   * Close a beads issue with reason.
   */
  closeIssue(issueId: string, reason?: string): Promise<void>;

  /**
   * Add dependency between issues.
   */
  addDependency(issueId: string, dependsOnId: string): Promise<void>;

  /**
   * Get issue details.
   */
  getIssue(issueId: string): Promise<{
    id: string;
    title: string;
    description: string;
    status: string;
    type: string;
    priority: number;
    dependencies: string[];
    blockedBy: string[];
  } | null>;

  /**
   * List issues matching criteria.
   */
  listIssues(filter: {
    status?: string;
    type?: string;
    priority?: number;
  }): Promise<Array<{
    id: string;
    title: string;
    status: string;
    type: string;
    priority: number;
  }>>;
}
