/**
 * ParseTaskFromNaturalLanguage Use Case
 *
 * Parses natural language input into a structured Task entity.
 * Uses the Orchestrator LLM to understand intent and classify task type.
 *
 * Flow:
 * 1. Receive natural language input from user or beads
 * 2. Gather context (project knowledge, recent tasks)
 * 3. Call LLM gateway to parse and classify
 * 4. Create and persist Task entity
 */

import { Task } from "@/domain/entities/Task";
import { TaskType } from "@/domain/value-objects/TaskType";
import { TaskParsingError } from "@/domain/errors/TaskErrors";
import type {
  ITaskRepository,
  IProjectKnowledgeRepository,
  IOrchestratorLLMGateway,
  ParsedTask,
} from "@/application/ports/task-ports";

export interface ParseTaskInput {
  orchestratorId: string;
  userId: string;
  folderId?: string;
  input: string;
  beadsIssueId?: string;
}

export interface ParseTaskOutput {
  task: Task;
  parsedInfo: ParsedTask;
}

export class ParseTaskFromNaturalLanguage {
  constructor(
    private readonly taskRepository: ITaskRepository,
    private readonly projectKnowledgeRepository: IProjectKnowledgeRepository,
    private readonly llmGateway: IOrchestratorLLMGateway
  ) {}

  async execute(input: ParseTaskInput): Promise<ParseTaskOutput> {
    // Validate input
    if (!input.input || input.input.trim().length === 0) {
      throw new TaskParsingError(input.input, "Input cannot be empty");
    }

    // Gather context for LLM
    const projectKnowledge = input.folderId
      ? await this.projectKnowledgeRepository.findByFolderId(input.folderId)
      : null;

    // Get recent tasks for context (last 5)
    const recentTasks = await this.taskRepository.findByOrchestratorId(input.orchestratorId);
    const sortedRecentTasks = recentTasks
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5);

    // Parse using LLM
    const parsedInfo = await this.llmGateway.parseTaskFromNaturalLanguage(input.input, {
      projectKnowledge: projectKnowledge ?? undefined,
      recentTasks: sortedRecentTasks,
      beadsContext: input.beadsIssueId ? `Linked to beads issue: ${input.beadsIssueId}` : undefined,
    });

    // Validate parsed result
    if (!parsedInfo.description || parsedInfo.confidence < 0.3) {
      throw new TaskParsingError(
        input.input,
        `Low confidence parse (${parsedInfo.confidence}): ${parsedInfo.reasoning}`
      );
    }

    // Create Task entity
    const task = Task.create({
      orchestratorId: input.orchestratorId,
      userId: input.userId,
      description: parsedInfo.description,
      type: parsedInfo.type,
      confidence: parsedInfo.confidence,
      folderId: input.folderId ?? null,
    });

    // Link to beads issue if provided
    let finalTask = task;
    if (input.beadsIssueId || parsedInfo.beadsIssueId) {
      finalTask = task.linkToBeadsIssue(input.beadsIssueId ?? parsedInfo.beadsIssueId!);
    }

    // Set estimated duration if available
    if (parsedInfo.estimatedDuration) {
      finalTask = finalTask.setEstimatedDuration(parsedInfo.estimatedDuration);
    }

    // Persist task
    await this.taskRepository.save(finalTask);

    return {
      task: finalTask,
      parsedInfo,
    };
  }
}
