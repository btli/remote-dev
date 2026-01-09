/**
 * SessionEndAnalysisService - Analyzes session terminations for learning.
 *
 * Handles different session end scenarios:
 * - task_complete: Agent finished work successfully
 * - session_end: Session ended normally (exit, logout, timeout)
 * - user_closed: User manually closed/killed session
 * - error: Agent crashed or errored
 * - stall_detected: Orchestrator detected stall
 *
 * Each scenario generates learnings that feed back into improvements.
 */

import type { ParsedTranscript, TranscriptError } from "@/lib/transcript-parsers/types";
import { TranscriptIngestionService } from "./transcript-ingestion-service";
import { PatternAnalysisService } from "./pattern-analysis-service";
import { ImprovementGeneratorService } from "./improvement-generator-service";
import type { AgentProvider } from "@/types/agent";

export type SessionEndType =
  | "task_complete"
  | "session_end"
  | "user_closed"
  | "error"
  | "stall_detected";

export type SessionOutcome =
  | "success"
  | "partial"
  | "completed"
  | "abandoned"
  | "interrupted"
  | "failed"
  | "stalled";

export interface SessionEndContext {
  sessionId: string;
  projectPath: string;
  agentProvider: AgentProvider;
  endType: SessionEndType;
  reason?: string;
  errorContext?: {
    message: string;
    stack?: string;
    tool?: string;
  };
  stallContext?: {
    duration: number;
    lastActivity: string;
    injectedCommand?: string;
  };
}

export interface SessionEndAnalysis {
  sessionId: string;
  endType: SessionEndType;
  outcome: SessionOutcome;
  transcript: ParsedTranscript | null;

  // What happened
  summary: string;
  taskProgress: number; // 0-1 estimated progress

  // Learnings
  learnings: SessionLearning[];
  improvements: SessionImprovement[];

  // Issues detected
  issues: SessionIssue[];

  // Timing
  analyzedAt: Date;
  analysisDuration: number;
}

export interface SessionLearning {
  type: "pattern" | "tool" | "command" | "error_handling";
  description: string;
  evidence: string;
  confidence: number;
}

export interface SessionImprovement {
  type: "skill" | "config" | "gotcha" | "prevention";
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  action?: string;
}

export interface SessionIssue {
  type: "loop" | "wrong_direction" | "stuck" | "error" | "timeout";
  description: string;
  severity: "critical" | "warning" | "info";
  timestamp?: Date;
}

/**
 * Service for analyzing session terminations.
 */
export class SessionEndAnalysisService {
  private readonly ingestion: TranscriptIngestionService;
  private readonly patternAnalysis: PatternAnalysisService;
  private readonly improvementGenerator: ImprovementGeneratorService;

  constructor() {
    this.ingestion = new TranscriptIngestionService();
    this.patternAnalysis = new PatternAnalysisService();
    this.improvementGenerator = new ImprovementGeneratorService();
  }

  /**
   * Analyze a session end event.
   */
  async analyze(context: SessionEndContext): Promise<SessionEndAnalysis> {
    const startTime = Date.now();

    // Step 1: Get transcript
    const transcript = await this.findTranscript(context);

    // Step 2: Determine outcome based on end type
    const outcome = this.determineOutcome(context, transcript);

    // Step 3: Analyze based on type
    let analysis: Omit<SessionEndAnalysis, "analyzedAt" | "analysisDuration">;

    switch (context.endType) {
      case "task_complete":
        analysis = await this.analyzeTaskComplete(context, transcript);
        break;
      case "session_end":
        analysis = await this.analyzeSessionEnd(context, transcript);
        break;
      case "user_closed":
        analysis = await this.analyzeUserClosed(context, transcript);
        break;
      case "error":
        analysis = await this.analyzeError(context, transcript);
        break;
      case "stall_detected":
        analysis = await this.analyzeStall(context, transcript);
        break;
      default:
        analysis = this.createEmptyAnalysis(context, transcript, outcome);
    }

    return {
      ...analysis,
      analyzedAt: new Date(),
      analysisDuration: Date.now() - startTime,
    };
  }

