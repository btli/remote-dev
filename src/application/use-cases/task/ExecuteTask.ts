/**
 * ExecuteTask Use Case
 *
 * Executes a planned task by:
 * 1. Spawning an agent session
 * 2. Optionally creating a worktree for isolation
 * 3. Injecting context into the session
 * 4. Creating a Delegation to track execution
 *
 * This use case transitions the task from "planning" to "executing".
 */

import { Task } from "@/domain/entities/Task";
import { Delegation } from "@/domain/entities/Delegation";
import { TaskExecutionError, DelegationError as DelegationDomainError, ContextInjectionError } from "@/domain/errors/TaskErrors";
import { EntityNotFoundError } from "@/domain/errors/DomainError";
import type {
  ITaskRepository,
  IDelegationRepository,
  IProjectKnowledgeRepository,
  IOrchestratorLLMGateway,
  ISessionGateway,
  IWorktreeGateway,
  ExecutionPlan,
} from "@/application/ports/task-ports";

export interface ExecuteTaskInput {
  taskId: string;
  plan: ExecutionPlan;
  folderId: string;
}

export interface ExecuteTaskOutput {
  task: Task;
  delegation: Delegation;
  sessionId: string;
  worktreeId?: string;
}

export class ExecuteTask {
  constructor(
    private readonly taskRepository: ITaskRepository,
    private readonly delegationRepository: IDelegationRepository,
    private readonly projectKnowledgeRepository: IProjectKnowledgeRepository,
    private readonly llmGateway: IOrchestratorLLMGateway,
    private readonly sessionGateway: ISessionGateway,
    private readonly worktreeGateway: IWorktreeGateway
  ) {}

  async execute(input: ExecuteTaskInput): Promise<ExecuteTaskOutput> {
    const { taskId, plan, folderId } = input;

    // Retrieve task
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new EntityNotFoundError("Task", taskId);
    }

    // Validate task is in planning state
    if (!task.isPlanning()) {
      throw new TaskExecutionError(
        taskId,
        `Task must be in planning state to execute, current state: ${task.status.toString()}`
      );
    }

    // Get project knowledge for context generation
    const projectKnowledge = task.folderId
      ? await this.projectKnowledgeRepository.findByFolderId(task.folderId)
      : null;

    let worktreeId: string | undefined;
    let workingDirectory = plan.worktreePath ?? "";

    // Create worktree if isolation strategy requires it
    if (plan.isolationStrategy === "worktree" && plan.branchName) {
      try {
        const worktreeResult = await this.worktreeGateway.createWorktree({
          repoPath: workingDirectory || ".",
          branchName: plan.branchName,
          taskId,
        });
        worktreeId = worktreeResult.worktreeId;
        workingDirectory = worktreeResult.worktreePath;
      } catch (error) {
        throw new TaskExecutionError(
          taskId,
          `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
          true // recoverable
        );
      }
    }

    // Spawn agent session
    let sessionId: string;
    try {
      const sessionResult = await this.sessionGateway.spawnSession({
        folderId,
        workingDirectory,
        agentProvider: plan.selectedAgent,
        worktreeId,
        name: `Task: ${task.description.substring(0, 50)}`,
      });
      sessionId = sessionResult.sessionId;
    } catch (error) {
      // Clean up worktree if session spawn fails
      if (worktreeId) {
        try {
          await this.worktreeGateway.removeWorktree(worktreeId);
        } catch {
          // Ignore cleanup errors
        }
      }
      throw new DelegationDomainError(
        taskId,
        "new",
        `Failed to spawn session: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Create delegation entity
    let delegation = Delegation.create({
      taskId,
      sessionId,
      worktreeId,
      agentProvider: plan.selectedAgent,
    });

    // Generate and inject context
    try {
      const contextToInject = await this.llmGateway.generateContextInjection(task, plan, {
        projectKnowledge: projectKnowledge ?? undefined,
        relevantConventions: projectKnowledge?.conventions.map(c => c.description),
        relevantPatterns: projectKnowledge?.patterns.map(p => p.description),
      });

      delegation = delegation.startContextInjection(contextToInject);
      await this.sessionGateway.injectContext(sessionId, contextToInject);
      delegation = delegation.startRunning();
    } catch (error) {
      // Mark delegation as failed
      delegation = delegation.fail({
        code: "CONTEXT_INJECTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
        exitCode: null,
        recoverable: true,
      });

      await this.delegationRepository.save(delegation);

      throw new ContextInjectionError(
        sessionId,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Transition task to executing
    const executingTask = task.startExecution(plan.selectedAgent, delegation.contextInjected ?? "");
    const taskWithDelegation = executingTask.attachDelegation(delegation.id);

    // Persist entities
    await this.delegationRepository.save(delegation);
    await this.taskRepository.save(taskWithDelegation);

    // Log start of execution
    delegation = delegation.addLog({
      level: "info",
      message: `Started execution with ${plan.selectedAgent}`,
      metadata: {
        isolationStrategy: plan.isolationStrategy,
        worktreeId,
        estimatedTokens: plan.estimatedTokens,
      },
    });
    await this.delegationRepository.save(delegation);

    return {
      task: taskWithDelegation,
      delegation,
      sessionId,
      worktreeId,
    };
  }
}
