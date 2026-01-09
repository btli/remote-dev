/**
 * ReflectionGeneratorService - Generates verbal learnings from transcript evaluations.
 *
 * Part of the Reflexion Loop architecture (adapted for terminal model).
 * Transforms evaluations into actionable reflections that can be applied
 * to improve future sessions.
 *
 * Based on the Reflexion paper's concept of "verbal reinforcement learning"
 * where agents learn from verbal feedback about their past actions.
 */

import type { TranscriptEvaluation, ErrorRecord } from "./transcript-evaluator-service";

export interface Reflection {
  id: string;
  sessionId: string;
  evaluationId?: string;
  taskId?: string;
  createdAt: Date;

  // Verbal reflections (like Reflexion paper)
  reflections: string[];

  // Actionable improvements
  suggestedActions: SuggestedAction[];

  // Priority (based on impact)
  priority: "high" | "medium" | "low";

  // Confidence in these reflections
  confidence: number;
}

export interface SuggestedAction {
  type:
    | "add_to_claudemd"
    | "create_skill"
    | "add_gotcha"
    | "create_tool"
    | "update_convention"
    | "add_pattern";
  title: string;
  description: string;
  implementation: string;
  confidence: number;
  source: "error_analysis" | "inefficiency" | "success_pattern" | "failure_pattern";
}

/**
 * Service for generating reflections from evaluations.
 */
export class ReflectionGeneratorService {
  /**
   * Generate reflections from a transcript evaluation.
   */
  async generateReflections(
    evaluation: TranscriptEvaluation,
    context?: {
      taskDescription?: string;
      projectPath?: string;
      techStack?: string[];
    }
  ): Promise<Reflection> {
    const id = crypto.randomUUID();
    const reflections: string[] = [];
    const suggestedActions: SuggestedAction[] = [];

    // Generate reflections from errors
    const errorReflections = this.reflectOnErrors(evaluation.errorsEncountered);
    reflections.push(...errorReflections.reflections);
    suggestedActions.push(...errorReflections.actions);

    // Generate reflections from inefficiencies
    const inefficiencyReflections = this.reflectOnInefficiencies(evaluation.inefficiencies);
    reflections.push(...inefficiencyReflections.reflections);
    suggestedActions.push(...inefficiencyReflections.actions);

    // Generate reflections from what worked
    const successReflections = this.reflectOnSuccess(evaluation.whatWorked);
    reflections.push(...successReflections.reflections);
    suggestedActions.push(...successReflections.actions);

    // Generate reflections from what failed
    const failureReflections = this.reflectOnFailures(evaluation.whatFailed);
    reflections.push(...failureReflections.reflections);
    suggestedActions.push(...failureReflections.actions);

    // Generate outcome-based reflections
    const outcomeReflections = this.reflectOnOutcome(evaluation);
    reflections.push(...outcomeReflections.reflections);
    suggestedActions.push(...outcomeReflections.actions);

    // Calculate priority based on evaluation scores
    const priority = this.calculatePriority(evaluation);

    // Calculate confidence based on evaluation clarity
    const confidence = this.calculateConfidence(evaluation, suggestedActions);

    return {
      id,
      sessionId: evaluation.sessionId,
      taskId: evaluation.taskId,
      createdAt: new Date(),
      reflections: this.deduplicateReflections(reflections),
      suggestedActions: this.prioritizeActions(suggestedActions),
      priority,
      confidence,
    };
  }

