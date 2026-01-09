/**
 * PatternAnalysisService - Analyzes transcripts for patterns.
 *
 * Identifies:
 * - Efficiency patterns (retries, backtracking, context switches)
 * - Error patterns (common errors, resolution rates)
 * - Success patterns (reliable tools, successful commands)
 * - Behavioral patterns (working styles, tool preferences)
 */

import type {
  ParsedTranscript,
  ToolCall,
  TranscriptError,
} from "@/lib/transcript-parsers/types";
import type { AgentProvider } from "@/types/agent";

export interface EfficiencyPattern {
  type: "retry" | "backtrack" | "context_switch" | "tool_failure";
  frequency: number; // Occurrences per hour
  averagePerSession: number;
  trend: "improving" | "stable" | "degrading";
  examples: string[];
}

export interface ErrorPattern {
  type: TranscriptError["type"];
  frequency: number; // Per session
  resolutionRate: number; // 0-1
  avgTurnsToResolve: number;
  commonMessages: Array<{ message: string; count: number }>;
}

export interface SuccessPattern {
  toolName: string;
  successRate: number; // 0-1
  avgDuration: number; // ms
  usageCount: number;
  reliabilityScore: number; // 0-1, based on consistency
}

export interface CommandPattern {
  command: string; // Normalized command prefix
  frequency: number;
  successRate: number;
  commonErrors: string[];
}

export interface ProjectPattern {
  projectPath: string;
  provider: AgentProvider;
  efficiency: {
    retryRate: number;
    backtrackRate: number;
    contextSwitchRate: number;
    toolFailureRate: number;
  };
  commonErrors: ErrorPattern[];
  reliableTools: SuccessPattern[];
  frequentCommands: CommandPattern[];
  workingHours: number[]; // Most active hours (0-23)
}

export interface AnalysisResult {
  efficiencyPatterns: EfficiencyPattern[];
  errorPatterns: ErrorPattern[];
  successPatterns: SuccessPattern[];
  commandPatterns: CommandPattern[];
  projectPatterns: ProjectPattern[];
  overallMetrics: {
    avgSessionDuration: number;
    avgToolsPerSession: number;
    avgErrorsPerSession: number;
    overallSuccessRate: number;
    mostEfficientProvider: AgentProvider | null;
  };
}

/**
 * Service for analyzing patterns in transcripts.
 */
export class PatternAnalysisService {
  /**
   * Analyze a batch of transcripts.
   */
  analyze(transcripts: ParsedTranscript[]): AnalysisResult {
    if (transcripts.length === 0) {
      return this.emptyResult();
    }

    const efficiencyPatterns = this.analyzeEfficiency(transcripts);
    const errorPatterns = this.analyzeErrors(transcripts);
    const successPatterns = this.analyzeToolSuccess(transcripts);
    const commandPatterns = this.analyzeCommands(transcripts);
    const projectPatterns = this.analyzeByProject(transcripts);
    const overallMetrics = this.calculateOverallMetrics(transcripts);

    return {
      efficiencyPatterns,
      errorPatterns,
      successPatterns,
      commandPatterns,
      projectPatterns,
      overallMetrics,
    };
  }

