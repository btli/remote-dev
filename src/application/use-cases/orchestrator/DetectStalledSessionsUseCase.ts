/**
 * DetectStalledSessionsUseCase - Detect stalled sessions within orchestrator scope.
 *
 * This use case implements the core stall detection algorithm:
 * 1. Get all sessions in the orchestrator's scope
 * 2. For each session, capture current scrollback buffer
 * 3. Compare with previous snapshot (passed in by caller)
 * 4. If unchanged for threshold period, create a stall insight
 * 5. Return all generated insights
 *
 * The caller (service layer or scheduled job) is responsible for:
 * - Storing previous snapshots (in-memory cache or database)
 * - Calling this use case at regular intervals
 * - Passing the previous snapshots for comparison
 */

import { OrchestratorInsight } from "@/domain/entities/OrchestratorInsight";
import { OrchestratorAuditLog } from "@/domain/entities/OrchestratorAuditLog";
import type { IOrchestratorRepository } from "@/application/ports/IOrchestratorRepository";
import type { IInsightRepository } from "@/application/ports/IInsightRepository";
import type { IAuditLogRepository } from "@/application/ports/IAuditLogRepository";
import type { IScrollbackMonitor } from "@/application/ports/IScrollbackMonitor";
import { TransactionManager } from "@/infrastructure/persistence/TransactionManager";
import type { ScrollbackSnapshot, StallDetectionResult, SuggestedAction } from "@/types/orchestrator";
import { OrchestratorNotFoundError, OrchestratorPausedError } from "@/domain/errors/OrchestratorErrors";

export interface SessionToMonitor {
  sessionId: string;
  tmuxSessionName: string;
  name: string;
  folderId: string | null;
  previousSnapshot: ScrollbackSnapshot | null;
}

export interface DetectStalledSessionsInput {
  orchestratorId: string;
  sessionsToMonitor: SessionToMonitor[]; // Caller provides list of sessions in scope
}

export interface DetectStalledSessionsOutput {
  insights: OrchestratorInsight[];
  auditLogs: OrchestratorAuditLog[];
  stallDetectionResults: Map<string, StallDetectionResult>; // sessionId -> result
  errors: Array<{
    sessionId: string;
    sessionName: string;
    error: string;
    timestamp: Date;
  }>; // Errors encountered during detection
}

export class DetectStalledSessionsUseCase {
  constructor(
    private readonly orchestratorRepository: IOrchestratorRepository,
    private readonly insightRepository: IInsightRepository,
    private readonly auditLogRepository: IAuditLogRepository,
    private readonly scrollbackMonitor: IScrollbackMonitor,
    private readonly transactionManager: TransactionManager
  ) {}