  /**
   * Analyze task_complete scenario.
   */
  private async analyzeTaskComplete(
    context: SessionEndContext,
    transcript: ParsedTranscript | null
  ): Promise<Omit<SessionEndAnalysis, "analyzedAt" | "analysisDuration">> {
    const learnings: SessionLearning[] = [];
    const improvements: SessionImprovement[] = [];
    const issues: SessionIssue[] = [];

    if (transcript) {
      // Extract success patterns
      const analysis = this.patternAnalysis.analyze([transcript]);

      // Learn from reliable tools
      for (const tool of analysis.successPatterns.filter((t) => t.successRate > 0.9)) {
        learnings.push({
          type: "tool",
          description: `${tool.toolName} is highly reliable`,
          evidence: `${(tool.successRate * 100).toFixed(0)}% success over ${tool.usageCount} uses`,
          confidence: tool.reliabilityScore,
        });
      }

      // Learn from command patterns
      for (const cmd of analysis.commandPatterns.filter((c) => c.successRate > 0.9)) {
        learnings.push({
          type: "command",
          description: `Command pattern: ${cmd.command}`,
          evidence: `Used in ${(cmd.frequency * 100).toFixed(0)}% of sessions`,
          confidence: cmd.successRate,
        });
      }

      // Suggest optimizations
      const impResult = this.improvementGenerator.generate(analysis);
      for (const skill of impResult.skillSuggestions.slice(0, 3)) {
        improvements.push({
          type: "skill",
          title: skill.name,
          description: skill.description,
          priority: "medium",
        });
      }
    }

    return {
      sessionId: context.sessionId,
      endType: "task_complete",
      outcome: "success",
      transcript,
      summary: "Task completed successfully",
      taskProgress: 1.0,
      learnings,
      improvements,
      issues,
    };
  }

  /**
   * Analyze session_end scenario.
   */
  private async analyzeSessionEnd(
    context: SessionEndContext,
    transcript: ParsedTranscript | null
  ): Promise<Omit<SessionEndAnalysis, "analyzedAt" | "analysisDuration">> {
    const learnings: SessionLearning[] = [];
    const improvements: SessionImprovement[] = [];
    const issues: SessionIssue[] = [];

    // Determine if completed or abandoned
    const outcome: SessionOutcome = this.inferSessionCompletion(transcript, context.reason);
    const taskProgress = this.estimateTaskProgress(transcript);

    if (transcript) {
      // Check for issues
      if (transcript.retries > 5) {
        issues.push({
          type: "loop",
          description: `High retry count: ${transcript.retries} retries detected`,
          severity: "warning",
        });
      }

      if (transcript.contextSwitches > 5) {
        issues.push({
          type: "wrong_direction",
          description: `Frequent context switches: ${transcript.contextSwitches} detected`,
          severity: "info",
        });
      }

      // Learn from errors that were resolved
      const resolvedErrors = transcript.errorsEncountered.filter((e) => e.resolved);
      for (const error of resolvedErrors.slice(0, 3)) {
        learnings.push({
          type: "error_handling",
          description: `Resolved ${error.type} error: ${error.message.substring(0, 50)}`,
          evidence: `Source: ${error.source}`,
          confidence: 0.8,
        });
      }
    }

    return {
      sessionId: context.sessionId,
      endType: "session_end",
      outcome,
      transcript,
      summary: outcome === "completed"
        ? `Session ended normally (${context.reason ?? "user exit"})`
        : `Session abandoned at ${(taskProgress * 100).toFixed(0)}% progress`,
      taskProgress,
      learnings,
      improvements,
      issues,
    };
  }

  /**
   * Analyze user_closed scenario.
   */
  private async analyzeUserClosed(
    context: SessionEndContext,
    transcript: ParsedTranscript | null
  ): Promise<Omit<SessionEndAnalysis, "analyzedAt" | "analysisDuration">> {
    const learnings: SessionLearning[] = [];
    const improvements: SessionImprovement[] = [];
    const issues: SessionIssue[] = [];

    // Infer why user closed
    const possibleReasons = this.inferCloseReason(transcript);

    for (const reason of possibleReasons) {
      issues.push({
        type: reason.type,
        description: reason.description,
        severity: reason.severity,
      });

      // Generate improvement suggestions
      if (reason.type === "loop") {
        improvements.push({
          type: "gotcha",
          title: "Loop detection",
          description: "Agent was repeating actions - need better loop detection",
          priority: "high",
          action: "Add early termination after 3 repeated failures",
        });
      } else if (reason.type === "wrong_direction") {
        improvements.push({
          type: "prevention",
          title: "Direction validation",
          description: "Agent went in wrong direction - need better validation",
          priority: "medium",
          action: "Check in with user before major changes",
        });
      }
    }

    const taskProgress = this.estimateTaskProgress(transcript);

    return {
      sessionId: context.sessionId,
      endType: "user_closed",
      outcome: "interrupted",
      transcript,
      summary: `Session interrupted by user at ${(taskProgress * 100).toFixed(0)}% progress`,
      taskProgress,
      learnings,
      improvements,
      issues,
    };
  }

