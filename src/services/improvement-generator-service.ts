/**
 * ImprovementGeneratorService - Generates actionable improvements from patterns.
 *
 * Outputs:
 * - CLAUDE.md updates (rules, gotchas, patterns)
 * - Skill definitions (based on successful patterns)
 * - Project-specific recommendations
 * - Agent configuration suggestions
 */

import type {
  AnalysisResult,
  ErrorPattern,
  SuccessPattern,
  CommandPattern,
  ProjectPattern,
} from "./pattern-analysis-service";
import type { CreateSkillProps, SkillImplementationType } from "@/domain/entities/Skill";
import type { AgentProvider } from "@/types/agent";

export interface ClaudeMdUpdate {
  section: "rules" | "gotchas" | "patterns" | "tools" | "commands";
  content: string;
  priority: "high" | "medium" | "low";
  reason: string;
}

export interface SkillSuggestion {
  name: string;
  description: string;
  triggers: string[];
  implementation: {
    type: SkillImplementationType;
    code: string;
  };
  source: "command_pattern" | "tool_pattern" | "error_resolution";
  confidence: number; // 0-1
}

export interface ProjectRecommendation {
  projectPath: string;
  recommendations: Array<{
    type: "efficiency" | "error_prevention" | "tool_usage" | "workflow";
    title: string;
    description: string;
    priority: "high" | "medium" | "low";
    action?: string;
  }>;
}

export interface AgentConfigSuggestion {
  provider: AgentProvider;
  setting: string;
  currentBehavior: string;
  suggestedBehavior: string;
  reason: string;
}

export interface GeneratedImprovements {
  claudeMdUpdates: ClaudeMdUpdate[];
  skillSuggestions: SkillSuggestion[];
  projectRecommendations: ProjectRecommendation[];
  agentConfigSuggestions: AgentConfigSuggestion[];
  summary: {
    totalSuggestions: number;
    highPriority: number;
    estimatedImpact: string;
  };
}

/**
 * Service for generating improvements from analysis results.
 */
export class ImprovementGeneratorService {
  /**
   * Generate improvements from analysis results.
   */
  generate(analysis: AnalysisResult): GeneratedImprovements {
    const claudeMdUpdates = this.generateClaudeMdUpdates(analysis);
    const skillSuggestions = this.generateSkillSuggestions(analysis);
    const projectRecommendations = this.generateProjectRecommendations(analysis);
    const agentConfigSuggestions = this.generateAgentConfigSuggestions(analysis);

    const allSuggestions = [
      ...claudeMdUpdates,
      ...skillSuggestions,
      ...projectRecommendations.flatMap((p) => p.recommendations),
      ...agentConfigSuggestions,
    ];

    const highPriority = allSuggestions.filter(
      (s) => "priority" in s && s.priority === "high"
    ).length;

    return {
      claudeMdUpdates,
      skillSuggestions,
      projectRecommendations,
      agentConfigSuggestions,
      summary: {
        totalSuggestions: allSuggestions.length,
        highPriority,
        estimatedImpact: this.estimateImpact(analysis, allSuggestions.length),
      },
    };
  }

