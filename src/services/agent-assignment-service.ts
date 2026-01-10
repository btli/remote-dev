/**
 * Agent Assignment Service - Assign optimal agents to tasks
 *
 * Uses heuristics and past performance to assign the best agent
 * for each task type. Supports parallel execution and load balancing.
 */

import {
  selectAgent,
  selectAgentForCategory,
  getAgentCapabilities,
  compareAgentsForTask,
  type TaskCategory,
  type AgentRecommendation,
  type ExecutableAgent,
} from "@/lib/agent-heuristics";
import {
  getDependencyResolver,
  type BeadsIssue,
} from "./dependency-resolver-service";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentAssignment {
  issueId: string;
  agent: ExecutableAgent;
  confidence: number;
  reasoning: string;
  alternativeAgents: ExecutableAgent[];
}

export interface ExecutionPlan {
  phases: ExecutionPhase[];
  totalAgentSessions: number;
  estimatedParallelism: number;
}

export interface ExecutionPhase {
  phaseNumber: number;
  assignments: AgentAssignment[];
  canRunParallel: boolean;
  estimatedDuration: "short" | "medium" | "long";
}

export interface AgentWorkload {
  agent: ExecutableAgent;
  assignedTasks: number;
  estimatedLoad: number; // 0-1 normalized
  currentlyActive: boolean;
}

export interface AssignmentOptions {
  availableAgents?: ExecutableAgent[];
  preferFastExecution?: boolean;
  preferQuality?: boolean;
  maxParallelAgents?: number;
  balanceLoad?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

class AgentAssignmentService {
  private workingDir: string;
  private workloads: Map<ExecutableAgent, AgentWorkload> = new Map();

  constructor(workingDir: string = process.cwd()) {
    this.workingDir = workingDir;
    this.initializeWorkloads();
  }

  /**
   * Initialize workload tracking for all agents.
   */
  private initializeWorkloads() {
    const agents: ExecutableAgent[] = ["claude", "gemini", "codex", "opencode"];
    for (const agent of agents) {
      this.workloads.set(agent, {
        agent,
        assignedTasks: 0,
        estimatedLoad: 0,
        currentlyActive: false,
      });
    }
  }

  /**
   * Assign an agent to a single task.
   */
  assignAgent(
    issue: BeadsIssue,
    options: AssignmentOptions = {}
  ): AgentAssignment {
    const {
      availableAgents,
      preferFastExecution = false,
      preferQuality = false,
      balanceLoad = true,
    } = options;

    // Get base recommendation from heuristics
    const recommendation = selectAgent(
      issue.title,
      issue.description,
      availableAgents
    );

    let selectedAgent = recommendation.recommended;
    let confidence = recommendation.confidence;

    // Adjust based on preferences
    if (preferFastExecution) {
      const fastAgents = this.sortAgentsBySpeed(
        availableAgents || ["claude", "gemini", "codex", "opencode"]
      );
      if (fastAgents[0] !== selectedAgent) {
        // Prefer faster agent if confidence is not too high
        if (confidence < 0.8) {
          selectedAgent = fastAgents[0];
          confidence *= 0.9; // Slight reduction for preference override
        }
      }
    }

    if (preferQuality) {
      const qualityAgents = this.sortAgentsByQuality(
        availableAgents || ["claude", "gemini", "codex", "opencode"]
      );
      if (qualityAgents[0] !== selectedAgent) {
        if (confidence < 0.8) {
          selectedAgent = qualityAgents[0];
          confidence *= 0.9;
        }
      }
    }

    // Load balancing
    if (balanceLoad) {
      const alternatives = recommendation.alternatives;
      for (const alt of alternatives) {
        const currentLoad = this.workloads.get(selectedAgent)?.estimatedLoad || 0;
        const altLoad = this.workloads.get(alt)?.estimatedLoad || 0;

        // Switch to alternative if significantly less loaded
        if (altLoad < currentLoad - 0.3) {
          selectedAgent = alt;
          confidence *= 0.85; // Reduction for load-based switch
          break;
        }
      }
    }

    // Update workload
    const workload = this.workloads.get(selectedAgent);
    if (workload) {
      workload.assignedTasks++;
      workload.estimatedLoad = Math.min(
        1,
        workload.assignedTasks / 5 // Normalize by max 5 concurrent tasks
      );
    }

    return {
      issueId: issue.id,
      agent: selectedAgent,
      confidence,
      reasoning: recommendation.reasoning,
      alternativeAgents: recommendation.alternatives.filter(
        (a) => a !== selectedAgent
      ),
    };
  }

