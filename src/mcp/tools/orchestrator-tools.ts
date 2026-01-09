/**
 * Orchestrator Tools - AI Agent Orchestration
 *
 * Tools for managing orchestrators, monitoring session health, and accessing insights.
 * These enable AI agents to coordinate multi-session workflows and respond to stall detection.
 */
import { z } from "zod";
import { createTool } from "../registry";
import { successResult } from "../utils/error-handler";
import { injectCommandUseCase } from "@/infrastructure/container";
import * as SessionService from "@/services/session-service";
import { db } from "@/db";
import { orchestratorSessions, orchestratorInsights, orchestratorAuditLog, terminalSessions } from "@/db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import type { RegisteredTool } from "../types";

/**
 * session_send_input - Inject command to a session via orchestrator
 */
const sessionSendInput = createTool({
  name: "session_send_input",
  description:
    "Inject a command into a terminal session through the orchestrator. " +
    "This validates the command for safety, checks session scope, and logs the action. " +
    "Use this when the orchestrator needs to intervene in a stalled session.",
  inputSchema: z.object({
    orchestratorId: z.string().uuid().describe("The orchestrator UUID performing the injection"),
    sessionId: z.string().uuid().describe("The target session UUID"),
    command: z.string().describe("The command to inject (safety validated)"),
    reason: z.string().optional().describe("Reason for the injection (for audit log)"),
  }),
  handler: async (input, context) => {
    // Step 1: Get session to verify it exists and get tmux name
    const session = await SessionService.getSession(input.sessionId, context.userId);

    if (!session) {
      return successResult({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    if (session.status === "closed") {
      return successResult({
        success: false,
        error: "Cannot inject command to closed session",
        code: "SESSION_CLOSED",
      });
    }

    // Step 2: Execute the use case
    try {
      const result = await injectCommandUseCase.execute({
        orchestratorId: input.orchestratorId,
        targetSessionId: input.sessionId,
        targetTmuxSessionName: session.tmuxSessionName,
        targetSessionFolderId: session.folderId,
        command: input.command,
        reason: input.reason,
      });

      return successResult({
        success: result.result.success,
        sessionId: input.sessionId,
        command: input.command,
        timestamp: result.result.timestamp,
        auditLogId: result.auditLog.id,
        error: result.result.error,
        hint: result.result.success
          ? "Command injected successfully. Use session_read_output to see results."
          : "Command injection failed. Check the error details.",
      });
    } catch (error) {
      // Domain errors get thrown by use case
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof Error && "code" in error ? (error as { code: string }).code : undefined;

      return successResult({
        success: false,
        error: message,
        code,
      });
    }
  },
});

/**
 * session_get_insights - Get orchestrator insights for a session
 */
const sessionGetInsights = createTool({
  name: "session_get_insights",
  description:
    "Retrieve orchestrator insights for a specific session. " +
    "Insights include stall detection, error patterns, and suggested actions. " +
    "Use this to understand session health and decide on interventions.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID to query insights for"),
    includeResolved: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include resolved insights (default: false, only unresolved)"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(20)
      .describe("Maximum number of insights to return (default: 20)"),
  }),
  handler: async (input, context) => {
    // Step 1: Verify session exists and belongs to user
    const session = await SessionService.getSession(input.sessionId, context.userId);

    if (!session) {
      return successResult({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    // Step 2: Query insights from database
    let query = db
      .select()
      .from(orchestratorInsights)
      .where(eq(orchestratorInsights.sessionId, input.sessionId))
      .orderBy(desc(orchestratorInsights.createdAt))
      .limit(input.limit);

    // Filter to only unresolved if requested
    if (!input.includeResolved) {
      query = db
        .select()
        .from(orchestratorInsights)
        .where(
          and(
            eq(orchestratorInsights.sessionId, input.sessionId),
            eq(orchestratorInsights.resolved, false)
          )
        )
        .orderBy(desc(orchestratorInsights.createdAt))
        .limit(input.limit);
    }

    const insights = await query;

    // Step 3: Format insights for response
    const formattedInsights = insights.map((insight) => ({
      id: insight.id,
      orchestratorId: insight.orchestratorId,
      type: insight.type,
      severity: insight.severity,
      message: insight.message,
      context: insight.contextJson ? JSON.parse(insight.contextJson) : null,
      suggestedActions: insight.suggestedActions ? JSON.parse(insight.suggestedActions) : [],
      resolved: insight.resolved,
      resolvedAt: insight.resolvedAt,
      createdAt: insight.createdAt,
    }));

    // Step 4: Get orchestrator info for context
    const orchestratorIds = [...new Set(insights.map((i) => i.orchestratorId))];
    const orchestrators = await db
      .select()
      .from(orchestratorSessions)
      .where(
        orchestratorIds.length > 0
          ? orchestratorIds.map((id) => eq(orchestratorSessions.id, id)).reduce((a, b) => and(a, b)!)
          : undefined
      );

    return successResult({
      success: true,
      sessionId: input.sessionId,
      count: formattedInsights.length,
      insights: formattedInsights,
      orchestrators: orchestrators.map((orc) => ({
        id: orc.id,
        type: orc.type,
        status: orc.status,
        scopeType: orc.scopeType,
        scopeId: orc.scopeId,
      })),
      hint:
        formattedInsights.length === 0
          ? "No insights found for this session. Session is healthy or not being monitored."
          : `Found ${formattedInsights.length} insight(s). Review suggested actions for intervention guidance.`,
    });
  },
});

/**
 * orchestrator_status - Get orchestrator status and configuration
 */
const orchestratorStatus = createTool({
  name: "orchestrator_status",
  description:
    "Get the status and configuration of orchestrators monitoring sessions. " +
    "Includes Master Control and any folder-scoped Folder Control agents. " +
    "Use this to understand the current monitoring state.",
  inputSchema: z.object({
    orchestratorId: z
      .string()
      .uuid()
      .optional()
      .describe("Specific orchestrator ID (omit to list all user orchestrators)"),
    includeStats: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include statistics (insight counts, audit log counts)"),
  }),
  handler: async (input, context) => {
    // Step 1: Query orchestrators
    let orchestrators;
    if (input.orchestratorId) {
      // Get specific orchestrator
      orchestrators = await db
        .select()
        .from(orchestratorSessions)
        .where(eq(orchestratorSessions.id, input.orchestratorId))
        .limit(1);

      if (orchestrators.length === 0) {
        return successResult({
          success: false,
          error: "Orchestrator not found",
          code: "ORCHESTRATOR_NOT_FOUND",
        });
      }
    } else {
      // Get all user orchestrators
      orchestrators = await db
        .select()
        .from(orchestratorSessions)
        .where(eq(orchestratorSessions.userId, context.userId))
        .orderBy(desc(orchestratorSessions.createdAt));
    }

    // Step 2: Gather statistics if requested
    const orchestratorData = await Promise.all(
      orchestrators.map(async (orc) => {
        const baseData = {
          id: orc.id,
          sessionId: orc.sessionId,
          type: orc.type,
          status: orc.status,
          scopeType: orc.scopeType,
          scopeId: orc.scopeId,
          customInstructions: orc.customInstructions,
          monitoringInterval: orc.monitoringInterval,
          stallThreshold: orc.stallThreshold,
          autoIntervention: orc.autoIntervention,
          lastActivityAt: orc.lastActivityAt,
          createdAt: orc.createdAt,
          updatedAt: orc.updatedAt,
        };

        if (!input.includeStats) {
          return baseData;
        }

        // Get insight counts
        const unresolvedInsights = await db
          .select()
          .from(orchestratorInsights)
          .where(
            and(
              eq(orchestratorInsights.orchestratorId, orc.id),
              eq(orchestratorInsights.resolved, false)
            )
          );

        const totalInsights = await db
          .select()
          .from(orchestratorInsights)
          .where(eq(orchestratorInsights.orchestratorId, orc.id));

        const criticalInsights = unresolvedInsights.filter(
          (i) => i.severity === "critical"
        );

        // Get recent audit log count for this orchestrator
        const recentAuditLogs = await db
          .select()
          .from(orchestratorAuditLog)
          .where(eq(orchestratorAuditLog.orchestratorId, orc.id));

        return {
          ...baseData,
          stats: {
            unresolvedInsights: unresolvedInsights.length,
            totalInsights: totalInsights.length,
            criticalInsights: criticalInsights.length,
            recentActions: recentAuditLogs.length,
          },
        };
      })
    );

    // Step 3: Get session info for context
    const sessionIds = orchestrators.map((orc) => orc.sessionId);

    const sessions =
      sessionIds.length > 0
        ? await db
            .select()
            .from(terminalSessions)
            .where(inArray(terminalSessions.id, sessionIds))
        : [];

    const sessionMap = new Map(sessions.map((s) => [s.id, s]));

    return successResult({
      success: true,
      count: orchestratorData.length,
      orchestrators: orchestratorData.map((orc) => ({
        ...orc,
        session: sessionMap.get(orc.sessionId)
          ? {
              id: sessionMap.get(orc.sessionId)!.id,
              name: sessionMap.get(orc.sessionId)!.name,
              status: sessionMap.get(orc.sessionId)!.status,
              projectPath: sessionMap.get(orc.sessionId)!.projectPath,
            }
          : null,
      })),
      hint:
        orchestratorData.length === 0
          ? "No orchestrators found. Create a Master Control agent to begin monitoring."
          : input.orchestratorId
            ? "Orchestrator details retrieved."
            : `Found ${orchestratorData.length} orchestrator(s).`,
    });
  },
});

/**
 * session_analyze - Analyze session output to understand agent activity
 *
 * This tool enables Master Control to understand what an agent is working on
 * by analyzing the terminal scrollback buffer for patterns.
 */
const sessionAnalyze = createTool({
  name: "session_analyze",
  description:
    "Analyze a session's terminal output to understand what the agent is working on. " +
    "Detects patterns like: file edits, git operations, test runs, builds, errors. " +
    "Use this to gain context before intervening in a stalled session.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID to analyze"),
    lines: z
      .number()
      .int()
      .positive()
      .optional()
      .default(200)
      .describe("Number of scrollback lines to analyze (default: 200)"),
  }),
  handler: async (input, context) => {
    const session = await SessionService.getSession(input.sessionId, context.userId);

    if (!session) {
      return successResult({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    // Import TmuxService for scrollback capture
    const TmuxService = await import("@/services/tmux-service");

    // Check if tmux session exists
    const tmuxExists = await TmuxService.sessionExists(session.tmuxSessionName);
    if (!tmuxExists) {
      return successResult({
        success: false,
        error: "Terminal session no longer exists",
        code: "TMUX_SESSION_GONE",
      });
    }

    // Capture scrollback
    const output = await TmuxService.captureOutput(session.tmuxSessionName, input.lines);

    // Analyze patterns in the output
    const analysis = analyzeScrollback(output);

    return successResult({
      success: true,
      sessionId: input.sessionId,
      sessionName: session.name,
      agentProvider: session.agentProvider || "unknown",
      projectPath: session.projectPath,
      analysis,
      hint: analysis.currentActivity
        ? `Agent appears to be: ${analysis.currentActivity}`
        : "Unable to determine current activity. Manual review recommended.",
    });
  },
});

/**
 * Analyze scrollback buffer for patterns
 */
function analyzeScrollback(output: string): {
  currentActivity: string | null;
  recentCommands: string[];
  detectedPatterns: string[];
  errorCount: number;
  lastError: string | null;
  gitActivity: boolean;
  buildActivity: boolean;
  testActivity: boolean;
  fileEdits: string[];
} {
  const lines = output.split("\n");
  const patterns: string[] = [];
  const recentCommands: string[] = [];
  const fileEdits: string[] = [];
  let errorCount = 0;
  let lastError: string | null = null;
  let gitActivity = false;
  let buildActivity = false;
  let testActivity = false;
  let currentActivity: string | null = null;

  // Pattern detection
  for (const line of lines) {
    // Detect command prompts (common patterns)
    if (line.match(/^\$ |^> |^❯ |^\[.*\].*\$ /)) {
      const cmd = line.replace(/^[\$>❯\s]+|\[.*\].*\$ /, "").trim();
      if (cmd) recentCommands.push(cmd);
    }

    // Git activity
    if (line.match(/git (commit|push|pull|checkout|merge|rebase|diff|status|add|stash)/i)) {
      gitActivity = true;
      patterns.push("git_operation");
    }

    // Build activity
    if (line.match(/npm run|bun run|yarn |pnpm |cargo build|go build|make |webpack|vite|next build/i)) {
      buildActivity = true;
      patterns.push("build_operation");
    }

    // Test activity
    if (line.match(/npm test|bun test|jest|pytest|cargo test|go test|vitest|playwright/i)) {
      testActivity = true;
      patterns.push("test_run");
    }

    // Error detection
    if (line.match(/error:|Error:|ERROR|failed|Failed|FAILED|exception|Exception/i)) {
      errorCount++;
      lastError = line.slice(0, 200);
    }

    // File edit detection (Claude Code, Codex patterns)
    const fileMatch = line.match(/(?:editing|writing|creating|modifying|updated?)\s+[`"']?([^\s`"']+\.[a-z]+)/i);
    if (fileMatch) {
      fileEdits.push(fileMatch[1]);
    }

    // Agent-specific patterns
    if (line.match(/claude|anthropic/i)) patterns.push("claude_code");
    if (line.match(/codex|openai/i)) patterns.push("codex");
    if (line.match(/gemini|google/i)) patterns.push("gemini");
  }

  // Determine current activity based on patterns
  if (testActivity && errorCount > 0) {
    currentActivity = "Running tests (with failures)";
  } else if (testActivity) {
    currentActivity = "Running tests";
  } else if (buildActivity && errorCount > 0) {
    currentActivity = "Building (with errors)";
  } else if (buildActivity) {
    currentActivity = "Building project";
  } else if (gitActivity) {
    currentActivity = "Git operations";
  } else if (fileEdits.length > 0) {
    currentActivity = `Editing files: ${fileEdits.slice(-3).join(", ")}`;
  } else if (recentCommands.length > 0) {
    currentActivity = `Running: ${recentCommands.slice(-1)[0]}`;
  }

  return {
    currentActivity,
    recentCommands: recentCommands.slice(-10),
    detectedPatterns: [...new Set(patterns)],
    errorCount,
    lastError,
    gitActivity,
    buildActivity,
    testActivity,
    fileEdits: fileEdits.slice(-5),
  };
}

/**
 * session_agent_info - Get agent provider info for a session
 *
 * Returns information about which coding agent is running in the session,
 * enabling agent-agnostic monitoring and intervention.
 */
const sessionAgentInfo = createTool({
  name: "session_agent_info",
  description:
    "Get information about the coding agent running in a session. " +
    "Returns the agent provider (claude, codex, gemini, opencode), " +
    "configuration status, and relevant paths. " +
    "Use this to tailor interventions based on agent type.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID to query"),
  }),
  handler: async (input, context) => {
    const session = await SessionService.getSession(input.sessionId, context.userId);

    if (!session) {
      return successResult({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    // Get agent config files if project path exists
    const configFiles: Record<string, boolean> = {};
    if (session.projectPath) {
      const fs = await import("fs/promises");
      const path = await import("path");

      const configChecks = [
        { name: "CLAUDE.md", provider: "claude" },
        { name: "AGENTS.md", provider: "codex" },
        { name: "GEMINI.md", provider: "gemini" },
        { name: "OPENCODE.md", provider: "opencode" },
      ];

      for (const check of configChecks) {
        try {
          await fs.access(path.join(session.projectPath, check.name));
          configFiles[check.name] = true;
        } catch {
          configFiles[check.name] = false;
        }
      }
    }

    return successResult({
      success: true,
      sessionId: input.sessionId,
      sessionName: session.name,
      agentProvider: session.agentProvider || "unknown",
      projectPath: session.projectPath,
      folderId: session.folderId,
      configFiles,
      isOrchestratorSession: session.isOrchestratorSession || false,
      status: session.status,
      hint: session.agentProvider
        ? `Session is running ${session.agentProvider} agent.`
        : "No agent provider specified. Session may be a generic terminal.",
    });
  },
});

/**
 * project_metadata_detect - Detect project stack and metadata
 *
 * Analyzes a project directory to detect the tech stack, dependencies,
 * and other metadata useful for Master Control decisions.
 */
const projectMetadataDetect = createTool({
  name: "project_metadata_detect",
  description:
    "Detect project stack, dependencies, and metadata for a session's project. " +
    "Analyzes package.json, pyproject.toml, Cargo.toml, go.mod, etc. " +
    "Use this to understand project context for better monitoring decisions.",
  inputSchema: z.object({
    sessionId: z.string().uuid().describe("The session UUID with project to analyze"),
  }),
  handler: async (input, context) => {
    const session = await SessionService.getSession(input.sessionId, context.userId);

    if (!session) {
      return successResult({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
    }

    if (!session.projectPath) {
      return successResult({
        success: false,
        error: "Session has no project path",
        code: "NO_PROJECT_PATH",
      });
    }

    const fs = await import("fs/promises");
    const path = await import("path");

    const metadata: {
      stack: string[];
      packageManager: string | null;
      framework: string | null;
      language: string | null;
      hasTests: boolean;
      hasCi: boolean;
      dependencies: string[];
    } = {
      stack: [],
      packageManager: null,
      framework: null,
      language: null,
      hasTests: false,
      hasCi: false,
      dependencies: [],
    };

    try {
      // Check for package.json (Node.js/JavaScript/TypeScript)
      try {
        const pkgPath = path.join(session.projectPath, "package.json");
        const pkgContent = await fs.readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(pkgContent);

        metadata.stack.push("nodejs");
        metadata.language = "typescript";

        // Detect package manager
        if (await fileExists(path.join(session.projectPath, "bun.lockb"))) {
          metadata.packageManager = "bun";
        } else if (await fileExists(path.join(session.projectPath, "pnpm-lock.yaml"))) {
          metadata.packageManager = "pnpm";
        } else if (await fileExists(path.join(session.projectPath, "yarn.lock"))) {
          metadata.packageManager = "yarn";
        } else {
          metadata.packageManager = "npm";
        }

        // Detect framework
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps["next"]) metadata.framework = "nextjs";
        else if (allDeps["react"]) metadata.framework = "react";
        else if (allDeps["vue"]) metadata.framework = "vue";
        else if (allDeps["svelte"]) metadata.framework = "svelte";
        else if (allDeps["express"]) metadata.framework = "express";

        // Get top dependencies
        metadata.dependencies = Object.keys(allDeps).slice(0, 20);

        // Check for tests
        metadata.hasTests = !!(pkg.scripts?.test || allDeps["jest"] || allDeps["vitest"]);
      } catch {
        // No package.json
      }

      // Check for pyproject.toml (Python)
      try {
        await fs.access(path.join(session.projectPath, "pyproject.toml"));
        metadata.stack.push("python");
        metadata.language = metadata.language || "python";
        metadata.packageManager = "uv";
      } catch {
        // No pyproject.toml
      }

      // Check for Cargo.toml (Rust)
      try {
        await fs.access(path.join(session.projectPath, "Cargo.toml"));
        metadata.stack.push("rust");
        metadata.language = metadata.language || "rust";
        metadata.packageManager = "cargo";
      } catch {
        // No Cargo.toml
      }

      // Check for go.mod (Go)
      try {
        await fs.access(path.join(session.projectPath, "go.mod"));
        metadata.stack.push("go");
        metadata.language = metadata.language || "go";
        metadata.packageManager = "go";
      } catch {
        // No go.mod
      }

      // Check for CI
      try {
        await fs.access(path.join(session.projectPath, ".github/workflows"));
        metadata.hasCi = true;
      } catch {
        // No GitHub Actions
      }

      return successResult({
        success: true,
        sessionId: input.sessionId,
        projectPath: session.projectPath,
        metadata,
        hint: metadata.stack.length > 0
          ? `Detected ${metadata.language} project using ${metadata.packageManager}${metadata.framework ? ` with ${metadata.framework}` : ""}`
          : "Could not detect project stack. Manual review recommended.",
      });
    } catch (error) {
      return successResult({
        success: false,
        error: error instanceof Error ? error.message : "Failed to analyze project",
        code: "ANALYSIS_FAILED",
      });
    }
  },
});

/**
 * Helper to check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fs = await import("fs/promises");
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Export all orchestrator tools
 */
export const orchestratorTools: RegisteredTool[] = [
  sessionSendInput,
  sessionGetInsights,
  orchestratorStatus,
  sessionAnalyze,
  sessionAgentInfo,
  projectMetadataDetect,
];
