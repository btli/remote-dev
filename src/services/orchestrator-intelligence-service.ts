/**
 * Orchestrator Intelligence Service
 *
 * Provides AI-driven analysis and learning capabilities for orchestrators.
 * Inspired by Auto-Claude's approach to session memory and knowledge retention.
 *
 * Key responsibilities:
 * 1. Analyze session history on task_complete events
 * 2. Extract patterns, gotchas, and insights
 * 3. Update CLAUDE.md/AGENTS.md with learned knowledge
 * 4. Promote common patterns to ~/.claude (Master Control only)
 *
 * Memory Types (following Auto-Claude's episode types):
 * - codebase_map: File purposes and structure
 * - patterns: Successful code conventions
 * - gotchas: Project-specific pitfalls
 * - session_insights: What worked/failed and recommendations
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import * as TmuxService from "./tmux-service";

/**
 * Types of knowledge that can be extracted from sessions
 */
export type KnowledgeType = "pattern" | "gotcha" | "insight" | "command" | "dependency";

/**
 * Extracted knowledge item
 */
export interface KnowledgeItem {
  type: KnowledgeType;
  content: string;
  context: string;
  confidence: number; // 0-1, how confident we are this is useful
  source: {
    sessionId: string;
    agent: string;
    timestamp: string;
  };
  tags: string[];
}

/**
 * Session analysis result
 */
export interface SessionAnalysis {
  sessionId: string;
  projectPath: string;
  agent: string;
  duration: number;
  filesModified: string[];
  commandsRun: string[];
  errorsEncountered: string[];
  errorsFixes: Array<{ error: string; fix: string }>;
  patterns: KnowledgeItem[];
  gotchas: KnowledgeItem[];
  insights: KnowledgeItem[];
}

/**
 * Config file types for different agents
 */
const AGENT_CONFIG_FILES: Record<string, string> = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  gemini: "GEMINI.md",
  opencode: "OPENCODE.md",
};

/**
 * Analyze a session's scrollback to extract knowledge
 */
export async function analyzeSession(
  sessionId: string,
  tmuxSessionName: string,
  projectPath: string,
  agent: string,
  lines: number = 500
): Promise<SessionAnalysis> {
  // Capture scrollback from tmux
  const scrollback = await TmuxService.captureOutput(tmuxSessionName, lines);

  // Parse the scrollback for patterns
  const analysis = parseScrollback(scrollback, sessionId, projectPath, agent);

  return analysis;
}

/**
 * Parse scrollback buffer to extract knowledge
 */