  /**
   * Analyze efficiency patterns.
   */
  private analyzeEfficiency(transcripts: ParsedTranscript[]): EfficiencyPattern[] {
    const patterns: EfficiencyPattern[] = [];
    const totalHours = transcripts.reduce((sum, t) => sum + t.duration / 3600, 0);

    // Retry pattern
    const totalRetries = transcripts.reduce((sum, t) => sum + t.retries, 0);
    patterns.push({
      type: "retry",
      frequency: totalHours > 0 ? totalRetries / totalHours : 0,
      averagePerSession: totalRetries / transcripts.length,
      trend: this.calculateTrend(transcripts, (t) => t.retries),
      examples: this.extractRetryExamples(transcripts),
    });

    // Backtracking pattern
    const totalBacktracks = transcripts.reduce((sum, t) => sum + t.backtracking, 0);
    patterns.push({
      type: "backtrack",
      frequency: totalHours > 0 ? totalBacktracks / totalHours : 0,
      averagePerSession: totalBacktracks / transcripts.length,
      trend: this.calculateTrend(transcripts, (t) => t.backtracking),
      examples: this.extractBacktrackExamples(transcripts),
    });

    // Context switch pattern
    const totalSwitches = transcripts.reduce((sum, t) => sum + t.contextSwitches, 0);
    patterns.push({
      type: "context_switch",
      frequency: totalHours > 0 ? totalSwitches / totalHours : 0,
      averagePerSession: totalSwitches / transcripts.length,
      trend: this.calculateTrend(transcripts, (t) => t.contextSwitches),
      examples: [],
    });

    // Tool failure pattern
    const totalFailures = transcripts.reduce((sum, t) => sum + t.toolFailures, 0);
    patterns.push({
      type: "tool_failure",
      frequency: totalHours > 0 ? totalFailures / totalHours : 0,
      averagePerSession: totalFailures / transcripts.length,
      trend: this.calculateTrend(transcripts, (t) => t.toolFailures),
      examples: this.extractFailureExamples(transcripts),
    });

    return patterns;
  }

