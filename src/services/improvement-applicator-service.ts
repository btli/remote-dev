/**
 * ImprovementApplicatorService - Applies reflections to project configuration.
 *
 * Part of the Reflexion Loop architecture (adapted for terminal model).
 * Takes suggested actions from ReflectionGeneratorService and applies them:
 * - Updates CLAUDE.md with new conventions/gotchas
 * - Creates skill definitions
 * - Adds patterns to project knowledge
 * - Creates tool stubs
 *
 * Key insight: Reflexion in terminal model applies BETWEEN sessions,
 * so improvements benefit future sessions, not the current one.
 */

import { promises as fs } from "fs";
import * as path from "path";
import type { Reflection, SuggestedAction } from "./reflection-generator-service";
import type { ProjectKnowledge } from "@/domain/entities/ProjectKnowledge";
import type { IProjectKnowledgeRepository } from "@/application/ports/task-ports";

export interface AppliedImprovement {
  actionId: string;
  action: SuggestedAction;
  success: boolean;
  result: string;
  appliedAt: Date;
}

export interface ImprovementResult {
  reflectionId: string;
  applied: AppliedImprovement[];
  skipped: Array<{ action: SuggestedAction; reason: string }>;
  summary: string;
}

/**
 * Service for applying reflections to configuration.
 */
export class ImprovementApplicatorService {
  constructor(
    private readonly projectKnowledgeRepository: IProjectKnowledgeRepository
  ) {}

  /**
   * Apply improvements from a reflection.
   */
  async applyImprovements(
    reflection: Reflection,
    projectPath: string,
    options: {
      autoApply?: boolean; // Whether to auto-apply or just preview
      confidenceThreshold?: number; // Minimum confidence to apply (default 0.6)
      dryRun?: boolean; // If true, only simulate
    } = {}
  ): Promise<ImprovementResult> {
    const { autoApply = false, confidenceThreshold = 0.6, dryRun = false } = options;

    const applied: AppliedImprovement[] = [];
    const skipped: Array<{ action: SuggestedAction; reason: string }> = [];

    for (const action of reflection.suggestedActions) {
      // Skip if below confidence threshold
      if (action.confidence < confidenceThreshold) {
        skipped.push({
          action,
          reason: `Confidence ${action.confidence.toFixed(2)} below threshold ${confidenceThreshold}`,
        });
        continue;
      }

      // Skip if not auto-applying and not dry run
      if (!autoApply && !dryRun) {
        skipped.push({
          action,
          reason: "Auto-apply disabled",
        });
        continue;
      }

      try {
        const result = await this.applyAction(action, projectPath, dryRun);
        applied.push({
          actionId: crypto.randomUUID(),
          action,
          success: true,
          result,
          appliedAt: new Date(),
        });
      } catch (error) {
        applied.push({
          actionId: crypto.randomUUID(),
          action,
          success: false,
          result: error instanceof Error ? error.message : "Unknown error",
          appliedAt: new Date(),
        });
      }
    }

    const successCount = applied.filter((a) => a.success).length;
    const summary = `Applied ${successCount}/${applied.length} improvements, skipped ${skipped.length}`;

    return {
      reflectionId: reflection.id,
      applied,
      skipped,
      summary,
    };
  }

  /**
   * Apply a single action.
   */
  private async applyAction(
    action: SuggestedAction,
    projectPath: string,
    dryRun: boolean
  ): Promise<string> {
    switch (action.type) {
      case "add_to_claudemd":
        return this.addToClaudeMd(action, projectPath, dryRun);

      case "create_skill":
        return this.createSkill(action, projectPath, dryRun);

      case "add_gotcha":
        return this.addGotcha(action, projectPath, dryRun);

      case "create_tool":
        return this.createTool(action, projectPath, dryRun);

      case "update_convention":
        return this.updateConvention(action, projectPath, dryRun);

      case "add_pattern":
        return this.addPattern(action, projectPath, dryRun);

      default:
        throw new Error(`Unknown action type: ${(action as SuggestedAction).type}`);
    }
  }