  /**
   * Analyze error scenario.
   */
  private async analyzeError(
    context: SessionEndContext,
    transcript: ParsedTranscript | null
  ): Promise<Omit<SessionEndAnalysis, "analyzedAt" | "analysisDuration">> {
    const learnings: SessionLearning[] = [];
    const improvements: SessionImprovement[] = [];
    const issues: SessionIssue[] = [];

    // Classify the error
    const errorType = this.classifyError(context.errorContext?.message ?? "");

    issues.push({
      type: "error",
      description: context.errorContext?.message ?? "Unknown error",
      severity: "critical",
      timestamp: new Date(),
    });

    // Analyze root cause from transcript
    if (transcript) {
      const recentErrors = transcript.errorsEncountered.slice(-5);
      for (const error of recentErrors) {
        if (!error.resolved) {
          learnings.push({
            type: "error_handling",
            description: `Unresolved ${error.type} error led to crash`,
            evidence: error.message,
            confidence: 0.7,
          });
        }
      }
    }

    // Suggest prevention
    improvements.push({
      type: "prevention",
      title: `Prevent ${errorType} errors`,
      description: `Add error handling for: ${context.errorContext?.message?.substring(0, 50) ?? "unknown"}`,
      priority: "high",
      action: context.errorContext?.tool
        ? `Validate ${context.errorContext.tool} inputs`
        : "Add try-catch around risky operations",
    });

    return {
      sessionId: context.sessionId,
      endType: "error",
      outcome: "failed",
      transcript,
      summary: `Session crashed: ${context.errorContext?.message ?? "Unknown error"}`,
      taskProgress: this.estimateTaskProgress(transcript),
      learnings,
      improvements,
      issues,
    };
  }

