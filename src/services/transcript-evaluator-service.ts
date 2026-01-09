/**
 * TranscriptEvaluatorService - Analyzes completed session transcripts.
 *
 * Part of the Reflexion Loop architecture (adapted for terminal model).
 * Evaluates transcripts OFFLINE after session completion to:
 * - Score task completion, efficiency, and errors
 * - Identify what worked and what failed
 * - Classify session outcome
 *
 * This evaluation feeds into ReflectionGeneratorService for verbal learnings.
 */

import type { TranscriptChunk } from "@/application/ports/task-ports";

export interface TranscriptEvaluation {
  sessionId: string;
  taskId?: string;
  evaluatedAt: Date;

  // Scoring (0-1 scale)
  taskCompletionScore: number;
  efficiencyScore: number;
  errorScore: number;
  overallScore: number;

  // Qualitative analysis
  whatWorked: string[];
  whatFailed: string[];
  inefficiencies: string[];
  errorsEncountered: ErrorRecord[];

  // Classification
  outcome: "success" | "partial" | "failure" | "interrupted";

  // Metrics
  metrics: {
    totalTurns: number;
    totalTokensEstimate: number;
    durationSeconds: number;
    toolCallCount: number;
    errorCount: number;
    retryCount: number;
  };
}

export interface ErrorRecord {
  type: "syntax" | "runtime" | "test" | "lint" | "type" | "other";
  message: string;
  resolved: boolean;
  turnsToResolve?: number;
}

/**
 * Service for evaluating session transcripts.
 */
export class TranscriptEvaluatorService {
  // Common error patterns to detect
  private readonly ERROR_PATTERNS = [
    { pattern: /error\s*(?:ts|TS)\d+:/i, type: "type" as const },
    { pattern: /SyntaxError:/i, type: "syntax" as const },
    { pattern: /TypeError:|ReferenceError:|RangeError:/i, type: "runtime" as const },
    { pattern: /FAIL\s+.*\.test\./i, type: "test" as const },
    { pattern: /error\s+.*eslint/i, type: "lint" as const },
    { pattern: /command not found|No such file/i, type: "other" as const },
  ];

  // Success indicators
  private readonly SUCCESS_INDICATORS = [
    /✓|✔|passed|success|complete|done|finished/i,
    /all tests passed/i,
    /build succeeded/i,
    /no errors/i,
    /commit.*created|pushed/i,
  ];

  // Failure indicators
  private readonly FAILURE_INDICATORS = [
    /failed|error|cannot|unable/i,
    /FAIL\s/,
    /fatal:/i,
    /panic:/i,
    /abort/i,
  ];