function parseScrollback(
  scrollback: string,
  sessionId: string,
  projectPath: string,
  agent: string
): SessionAnalysis {
  const lines = scrollback.split("\n");
  const timestamp = new Date().toISOString();

  const filesModified: string[] = [];
  const commandsRun: string[] = [];
  const errorsEncountered: string[] = [];
  const errorsFixes: Array<{ error: string; fix: string }> = [];
  const patterns: KnowledgeItem[] = [];
  const gotchas: KnowledgeItem[] = [];
  const insights: KnowledgeItem[] = [];

  let lastError: string | null = null;
  let inErrorContext = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLines = lines.slice(i + 1, i + 5).join("\n");

    // Detect command prompts and extract commands
    const cmdMatch = line.match(/^[\$❯>]\s*(.+)$/);
    if (cmdMatch) {
      const cmd = cmdMatch[1].trim();
      if (cmd && !cmd.startsWith("#")) {
        commandsRun.push(cmd);
      }
    }

    // Detect file modifications
    const filePatterns = [
      /(?:editing|writing|creating|modifying|updated?|wrote)\s+[`"']?([^\s`"']+\.[a-z]+)/i,
      /File:\s*([^\s]+\.[a-z]+)/i,
      /→\s*([^\s]+\.[a-z]+)/,
    ];

    for (const pattern of filePatterns) {
      const match = line.match(pattern);
      if (match && !filesModified.includes(match[1])) {
        filesModified.push(match[1]);
      }
    }

    // Detect errors
    if (line.match(/error:|Error:|ERROR|failed|Failed|FAILED|exception|Exception/i)) {
      const errorLine = line.slice(0, 300);
      errorsEncountered.push(errorLine);
      lastError = errorLine;
      inErrorContext = true;
    }

    // Detect error fixes (command after error that succeeds)
    if (inErrorContext && line.match(/✓|success|passed|fixed|resolved/i)) {
      if (lastError) {
        // Look for what fixed it
        const recentCommands = commandsRun.slice(-3);
        if (recentCommands.length > 0) {
          errorsFixes.push({
            error: lastError,
            fix: recentCommands[recentCommands.length - 1],
          });

          // This is a gotcha worth recording
          gotchas.push({
            type: "gotcha",
            content: `Error "${lastError.slice(0, 100)}..." can be fixed with: ${recentCommands[recentCommands.length - 1]}`,
            context: projectPath,
            confidence: 0.7,
            source: { sessionId, agent, timestamp },
            tags: ["error-fix", "troubleshooting"],
          });
        }
      }
      inErrorContext = false;
      lastError = null;
    }

    // Detect patterns - look for repeated successful operations
    if (line.match(/✓|success|passed|completed/i)) {
      // Extract what succeeded
      const context = lines.slice(Math.max(0, i - 3), i + 1).join("\n");

      // Check for test patterns
      if (context.match(/test|spec|jest|vitest|pytest/i)) {
        patterns.push({
          type: "pattern",
          content: "Test command pattern detected",
          context: context.slice(0, 200),
          confidence: 0.6,
          source: { sessionId, agent, timestamp },
          tags: ["testing"],
        });
      }

      // Check for build patterns
      if (context.match(/build|compile|bundle|webpack|vite|tsc/i)) {
        patterns.push({
          type: "pattern",
          content: "Build command pattern detected",
          context: context.slice(0, 200),
          confidence: 0.6,
          source: { sessionId, agent, timestamp },
          tags: ["build"],
        });
      }
    }

    // Detect insights from agent output
    if (line.match(/insight|learned|discovered|note:|tip:|important:/i)) {
      insights.push({
        type: "insight",
        content: line.slice(0, 300),
        context: nextLines.slice(0, 200),
        confidence: 0.5,
        source: { sessionId, agent, timestamp },
        tags: ["agent-insight"],
      });
    }

    // Detect dependency installations
    if (line.match(/npm install|bun add|yarn add|pip install|cargo add/i)) {
      const depMatch = line.match(/(?:install|add)\s+([^\s]+)/);
      if (depMatch) {
        insights.push({
          type: "dependency",
          content: `Dependency added: ${depMatch[1]}`,
          context: line,
          confidence: 0.8,
          source: { sessionId, agent, timestamp },
          tags: ["dependency"],
        });
      }
    }
  }

  return {
    sessionId,
    projectPath,
    agent,
    duration: 0, // Would need start time to calculate
    filesModified,
    commandsRun: commandsRun.slice(-50), // Keep last 50 commands
    errorsEncountered,
    errorsFixes,
    patterns: deduplicateKnowledge(patterns),
    gotchas: deduplicateKnowledge(gotchas),
    insights: deduplicateKnowledge(insights),
  };
}

/**
 * Deduplicate knowledge items by content similarity
 */