  /**
   * Reflect on errors encountered.
   */
  private reflectOnErrors(errors: ErrorRecord[]): {
    reflections: string[];
    actions: SuggestedAction[];
  } {
    const reflections: string[] = [];
    const actions: SuggestedAction[] = [];

    if (errors.length === 0) {
      return { reflections, actions };
    }

    // Categorize errors
    const errorsByType = new Map<string, ErrorRecord[]>();
    for (const error of errors) {
      const existing = errorsByType.get(error.type) ?? [];
      existing.push(error);
      errorsByType.set(error.type, existing);
    }

    // Generate reflections for each error type
    for (const [type, typeErrors] of errorsByType) {
      const resolved = typeErrors.filter((e) => e.resolved).length;
      const unresolved = typeErrors.length - resolved;

      if (type === "type") {
        reflections.push(
          `Encountered ${typeErrors.length} TypeScript type errors. ${resolved} were resolved, ${unresolved} remain.`
        );

        if (unresolved > 0) {
          actions.push({
            type: "add_gotcha",
            title: "Type error patterns",
            description: `Document common type error patterns to avoid: ${typeErrors[0].message.slice(0, 100)}`,
            implementation: `Add to gotchas: "Check type compatibility before assignments"`,
            confidence: 0.7,
            source: "error_analysis",
          });
        }
      } else if (type === "test") {
        reflections.push(
          `${typeErrors.length} test failures occurred. Consider running tests earlier in the development cycle.`
        );

        actions.push({
          type: "add_to_claudemd",
          title: "Run tests early",
          description: "Add reminder to run tests after each significant change",
          implementation: `Add to CLAUDE.md: "Run tests after each file modification to catch issues early"`,
          confidence: 0.8,
          source: "error_analysis",
        });
      } else if (type === "runtime") {
        reflections.push(
          `Runtime errors suggest the code wasn't properly tested before execution.`
        );
      }
    }

    // Slow resolution reflection
    const slowResolutions = errors.filter((e) => (e.turnsToResolve ?? 0) > 5);
    if (slowResolutions.length > 0) {
      reflections.push(
        `Some errors took more than 5 turns to resolve. Consider creating tools or skills for common error patterns.`
      );

      actions.push({
        type: "create_skill",
        title: "Error resolution skill",
        description: "Create a skill for handling common error types",
        implementation: `Skill: /fix-error - Analyze and fix common error patterns`,
        confidence: 0.6,
        source: "error_analysis",
      });
    }

    return { reflections, actions };
  }

  /**
   * Reflect on inefficiencies.
   */
  private reflectOnInefficiencies(inefficiencies: string[]): {
    reflections: string[];
    actions: SuggestedAction[];
  } {
    const reflections: string[] = [];
    const actions: SuggestedAction[] = [];

    for (const inefficiency of inefficiencies) {
      if (inefficiency.includes("Searched for something")) {
        reflections.push(
          `Time was spent searching for files or configurations that weren't found. Add common locations to project documentation.`
        );

        actions.push({
          type: "add_to_claudemd",
          title: "Document file locations",
          description: "Add common file and config locations to CLAUDE.md",
          implementation: `Add to CLAUDE.md: "## Key Files\\n- Config: path/to/config\\n- Tests: path/to/tests"`,
          confidence: 0.8,
          source: "inefficiency",
        });
      }

      if (inefficiency.includes("retry") || inefficiency.includes("didn't work")) {
        reflections.push(
          `Multiple attempts were needed. Document successful patterns to avoid trial-and-error.`
        );
      }

      if (inefficiency.includes("High tool call count")) {
        reflections.push(
          `High number of tool calls suggests complex exploration. Consider creating specialized tools.`
        );

        actions.push({
          type: "create_tool",
          title: "Specialized search tool",
          description: "Create tool for common search patterns",
          implementation: `MCP tool for project-specific file search`,
          confidence: 0.5,
          source: "inefficiency",
        });
      }

      if (inefficiency.includes("Long session")) {
        reflections.push(
          `Long session duration. Consider breaking complex tasks into smaller subtasks.`
        );
      }

      if (inefficiency.includes("backtrack")) {
        reflections.push(
          `Had to backtrack during implementation. Plan more thoroughly before starting.`
        );

        actions.push({
          type: "add_pattern",
          title: "Planning pattern",
          description: "Add planning step before implementation",
          implementation: `Before implementing, list affected files and expected changes`,
          confidence: 0.7,
          source: "inefficiency",
        });
      }
    }

    return { reflections, actions };
  }

  /**
   * Reflect on successful patterns.
   */
  private reflectOnSuccess(whatWorked: string[]): {
    reflections: string[];
    actions: SuggestedAction[];
  } {
    const reflections: string[] = [];
    const actions: SuggestedAction[] = [];

    if (whatWorked.length === 0) {
      return { reflections, actions };
    }

    reflections.push(`Successful actions: ${whatWorked.slice(0, 3).join(", ")}`);

    // Extract patterns from success
    for (const success of whatWorked) {
      if (success.toLowerCase().includes("test")) {
        actions.push({
          type: "add_pattern",
          title: "Testing success pattern",
          description: "Document successful testing approach",
          implementation: `Pattern: Run tests incrementally after each change`,
          confidence: 0.7,
          source: "success_pattern",
        });
      }

      if (success.toLowerCase().includes("fix")) {
        actions.push({
          type: "create_skill",
          title: "Fix skill",
          description: `Create skill from successful fix: ${success}`,
          implementation: `Skill to reproduce this fix pattern`,
          confidence: 0.5,
          source: "success_pattern",
        });
      }
    }

    return { reflections, actions };
  }