  /**
   * Create an execution plan for multiple issues.
   */
  async createExecutionPlan(
    options: AssignmentOptions = {}
  ): Promise<ExecutionPlan> {
    const resolver = getDependencyResolver(this.workingDir);
    const { ready, blocked, inProgress } = await resolver.getReadyIssues();

    // Get all open issues for planning
    const allIssues = [...ready, ...blocked.map((b) => b.issue), ...inProgress];

    if (allIssues.length === 0) {
      return {
        phases: [],
        totalAgentSessions: 0,
        estimatedParallelism: 0,
      };
    }

    // Build dependency graph
    const graph = resolver.buildDependencyGraph(allIssues);
    const order = resolver.topologicalSort(graph);

    // Create phases based on parallel groups
    const phases: ExecutionPhase[] = [];
    let phaseNumber = 1;

    for (const group of order.parallel) {
      const assignments: AgentAssignment[] = [];

      for (const issueId of group) {
        const issue = graph.nodes.get(issueId);
        if (issue && issue.status !== "closed") {
          const assignment = this.assignAgent(issue, options);
          assignments.push(assignment);
        }
      }

      if (assignments.length > 0) {
        // Estimate duration based on complexity
        const avgComplexity = assignments.length;
        let estimatedDuration: "short" | "medium" | "long";
        if (avgComplexity <= 2) {
          estimatedDuration = "short";
        } else if (avgComplexity <= 4) {
          estimatedDuration = "medium";
        } else {
          estimatedDuration = "long";
        }

        phases.push({
          phaseNumber: phaseNumber++,
          assignments,
          canRunParallel:
            assignments.length > 1 &&
            (options.maxParallelAgents === undefined ||
              assignments.length <= options.maxParallelAgents),
          estimatedDuration,
        });
      }
    }

    // Calculate parallelism
    const totalTasks = phases.reduce((sum, p) => sum + p.assignments.length, 0);
    const parallelism =
      phases.length > 0 ? totalTasks / phases.length : 0;

    return {
      phases,
      totalAgentSessions: totalTasks,
      estimatedParallelism: Math.round(parallelism * 100) / 100,
    };
  }

  /**
   * Get next assignment for immediate execution.
   */
  async getNextAssignment(
    options: AssignmentOptions = {}
  ): Promise<AgentAssignment | null> {
    const resolver = getDependencyResolver(this.workingDir);
    const { ready } = await resolver.getReadyIssues();

    if (ready.length === 0) {
      return null;
    }

    // Sort by priority (lower is higher priority)
    const sorted = [...ready].sort((a, b) => a.priority - b.priority);

    // Assign to highest priority task
    return this.assignAgent(sorted[0], options);
  }

  /**
   * Get assignments for all ready tasks.
   */
  async getReadyAssignments(
    options: AssignmentOptions = {}
  ): Promise<AgentAssignment[]> {
    const resolver = getDependencyResolver(this.workingDir);
    const { ready } = await resolver.getReadyIssues();

    return ready.map((issue) => this.assignAgent(issue, options));
  }

  /**
   * Get recommended agent for a task category.
   */
  getAgentForCategory(
    category: TaskCategory,
    options: AssignmentOptions = {}
  ): AgentRecommendation {
    return selectAgentForCategory(category, options.availableAgents);
  }

