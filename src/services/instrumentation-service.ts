/**
 * InstrumentationService - Orchestrates agent instrumentation.
 *
 * This is the main service that coordinates:
 * - Transcript analysis → pattern discovery
 * - Pattern analysis → improvement suggestions
 * - Config generation → agent context files
 * - Skill generation → executable workflows
 * - Plugin generation → hooks and event handlers
 *
 * The goal is to make agents more effective by:
 * 1. Learning from past sessions (what worked, what failed)
 * 2. Providing context (project structure, conventions, gotchas)
 * 3. Creating reusable skills (common workflows)
 * 4. Installing hooks (lifecycle automation)
 */

import { promises as fs } from "fs";
import * as path from "path";
import type { AgentProvider } from "@/types/agent";
import type { ParsedTranscript } from "@/lib/transcript-parsers/types";

import { TranscriptIngestionService } from "./transcript-ingestion-service";
import { PatternAnalysisService, type AnalysisResult } from "./pattern-analysis-service";
import {
  ImprovementGeneratorService,
  type GeneratedImprovements,
} from "./improvement-generator-service";
import { ConfigGeneratorService, type GeneratedConfig } from "./config-generator-service";
import {
  SkillGeneratorService,
  type GeneratedSkill,
} from "./skill-generator-service";
import {
  PluginGeneratorService,
  type GeneratedPlugin,
} from "./plugin-generator-service";
import type { SkillLibraryService } from "./skill-library-service";

export interface InstrumentationResult {
  analysis: AnalysisResult;
  improvements: GeneratedImprovements;
  configs: GeneratedConfig[];
  skills: GeneratedSkill[];
  plugins: GeneratedPlugin[];
  stats: {
    transcriptsAnalyzed: number;
    configsGenerated: number;
    skillsGenerated: number;
    pluginsGenerated: number;
    filesWritten: number;
  };
}

export interface InstrumentationOptions {
  /** Project path to instrument */
  projectPath: string;

  /** Target agent providers */
  providers?: AgentProvider[];

  /** Include global instrumentation */
  includeGlobal?: boolean;

  /** Ingest transcripts from this date onwards */
  since?: Date;

  /** Write generated files to disk */
  writeFiles?: boolean;

  /** Orchestrator URL for hooks */
  orchestratorUrl?: string;

  /** Generate validation hooks */
  includeValidation?: boolean;

  /** Skill library for storing generated skills */
  skillLibrary?: SkillLibraryService;
}

/**
 * Main service for instrumenting agents.
 */
export class InstrumentationService {
  private readonly ingestion: TranscriptIngestionService;
  private readonly patternAnalysis: PatternAnalysisService;
  private readonly improvementGenerator: ImprovementGeneratorService;
  private readonly configGenerator: ConfigGeneratorService;
  private readonly skillGenerator: SkillGeneratorService;
  private readonly pluginGenerator: PluginGeneratorService;

  constructor() {
    this.ingestion = new TranscriptIngestionService();
    this.patternAnalysis = new PatternAnalysisService();
    this.improvementGenerator = new ImprovementGeneratorService();
    this.configGenerator = new ConfigGeneratorService();
    this.skillGenerator = new SkillGeneratorService();
    this.pluginGenerator = new PluginGeneratorService();
  }

  /**
   * Run full instrumentation pipeline for a project.
   */
  async instrumentProject(
    options: InstrumentationOptions
  ): Promise<InstrumentationResult> {
    const providers = options.providers ?? ["claude", "codex", "gemini", "opencode"];

    // Step 1: Ingest transcripts
    const ingestionResult = await this.ingestion.ingest({
      projectPath: options.projectPath,
      since: options.since,
      providers: providers.filter((p) => p !== "all") as AgentProvider[],
    });

    // Step 2: Analyze patterns
    const analysis = this.patternAnalysis.analyze(ingestionResult.transcripts);

    // Step 3: Generate improvements
    const improvements = this.improvementGenerator.generate(analysis);

    // Step 4: Generate configs for each provider
    const configs: GeneratedConfig[] = [];
    for (const provider of providers) {
      if (provider === "all") continue;

      const config = this.configGenerator.generateFromAnalysis(
        provider,
        options.projectPath,
        analysis,
        improvements
      );
      configs.push(config);

      // Generate global config if requested
      if (options.includeGlobal) {
        const globalConfig = this.configGenerator.generateGlobalConfig(
          provider,
          this.buildGlobalConfigContent(analysis, improvements)
        );
        configs.push(globalConfig);
      }
    }

    // Step 5: Generate skills
    const skills = this.skillGenerator.generateFromAnalysis(
      analysis,
      options.projectPath
    );

    // Add skills from improvement suggestions
    for (const suggestion of improvements.skillSuggestions) {
      const skill = this.skillGenerator.generateFromSuggestion(
        suggestion,
        options.projectPath
      );
      skills.push(skill);
    }

    // Step 6: Generate plugins/hooks
    const plugins: GeneratedPlugin[] = [];
    for (const provider of providers) {
      if (provider === "all") continue;

      // Orchestrator hooks
      if (options.orchestratorUrl) {
        plugins.push(
          this.pluginGenerator.generateOrchestratorHooks(
            provider,
            options.projectPath,
            options.orchestratorUrl
          )
        );
      }

      // Validation hooks
      if (options.includeValidation) {
        plugins.push(
          this.pluginGenerator.generateValidationHooks(
            provider,
            options.projectPath
          )
        );
      }
    }

    // Step 7: Write files if requested
    let filesWritten = 0;
    if (options.writeFiles) {
      filesWritten = await this.writeGeneratedFiles(
        configs,
        skills,
        plugins,
        options.projectPath,
        options.skillLibrary
      );
    }

    return {
      analysis,
      improvements,
      configs,
      skills,
      plugins,
      stats: {
        transcriptsAnalyzed: ingestionResult.transcripts.length,
        configsGenerated: configs.length,
        skillsGenerated: skills.length,
        pluginsGenerated: plugins.length,
        filesWritten,
      },
    };
  }