  /**
   * Analyze stall_detected scenario.
   */
  private async analyzeStall(
    context: SessionEndContext,
    transcript: ParsedTranscript | null
  ): Promise<Omit<SessionEndAnalysis, "analyzedAt" | "analysisDuration">> {
    const learnings: SessionLearning[] = [];
    const improvements: SessionImprovement[] = [];
    const issues: SessionIssue[] = [];

    issues.push({
      type: "stuck",
      description: `Session stalled for ${context.stallContext?.duration ?? 0}ms`,
      severity: "warning",
    });

    // Analyze what the agent was doing before stall
    if (transcript && transcript.toolCalls.length > 0) {
      const lastTool = transcript.toolCalls[transcript.toolCalls.length - 1];
      learnings.push({
        type: "pattern",
        description: `Agent stalled after ${lastTool.name}`,
        evidence: `Last action: ${lastTool.name} with ${JSON.stringify(lastTool.input).substring(0, 50)}`,
        confidence: 0.6,
      });

      // Check if waiting for user input
      if (transcript.messages.length > 0) {
        const lastMessage = transcript.messages[transcript.messages.length - 1];
        if (lastMessage.role === "assistant" && lastMessage.content.includes("?")) {
          improvements.push({
            type: "gotcha",
            title: "Waiting for input",
            description: "Agent was waiting for user response",
            priority: "low",
          });
        }
      }
    }

    improvements.push({
      type: "prevention",
      title: "Stall prevention",
      description: "Reduce stall occurrences",
      priority: "medium",
      action: context.stallContext?.lastActivity
        ? `Check why ${context.stallContext.lastActivity} caused stall`
        : "Add periodic health checks",
    });

    return {
      sessionId: context.sessionId,
      endType: "stall_detected",
      outcome: "stalled",
      transcript,
      summary: `Session stalled: ${context.stallContext?.lastActivity ?? "unknown activity"}`,
      taskProgress: this.estimateTaskProgress(transcript),
      learnings,
      improvements,
      issues,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private async findTranscript(
    context: SessionEndContext
  ): Promise<ParsedTranscript | null> {
    return this.ingestion.getLatestForSession(
      context.sessionId,
      context.projectPath
    );
  }

  private determineOutcome(
    context: SessionEndContext,
    transcript: ParsedTranscript | null
  ): SessionOutcome {
    switch (context.endType) {
      case "task_complete":
        return transcript?.errorsEncountered.some((e) => !e.resolved)
          ? "partial"
          : "success";
      case "session_end":
        return this.inferSessionCompletion(transcript, context.reason);
      case "user_closed":
        return "interrupted";
      case "error":
        return "failed";
      case "stall_detected":
        return "stalled";
      default:
        return "abandoned";
    }
  }

  private inferSessionCompletion(
    transcript: ParsedTranscript | null,
    reason?: string
  ): "completed" | "abandoned" {
    if (!transcript) return "abandoned";

    // Check for completion indicators
    const lastMessages = transcript.messages.slice(-3);
    const hasCompletion = lastMessages.some((m) =>
      m.content.toLowerCase().includes("complete") ||
      m.content.toLowerCase().includes("done") ||
      m.content.toLowerCase().includes("finished")
    );

    // Check error rate
    const unresolvedErrors = transcript.errorsEncountered.filter((e) => !e.resolved);
    const hasUnresolvedErrors = unresolvedErrors.length > 2;

    if (reason === "exit" && hasCompletion && !hasUnresolvedErrors) {
      return "completed";
    }

    return "abandoned";
  }

  private estimateTaskProgress(transcript: ParsedTranscript | null): number {
    if (!transcript) return 0;

    // Simple heuristic based on various signals
    let progress = 0;

    // Tool usage indicates work done
    if (transcript.toolCalls.length > 0) {
      progress += Math.min(transcript.toolCalls.length / 20, 0.3);
    }

    // Successful tools indicate progress
    const successfulTools = transcript.toolCalls.filter((t) => t.success).length;
    progress += (successfulTools / Math.max(transcript.toolCalls.length, 1)) * 0.3;

    // Files modified indicates output
    progress += Math.min(transcript.filesModified.length / 10, 0.2);

    // Resolved errors indicate problem-solving
    const resolved = transcript.errorsEncountered.filter((e) => e.resolved).length;
    progress += (resolved / Math.max(transcript.errorsEncountered.length, 1)) * 0.2;

    return Math.min(progress, 1);
  }

  private inferCloseReason(
    transcript: ParsedTranscript | null
  ): Array<{ type: SessionIssue["type"]; description: string; severity: SessionIssue["severity"] }> {
    const reasons: Array<{ type: SessionIssue["type"]; description: string; severity: SessionIssue["severity"] }> = [];

    if (!transcript) {
      reasons.push({
        type: "stuck",
        description: "No transcript available - session may have been closed early",
        severity: "info",
      });
      return reasons;
    }

    // Check for loops
    if (transcript.retries > 5) {
      reasons.push({
        type: "loop",
        description: `Agent was in a retry loop (${transcript.retries} retries)`,
        severity: "warning",
      });
    }

    // Check for direction changes
    if (transcript.contextSwitches > 5) {
      reasons.push({
        type: "wrong_direction",
        description: `Agent changed direction ${transcript.contextSwitches} times`,
        severity: "info",
      });
    }

    // Check for stuck on errors
    const unresolvedCount = transcript.errorsEncountered.filter((e) => !e.resolved).length;
    if (unresolvedCount > 2) {
      reasons.push({
        type: "stuck",
        description: `Agent had ${unresolvedCount} unresolved errors`,
        severity: "warning",
      });
    }

    // Check for timeout-like behavior (long duration, little output)
    if (transcript.duration > 1800 && transcript.toolCalls.length < 5) {
      reasons.push({
        type: "timeout",
        description: "Session ran long with little activity",
        severity: "info",
      });
    }

    if (reasons.length === 0) {
      reasons.push({
        type: "stuck",
        description: "User closed session - reason unclear",
        severity: "info",
      });
    }

    return reasons;
  }

  private classifyError(message: string): string {
    if (message.includes("ENOENT")) return "file_not_found";
    if (message.includes("permission")) return "permission";
    if (message.includes("timeout")) return "timeout";
    if (message.includes("TypeError") || message.includes("TS")) return "type";
    if (message.includes("SyntaxError")) return "syntax";
    if (message.includes("network") || message.includes("fetch")) return "network";
    return "runtime";
  }

  private createEmptyAnalysis(
    context: SessionEndContext,
    transcript: ParsedTranscript | null,
    outcome: SessionOutcome
  ): Omit<SessionEndAnalysis, "analyzedAt" | "analysisDuration"> {
    return {
      sessionId: context.sessionId,
      endType: context.endType,
      outcome,
      transcript,
      summary: "Analysis not available",
      taskProgress: 0,
      learnings: [],
      improvements: [],
      issues: [],
    };
  }
}
