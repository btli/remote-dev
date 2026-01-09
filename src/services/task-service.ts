/**
 * TaskService - Service layer for task management.
 *
 * This service wraps the task use cases and provides a simpler API
 * for the API layer to interact with the task system.
 *
 * Responsibilities:
 * - Parse natural language into tasks
 * - Plan task execution
 * - Execute tasks with agent delegation
 * - Monitor task progress
 * - Cancel tasks
 */

import { Task, type TaskResult, type TaskError } from "@/domain/entities/Task";
import { TaskType } from "@/domain/value-objects/TaskType";
import { TaskParsingError } from "@/domain/errors/TaskErrors";
import {
  taskRepository,
  delegationRepository,
  projectKnowledgeRepository,
  orchestratorRepository,
  orchestratorLLMGateway,
} from "@/infrastructure/container";
import { ParseTaskFromNaturalLanguage } from "@/application/use-cases/task/ParseTaskFromNaturalLanguage";
import { PlanTaskExecution } from "@/application/use-cases/task/PlanTaskExecution";
import type { ExecutionPlan, ParsedTask } from "@/application/ports/task-ports";
import type { AgentProviderType } from "@/types/session";

// ─────────────────────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────────────────────

export class TaskServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "TaskServiceError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Use Case Instances (lazy initialized)
// ─────────────────────────────────────────────────────────────────────────────

let parseTaskUseCase: ParseTaskFromNaturalLanguage | null = null;
let planTaskUseCase: PlanTaskExecution | null = null;

function getParseTaskUseCase(): ParseTaskFromNaturalLanguage {
  if (!parseTaskUseCase) {
    parseTaskUseCase = new ParseTaskFromNaturalLanguage(
      taskRepository,
      projectKnowledgeRepository,
      orchestratorLLMGateway
    );
  }
  return parseTaskUseCase;
}