  /**
   * Analyze error patterns.
   */
  private analyzeErrors(transcripts: ParsedTranscript[]): ErrorPattern[] {
    const errorsByType = new Map<TranscriptError["type"], TranscriptError[]>();

    for (const transcript of transcripts) {
      for (const error of transcript.errorsEncountered) {
        const list = errorsByType.get(error.type) ?? [];
        list.push(error);
        errorsByType.set(error.type, list);
      }
    }

    const patterns: ErrorPattern[] = [];

    for (const [type, errors] of errorsByType) {
      const resolved = errors.filter((e) => e.resolved);
      const avgTurns =
        resolved.filter((e) => e.turnsToResolve !== undefined)
          .reduce((sum, e) => sum + (e.turnsToResolve ?? 0), 0) /
        (resolved.length || 1);

      // Count common messages
      const messageCounts = new Map<string, number>();
      for (const error of errors) {
        const normalized = error.message.substring(0, 100);
        messageCounts.set(normalized, (messageCounts.get(normalized) ?? 0) + 1);
      }

      const commonMessages = Array.from(messageCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([message, count]) => ({ message, count }));

      patterns.push({
        type,
        frequency: errors.length / transcripts.length,
        resolutionRate: errors.length > 0 ? resolved.length / errors.length : 1,
        avgTurnsToResolve: avgTurns,
        commonMessages,
      });
    }

    return patterns.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Analyze tool success patterns.
   */
  private analyzeToolSuccess(transcripts: ParsedTranscript[]): SuccessPattern[] {
    const toolStats = new Map<
      string,
      { success: number; total: number; durations: number[] }
    >();

    for (const transcript of transcripts) {
      for (const toolCall of transcript.toolCalls) {
        const stats = toolStats.get(toolCall.name) ?? {
          success: 0,
          total: 0,
          durations: [],
        };
        stats.total++;
        if (toolCall.success) {
          stats.success++;
        }
        if (toolCall.duration !== undefined) {
          stats.durations.push(toolCall.duration);
        }
        toolStats.set(toolCall.name, stats);
      }
    }

    const patterns: SuccessPattern[] = [];

    for (const [toolName, stats] of toolStats) {
      const successRate = stats.total > 0 ? stats.success / stats.total : 0;
      const avgDuration =
        stats.durations.length > 0
          ? stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length
          : 0;

      // Calculate reliability score (consistency of success)
      const variance = this.calculateVariance(
        stats.durations.map(() => (stats.success > 0 ? 1 : 0))
      );
      const reliabilityScore = 1 - Math.min(variance, 1);

      patterns.push({
        toolName,
        successRate,
        avgDuration,
        usageCount: stats.total,
        reliabilityScore,
      });
    }

    return patterns
      .filter((p) => p.usageCount >= 3) // Only tools used 3+ times
      .sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Analyze command patterns.
   */
  private analyzeCommands(transcripts: ParsedTranscript[]): CommandPattern[] {
    const commandStats = new Map<
      string,
      { success: number; total: number; errors: string[] }
    >();

    for (const transcript of transcripts) {
      for (const command of transcript.commandsRun) {
        // Normalize to first 2 words or up to 30 chars
        const normalized = this.normalizeCommand(command);
        const stats = commandStats.get(normalized) ?? {
          success: 0,
          total: 0,
          errors: [],
        };
        stats.total++;
        // Assume success unless we find an error after this command
        // (Simplified - real impl would track command-error correlation)
        stats.success++;
        commandStats.set(normalized, stats);
      }
    }

    const patterns: CommandPattern[] = [];

    for (const [command, stats] of commandStats) {
      patterns.push({
        command,
        frequency: stats.total / transcripts.length,
        successRate: stats.total > 0 ? stats.success / stats.total : 0,
        commonErrors: [...new Set(stats.errors)].slice(0, 3),
      });
    }

    return patterns
      .filter((p) => p.frequency >= 0.1) // Commands in 10%+ of sessions
      .sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Analyze patterns by project.
   */
  private analyzeByProject(transcripts: ParsedTranscript[]): ProjectPattern[] {
    const byProject = new Map<string, ParsedTranscript[]>();

    for (const transcript of transcripts) {
      const key = transcript.projectPath || "unknown";
      const list = byProject.get(key) ?? [];
      list.push(transcript);
      byProject.set(key, list);
    }

    const patterns: ProjectPattern[] = [];

    for (const [projectPath, projectTranscripts] of byProject) {
      if (projectTranscripts.length < 2) continue; // Need multiple sessions

      const totalSessions = projectTranscripts.length;
      const provider = projectTranscripts[0].agentProvider;

      // Calculate efficiency rates
      const efficiency = {
        retryRate:
          projectTranscripts.reduce((sum, t) => sum + t.retries, 0) / totalSessions,
        backtrackRate:
          projectTranscripts.reduce((sum, t) => sum + t.backtracking, 0) / totalSessions,
        contextSwitchRate:
          projectTranscripts.reduce((sum, t) => sum + t.contextSwitches, 0) / totalSessions,
        toolFailureRate:
          projectTranscripts.reduce((sum, t) => sum + t.toolFailures, 0) / totalSessions,
      };

      // Get top errors and tools for this project
      const projectAnalysis = {
        errorPatterns: this.analyzeErrors(projectTranscripts),
        successPatterns: this.analyzeToolSuccess(projectTranscripts),
        commandPatterns: this.analyzeCommands(projectTranscripts),
      };

      // Calculate working hours distribution
      const hourCounts = new Array(24).fill(0);
      for (const transcript of projectTranscripts) {
        const hour = transcript.startedAt.getHours();
        hourCounts[hour]++;
      }
      const workingHours = hourCounts
        .map((count, hour) => ({ hour, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((h) => h.hour);

      patterns.push({
        projectPath,
        provider,
        efficiency,
        commonErrors: projectAnalysis.errorPatterns.slice(0, 3),
        reliableTools: projectAnalysis.successPatterns.slice(0, 5),
        frequentCommands: projectAnalysis.commandPatterns.slice(0, 5),
        workingHours,
      });
    }

    return patterns;
  }

  /**
   * Calculate overall metrics.
   */
  private calculateOverallMetrics(
    transcripts: ParsedTranscript[]
  ): AnalysisResult["overallMetrics"] {
    const avgSessionDuration =
      transcripts.reduce((sum, t) => sum + t.duration, 0) / transcripts.length;

    const avgToolsPerSession =
      transcripts.reduce((sum, t) => sum + t.toolCalls.length, 0) /
      transcripts.length;

    const avgErrorsPerSession =
      transcripts.reduce((sum, t) => sum + t.errorsEncountered.length, 0) /
      transcripts.length;

    // Calculate success rate (sessions with no unresolved errors)
    const successfulSessions = transcripts.filter(
      (t) => t.errorsEncountered.every((e) => e.resolved)
    ).length;
    const overallSuccessRate = successfulSessions / transcripts.length;

    // Find most efficient provider
    const byProvider = new Map<AgentProvider, number[]>();
    for (const t of transcripts) {
      const efficiencyScore =
        1 - (t.retries + t.backtracking + t.toolFailures) / (t.totalTurns + 1);
      const scores = byProvider.get(t.agentProvider) ?? [];
      scores.push(efficiencyScore);
      byProvider.set(t.agentProvider, scores);
    }

    let mostEfficientProvider: AgentProvider | null = null;
    let bestScore = 0;
    for (const [provider, scores] of byProvider) {
      if (scores.length >= 3) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        if (avg > bestScore) {
          bestScore = avg;
          mostEfficientProvider = provider;
        }
      }
    }

    return {
      avgSessionDuration,
      avgToolsPerSession,
      avgErrorsPerSession,
      overallSuccessRate,
      mostEfficientProvider,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private emptyResult(): AnalysisResult {
    return {
      efficiencyPatterns: [],
      errorPatterns: [],
      successPatterns: [],
      commandPatterns: [],
      projectPatterns: [],
      overallMetrics: {
        avgSessionDuration: 0,
        avgToolsPerSession: 0,
        avgErrorsPerSession: 0,
        overallSuccessRate: 0,
        mostEfficientProvider: null,
      },
    };
  }

  private calculateTrend(
    transcripts: ParsedTranscript[],
    metric: (t: ParsedTranscript) => number
  ): "improving" | "stable" | "degrading" {
    if (transcripts.length < 3) return "stable";

    // Sort by start time
    const sorted = [...transcripts].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime()
    );

    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));

    const firstAvg =
      firstHalf.reduce((sum, t) => sum + metric(t), 0) / firstHalf.length;
    const secondAvg =
      secondHalf.reduce((sum, t) => sum + metric(t), 0) / secondHalf.length;

    const changeRatio = (secondAvg - firstAvg) / (firstAvg || 1);

    if (changeRatio < -0.1) return "improving"; // Lower is better for these metrics
    if (changeRatio > 0.1) return "degrading";
    return "stable";
  }

  private normalizeCommand(command: string): string {
    const parts = command.trim().split(/\s+/);
    const prefix = parts.slice(0, 2).join(" ");
    return prefix.length > 30 ? prefix.substring(0, 30) : prefix;
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map((v) => (v - mean) ** 2);
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  }

  private extractRetryExamples(transcripts: ParsedTranscript[]): string[] {
    const examples: string[] = [];
    for (const t of transcripts) {
      if (t.retries > 0) {
        // Find repeated commands
        const commandCounts = new Map<string, number>();
        for (const cmd of t.commandsRun) {
          const normalized = this.normalizeCommand(cmd);
          commandCounts.set(normalized, (commandCounts.get(normalized) ?? 0) + 1);
        }
        for (const [cmd, count] of commandCounts) {
          if (count > 1) {
            examples.push(`${cmd} (x${count})`);
          }
        }
      }
      if (examples.length >= 5) break;
    }
    return examples.slice(0, 5);
  }

  private extractBacktrackExamples(transcripts: ParsedTranscript[]): string[] {
    const examples: string[] = [];
    const backtrackPatterns = ["git checkout", "git reset", "rm ", "revert"];

    for (const t of transcripts) {
      for (const cmd of t.commandsRun) {
        if (backtrackPatterns.some((p) => cmd.includes(p))) {
          examples.push(cmd.substring(0, 50));
        }
      }
      if (examples.length >= 5) break;
    }
    return examples.slice(0, 5);
  }

  private extractFailureExamples(transcripts: ParsedTranscript[]): string[] {
    const examples: string[] = [];

    for (const t of transcripts) {
      for (const tool of t.toolCalls) {
        if (!tool.success && tool.error) {
          examples.push(`${tool.name}: ${tool.error.substring(0, 50)}`);
        }
      }
      if (examples.length >= 5) break;
    }
    return examples.slice(0, 5);
  }
}
