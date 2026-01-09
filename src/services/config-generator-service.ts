/**
 * ConfigGeneratorService - Generates agent config files.
 *
 * Creates project-specific context files for each agent CLI:
 * - CLAUDE.md for Claude Code
 * - AGENTS.md for Codex
 * - GEMINI.md for Gemini CLI
 * - .opencode/config for OpenCode
 *
 * Config files contain:
 * - Project context (stack, conventions, patterns)
 * - Available skills and commands
 * - Known gotchas and common issues
 * - Task management instructions
 */

import type { AgentProvider } from "@/types/agent";
import type { AnalysisResult, ProjectPattern } from "./pattern-analysis-service";
import type { GeneratedImprovements } from "./improvement-generator-service";

export interface ConfigContent {
  /** Project overview */
  projectContext: {
    name: string;
    stack: string[];
    conventions: string[];
    fileStructure: string;
  };

  /** Common commands for this project */
  commands: Array<{
    name: string;
    command: string;
    description: string;
  }>;

  /** Available skills */
  skills: Array<{
    name: string;
    trigger: string;
    description: string;
  }>;

  /** Known gotchas and tips */
  gotchas: string[];

  /** Task management instructions */
  taskManagement: string[];
}

export interface GeneratedConfig {
  provider: AgentProvider;
  content: string;
  path: string;
  isGlobal: boolean;
}

/**
 * Service for generating agent configuration files.
 */
export class ConfigGeneratorService {
  private readonly templates: Map<AgentProvider, ConfigTemplate>;

  constructor() {
    this.templates = this.initTemplates();
  }

  /**
   * Generate config for a specific agent from analysis.
   */
  generateFromAnalysis(
    provider: AgentProvider,
    projectPath: string,
    analysis: AnalysisResult,
    improvements: GeneratedImprovements
  ): GeneratedConfig {
    const projectPattern = analysis.projectPatterns.find(
      (p) => p.projectPath === projectPath
    );

    const content = this.buildConfigContent(
      projectPattern,
      analysis,
      improvements
    );

    return this.generateConfig(provider, projectPath, content);
  }

  /**
   * Generate config file for an agent.
   */
  generateConfig(
    provider: AgentProvider,
    projectPath: string,
    content: ConfigContent
  ): GeneratedConfig {
    const template = this.templates.get(provider);
    if (!template) {
      throw new Error(`No template for provider: ${provider}`);
    }

    const formatted = this.formatConfig(template, content);
    const configPath = this.getConfigPath(provider, projectPath);

    return {
      provider,
      content: formatted,
      path: configPath,
      isGlobal: false,
    };
  }

  /**
   * Generate global config (applies to all projects).
   */
  generateGlobalConfig(
    provider: AgentProvider,
    content: ConfigContent
  ): GeneratedConfig {
    const template = this.templates.get(provider);
    if (!template) {
      throw new Error(`No template for provider: ${provider}`);
    }

    const formatted = this.formatConfig(template, content);
    const configPath = this.getGlobalConfigPath(provider);

    return {
      provider,
      content: formatted,
      path: configPath,
      isGlobal: true,
    };
  }

  /**
   * Build config content from analysis.
   */
  private buildConfigContent(
    projectPattern: ProjectPattern | undefined,
    analysis: AnalysisResult,
    improvements: GeneratedImprovements
  ): ConfigContent {
    // Extract commands from patterns
    const commands = (projectPattern?.frequentCommands ?? [])
      .filter((c) => c.successRate > 0.8)
      .slice(0, 10)
      .map((c) => ({
        name: c.command.split(" ")[0],
        command: c.command,
        description: `Frequently used (${(c.frequency * 100).toFixed(0)}% of sessions)`,
      }));

    // Extract skills from improvements
    const skills = improvements.skillSuggestions
      .slice(0, 10)
      .map((s) => ({
        name: s.name,
        trigger: `/${s.name}`,
        description: s.description,
      }));

    // Extract gotchas from improvements
    const gotchas = improvements.claudeMdUpdates
      .filter((u) => u.section === "gotchas")
      .map((u) => u.content);

    // Extract rules as task management instructions
    const taskManagement = improvements.claudeMdUpdates
      .filter((u) => u.section === "rules")
      .map((u) => u.content);

    // Infer stack from commands and tools
    const stack = this.inferStack(projectPattern);
    const conventions = this.inferConventions(projectPattern, analysis);

    return {
      projectContext: {
        name: projectPattern?.projectPath.split("/").pop() ?? "unknown",
        stack,
        conventions,
        fileStructure: "", // Would be populated from actual file analysis
      },
      commands,
      skills,
      gotchas,
      taskManagement,
    };
  }