  // Inefficiency patterns
  private readonly INEFFICIENCY_PATTERNS = [
    { pattern: /searching for.*not found/i, description: "Searched for something that wasn't found" },
    { pattern: /let me try.*again/i, description: "Had to retry an approach" },
    { pattern: /that didn't work/i, description: "An approach didn't work" },
    { pattern: /sorry.*mistake/i, description: "Made a mistake" },
    { pattern: /going back to/i, description: "Had to backtrack" },
  ];

  /**
   * Evaluate a session transcript.
   */
  async evaluateTranscript(
    sessionId: string,
    transcript: TranscriptChunk[],
    context: {
      taskId?: string;
      taskDescription?: string;
      startTime?: Date;
      endTime?: Date;
    }
  ): Promise<TranscriptEvaluation> {
    const evaluatedAt = new Date();

    // Extract metrics
    const metrics = this.extractMetrics(transcript, context);

    // Detect errors
    const errorsEncountered = this.detectErrors(transcript);

    // Analyze what worked/failed
    const { whatWorked, whatFailed } = this.analyzeOutcomes(transcript);

    // Detect inefficiencies
    const inefficiencies = this.detectInefficiencies(transcript);

    // Calculate scores
    const taskCompletionScore = this.calculateCompletionScore(transcript, errorsEncountered);
    const efficiencyScore = this.calculateEfficiencyScore(metrics, inefficiencies);
    const errorScore = this.calculateErrorScore(errorsEncountered);

    // Overall score (weighted average)
    const overallScore =
      taskCompletionScore * 0.5 + efficiencyScore * 0.3 + errorScore * 0.2;

    // Classify outcome
    const outcome = this.classifyOutcome(transcript, taskCompletionScore, errorsEncountered);

    return {
      sessionId,
      taskId: context.taskId,
      evaluatedAt,
      taskCompletionScore,
      efficiencyScore,
      errorScore,
      overallScore,
      whatWorked,
      whatFailed,
      inefficiencies,
      errorsEncountered,
      outcome,
      metrics,
    };
  }

  /**
   * Extract metrics from transcript.
   */
  private extractMetrics(
    transcript: TranscriptChunk[],
    context: { startTime?: Date; endTime?: Date }
  ): TranscriptEvaluation["metrics"] {
    const totalTurns = transcript.length;

    // Estimate tokens (rough: 4 chars = 1 token)
    const totalChars = transcript.reduce((sum, chunk) => sum + chunk.content.length, 0);
    const totalTokensEstimate = Math.ceil(totalChars / 4);

    // Duration
    const durationSeconds =
      context.startTime && context.endTime
        ? Math.round((context.endTime.getTime() - context.startTime.getTime()) / 1000)
        : 0;

    // Count tool calls
    let toolCallCount = 0;
    for (const chunk of transcript) {
      if (chunk.toolCalls) {
        toolCallCount += chunk.toolCalls.length;
      }
      // Also detect tool calls from text patterns
      const toolMatches = chunk.content.match(/\[tool:|<tool>|Using tool:/gi);
      if (toolMatches) {
        toolCallCount += toolMatches.length;
      }
    }

    // Count errors
    let errorCount = 0;
    for (const chunk of transcript) {
      for (const { pattern } of this.ERROR_PATTERNS) {
        const matches = chunk.content.match(pattern);
        if (matches) {
          errorCount += matches.length;
        }
      }
    }

    // Count retries
    let retryCount = 0;
    for (const chunk of transcript) {
      const retryMatches = chunk.content.match(/retry|trying again|let me try|attempt/gi);
      if (retryMatches) {
        retryCount += retryMatches.length;
      }
    }

    return {
      totalTurns,
      totalTokensEstimate,
      durationSeconds,
      toolCallCount,
      errorCount,
      retryCount,
    };
  }

  /**
   * Detect errors in transcript.
   */
  private detectErrors(transcript: TranscriptChunk[]): ErrorRecord[] {
    const errors: ErrorRecord[] = [];
    const errorOccurrences = new Map<string, { firstIndex: number; lastIndex: number }>();

    for (let i = 0; i < transcript.length; i++) {
      const chunk = transcript[i];

      for (const { pattern, type } of this.ERROR_PATTERNS) {
        const matches = chunk.content.matchAll(new RegExp(pattern, "gi"));
        for (const match of matches) {
          const message = this.extractErrorMessage(chunk.content, match.index ?? 0);
          const key = `${type}:${message.slice(0, 50)}`;

          if (!errorOccurrences.has(key)) {
            errorOccurrences.set(key, { firstIndex: i, lastIndex: i });
            errors.push({
              type,
              message,
              resolved: false,
            });
          } else {
            errorOccurrences.get(key)!.lastIndex = i;
          }
        }
      }
    }

    // Check if errors were resolved (success indicators after error)
    for (const error of errors) {
      const occurrence = errorOccurrences.get(`${error.type}:${error.message.slice(0, 50)}`);
      if (occurrence) {
        // Look for success indicators after the error
        for (let i = occurrence.lastIndex + 1; i < transcript.length; i++) {
          for (const pattern of this.SUCCESS_INDICATORS) {
            if (pattern.test(transcript[i].content)) {
              error.resolved = true;
              error.turnsToResolve = i - occurrence.firstIndex;
              break;
            }
          }
          if (error.resolved) break;
        }
      }
    }

    return errors;
  }

  /**
   * Extract error message from content around a match.
   */
  private extractErrorMessage(content: string, matchIndex: number): string {
    const lineStart = content.lastIndexOf("\n", matchIndex) + 1;
    const lineEnd = content.indexOf("\n", matchIndex);
    const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    return line.trim().slice(0, 200);
  }

  /**
   * Analyze what worked and what failed.
   */
  private analyzeOutcomes(transcript: TranscriptChunk[]): {
    whatWorked: string[];
    whatFailed: string[];
  } {
    const whatWorked: string[] = [];
    const whatFailed: string[] = [];

    const fullText = transcript.map((c) => c.content).join("\n");

    // Detect successful operations
    const successPatterns = [
      { pattern: /successfully\s+(\w+(?:\s+\w+){0,3})/gi, prefix: "Successfully" },
      { pattern: /created\s+(file|component|function|test|module)\s*:?\s*([^\n]+)/gi, prefix: "Created" },
      { pattern: /fixed\s+(?:the\s+)?(\w+(?:\s+\w+){0,3})/gi, prefix: "Fixed" },
      { pattern: /tests?\s+pass(?:ed|ing)/gi, prefix: "" },
      { pattern: /build\s+succeeded/gi, prefix: "" },
    ];

    for (const { pattern, prefix } of successPatterns) {
      const matches = fullText.matchAll(pattern);
      for (const match of matches) {
        const detail = match[1] || match[0];
        whatWorked.push(prefix ? `${prefix} ${detail.trim()}` : detail.trim());
      }
    }

    // Detect failures
    const failurePatterns = [
      { pattern: /failed to\s+(\w+(?:\s+\w+){0,3})/gi, prefix: "Failed to" },
      { pattern: /could not\s+(\w+(?:\s+\w+){0,3})/gi, prefix: "Could not" },
      { pattern: /error\s+(?:in|with|while)\s+([^\n]+)/gi, prefix: "Error with" },
      { pattern: /tests?\s+fail(?:ed|ing)/gi, prefix: "" },
    ];

    for (const { pattern, prefix } of failurePatterns) {
      const matches = fullText.matchAll(pattern);
      for (const match of matches) {
        const detail = match[1] || match[0];
        whatFailed.push(prefix ? `${prefix} ${detail.trim()}` : detail.trim());
      }
    }

    // Deduplicate and limit
    return {
      whatWorked: [...new Set(whatWorked)].slice(0, 10),
      whatFailed: [...new Set(whatFailed)].slice(0, 10),
    };
  }

  /**
   * Detect inefficiencies in the transcript.
   */
  private detectInefficiencies(transcript: TranscriptChunk[]): string[] {
    const inefficiencies: string[] = [];
    const fullText = transcript.map((c) => c.content).join("\n");

    for (const { pattern, description } of this.INEFFICIENCY_PATTERNS) {
      if (pattern.test(fullText)) {
        inefficiencies.push(description);
      }
    }

    // Detect excessive tool calls (more than 50)
    let toolCalls = 0;
    for (const chunk of transcript) {
      if (chunk.toolCalls) {
        toolCalls += chunk.toolCalls.length;
      }
    }
    if (toolCalls > 50) {
      inefficiencies.push(`High tool call count (${toolCalls})`);
    }

    // Detect long sessions (more than 100 turns)
    if (transcript.length > 100) {
      inefficiencies.push(`Long session (${transcript.length} turns)`);
    }

    return [...new Set(inefficiencies)];
  }

  /**
   * Calculate task completion score.
   */
  private calculateCompletionScore(
    transcript: TranscriptChunk[],
    errors: ErrorRecord[]
  ): number {
    const lastChunks = transcript.slice(-10);
    const lastText = lastChunks.map((c) => c.content).join("\n").toLowerCase();

    let score = 0.5; // Default uncertain

    // Check for explicit completion indicators
    if (
      lastText.includes("complete") ||
      lastText.includes("done") ||
      lastText.includes("finished") ||
      lastText.includes("success")
    ) {
      score += 0.3;
    }

    // Check for unresolved errors
    const unresolvedErrors = errors.filter((e) => !e.resolved);
    score -= unresolvedErrors.length * 0.1;

    // Check for failure indicators at end
    for (const pattern of this.FAILURE_INDICATORS) {
      if (pattern.test(lastText)) {
        score -= 0.2;
        break;
      }
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate efficiency score.
   */
  private calculateEfficiencyScore(
    metrics: TranscriptEvaluation["metrics"],
    inefficiencies: string[]
  ): number {
    let score = 1.0;

    // Penalize high turn count
    if (metrics.totalTurns > 50) score -= 0.1;
    if (metrics.totalTurns > 100) score -= 0.2;

    // Penalize high retry count
    score -= metrics.retryCount * 0.05;

    // Penalize inefficiencies
    score -= inefficiencies.length * 0.1;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate error handling score.
   */
  private calculateErrorScore(errors: ErrorRecord[]): number {
    if (errors.length === 0) return 1.0;

    const resolved = errors.filter((e) => e.resolved).length;
    const resolutionRate = resolved / errors.length;

    // Base score on resolution rate
    let score = resolutionRate * 0.8;

    // Bonus for quick resolution
    const avgTurnsToResolve =
      errors.filter((e) => e.turnsToResolve).reduce((sum, e) => sum + (e.turnsToResolve ?? 0), 0) /
      Math.max(1, errors.filter((e) => e.turnsToResolve).length);

    if (avgTurnsToResolve < 3) score += 0.2;
    else if (avgTurnsToResolve < 5) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Classify overall session outcome.
   */
  private classifyOutcome(
    transcript: TranscriptChunk[],
    completionScore: number,
    errors: ErrorRecord[]
  ): TranscriptEvaluation["outcome"] {
    const lastText = transcript
      .slice(-5)
      .map((c) => c.content)
      .join("\n")
      .toLowerCase();

    // Check for interruption
    if (
      lastText.includes("interrupt") ||
      lastText.includes("cancel") ||
      lastText.includes("abort") ||
      lastText.includes("stop")
    ) {
      return "interrupted";
    }

    // Check for clear failure
    const unresolvedErrors = errors.filter((e) => !e.resolved);
    if (unresolvedErrors.length > 2 || completionScore < 0.3) {
      return "failure";
    }

    // Check for success
    if (completionScore > 0.7 && unresolvedErrors.length === 0) {
      return "success";
    }

    return "partial";
  }
}