  /**
   * Add content to CLAUDE.md.
   */
  private async addToClaudeMd(
    action: SuggestedAction,
    projectPath: string,
    dryRun: boolean
  ): Promise<string> {
    const claudeMdPath = path.join(projectPath, "CLAUDE.md");

    let content: string;
    try {
      content = await fs.readFile(claudeMdPath, "utf-8");
    } catch {
      content = "# CLAUDE.md\n\n";
    }

    // Find or create the appropriate section
    const sectionHeader = this.getSectionHeader(action);
    const newContent = this.formatActionContent(action);

    let updatedContent: string;
    if (content.includes(sectionHeader)) {
      // Append to existing section
      const sectionIndex = content.indexOf(sectionHeader);
      const nextSectionIndex = content.indexOf("\n## ", sectionIndex + sectionHeader.length);
      const insertIndex = nextSectionIndex === -1 ? content.length : nextSectionIndex;

      updatedContent =
        content.slice(0, insertIndex) +
        "\n" + newContent + "\n" +
        content.slice(insertIndex);
    } else {
      // Create new section at end
      updatedContent = content + "\n\n" + sectionHeader + "\n\n" + newContent + "\n";
    }

    if (!dryRun) {
      await fs.writeFile(claudeMdPath, updatedContent);
    }

    return `Added to CLAUDE.md: ${action.title}`;
  }

  /**
   * Create a skill definition.
   */
  private async createSkill(
    action: SuggestedAction,
    projectPath: string,
    dryRun: boolean
  ): Promise<string> {
    const skillsDir = path.join(projectPath, ".claude", "skills");
    const skillName = action.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 30);
    const skillPath = path.join(skillsDir, `${skillName}.md`);

    const skillContent = `# ${action.title}

## Description
${action.description}

## Triggers
- ${action.title.toLowerCase()}

## Steps
1. ${action.implementation}

## Source
Generated from reflection analysis.
Confidence: ${action.confidence.toFixed(2)}
Source type: ${action.source}
`;

    if (!dryRun) {
      await fs.mkdir(skillsDir, { recursive: true });
      await fs.writeFile(skillPath, skillContent);
    }

