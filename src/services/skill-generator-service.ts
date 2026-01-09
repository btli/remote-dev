/**
 * SkillGeneratorService - Generates skills from patterns.
 *
 * Creates reusable workflow skills that agents can invoke:
 * - From transcript analysis (frequently used patterns)
 * - From pattern templates (common development tasks)
 * - From user feedback (explicit skill requests)
 *
 * Skills are executable workflows with steps, triggers, and scope.
 */

import type {
  CreateSkillProps,
  SkillImplementationType,
  SkillScope,
  TestCase,
} from "@/domain/entities/Skill";
import type { AnalysisResult, CommandPattern, SuccessPattern } from "./pattern-analysis-service";
import type { SkillSuggestion } from "./improvement-generator-service";

export interface SkillStep {
  type: "command" | "read" | "write" | "ask" | "tool";
  action: string;
  description?: string;
  condition?: string;
  onError?: "stop" | "continue" | "retry";
}

export interface SkillWorkflow {
  steps: SkillStep[];
  onError: "stop" | "continue" | "retry";
  timeout?: number; // milliseconds
}

export interface SkillTemplate {
  name: string;
  description: string;
  category: "testing" | "linting" | "building" | "deploying" | "git" | "dev" | "custom";
  triggers: string[];
  workflow: SkillWorkflow;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  scope: SkillScope;
}

export interface GeneratedSkill {
  props: CreateSkillProps;
  source: "pattern" | "template" | "user";
  confidence: number;
  template?: SkillTemplate;
}

/**
 * Service for generating skills.
 */
export class SkillGeneratorService {
  private readonly builtinTemplates: SkillTemplate[];

  constructor() {
    this.builtinTemplates = this.initBuiltinTemplates();
  }

  /**
   * Generate skills from analysis results.
   */
  generateFromAnalysis(
    analysis: AnalysisResult,
    projectPath?: string
  ): GeneratedSkill[] {
    const skills: GeneratedSkill[] = [];

    // Generate from command patterns
    for (const pattern of analysis.commandPatterns) {
      if (this.isGoodSkillCandidate(pattern)) {
        const skill = this.generateFromCommandPattern(pattern, projectPath);
        if (skill) {
          skills.push(skill);
        }
      }
    }

    // Generate from tool patterns
    for (const pattern of analysis.successPatterns) {
      if (pattern.successRate > 0.95 && pattern.usageCount > 10) {
        const skill = this.generateFromToolPattern(pattern, projectPath);
        if (skill) {
          skills.push(skill);
        }
      }
    }

    // Match to builtin templates
    const matchedTemplates = this.matchBuiltinTemplates(analysis);
    for (const template of matchedTemplates) {
      skills.push(this.generateFromTemplate(template, projectPath));
    }

    return this.deduplicateSkills(skills);
  }

  /**
   * Generate skill from a skill suggestion.
   */
  generateFromSuggestion(
    suggestion: SkillSuggestion,
    projectPath?: string
  ): GeneratedSkill {
    const props: CreateSkillProps = {
      name: suggestion.name,
      description: suggestion.description,
      triggers: suggestion.triggers,
      implementation: suggestion.implementation,
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "string",
      },
      scope: "project",
      projectPath,
    };