  async execute(input: DetectStalledSessionsInput): Promise<DetectStalledSessionsOutput> {
    // Step 1: Get the orchestrator and validate
    const orchestrator = await this.orchestratorRepository.findById(input.orchestratorId);
    if (!orchestrator) {
      throw new OrchestratorNotFoundError(input.orchestratorId);
    }

    if (orchestrator.isPaused()) {
      throw new OrchestratorPausedError(input.orchestratorId);
    }

    const insights: OrchestratorInsight[] = [];
    const auditLogs: OrchestratorAuditLog[] = [];
    const stallDetectionResults = new Map<string, StallDetectionResult>();
    const errors: Array<{
      sessionId: string;
      sessionName: string;
      error: string;
      timestamp: Date;
    }> = [];

    // Step 2: Detect stalls for each session
    for (const session of input.sessionsToMonitor) {
      try {
        // Detect stall using scrollback monitor
        const stallResult = await this.scrollbackMonitor.detectStall(
          session.tmuxSessionName,
          session.previousSnapshot,
          orchestrator.stallThreshold
        );

        stallDetectionResults.set(session.sessionId, stallResult);

        // Step 3: Create insight if session is stalled
        if (stallResult.isStalled) {
          const suggestedActions = this.generateSuggestedActions(stallResult, session);
          const insight = OrchestratorInsight.create({
            orchestratorId: input.orchestratorId,
            sessionId: session.sessionId,
            type: "stall_detected",
            severity: this.calculateSeverity(stallResult.unchangedDuration),
            message: `Session "${session.name}" has been inactive for ${Math.floor(stallResult.unchangedDuration / 60)} minutes`,
            context: {
              tmuxSessionName: session.tmuxSessionName,
              unchangedDuration: stallResult.unchangedDuration,
              stallThreshold: orchestrator.stallThreshold,
              lastActivity: stallResult.lastActivity,
              confidence: stallResult.confidence,
              reason: stallResult.reason ?? null,
              previousSnapshot: session.previousSnapshot
                ? {
                    timestamp: session.previousSnapshot.timestamp.toISOString(),
                    hash: session.previousSnapshot.hash,
                    lineCount: session.previousSnapshot.lineCount,
                  }
                : null,
            },
            suggestedActions,
          });

          // Create audit log for insight generation
          const auditLog = OrchestratorAuditLog.forInsightGenerated(
            input.orchestratorId,
            insight.id,
            session.sessionId,
            "stall_detected",
            insight.severity
          );

          // Add to arrays for batch persistence
          insights.push(insight);
          auditLogs.push(auditLog);
        }
      } catch (error) {
        // Collect error details for caller to handle
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorDetail = {
          sessionId: session.sessionId,
          sessionName: session.name,
          error: errorMessage,
          timestamp: new Date(),
        };

        errors.push(errorDetail);

        // Log error but continue monitoring other sessions
        console.error(
          `[DetectStalledSessions] Failed to monitor session ${session.sessionId} (${session.name}):`,
          errorMessage
        );
      }
    }

    // Log summary if there were errors
    if (errors.length > 0) {
      console.warn(
        `[DetectStalledSessions] Encountered ${errors.length} errors during stall detection for orchestrator ${input.orchestratorId}`
      );
    }

    // Step 3: Persist all insights and audit logs atomically within a transaction
    // This ensures that either all stall detections are recorded or none are
    if (insights.length > 0) {
      await this.transactionManager.execute(async (tx) => {
        for (const insight of insights) {
          await this.insightRepository.save(insight, tx);
        }
        for (const auditLog of auditLogs) {
          await this.auditLogRepository.save(auditLog, tx);
        }
      });
    }

    return {
      insights,
      auditLogs,
      stallDetectionResults,
      errors,
    };
  }

  /**
   * Calculate severity based on how long the session has been stalled.
   */
  private calculateSeverity(
    stalledForSeconds: number
  ): "info" | "warning" | "error" | "critical" {
    const minutes = stalledForSeconds / 60;

    if (minutes >= 60) return "critical"; // 1+ hour
    if (minutes >= 30) return "error"; // 30+ minutes
    if (minutes >= 15) return "warning"; // 15+ minutes
    return "info"; // 5-15 minutes
  }

  /**
   * Generate suggested actions based on the stall detection result.
   */
  private generateSuggestedActions(
    stallResult: StallDetectionResult,
    session: SessionToMonitor
  ): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    // Basic troubleshooting steps
    actions.push({
      label: "Check session output",
      description: `Review "${session.name}" terminal to see if a command is waiting for input or has completed`,
    });

    actions.push({
      label: "Send Ctrl-C",
      description: "Interrupt any running process",
      command: "C-c",
      dangerous: false,
    });

    // If reason is provided, add specific guidance
    if (stallResult.reason) {
      actions.push({
        label: "Review stall reason",
        description: stallResult.reason,
      });
    }

    // If confidence is low, suggest manual review
    if (stallResult.confidence < 0.7) {
      actions.push({
        label: "Manual review recommended",
        description: "Stall detection confidence is low - please verify manually",
      });
    }

    return actions;
  }
}