function deduplicateKnowledge(items: KnowledgeItem[]): KnowledgeItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.content.toLowerCase().slice(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Update project-level config file (CLAUDE.md, AGENTS.md, etc.)
 */
export async function updateProjectConfig(
  projectPath: string,
  agent: string,
  analysis: SessionAnalysis
): Promise<{ success: boolean; updated: boolean; message: string }> {
  const configFile = AGENT_CONFIG_FILES[agent];
  if (!configFile) {
    return { success: false, updated: false, message: `Unknown agent: ${agent}` };
  }

  const configPath = join(projectPath, configFile);

  // Read existing config or create new one
  let existingContent = "";
  if (existsSync(configPath)) {
    existingContent = await readFile(configPath, "utf-8");
  }

  // Generate new sections based on analysis
  const newSections = generateConfigSections(analysis);

  if (!newSections) {
    return { success: true, updated: false, message: "No significant knowledge to add" };
  }

  // Check if we already have these sections
  const learningsHeader = "## Learned Patterns & Gotchas";
  if (existingContent.includes(learningsHeader)) {
    // Update existing section
    const beforeSection = existingContent.split(learningsHeader)[0];
    const afterMatch = existingContent.match(/## Learned Patterns & Gotchas[\s\S]*?((?=\n## )|$)/);
    const afterSection = afterMatch ? existingContent.slice(existingContent.indexOf(afterMatch[0]) + afterMatch[0].length) : "";

    const updatedContent = beforeSection + newSections + afterSection;
    await writeFile(configPath, updatedContent);
  } else {
    // Append new section
    const updatedContent = existingContent + "\n\n" + newSections;
    await writeFile(configPath, updatedContent);
  }

  return { success: true, updated: true, message: `Updated ${configFile} with ${analysis.patterns.length} patterns and ${analysis.gotchas.length} gotchas` };
}

/**
 * Generate config sections from analysis
 */
function generateConfigSections(analysis: SessionAnalysis): string | null {
  const significantKnowledge =
    analysis.patterns.filter((p) => p.confidence >= 0.6).length +
    analysis.gotchas.filter((g) => g.confidence >= 0.6).length +
    analysis.insights.filter((i) => i.confidence >= 0.6).length;

  if (significantKnowledge === 0) {
    return null;
  }

  const lines: string[] = [];
  lines.push("## Learned Patterns & Gotchas");
  lines.push("");
  lines.push(`> Auto-generated by orchestrator on ${new Date().toISOString().split("T")[0]}`);
  lines.push("");

  // Add patterns
  const highConfidencePatterns = analysis.patterns.filter((p) => p.confidence >= 0.6);
  if (highConfidencePatterns.length > 0) {
    lines.push("### Patterns");
    lines.push("");
    for (const pattern of highConfidencePatterns.slice(0, 10)) {
      lines.push(`- ${pattern.content}`);
      if (pattern.tags.length > 0) {
        lines.push(`  - Tags: ${pattern.tags.join(", ")}`);
      }
    }
    lines.push("");
  }

  // Add gotchas
  const highConfidenceGotchas = analysis.gotchas.filter((g) => g.confidence >= 0.6);
  if (highConfidenceGotchas.length > 0) {
    lines.push("### Gotchas");
    lines.push("");
    for (const gotcha of highConfidenceGotchas.slice(0, 10)) {
      lines.push(`- ${gotcha.content}`);
    }
    lines.push("");
  }

  // Add insights
  const highConfidenceInsights = analysis.insights.filter((i) => i.confidence >= 0.6);
  if (highConfidenceInsights.length > 0) {
    lines.push("### Insights");
    lines.push("");
    for (const insight of highConfidenceInsights.slice(0, 10)) {
      lines.push(`- ${insight.content}`);
    }
    lines.push("");
  }

  // Add error fixes as troubleshooting section
  if (analysis.errorsFixes.length > 0) {
    lines.push("### Troubleshooting");
    lines.push("");
    for (const fix of analysis.errorsFixes.slice(0, 5)) {
      lines.push(`- **Error**: ${fix.error.slice(0, 100)}...`);
      lines.push(`  - **Fix**: \`${fix.fix}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Update global config (~/.claude/CLAUDE.md) with cross-project patterns
 * Only Master Control should call this
 */
export async function updateGlobalConfig(
  patterns: KnowledgeItem[],
  isMasterControl: boolean
): Promise<{ success: boolean; updated: boolean; message: string }> {
  if (!isMasterControl) {
    return { success: false, updated: false, message: "Only Master Control can update global config" };
  }

  // Filter to high-confidence cross-project patterns
  const crossProjectPatterns = patterns.filter(
    (p) => p.confidence >= 0.8 && p.tags.includes("cross-project")
  );

  if (crossProjectPatterns.length === 0) {
    return { success: true, updated: false, message: "No cross-project patterns to promote" };
  }

  const globalClaudeDir = join(homedir(), ".claude");
  const globalConfigPath = join(globalClaudeDir, "CLAUDE.md");

  // Ensure ~/.claude exists
  await mkdir(globalClaudeDir, { recursive: true });

  // Read existing global config
  let existingContent = "";
  if (existsSync(globalConfigPath)) {
    existingContent = await readFile(globalConfigPath, "utf-8");
  }

  // Generate global patterns section
  const lines: string[] = [];
  lines.push("## Cross-Project Patterns");
  lines.push("");
  lines.push(`> Auto-promoted by Master Control on ${new Date().toISOString().split("T")[0]}`);
  lines.push("");

  for (const pattern of crossProjectPatterns.slice(0, 20)) {
    lines.push(`- ${pattern.content}`);
    lines.push(`  - Source: ${pattern.source.agent} session`);
  }
  lines.push("");

  const newSection = lines.join("\n");

  // Check if section exists
  const sectionHeader = "## Cross-Project Patterns";
  if (existingContent.includes(sectionHeader)) {
    // Replace existing section
    const beforeSection = existingContent.split(sectionHeader)[0];
    const afterMatch = existingContent.match(/## Cross-Project Patterns[\s\S]*?((?=\n## )|$)/);
    const afterSection = afterMatch ? existingContent.slice(existingContent.indexOf(afterMatch[0]) + afterMatch[0].length) : "";

    const updatedContent = beforeSection + newSection + afterSection;
    await writeFile(globalConfigPath, updatedContent);
  } else {
    // Append new section
    const updatedContent = existingContent + "\n\n" + newSection;
    await writeFile(globalConfigPath, updatedContent);
  }

  return {
    success: true,
    updated: true,
    message: `Promoted ${crossProjectPatterns.length} patterns to global config`,
  };
}

/**
 * Detect if a pattern should be promoted to global scope
 * Called by Master Control when it sees similar patterns across projects
 */
export function detectCrossProjectPatterns(
  allPatterns: Array<{ projectPath: string; patterns: KnowledgeItem[] }>
): KnowledgeItem[] {
  // Group patterns by content similarity
  const patternCounts = new Map<string, { count: number; pattern: KnowledgeItem }>();

  for (const { patterns } of allPatterns) {
    for (const pattern of patterns) {
      const key = pattern.content.toLowerCase().slice(0, 50);
      const existing = patternCounts.get(key);
      if (existing) {
        existing.count++;
        // Increase confidence for patterns seen multiple times
        existing.pattern.confidence = Math.min(1, existing.pattern.confidence + 0.1);
      } else {
        patternCounts.set(key, { count: 1, pattern: { ...pattern } });
      }
    }
  }

  // Patterns seen in 2+ projects are candidates for promotion
  const crossProjectPatterns: KnowledgeItem[] = [];
  for (const { count, pattern } of patternCounts.values()) {
    if (count >= 2) {
      crossProjectPatterns.push({
        ...pattern,
        tags: [...pattern.tags, "cross-project"],
        confidence: Math.min(1, pattern.confidence + 0.2), // Boost confidence
      });
    }
  }

  return crossProjectPatterns;
}

/**
 * Process a task_complete event from an agent
 * This is the main entry point called by the agent-event handler
 */
export async function processTaskComplete(
  sessionId: string,
  tmuxSessionName: string,
  projectPath: string,
  agent: string,
  orchestratorType: "master" | "folder",
  userId?: string
): Promise<{
  analyzed: boolean;
  configUpdated: boolean;
  patternsFound: number;
  optimizationTriggered: boolean;
  message: string;
}> {
  try {
    // Step 1: Analyze the session
    const analysis = await analyzeSession(sessionId, tmuxSessionName, projectPath, agent);

    const totalKnowledge = analysis.patterns.length + analysis.gotchas.length + analysis.insights.length;

    if (totalKnowledge === 0) {
      return {
        analyzed: true,
        configUpdated: false,
        patternsFound: 0,
        optimizationTriggered: false,
        message: "Session analyzed but no significant patterns detected",
      };
    }

    // Step 2: Update project config
    const configResult = await updateProjectConfig(projectPath, agent, analysis);

    // Step 3: For Master Control, check for cross-project patterns
    // (This would require maintaining state across calls - simplified for now)

    // Step 4: Check if meta-agent optimization should be triggered
    let optimizationTriggered = false;
    if (userId) {
      const unfixedErrors = analysis.errorsEncountered.length - analysis.errorsFixes.length;
      if (unfixedErrors >= 3) {
        try {
          const { onTaskCompleteAnalysis } = await import("./meta-agent-orchestrator-service");
          await onTaskCompleteAnalysis(sessionId, userId, analysis);
          optimizationTriggered = true;
        } catch (error) {
          console.warn("[IntelligenceService] Failed to trigger meta-agent optimization:", error);
        }
      }
    }

    return {
      analyzed: true,
      configUpdated: configResult.updated,
      patternsFound: totalKnowledge,
      optimizationTriggered,
      message: configResult.message,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      analyzed: false,
      configUpdated: false,
      patternsFound: 0,
      optimizationTriggered: false,
      message: `Analysis failed: ${message}`,
    };
  }
}