function getPlanTaskUseCase(): PlanTaskExecution {
  if (!planTaskUseCase) {
    planTaskUseCase = new PlanTaskExecution(
      taskRepository,
      projectKnowledgeRepository,
      orchestratorLLMGateway
    );
  }
  return planTaskUseCase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit a new task from natural language input.
 */
export async function submitTask(
  orchestratorId: string,
  userId: string,
  input: string,
  options?: {
    folderId?: string;
    beadsIssueId?: string;
  }
): Promise<{ task: Task; parsedInfo: ParsedTask }> {
  // Verify orchestrator exists and belongs to user
  const orchestrator = await orchestratorRepository.findById(orchestratorId);
  if (!orchestrator) {
    throw new TaskServiceError("Orchestrator not found", "ORCHESTRATOR_NOT_FOUND");
  }
  if (orchestrator.userId !== userId) {
    throw new TaskServiceError("Orchestrator not found", "ORCHESTRATOR_NOT_FOUND");
  }

  try {
    const result = await getParseTaskUseCase().execute({
      orchestratorId,
      userId,
      input,
      folderId: options?.folderId,
      beadsIssueId: options?.beadsIssueId,
    });

    return result;
  } catch (error) {
    if (error instanceof TaskParsingError) {
      throw new TaskServiceError(error.message, "TASK_PARSING_FAILED");
    }
    throw error;
  }
}

/**
 * Create a task directly (without natural language parsing).
 */
export async function createTask(
  orchestratorId: string,
  userId: string,
  props: {
    description: string;
    type: string;
    folderId?: string;
    confidence?: number;
    estimatedDuration?: number;
    beadsIssueId?: string;
  }
): Promise<Task> {
  // Verify orchestrator exists and belongs to user
  const orchestrator = await orchestratorRepository.findById(orchestratorId);
  if (!orchestrator) {
    throw new TaskServiceError("Orchestrator not found", "ORCHESTRATOR_NOT_FOUND");
  }
  if (orchestrator.userId !== userId) {
    throw new TaskServiceError("Orchestrator not found", "ORCHESTRATOR_NOT_FOUND");
  }

  // Create task
  const task = Task.create({
    orchestratorId,
    userId,
    description: props.description,
    type: TaskType.fromString(props.type),
    folderId: props.folderId ?? null,
    confidence: props.confidence,
    estimatedDuration: props.estimatedDuration ?? null,
    beadsIssueId: props.beadsIssueId ?? null,
  });

  await taskRepository.save(task);
  return task;
}

/**
 * List tasks for an orchestrator.
 */
export async function listTasks(
  orchestratorId: string,
  userId: string,
  options?: {
    status?: string[];
    limit?: number;
    offset?: number;
  }
): Promise<{ tasks: Task[]; total: number }> {
  // Verify orchestrator belongs to user
  const orchestrator = await orchestratorRepository.findById(orchestratorId);
  if (!orchestrator) {
    throw new TaskServiceError("Orchestrator not found", "ORCHESTRATOR_NOT_FOUND");
  }
  if (orchestrator.userId !== userId) {
    throw new TaskServiceError("Orchestrator not found", "ORCHESTRATOR_NOT_FOUND");
  }

  let tasks: Task[];
  if (options?.status && options.status.length > 0) {
    tasks = await taskRepository.findByStatus(orchestratorId, options.status);
  } else {
    tasks = await taskRepository.findByOrchestratorId(orchestratorId);
  }

  const total = tasks.length;

  // Apply pagination
  if (options?.offset !== undefined || options?.limit !== undefined) {
    const start = options.offset ?? 0;
    const end = options.limit ? start + options.limit : undefined;
    tasks = tasks.slice(start, end);
  }

  return { tasks, total };
}

/**
 * Get a task by ID.
 */
export async function getTask(
  orchestratorId: string,
  taskId: string,
  userId: string
): Promise<Task | null> {
  // Verify orchestrator belongs to user
  const orchestrator = await orchestratorRepository.findById(orchestratorId);
  if (!orchestrator) {
    throw new TaskServiceError("Orchestrator not found", "ORCHESTRATOR_NOT_FOUND");
  }
  if (orchestrator.userId !== userId) {
    throw new TaskServiceError("Orchestrator not found", "ORCHESTRATOR_NOT_FOUND");
  }

  const task = await taskRepository.findById(taskId);
  if (!task) {
    return null;
  }

  // Verify task belongs to orchestrator
  if (task.orchestratorId !== orchestratorId) {
    return null;
  }

  return task;
}

/**
 * Plan task execution (transition from queued to planning).
 */
export async function planTask(
  orchestratorId: string,
  taskId: string,
  userId: string,
  options: {
    folderPath: string;
    availableAgents?: AgentProviderType[];
    gitStatus?: string;
  }
): Promise<{ task: Task; plan: ExecutionPlan }> {
  // Verify access
  const task = await getTask(orchestratorId, taskId, userId);
  if (!task) {
    throw new TaskServiceError("Task not found", "TASK_NOT_FOUND");
  }

  const result = await getPlanTaskUseCase().execute({
    taskId,
    folderPath: options.folderPath,
    availableAgents: options.availableAgents,
    gitStatus: options.gitStatus,
  });

  return result;
}

/**
 * Confirm and execute a planned task.
 * Note: Full execution requires session gateway which may not be available
 * in all contexts. This function handles the state transition.
 */
export async function confirmExecution(
  orchestratorId: string,
  taskId: string,
  userId: string,
  plan: ExecutionPlan
): Promise<Task> {
  // Verify access
  const task = await getTask(orchestratorId, taskId, userId);
  if (!task) {
    throw new TaskServiceError("Task not found", "TASK_NOT_FOUND");
  }

  // Task must be in planning state
  if (!task.isPlanning()) {
    throw new TaskServiceError(
      `Task must be in planning state, current: ${task.status.toString()}`,
      "INVALID_TASK_STATE"
    );
  }

  // Transition to executing
  const executingTask = task.startExecution(plan.selectedAgent, plan.contextToInject);
  await taskRepository.save(executingTask);

  return executingTask;
}

/**
 * Cancel a task.
 */
export async function cancelTask(
  orchestratorId: string,
  taskId: string,
  userId: string
): Promise<Task> {
  // Verify access
  const task = await getTask(orchestratorId, taskId, userId);
  if (!task) {
    throw new TaskServiceError("Task not found", "TASK_NOT_FOUND");
  }

  // Check if cancellable
  if (!task.canCancel()) {
    throw new TaskServiceError(
      `Task in ${task.status.toString()} state cannot be cancelled`,
      "TASK_NOT_CANCELLABLE"
    );
  }

  // Cancel
  const cancelledTask = task.cancel();
  await taskRepository.save(cancelledTask);

  // If there's an active delegation, we should mark it as failed (cancelled)
  if (task.delegationId) {
    const delegation = await delegationRepository.findById(task.delegationId);
    if (delegation && !delegation.isTerminal()) {
      const cancelledDelegation = delegation.fail({
        code: "TASK_CANCELLED",
        message: "Task was cancelled by user",
        exitCode: null,
        recoverable: false,
      });
      await delegationRepository.save(cancelledDelegation);
    }
  }

  return cancelledTask;
}

/**
 * Update task description.
 */
export async function updateTaskDescription(
  orchestratorId: string,
  taskId: string,
  userId: string,
  description: string
): Promise<Task> {
  // Verify access
  const task = await getTask(orchestratorId, taskId, userId);
  if (!task) {
    throw new TaskServiceError("Task not found", "TASK_NOT_FOUND");
  }

  // Can only update queued tasks
  if (!task.isQueued()) {
    throw new TaskServiceError(
      "Can only update description of queued tasks",
      "INVALID_TASK_STATE"
    );
  }

  const updatedTask = task.updateDescription(description);
  await taskRepository.save(updatedTask);

  return updatedTask;
}

/**
 * Complete a task with result.
 */
export async function completeTask(
  taskId: string,
  userId: string,
  result: TaskResult
): Promise<Task> {
  const task = await taskRepository.findById(taskId);
  if (!task) {
    throw new TaskServiceError("Task not found", "TASK_NOT_FOUND");
  }
  if (!task.belongsTo(userId)) {
    throw new TaskServiceError("Task not found", "TASK_NOT_FOUND");
  }

  const completedTask = task.complete(result);
  await taskRepository.save(completedTask);

  return completedTask;
}

/**
 * Fail a task with error.
 */
export async function failTask(
  taskId: string,
  userId: string,
  error: TaskError
): Promise<Task> {
  const task = await taskRepository.findById(taskId);
  if (!task) {
    throw new TaskServiceError("Task not found", "TASK_NOT_FOUND");
  }
  if (!task.belongsTo(userId)) {
    throw new TaskServiceError("Task not found", "TASK_NOT_FOUND");
  }

  const failedTask = task.fail(error);
  await taskRepository.save(failedTask);

  return failedTask;
}

/**
 * Get task statistics for an orchestrator.
 */
export async function getTaskStats(
  orchestratorId: string,
  userId: string
): Promise<{
  total: number;
  byStatus: Record<string, number>;
  activeCount: number;
  completedCount: number;
}> {
  // Verify access
  const orchestrator = await orchestratorRepository.findById(orchestratorId);
  if (!orchestrator) {
    throw new TaskServiceError("Orchestrator not found", "ORCHESTRATOR_NOT_FOUND");
  }
  if (orchestrator.userId !== userId) {
    throw new TaskServiceError("Orchestrator not found", "ORCHESTRATOR_NOT_FOUND");
  }

  // Get all tasks
  const tasks = await taskRepository.findByOrchestratorId(orchestratorId);

  const byStatus: Record<string, number> = {
    queued: 0,
    planning: 0,
    executing: 0,
    monitoring: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };

  for (const task of tasks) {
    const status = task.status.toString();
    if (status in byStatus) {
      byStatus[status]++;
    }
  }

  return {
    total: tasks.length,
    byStatus,
    activeCount: tasks.filter((t) => t.isActive()).length,
    completedCount: byStatus.completed,
  };
}