  /**
   * Compare agents for a specific task.
   */
  compareAgents(
    title: string,
    description?: string
  ): Array<{
    agent: ExecutableAgent;
    score: number;
    reasoning: string;
  }> {
    return compareAgentsForTask(title, description);
  }

  /**
   * Get current workload for all agents.
   */
  getWorkloads(): AgentWorkload[] {
    return Array.from(this.workloads.values());
  }

  /**
   * Mark an agent as active (running a task).
   */
  markAgentActive(agent: ExecutableAgent, active: boolean) {
    const workload = this.workloads.get(agent);
    if (workload) {
      workload.currentlyActive = active;
    }
  }

  /**
   * Release a task assignment (task completed or cancelled).
   */
  releaseAssignment(issueId: string, agent: ExecutableAgent) {
    const workload = this.workloads.get(agent);
    if (workload && workload.assignedTasks > 0) {
      workload.assignedTasks--;
      workload.estimatedLoad = Math.max(0, workload.assignedTasks / 5);
    }
  }

  /**
   * Sort agents by speed rating.
   */
  private sortAgentsBySpeed(agents: ExecutableAgent[]): ExecutableAgent[] {
    return [...agents].sort((a, b) => {
      const capA = getAgentCapabilities(a);
      const capB = getAgentCapabilities(b);
      return capB.speedRating - capA.speedRating;
    });
  }

  /**
   * Sort agents by quality rating.
   */
  private sortAgentsByQuality(agents: ExecutableAgent[]): ExecutableAgent[] {
    return [...agents].sort((a, b) => {
      const capA = getAgentCapabilities(a);
      const capB = getAgentCapabilities(b);
      return capB.qualityRating - capA.qualityRating;
    });
  }

  /**
   * Get agent assignment statistics.
   */
  getAssignmentStats(): {
    byAgent: Record<ExecutableAgent, number>;
    totalAssignments: number;
    activeAgents: number;
  } {
    const byAgent: Record<ExecutableAgent, number> = {
      claude: 0,
      gemini: 0,
      codex: 0,
      opencode: 0,
    };

    let totalAssignments = 0;
    let activeAgents = 0;

    for (const workload of this.workloads.values()) {
      byAgent[workload.agent] = workload.assignedTasks;
      totalAssignments += workload.assignedTasks;
      if (workload.currentlyActive) {
        activeAgents++;
      }
    }

    return {
      byAgent,
      totalAssignments,
      activeAgents,
    };
  }

  /**
   * Reset workload tracking.
   */
  resetWorkloads() {
    this.initializeWorkloads();
  }

  /**
   * Get assignment recommendation summary for display.
   */
  async getSummary(): Promise<{
    readyTasks: number;
    blockedTasks: number;
    inProgressTasks: number;
    recommendedNextAgent: ExecutableAgent | null;
    estimatedPhases: number;
  }> {
    const resolver = getDependencyResolver(this.workingDir);
    const { ready, blocked, inProgress } = await resolver.getReadyIssues();

    const nextAssignment = ready.length > 0
      ? this.assignAgent(ready[0])
      : null;

    const plan = await this.createExecutionPlan();

    return {
      readyTasks: ready.length,
      blockedTasks: blocked.length,
      inProgressTasks: inProgress.length,
      recommendedNextAgent: nextAssignment?.agent || null,
      estimatedPhases: plan.phases.length,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

const assignmentCache = new Map<string, AgentAssignmentService>();

export function getAgentAssignmentService(
  workingDir?: string
): AgentAssignmentService {
  const dir = workingDir || process.cwd();
  if (!assignmentCache.has(dir)) {
    assignmentCache.set(dir, new AgentAssignmentService(dir));
  }
  return assignmentCache.get(dir)!;
}

export { AgentAssignmentService };