  /**
   * Reflect on failures.
   */
  private reflectOnFailures(whatFailed: string[]): {
    reflections: string[];
    actions: SuggestedAction[];
  } {
    const reflections: string[] = [];
    const actions: SuggestedAction[] = [];

    if (whatFailed.length === 0) {
      return { reflections, actions };
    }

    reflections.push(`Failures encountered: ${whatFailed.slice(0, 3).join(", ")}`);

    for (const failure of whatFailed) {
      actions.push({
        type: "add_gotcha",
        title: `Gotcha: ${failure.slice(0, 50)}`,
        description: `Add gotcha to prevent: ${failure}`,
        implementation: `Gotcha: Watch out for this pattern - ${failure}`,
        confidence: 0.6,
        source: "failure_pattern",
      });
    }

    return { reflections, actions };
  }

  /**
   * Reflect on overall outcome.
   */
  private reflectOnOutcome(evaluation: TranscriptEvaluation): {
    reflections: string[];
    actions: SuggestedAction[];
  } {
    const reflections: string[] = [];
    const actions: SuggestedAction[] = [];

    switch (evaluation.outcome) {
      case "success":
        reflections.push(
          `Task completed successfully with ${evaluation.overallScore.toFixed(2)} overall score.`
        );
        break;

      case "partial":
        reflections.push(
          `Task partially completed. Some objectives achieved but gaps remain.`
        );
        actions.push({
          type: "add_pattern",
          title: "Completion verification",
          description: "Add explicit completion verification step",
          implementation: `Before finishing, verify all objectives are met`,
          confidence: 0.7,
          source: "failure_pattern",
        });
        break;

      case "failure":
        reflections.push(
          `Task failed. Review approach and consider alternative strategies.`
        );
        actions.push({
          type: "add_gotcha",
          title: "Failure case documentation",
          description: "Document what caused the failure for future reference",
          implementation: `Document failure pattern and mitigation`,
          confidence: 0.8,
          source: "failure_pattern",
        });
        break;

      case "interrupted":
        reflections.push(
          `Task was interrupted. Consider checkpointing or breaking into smaller tasks.`
        );
        break;
    }

    // Score-based reflections
    if (evaluation.efficiencyScore < 0.5) {
      reflections.push(
        `Efficiency was low (${evaluation.efficiencyScore.toFixed(2)}). Look for ways to streamline the workflow.`
      );
    }

    if (evaluation.errorScore < 0.5) {
      reflections.push(
        `Error handling could be improved (${evaluation.errorScore.toFixed(2)}). Consider adding validation steps.`
      );
    }

    return { reflections, actions };
  }

  /**
   * Calculate priority based on evaluation.
   */
  private calculatePriority(evaluation: TranscriptEvaluation): Reflection["priority"] {
    if (evaluation.outcome === "failure" || evaluation.overallScore < 0.4) {
      return "high";
    }
    if (evaluation.outcome === "partial" || evaluation.overallScore < 0.7) {
      return "medium";
    }
    return "low";
  }

  /**
   * Calculate confidence in reflections.
   */
  private calculateConfidence(
    evaluation: TranscriptEvaluation,
    actions: SuggestedAction[]
  ): number {
    // Base confidence on amount of evidence
    let confidence = 0.5;

    // More data = higher confidence
    if (evaluation.metrics.totalTurns > 20) confidence += 0.1;
    if (evaluation.errorsEncountered.length > 0) confidence += 0.1;
    if (evaluation.whatWorked.length > 0) confidence += 0.1;
    if (evaluation.whatFailed.length > 0) confidence += 0.1;

    // Average action confidence
    if (actions.length > 0) {
      const avgActionConfidence =
        actions.reduce((sum, a) => sum + a.confidence, 0) / actions.length;
      confidence = (confidence + avgActionConfidence) / 2;
    }

    return Math.min(1, confidence);
  }

  /**
   * Deduplicate reflections.
   */
  private deduplicateReflections(reflections: string[]): string[] {
    const seen = new Set<string>();
    return reflections.filter((r) => {
      const normalized = r.toLowerCase().trim();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  /**
   * Prioritize and limit actions.
   */
  private prioritizeActions(actions: SuggestedAction[]): SuggestedAction[] {
    // Sort by confidence descending
    const sorted = actions.sort((a, b) => b.confidence - a.confidence);

    // Deduplicate by type + title
    const seen = new Set<string>();
    const unique = sorted.filter((a) => {
      const key = `${a.type}:${a.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Return top 5
    return unique.slice(0, 5);
  }
}