  /**
   * Format config content using template.
   */
  private formatConfig(
    template: ConfigTemplate,
    content: ConfigContent
  ): string {
    const sections: string[] = [];

    // Header
    sections.push(template.header);

    // Project Context
    sections.push(template.sectionHeader("Project Context"));
    sections.push(`**Name**: ${content.projectContext.name}`);
    if (content.projectContext.stack.length > 0) {
      sections.push(`**Stack**: ${content.projectContext.stack.join(", ")}`);
    }
    if (content.projectContext.conventions.length > 0) {
      sections.push("");
      sections.push("**Conventions**:");
      for (const conv of content.projectContext.conventions) {
        sections.push(`- ${conv}`);
      }
    }

    // Commands
    if (content.commands.length > 0) {
      sections.push("");
      sections.push(template.sectionHeader("Common Commands"));
      for (const cmd of content.commands) {
        sections.push(template.command(cmd.name, cmd.command, cmd.description));
      }
    }

    // Skills
    if (content.skills.length > 0) {
      sections.push("");
      sections.push(template.sectionHeader("Available Skills"));
      for (const skill of content.skills) {
        sections.push(template.skill(skill.trigger, skill.description));
      }
    }

    // Gotchas
    if (content.gotchas.length > 0) {
      sections.push("");
      sections.push(template.sectionHeader("Gotchas"));
      for (const gotcha of content.gotchas) {
        sections.push(gotcha);
      }
    }

    // Task Management
    if (content.taskManagement.length > 0) {
      sections.push("");
      sections.push(template.sectionHeader("Task Management"));
      for (const rule of content.taskManagement) {
        sections.push(rule);
      }
    }

    return sections.join("\n");
  }

  /**
   * Get config file path for agent.
   */
  private getConfigPath(provider: AgentProvider, projectPath: string): string {
    const paths: Record<AgentProvider, string> = {
      claude: `${projectPath}/CLAUDE.md`,
      codex: `${projectPath}/AGENTS.md`,
      gemini: `${projectPath}/GEMINI.md`,
      opencode: `${projectPath}/.opencode/config.md`,
      all: `${projectPath}/AGENTS.md`, // Default
    };
    return paths[provider];
  }

  /**
   * Get global config path.
   */
  private getGlobalConfigPath(provider: AgentProvider): string {
    const home = process.env.HOME ?? "~";
    const paths: Record<AgentProvider, string> = {
      claude: `${home}/.claude/CLAUDE.md`,
      codex: `${home}/.codex/AGENTS.md`,
      gemini: `${home}/.gemini/GEMINI.md`,
      opencode: `${home}/.config/opencode/config.md`,
      all: `${home}/.claude/CLAUDE.md`, // Default
    };
    return paths[provider];
  }

  /**
   * Infer tech stack from patterns.
   */
  private inferStack(pattern: ProjectPattern | undefined): string[] {
    if (!pattern) return [];

    const stack: string[] = [];
    const commands = pattern.frequentCommands.map((c) => c.command.toLowerCase());
    const allCommands = commands.join(" ");

    // Detect from command patterns
    if (allCommands.includes("bun ")) stack.push("Bun");
    if (allCommands.includes("npm ") || allCommands.includes("npx ")) stack.push("Node.js");
    if (allCommands.includes("pnpm ")) stack.push("pnpm");
    if (allCommands.includes("yarn ")) stack.push("Yarn");
    if (allCommands.includes("uv ") || allCommands.includes("python")) stack.push("Python");
    if (allCommands.includes("cargo ")) stack.push("Rust");
    if (allCommands.includes("go ")) stack.push("Go");
    if (allCommands.includes("next")) stack.push("Next.js");
    if (allCommands.includes("vite")) stack.push("Vite");
    if (allCommands.includes("docker")) stack.push("Docker");
    if (allCommands.includes("git")) stack.push("Git");

    return [...new Set(stack)];
  }