  /**
   * Generate CLAUDE.md updates from patterns.
   */
  private generateClaudeMdUpdates(analysis: AnalysisResult): ClaudeMdUpdate[] {
    const updates: ClaudeMdUpdate[] = [];

    // Generate gotchas from error patterns
    for (const errorPattern of analysis.errorPatterns) {
      if (errorPattern.frequency > 0.5 && errorPattern.resolutionRate < 0.8) {
        const topMessage = errorPattern.commonMessages[0]?.message ?? "Unknown error";
        updates.push({
          section: "gotchas",
          content: this.formatGotcha(errorPattern),
          priority: errorPattern.frequency > 1 ? "high" : "medium",
          reason: `Error "${topMessage}" occurs ${errorPattern.frequency.toFixed(1)} times per session with only ${(errorPattern.resolutionRate * 100).toFixed(0)}% resolution rate`,
        });
      }
    }

    // Generate rules from efficiency patterns
    for (const effPattern of analysis.efficiencyPatterns) {
      if (effPattern.trend === "degrading" && effPattern.averagePerSession > 3) {
        updates.push({
          section: "rules",
          content: this.formatEfficiencyRule(effPattern),
          priority: "high",
          reason: `${effPattern.type} is degrading with ${effPattern.averagePerSession.toFixed(1)} occurrences per session`,
        });
      }
    }

    // Generate tool recommendations
    for (const toolPattern of analysis.successPatterns) {
      if (toolPattern.successRate > 0.95 && toolPattern.usageCount > 10) {
        updates.push({
          section: "tools",
          content: `- **${toolPattern.toolName}**: Highly reliable (${(toolPattern.successRate * 100).toFixed(0)}% success rate). Prefer for ${this.inferToolPurpose(toolPattern.toolName)}.`,
          priority: "low",
          reason: `Tool has ${(toolPattern.successRate * 100).toFixed(0)}% success rate over ${toolPattern.usageCount} uses`,
        });
      } else if (toolPattern.successRate < 0.7 && toolPattern.usageCount > 5) {
        updates.push({
          section: "gotchas",
          content: `- **${toolPattern.toolName}**: Has ${(toolPattern.successRate * 100).toFixed(0)}% success rate. Consider alternatives or verify inputs before use.`,
          priority: "medium",
          reason: `Tool fails ${((1 - toolPattern.successRate) * 100).toFixed(0)}% of the time`,
        });
      }
    }

    // Generate command patterns
    for (const cmdPattern of analysis.commandPatterns) {
      if (cmdPattern.frequency > 0.5 && cmdPattern.successRate > 0.9) {
        updates.push({
          section: "commands",
          content: `- \`${cmdPattern.command}\`: Frequently used and reliable.`,
          priority: "low",
          reason: `Used in ${(cmdPattern.frequency * 100).toFixed(0)}% of sessions with ${(cmdPattern.successRate * 100).toFixed(0)}% success`,
        });
      }
    }

    return updates.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Generate skill suggestions from patterns.
   */
  private generateSkillSuggestions(analysis: AnalysisResult): SkillSuggestion[] {
    const suggestions: SkillSuggestion[] = [];

    // Generate skills from frequent command patterns
    for (const cmdPattern of analysis.commandPatterns) {
      if (cmdPattern.frequency > 0.3 && cmdPattern.successRate > 0.85) {
        suggestions.push({
          name: this.commandToSkillName(cmdPattern.command),
          description: `Execute ${cmdPattern.command} command pattern`,
          triggers: [cmdPattern.command.split(" ")[0]],
          implementation: {
            type: "bash",
            code: cmdPattern.command,
          },
          source: "command_pattern",
          confidence: cmdPattern.successRate,
        });
      }
    }

    // Generate skills from reliable tool patterns
    for (const toolPattern of analysis.successPatterns) {
      if (toolPattern.successRate > 0.9 && toolPattern.usageCount > 20) {
        suggestions.push({
          name: `use_${toolPattern.toolName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
          description: `Wrapper for ${toolPattern.toolName} with optimal settings`,
          triggers: [toolPattern.toolName.toLowerCase()],
          implementation: {
            type: "mcp_tool",
            code: toolPattern.toolName,
          },
          source: "tool_pattern",
          confidence: toolPattern.reliabilityScore,
        });
      }
    }

    // Filter to unique, high-confidence suggestions
    return suggestions
      .filter((s) => s.confidence > 0.8)
      .slice(0, 10);
  }

  /**
   * Generate project-specific recommendations.
   */
  private generateProjectRecommendations(
    analysis: AnalysisResult
  ): ProjectRecommendation[] {
    const recommendations: ProjectRecommendation[] = [];

    for (const project of analysis.projectPatterns) {
      const projectRecs: ProjectRecommendation["recommendations"] = [];

      // Efficiency recommendations
      if (project.efficiency.retryRate > 3) {
        projectRecs.push({
          type: "efficiency",
          title: "High retry rate detected",
          description: `Average of ${project.efficiency.retryRate.toFixed(1)} retries per session. Consider adding pre-validation steps.`,
          priority: "high",
          action: "Add validation checks before executing commands",
        });
      }

      if (project.efficiency.backtrackRate > 2) {
        projectRecs.push({
          type: "efficiency",
          title: "Frequent backtracking",
          description: `Average of ${project.efficiency.backtrackRate.toFixed(1)} backtracks per session. Consider planning before executing.`,
          priority: "medium",
          action: "Use TodoWrite to plan before implementing",
        });
      }

      // Error prevention recommendations
      for (const error of project.commonErrors.slice(0, 2)) {
        if (error.resolutionRate < 0.7) {
          projectRecs.push({
            type: "error_prevention",
            title: `Recurring ${error.type} errors`,
            description: `${error.commonMessages[0]?.message ?? "Unknown"} occurs frequently with low resolution rate`,
            priority: "high",
            action: this.suggestErrorPrevention(error),
          });
        }
      }

      // Tool usage recommendations
      const unreliableTools = project.reliableTools.filter(
        (t) => t.successRate < 0.8 && t.usageCount > 5
      );
      for (const tool of unreliableTools.slice(0, 2)) {
        projectRecs.push({
          type: "tool_usage",
          title: `Unreliable tool: ${tool.toolName}`,
          description: `Only ${(tool.successRate * 100).toFixed(0)}% success rate over ${tool.usageCount} uses`,
          priority: "medium",
          action: `Consider alternative approaches or validate inputs for ${tool.toolName}`,
        });
      }

      if (projectRecs.length > 0) {
        recommendations.push({
          projectPath: project.projectPath,
          recommendations: projectRecs,
        });
      }
    }

    return recommendations;
  }

  /**
   * Generate agent configuration suggestions.
   */
  private generateAgentConfigSuggestions(
    analysis: AnalysisResult
  ): AgentConfigSuggestion[] {
    const suggestions: AgentConfigSuggestion[] = [];

    // Check if efficiency is low
    if (analysis.overallMetrics.overallSuccessRate < 0.7) {
      suggestions.push({
        provider: analysis.overallMetrics.mostEfficientProvider ?? "claude",
        setting: "error_handling",
        currentBehavior: "Continuing despite frequent errors",
        suggestedBehavior: "Stop and re-evaluate after 2 consecutive errors",
        reason: `Only ${(analysis.overallMetrics.overallSuccessRate * 100).toFixed(0)}% of sessions complete without unresolved errors`,
      });
    }

    // Check for high tool failure rate
    const failurePattern = analysis.efficiencyPatterns.find(
      (p) => p.type === "tool_failure"
    );
    if (failurePattern && failurePattern.averagePerSession > 5) {
      suggestions.push({
        provider: "claude",
        setting: "tool_validation",
        currentBehavior: "Executing tools without validation",
        suggestedBehavior: "Validate tool inputs before execution",
        reason: `Average of ${failurePattern.averagePerSession.toFixed(1)} tool failures per session`,
      });
    }

    // Check for high context switching
    const switchPattern = analysis.efficiencyPatterns.find(
      (p) => p.type === "context_switch"
    );
    if (switchPattern && switchPattern.averagePerSession > 5) {
      suggestions.push({
        provider: "claude",
        setting: "focus_mode",
        currentBehavior: "Frequently switching between tasks",
        suggestedBehavior: "Complete one task before starting another",
        reason: `Average of ${switchPattern.averagePerSession.toFixed(1)} context switches per session`,
      });
    }

    return suggestions;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Formatters
  // ─────────────────────────────────────────────────────────────────────────────

  private formatGotcha(error: ErrorPattern): string {
    const topMessage = error.commonMessages[0]?.message ?? "Unknown error";
    return `- **${error.type} errors**: Watch out for "${topMessage}". Resolution rate is only ${(error.resolutionRate * 100).toFixed(0)}%.`;
  }

  private formatEfficiencyRule(pattern: {
    type: string;
    averagePerSession: number;
    examples: string[];
  }): string {
    const example = pattern.examples[0] ?? "";
    const typeMap: Record<string, string> = {
      retry: "Avoid repeating the same action",
      backtrack: "Plan before executing to avoid undoing work",
      context_switch: "Complete one task before starting another",
      tool_failure: "Validate tool inputs before execution",
    };

    return `- **${typeMap[pattern.type] ?? pattern.type}**: Currently averaging ${pattern.averagePerSession.toFixed(1)} per session.${example ? ` Example: ${example}` : ""}`;
  }

  private inferToolPurpose(toolName: string): string {
    const purposes: Record<string, string> = {
      Read: "file reading operations",
      Write: "file writing operations",
      Edit: "file editing",
      Bash: "command execution",
      Grep: "searching code",
      Glob: "finding files",
      Task: "complex multi-step operations",
      WebFetch: "retrieving web content",
    };
    return purposes[toolName] ?? "its intended purpose";
  }

  private commandToSkillName(command: string): string {
    return command
      .split(" ")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_") + "_skill";
  }

  private suggestErrorPrevention(error: ErrorPattern): string {
    const suggestions: Record<ErrorPattern["type"], string> = {
      type: "Run typecheck before committing changes",
      build: "Verify dependencies are installed before building",
      test: "Write tests incrementally, not all at once",
      lint: "Fix lint errors immediately rather than batching",
      runtime: "Add error handling around risky operations",
      other: "Review error patterns and add preventive checks",
    };
    return suggestions[error.type] ?? suggestions.other;
  }

  private estimateImpact(analysis: AnalysisResult, suggestionCount: number): string {
    const efficiencyGains = analysis.efficiencyPatterns.filter(
      (p) => p.trend === "degrading"
    ).length;
    const errorReductions = analysis.errorPatterns.filter(
      (p) => p.resolutionRate < 0.8
    ).length;

    if (efficiencyGains > 2 || errorReductions > 3) {
      return "High - Significant efficiency gains possible";
    } else if (suggestionCount > 5) {
      return "Medium - Multiple areas for improvement identified";
    }
    return "Low - Minor optimizations available";
  }

  /**
   * Format improvements as CLAUDE.md content.
   */
  formatAsClaudeMd(improvements: GeneratedImprovements): string {
    const sections: string[] = [];

    // Gotchas section
    const gotchas = improvements.claudeMdUpdates.filter(
      (u) => u.section === "gotchas"
    );
    if (gotchas.length > 0) {
      sections.push("## Gotchas\n");
      sections.push(gotchas.map((g) => g.content).join("\n"));
    }

    // Rules section
    const rules = improvements.claudeMdUpdates.filter((u) => u.section === "rules");
    if (rules.length > 0) {
      sections.push("\n## Rules\n");
      sections.push(rules.map((r) => r.content).join("\n"));
    }

    // Tools section
    const tools = improvements.claudeMdUpdates.filter((u) => u.section === "tools");
    if (tools.length > 0) {
      sections.push("\n## Reliable Tools\n");
      sections.push(tools.map((t) => t.content).join("\n"));
    }

    return sections.join("\n");
  }

  /**
   * Convert skill suggestions to CreateSkillProps.
   */
  toSkillProps(suggestions: SkillSuggestion[]): CreateSkillProps[] {
    return suggestions.map((s) => ({
      name: s.name,
      description: s.description,
      triggers: s.triggers,
      implementation: s.implementation,
      inputSchema: { type: "object" as const, properties: {} },
      outputSchema: { type: "string" as const },
      scope: "project" as const,
    }));
  }
}
