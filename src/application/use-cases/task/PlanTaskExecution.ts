/**
 * PlanTaskExecution Use Case
 *
 * Generates an execution plan for a parsed task.
 * Determines:
 * - Which agent to use
 * - Isolation strategy (worktree, branch, or none)
 * - Context to inject
 *
 * Flow:
 * 1. Retrieve task and project knowledge
 * 2. Determine available agents and their suitability
 * 3. Call LLM gateway to generate plan
 * 4. Transition task to "planning" state
 */

import { Task } from "@/domain/entities/Task";
import { NoSuitableAgentError, TaskExecutionError } from "@/domain/errors/TaskErrors";
import { EntityNotFoundError } from "@/domain/errors/DomainError";
import type {
  ITaskRepository,
  IProjectKnowledgeRepository,
  IOrchestratorLLMGateway,
  ExecutionPlan,
} from "@/application/ports/task-ports";
import type { AgentProviderType } from "@/types/session";

export interface PlanTaskExecutionInput {
  taskId: string;
  folderPath: string;
  availableAgents?: AgentProviderType[];
  gitStatus?: string;
}

export interface PlanTaskExecutionOutput {
  task: Task;
  plan: ExecutionPlan;
}

export class PlanTaskExecution {
  constructor(
    private readonly taskRepository: ITaskRepository,
    private readonly projectKnowledgeRepository: IProjectKnowledgeRepository,
    private readonly llmGateway: IOrchestratorLLMGateway
  ) {}

  async execute(input: PlanTaskExecutionInput): Promise<PlanTaskExecutionOutput> {
    // Retrieve task
    const task = await this.taskRepository.findById(input.taskId);
    if (!task) {
      throw new EntityNotFoundError("Task", input.taskId);
    }

    // Validate task is in correct state
    if (!task.isQueued()) {
      throw new TaskExecutionError(
        input.taskId,
        `Task must be in queued state to plan execution, current state: ${task.status.toString()}`
      );
    }

    // Transition to planning
    const planningTask = task.startPlanning();

    // Get project knowledge if folder is linked
    const projectKnowledge = task.folderId
      ? await this.projectKnowledgeRepository.findByFolderId(task.folderId)
      : null;

    // Determine available agents
    const availableAgents = input.availableAgents ?? ["claude", "codex", "gemini", "opencode"];

    // Filter available agents based on task type recommendations
    const recommendedAgents = task.getRecommendedAgents();
    const suitableAgents = availableAgents.filter((agent) =>
      recommendedAgents.includes(agent)
    );

    if (suitableAgents.length === 0) {
      // Fall back to all available agents if no recommendations match
      if (availableAgents.length === 0) {
        throw new NoSuitableAgentError(
          task.type.toString(),
          "No agents available for task execution"
        );
      }
    }

    // Consider project knowledge for agent selection
    let preferredAgent: AgentProviderType | undefined;
    if (projectKnowledge) {
      const recommended = projectKnowledge.getRecommendedAgent(task.type.toString());
      if (recommended && availableAgents.includes(recommended)) {
        preferredAgent = recommended;
      }
    }

    // Generate execution plan using LLM
    const plan = await this.llmGateway.planTaskExecution(planningTask, {
      projectKnowledge: projectKnowledge ?? undefined,
      availableAgents: preferredAgent ? [preferredAgent, ...availableAgents.filter(a => a !== preferredAgent)] : availableAgents,
      folderPath: input.folderPath,
      gitStatus: input.gitStatus,
    });

    // Validate plan
    if (!plan.selectedAgent) {
      throw new NoSuitableAgentError(task.type.toString(), "LLM failed to select an agent");
    }

    if (!availableAgents.includes(plan.selectedAgent)) {
      throw new NoSuitableAgentError(
        task.type.toString(),
        `LLM selected unavailable agent: ${plan.selectedAgent}`
      );
    }

    // Persist planning state
    await this.taskRepository.save(planningTask);

    return {
      task: planningTask,
      plan,
    };
  }
}