  /**
   * Quick instrumentation - just generate configs and skills.
   */
  async quickInstrument(
    projectPath: string,
    provider: AgentProvider = "claude"
  ): Promise<{ config: GeneratedConfig; skills: GeneratedSkill[] }> {
    const ingestionResult = await this.ingestion.ingest({
      projectPath,
      limit: 10,
    });

    const analysis = this.patternAnalysis.analyze(ingestionResult.transcripts);
    const improvements = this.improvementGenerator.generate(analysis);

    const config = this.configGenerator.generateFromAnalysis(
      provider,
      projectPath,
      analysis,
      improvements
    );

    const skills = this.skillGenerator.generateFromAnalysis(analysis, projectPath);

    return { config, skills };
  }

  /**
   * Instrument from a single transcript.
   */
  async instrumentFromTranscript(
    transcript: ParsedTranscript,
    provider: AgentProvider = "claude"
  ): Promise<{ config: GeneratedConfig; skills: GeneratedSkill[] }> {
    const analysis = this.patternAnalysis.analyze([transcript]);
    const improvements = this.improvementGenerator.generate(analysis);

    const config = this.configGenerator.generateFromAnalysis(
      provider,
      transcript.projectPath,
      analysis,
      improvements
    );

    const skills = this.skillGenerator.generateFromAnalysis(
      analysis,
      transcript.projectPath
    );

    return { config, skills };
  }

  /**
   * Update existing config with new insights.
   */
  async updateConfig(
    existingConfigPath: string,
    provider: AgentProvider,
    projectPath: string
  ): Promise<GeneratedConfig> {
    // Read existing config
    let existingContent = "";
    try {
      existingContent = await fs.readFile(existingConfigPath, "utf-8");
    } catch {
      // File doesn't exist, will create new
    }

    // Ingest new transcripts (since last update)
    const ingestionResult = await this.ingestion.ingest({
      projectPath,
      skipProcessed: true,
    });

    const analysis = this.patternAnalysis.analyze(ingestionResult.transcripts);
    const improvements = this.improvementGenerator.generate(analysis);

    const newConfig = this.configGenerator.generateFromAnalysis(
      provider,
      projectPath,
      analysis,
      improvements
    );

    // Merge with existing (new content appended to relevant sections)
    if (existingContent) {
      newConfig.content = this.mergeConfigs(existingContent, newConfig.content);
    }

    return newConfig;
  }

  /**
   * Get skill templates for a category.
   */
  getSkillTemplates(category?: string) {
    if (category) {
      return this.skillGenerator.getTemplatesByCategory(
        category as "testing" | "linting" | "building" | "deploying" | "git" | "dev" | "custom"
      );
    }
    return this.skillGenerator.getBuiltinTemplates();
  }

