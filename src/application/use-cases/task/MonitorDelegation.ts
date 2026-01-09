/**
 * MonitorDelegation Use Case
 *
 * Monitors an active delegation to track task progress.
 * Uses scrollback analysis to understand what the agent is doing.
 *
 * Flow:
 * 1. Retrieve delegation and task
 * 2. Check if session is still active
 * 3. Capture scrollback buffer
 * 4. Analyze progress using LLM
 * 5. Update delegation with logs
 * 6. Detect completion or failure
 */

import { Task } from "@/domain/entities/Task";
import { Delegation } from "@/domain/entities/Delegation";
import { EntityNotFoundError } from "@/domain/errors/DomainError";
import type {
  ITaskRepository,
  IDelegationRepository,
  IOrchestratorLLMGateway,
  ISessionGateway,
  ExecutionPlan,
} from "@/application/ports/task-ports";

export interface MonitorDelegationInput {
  delegationId: string;
  executionPlan?: ExecutionPlan;
  previousAnalysis?: string;
}

export interface MonitorDelegationOutput {
  delegation: Delegation;
  task: Task;
  status: "working" | "blocked" | "completed" | "failed" | "idle" | "session_ended";
  progress: number;
  currentActivity: string;
  blockedReason?: string;
  suggestedIntervention?: string;
  sessionEnded: boolean;
}

export class MonitorDelegation {
  constructor(
    private readonly taskRepository: ITaskRepository,
    private readonly delegationRepository: IDelegationRepository,
    private readonly llmGateway: IOrchestratorLLMGateway,
    private readonly sessionGateway: ISessionGateway
  ) {}

  async execute(input: MonitorDelegationInput): Promise<MonitorDelegationOutput> {
    const { delegationId, executionPlan, previousAnalysis } = input;

    // Retrieve delegation
    let delegation = await this.delegationRepository.findById(delegationId);
    if (!delegation) {
      throw new EntityNotFoundError("Delegation", delegationId);
    }

    // Check if delegation is already terminal
    if (delegation.isTerminal()) {
      const task = await this.taskRepository.findById(delegation.taskId);
      if (!task) {
        throw new EntityNotFoundError("Task", delegation.taskId);
      }

      return {
        delegation,
        task,
        status: delegation.isSuccessful() ? "completed" : "failed",
        progress: 100,
        currentActivity: delegation.isSuccessful() ? "Task completed" : "Task failed",
        sessionEnded: true,
      };
    }

    // Retrieve task
    let task = await this.taskRepository.findById(delegation.taskId);
    if (!task) {
      throw new EntityNotFoundError("Task", delegation.taskId);
    }

    // Check if session is still active
    const sessionActive = await this.sessionGateway.isSessionActive(delegation.sessionId);

    if (!sessionActive) {
      // Session ended - need to determine if it was successful
      delegation = delegation.addLog({
        level: "info",
        message: "Session ended",
      });

      // Try to get transcript path
      const transcriptPath = await this.sessionGateway.getTranscriptPath(delegation.sessionId);
      if (transcriptPath) {
        delegation = delegation.setTranscriptPath(transcriptPath);
      }

      // For now, mark as completed (actual success determination happens in CompleteTask)
      // We'll analyze the transcript there
      await this.delegationRepository.save(delegation);

      return {
        delegation,
        task,
        status: "session_ended",
        progress: 100,
        currentActivity: "Session has ended, awaiting analysis",
        sessionEnded: true,
      };
    }

    // Transition to monitoring if in running state
    if (delegation.status === "running") {
      delegation = delegation.startMonitoring();
      task = task.startMonitoring();
    }

    // Get scrollback buffer for analysis
    const scrollbackContent = await this.sessionGateway.getScrollback(delegation.sessionId, 200);

    // Analyze progress using LLM
    const analysis = await this.llmGateway.analyzeSessionProgress(task, scrollbackContent, {
      previousAnalysis,
      executionPlan,
    });

    // Log the analysis
    delegation = delegation.addLog({
      level: "info",
      message: `Progress: ${analysis.progress}% - ${analysis.currentActivity}`,
      metadata: {
        status: analysis.status,
        progress: analysis.progress,
      },
    });

    // Handle blocked state
    if (analysis.status === "blocked" && analysis.blockedReason) {
      delegation = delegation.addLog({
        level: "warn",
        message: `Agent appears blocked: ${analysis.blockedReason}`,
        metadata: {
          suggestedIntervention: analysis.suggestedIntervention,
        },
      });
    }

    // Persist updates
    await this.delegationRepository.save(delegation);
    await this.taskRepository.save(task);

    return {
      delegation,
      task,
      status: analysis.status,
      progress: analysis.progress,
      currentActivity: analysis.currentActivity,
      blockedReason: analysis.blockedReason,
      suggestedIntervention: analysis.suggestedIntervention,
      sessionEnded: false,
    };
  }
}