    return `Created skill: ${skillPath}`;
  }

  /**
   * Add a gotcha to the gotchas section.
   */
  private async addGotcha(
    action: SuggestedAction,
    projectPath: string,
    dryRun: boolean
  ): Promise<string> {
    const claudeMdPath = path.join(projectPath, "CLAUDE.md");

    let content: string;
    try {
      content = await fs.readFile(claudeMdPath, "utf-8");
    } catch {
      content = "# CLAUDE.md\n\n";
    }

    const gotchaSection = "## Gotchas";
    const gotchaEntry = `- **${action.title}**: ${action.description}`;

    let updatedContent: string;
    if (content.includes(gotchaSection)) {
      const sectionIndex = content.indexOf(gotchaSection);
      const endOfLine = content.indexOf("\n", sectionIndex);
      updatedContent =
        content.slice(0, endOfLine + 1) +
        "\n" + gotchaEntry +
        content.slice(endOfLine + 1);
    } else {
      updatedContent = content + "\n\n" + gotchaSection + "\n\n" + gotchaEntry + "\n";
    }

    if (!dryRun) {
      await fs.writeFile(claudeMdPath, updatedContent);
    }

    return `Added gotcha: ${action.title}`;
  }

  /**
   * Create a tool stub.
   */
  private async createTool(
    action: SuggestedAction,
    projectPath: string,
    dryRun: boolean
  ): Promise<string> {
    const toolsDir = path.join(projectPath, ".claude", "tools");
    const toolName = action.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 30);
    const toolPath = path.join(toolsDir, `${toolName}.json`);

    const toolDef = {
      name: toolName,
      description: action.description,
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      implementation: {
        type: "stub",
        note: "Auto-generated from reflection. Implement before use.",
      },
      metadata: {
        source: action.source,
        confidence: action.confidence,
        generatedAt: new Date().toISOString(),
      },
    };

    if (!dryRun) {
      await fs.mkdir(toolsDir, { recursive: true });
      await fs.writeFile(toolPath, JSON.stringify(toolDef, null, 2));
    }

    return `Created tool stub: ${toolPath}`;
  }

  /**
   * Update a convention in project knowledge.
   */
  private async updateConvention(
    action: SuggestedAction,
    projectPath: string,
    dryRun: boolean
  ): Promise<string> {
    // For conventions, we add to CLAUDE.md under conventions section
    const claudeMdPath = path.join(projectPath, "CLAUDE.md");

    let content: string;
    try {
      content = await fs.readFile(claudeMdPath, "utf-8");
    } catch {
      content = "# CLAUDE.md\n\n";
    }

    const conventionSection = "## Conventions";
    const conventionEntry = `- ${action.title}: ${action.description}`;

    let updatedContent: string;
    if (content.includes(conventionSection)) {
      const sectionIndex = content.indexOf(conventionSection);
      const endOfLine = content.indexOf("\n", sectionIndex);
      updatedContent =
        content.slice(0, endOfLine + 1) +
        "\n" + conventionEntry +
        content.slice(endOfLine + 1);
    } else {
      updatedContent = content + "\n\n" + conventionSection + "\n\n" + conventionEntry + "\n";
    }

    if (!dryRun) {
      await fs.writeFile(claudeMdPath, updatedContent);
    }

    return `Added convention: ${action.title}`;
  }

  /**
   * Add a pattern to project knowledge.
   */
  private async addPattern(
    action: SuggestedAction,
    projectPath: string,
    dryRun: boolean
  ): Promise<string> {
    // For patterns, we add to CLAUDE.md under patterns section
    const claudeMdPath = path.join(projectPath, "CLAUDE.md");

    let content: string;
    try {
      content = await fs.readFile(claudeMdPath, "utf-8");
    } catch {
      content = "# CLAUDE.md\n\n";
    }

    const patternSection = "## Patterns";
    const patternEntry = `### ${action.title}\n${action.description}\n\n\`\`\`\n${action.implementation}\n\`\`\``;

    let updatedContent: string;
    if (content.includes(patternSection)) {
      const sectionIndex = content.indexOf(patternSection);
      const endOfLine = content.indexOf("\n", sectionIndex);
      updatedContent =
        content.slice(0, endOfLine + 1) +
        "\n\n" + patternEntry +
        content.slice(endOfLine + 1);
    } else {
      updatedContent = content + "\n\n" + patternSection + "\n\n" + patternEntry + "\n";
    }

    if (!dryRun) {
      await fs.writeFile(claudeMdPath, updatedContent);
    }

    return `Added pattern: ${action.title}`;
  }

  /**
   * Get section header for an action type.
   */
  private getSectionHeader(action: SuggestedAction): string {
    switch (action.type) {
      case "add_to_claudemd":
        return "## Notes";
      case "add_gotcha":
        return "## Gotchas";
      case "update_convention":
        return "## Conventions";
      case "add_pattern":
        return "## Patterns";
      default:
        return "## Notes";
    }
  }

  /**
   * Format action content for CLAUDE.md.
   */
  private formatActionContent(action: SuggestedAction): string {
    return `- **${action.title}**: ${action.description}`;
  }

  /**
   * Preview what would be applied without actually applying.
   */
  async previewImprovements(
    reflection: Reflection,
    projectPath: string,
    confidenceThreshold = 0.6
  ): Promise<Array<{ action: SuggestedAction; wouldApply: boolean; reason: string }>> {
    return reflection.suggestedActions.map((action) => {
      const meetsThreshold = action.confidence >= confidenceThreshold;
      return {
        action,
        wouldApply: meetsThreshold,
        reason: meetsThreshold
          ? `Confidence ${action.confidence.toFixed(2)} meets threshold`
          : `Confidence ${action.confidence.toFixed(2)} below threshold ${confidenceThreshold}`,
      };
    });
  }
}