  /**
   * Infer conventions from patterns.
   */
  private inferConventions(
    pattern: ProjectPattern | undefined,
    analysis: AnalysisResult
  ): string[] {
    if (!pattern) return [];

    const conventions: string[] = [];

    // Infer from tool patterns
    const reliableTools = pattern.reliableTools.filter((t) => t.successRate > 0.9);
    for (const tool of reliableTools.slice(0, 3)) {
      conventions.push(`Prefer ${tool.toolName} for ${this.inferToolPurpose(tool.toolName)}`);
    }

    // Infer from error patterns
    for (const error of pattern.commonErrors.slice(0, 2)) {
      if (error.resolutionRate > 0.8) {
        conventions.push(`Handle ${error.type} errors promptly`);
      }
    }

    return conventions;
  }

  private inferToolPurpose(toolName: string): string {
    const purposes: Record<string, string> = {
      Read: "reading files",
      Write: "writing files",
      Edit: "editing files",
      Bash: "command execution",
      Grep: "code search",
      Glob: "file finding",
      Task: "complex operations",
    };
    return purposes[toolName] ?? "its purpose";
  }

  /**
   * Initialize templates for each agent.
   */
  private initTemplates(): Map<AgentProvider, ConfigTemplate> {
    const templates = new Map<AgentProvider, ConfigTemplate>();

    // Claude Code template (Markdown)
    templates.set("claude", {
      header: "# CLAUDE.md\n\nThis file provides guidance to Claude Code when working with this project.",
      sectionHeader: (title: string) => `\n## ${title}\n`,
      command: (name: string, cmd: string, desc: string) =>
        `- **${name}**: \`${cmd}\` - ${desc}`,
      skill: (trigger: string, desc: string) => `- \`${trigger}\` - ${desc}`,
    });

    // Codex template (Markdown)
    templates.set("codex", {
      header: "# AGENTS.md\n\nThis file provides guidance to Codex CLI when working with this project.",
      sectionHeader: (title: string) => `\n## ${title}\n`,
      command: (name: string, cmd: string, desc: string) =>
        `- **${name}**: \`${cmd}\` - ${desc}`,
      skill: (trigger: string, desc: string) => `- \`${trigger}\` - ${desc}`,
    });

    // Gemini template (Markdown)
    templates.set("gemini", {
      header: "# GEMINI.md\n\nThis file provides guidance to Gemini CLI when working with this project.",
      sectionHeader: (title: string) => `\n## ${title}\n`,
      command: (name: string, cmd: string, desc: string) =>
        `- **${name}**: \`${cmd}\` - ${desc}`,
      skill: (trigger: string, desc: string) => `- \`${trigger}\` - ${desc}`,
    });

    // OpenCode template (Markdown)
    templates.set("opencode", {
      header: "# OpenCode Configuration\n\nThis file provides guidance to OpenCode when working with this project.",
      sectionHeader: (title: string) => `\n## ${title}\n`,
      command: (name: string, cmd: string, desc: string) =>
        `- **${name}**: \`${cmd}\` - ${desc}`,
      skill: (trigger: string, desc: string) => `- \`${trigger}\` - ${desc}`,
    });

    // Default template
    templates.set("all", templates.get("claude")!);

    return templates;
  }
}

interface ConfigTemplate {
  header: string;
  sectionHeader: (title: string) => string;
  command: (name: string, cmd: string, desc: string) => string;
  skill: (trigger: string, desc: string) => string;
}