  /**
   * Generate a skill from user request.
   */
  generateSkillFromRequest(request: {
    name: string;
    description: string;
    steps: string[];
    projectPath?: string;
  }): GeneratedSkill {
    return this.skillGenerator.generateFromUserRequest(request);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private buildGlobalConfigContent(
    analysis: AnalysisResult,
    improvements: GeneratedImprovements
  ) {
    return {
      projectContext: {
        name: "Global Settings",
        stack: [],
        conventions: [],
        fileStructure: "",
      },
      commands: [],
      skills: improvements.skillSuggestions
        .filter((s) => s.confidence > 0.9)
        .slice(0, 5)
        .map((s) => ({
          name: s.name,
          trigger: `/${s.name}`,
          description: s.description,
        })),
      gotchas: improvements.claudeMdUpdates
        .filter((u) => u.section === "gotchas" && u.priority === "high")
        .map((u) => u.content),
      taskManagement: [
        "- Use TodoWrite to track multi-step tasks",
        "- Check bd ready for available beads issues",
        "- Complete current task before starting new ones",
      ],
    };
  }

  private async writeGeneratedFiles(
    configs: GeneratedConfig[],
    skills: GeneratedSkill[],
    plugins: GeneratedPlugin[],
    projectPath: string,
    skillLibrary?: SkillLibraryService
  ): Promise<number> {
    let filesWritten = 0;

    // Write configs
    for (const config of configs) {
      await this.ensureDir(path.dirname(config.path));
      await fs.writeFile(config.path, config.content, "utf-8");
      filesWritten++;
    }

    // Store skills in library
    if (skillLibrary) {
      for (const skill of skills) {
        await skillLibrary.addSkill(skill.props);
        filesWritten++;
      }
    }

    // Write plugins
    for (const plugin of plugins) {
      await this.ensureDir(path.dirname(plugin.path));
      await fs.writeFile(plugin.path, plugin.content, "utf-8");
      filesWritten++;
    }

    // Write helper scripts for plugins
    const orchestratorUrl =
      plugins.find((p) => p.content.includes("orchestrator"))?.content ?? "";
    if (orchestratorUrl) {
      const notifyScript = this.pluginGenerator.generateNotificationScript(
        "http://localhost:3001",
        projectPath
      );
      await this.ensureDir(path.dirname(notifyScript.path));
      await fs.writeFile(notifyScript.path, notifyScript.content, "utf-8");
      filesWritten++;

      const validateScript = this.pluginGenerator.generateToolValidatorScript(
        this.pluginGenerator.getDefaultDangerousPatterns(),
        projectPath
      );
      await this.ensureDir(path.dirname(validateScript.path));
      await fs.writeFile(validateScript.path, validateScript.content, "utf-8");
      filesWritten++;
    }

    return filesWritten;
  }

  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  private mergeConfigs(existing: string, newContent: string): string {
    // Simple merge: append new sections that don't exist
    const existingLines = existing.split("\n");
    const newLines = newContent.split("\n");

    const existingSections = new Set<string>();
    for (const line of existingLines) {
      if (line.startsWith("## ")) {
        existingSections.add(line);
      }
    }

    const result: string[] = [...existingLines];

    let currentSection = "";
    let sectionContent: string[] = [];

    for (const line of newLines) {
      if (line.startsWith("## ")) {
        // Save previous section if it's new
        if (currentSection && !existingSections.has(currentSection)) {
          result.push("");
          result.push(currentSection);
          result.push(...sectionContent);
        }
        currentSection = line;
        sectionContent = [];
      } else if (currentSection) {
        sectionContent.push(line);
      }
    }

    // Handle last section
    if (currentSection && !existingSections.has(currentSection)) {
      result.push("");
      result.push(currentSection);
      result.push(...sectionContent);
    }

    return result.join("\n");
  }

  /**
   * Get instrumentation status for a project.
   */
  async getStatus(projectPath: string): Promise<{
    hasConfig: Record<AgentProvider, boolean>;
    lastUpdated: Record<AgentProvider, Date | null>;
    transcriptsAvailable: number;
    skillsGenerated: number;
  }> {
    const providers: AgentProvider[] = ["claude", "codex", "gemini", "opencode"];
    const hasConfig: Record<AgentProvider, boolean> = {} as Record<AgentProvider, boolean>;
    const lastUpdated: Record<AgentProvider, Date | null> = {} as Record<AgentProvider, Date | null>;

    for (const provider of providers) {
      const configPath = this.getConfigPath(provider, projectPath);
      try {
        const stat = await fs.stat(configPath);
        hasConfig[provider] = true;
        lastUpdated[provider] = stat.mtime;
      } catch {
        hasConfig[provider] = false;
        lastUpdated[provider] = null;
      }
    }

    // Set 'all' aggregate
    hasConfig.all = Object.values(hasConfig).some((v) => v);
    lastUpdated.all = Object.values(lastUpdated)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const stats = await this.ingestion.getStats();

    return {
      hasConfig,
      lastUpdated,
      transcriptsAvailable: stats.totalAvailable,
      skillsGenerated: 0, // Would need skill library to know this
    };
  }

  private getConfigPath(provider: AgentProvider, projectPath: string): string {
    const paths: Record<AgentProvider, string> = {
      claude: `${projectPath}/CLAUDE.md`,
      codex: `${projectPath}/AGENTS.md`,
      gemini: `${projectPath}/GEMINI.md`,
      opencode: `${projectPath}/.opencode/config.md`,
      all: `${projectPath}/CLAUDE.md`,
    };
    return paths[provider];
  }
}