    return {
      props,
      source: "pattern",
      confidence: suggestion.confidence,
    };
  }

  /**
   * Generate skill from a template.
   */
  generateFromTemplate(
    template: SkillTemplate,
    projectPath?: string
  ): GeneratedSkill {
    // Convert workflow to bash script
    const bashCode = this.workflowToBash(template.workflow);

    const props: CreateSkillProps = {
      name: template.name,
      description: template.description,
      triggers: template.triggers,
      implementation: {
        type: "bash",
        code: bashCode,
      },
      inputSchema: template.inputSchema,
      outputSchema: { type: "string" },
      scope: projectPath ? "project" : template.scope,
      projectPath,
      testCases: this.generateTestCases(template),
      successCriteria: "All test cases pass",
    };

    return {
      props,
      source: "template",
      confidence: 1.0,
      template,
    };
  }

  /**
   * Generate skill from user request.
   */
  generateFromUserRequest(request: {
    name: string;
    description: string;
    steps: string[];
    projectPath?: string;
  }): GeneratedSkill {
    const workflow: SkillWorkflow = {
      steps: request.steps.map((step) => ({
        type: "command" as const,
        action: step,
      })),
      onError: "stop",
    };

    const bashCode = this.workflowToBash(workflow);

    const props: CreateSkillProps = {
      name: request.name.toLowerCase().replace(/\s+/g, "_"),
      description: request.description,
      triggers: [request.name.toLowerCase()],
      implementation: {
        type: "bash",
        code: bashCode,
      },
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "string" },
      scope: request.projectPath ? "project" : "global",
      projectPath: request.projectPath,
    };

    return {
      props,
      source: "user",
      confidence: 1.0,
    };
  }

  /**
   * Get all builtin templates.
   */
  getBuiltinTemplates(): SkillTemplate[] {
    return [...this.builtinTemplates];
  }

  /**
   * Get templates by category.
   */
  getTemplatesByCategory(category: SkillTemplate["category"]): SkillTemplate[] {
    return this.builtinTemplates.filter((t) => t.category === category);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private isGoodSkillCandidate(pattern: CommandPattern): boolean {
    return (
      pattern.frequency > 0.3 &&
      pattern.successRate > 0.85 &&
      !pattern.command.includes("cd ") &&
      !pattern.command.includes("ls ")
    );
  }

  private generateFromCommandPattern(
    pattern: CommandPattern,
    projectPath?: string
  ): GeneratedSkill | null {
    const name = this.commandToSkillName(pattern.command);

    const props: CreateSkillProps = {
      name,
      description: `Execute: ${pattern.command}`,
      triggers: [pattern.command.split(" ")[0]],
      implementation: {
        type: "bash",
        code: pattern.command,
      },
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "string" },
      scope: projectPath ? "project" : "global",
      projectPath,
    };

    return {
      props,
      source: "pattern",
      confidence: pattern.successRate,
    };
  }

  private generateFromToolPattern(
    pattern: SuccessPattern,
    projectPath?: string
  ): GeneratedSkill | null {
    const name = `use_${pattern.toolName.toLowerCase()}`;

    const props: CreateSkillProps = {
      name,
      description: `Wrapper for ${pattern.toolName} tool`,
      triggers: [pattern.toolName.toLowerCase()],
      implementation: {
        type: "mcp_tool",
        code: pattern.toolName,
      },
      inputSchema: { type: "object", properties: {} },
      outputSchema: { type: "string" },
      scope: projectPath ? "project" : "global",
      projectPath,
    };

    return {
      props,
      source: "pattern",
      confidence: pattern.reliabilityScore,
    };
  }

  private matchBuiltinTemplates(analysis: AnalysisResult): SkillTemplate[] {
    const matched: SkillTemplate[] = [];
    const commandsLower = analysis.commandPatterns.map((c) =>
      c.command.toLowerCase()
    );
    const allCommands = commandsLower.join(" ");

    for (const template of this.builtinTemplates) {
      // Check if any triggers match command patterns
      for (const trigger of template.triggers) {
        if (allCommands.includes(trigger.toLowerCase())) {
          matched.push(template);
          break;
        }
      }
    }

    return matched;
  }

  private workflowToBash(workflow: SkillWorkflow): string {
    const lines: string[] = ["#!/bin/bash", "set -e", ""];

    for (const step of workflow.steps) {
      if (step.condition) {
        lines.push(`if ${step.condition}; then`);
        lines.push(`  ${step.action}`);
        lines.push("fi");
      } else if (step.type === "command") {
        if (step.onError === "continue") {
          lines.push(`${step.action} || true`);
        } else if (step.onError === "retry") {
          lines.push(`${step.action} || { sleep 1; ${step.action}; }`);
        } else {
          lines.push(step.action);
        }
      } else if (step.type === "tool") {
        lines.push(`# Tool call: ${step.action}`);
      }
    }

    return lines.join("\n");
  }

  private generateTestCases(template: SkillTemplate): TestCase[] {
    // Generate basic test cases
    return [
      {
        id: crypto.randomUUID(),
        name: "Basic execution",
        input: {},
        expected: {
          success: true,
        },
      },
    ];
  }

  private commandToSkillName(command: string): string {
    const parts = command.split(" ");
    const prefix = parts[0].replace(/[^a-z0-9]/gi, "");
    const suffix = parts[1]?.replace(/[^a-z0-9]/gi, "") ?? "";
    return `${prefix}_${suffix}`.toLowerCase().replace(/_+$/, "");
  }

  private deduplicateSkills(skills: GeneratedSkill[]): GeneratedSkill[] {
    const seen = new Map<string, GeneratedSkill>();

    for (const skill of skills) {
      const existing = seen.get(skill.props.name);
      if (!existing || skill.confidence > existing.confidence) {
        seen.set(skill.props.name, skill);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Initialize builtin skill templates.
   */
  private initBuiltinTemplates(): SkillTemplate[] {
    return [
      // Testing skills
      {
        name: "quality_check",
        description: "Run complete pre-commit validation (lint, typecheck, test, build)",
        category: "testing",
        triggers: ["quality", "precommit", "validate", "check"],
        workflow: {
          steps: [
            { type: "command", action: "bun run lint", onError: "stop" },
            { type: "command", action: "bun run typecheck", onError: "stop" },
            { type: "command", action: "bun run test", onError: "stop" },
            { type: "command", action: "bun run build", onError: "stop" },
          ],
          onError: "stop",
        },
        inputSchema: { type: "object", properties: {} },
        scope: "project",
      },
      {
        name: "test_watch",
        description: "Run tests in watch mode",
        category: "testing",
        triggers: ["test watch", "tdd"],
        workflow: {
          steps: [{ type: "command", action: "bun run test --watch" }],
          onError: "stop",
        },
        inputSchema: { type: "object", properties: {} },
        scope: "project",
      },
      // Linting skills
      {
        name: "lint_fix",
        description: "Run linter and auto-fix issues",
        category: "linting",
        triggers: ["lint", "fix"],
        workflow: {
          steps: [
            { type: "command", action: "bun run lint --fix", onError: "continue" },
            { type: "command", action: "bun run format", onError: "continue" },
          ],
          onError: "continue",
        },
        inputSchema: { type: "object", properties: {} },
        scope: "project",
      },
      // Git skills
      {
        name: "git_status_full",
        description: "Show full git status with diff summary",
        category: "git",
        triggers: ["status", "changes"],
        workflow: {
          steps: [
            { type: "command", action: "git status" },
            { type: "command", action: "git diff --stat" },
          ],
          onError: "continue",
        },
        inputSchema: { type: "object", properties: {} },
        scope: "global",
      },
      {
        name: "git_sync",
        description: "Pull latest changes and rebase",
        category: "git",
        triggers: ["sync", "update", "pull"],
        workflow: {
          steps: [
            { type: "command", action: "git fetch --all" },
            { type: "command", action: "git pull --rebase" },
          ],
          onError: "stop",
        },
        inputSchema: { type: "object", properties: {} },
        scope: "global",
      },
      // Building skills
      {
        name: "clean_build",
        description: "Clean and rebuild project",
        category: "building",
        triggers: ["clean", "rebuild"],
        workflow: {
          steps: [
            { type: "command", action: "rm -rf .next dist build node_modules/.cache", onError: "continue" },
            { type: "command", action: "bun install" },
            { type: "command", action: "bun run build" },
          ],
          onError: "stop",
        },
        inputSchema: { type: "object", properties: {} },
        scope: "project",
      },
      // Dev skills
      {
        name: "dev_setup",
        description: "Set up development environment",
        category: "dev",
        triggers: ["setup", "init", "bootstrap"],
        workflow: {
          steps: [
            { type: "command", action: "bun install" },
            { type: "command", action: "cp .env.example .env.local", condition: "[ -f .env.example ]" },
            { type: "command", action: "bun run db:push", onError: "continue" },
          ],
          onError: "continue",
        },
        inputSchema: { type: "object", properties: {} },
        scope: "project",
      },
    ];
  }
}
