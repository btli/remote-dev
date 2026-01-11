/**
 * Meta-Agent Orchestrator Integration Service
 *
 * Integrates the meta-agent optimization system with the orchestrator's
 * stall detection and insight generation capabilities.
 *
 * Key responsibilities:
 * 1. Trigger config optimization when sessions perform poorly (stalls, errors)
 * 2. Use session analysis (patterns, gotchas, errors) to guide improvements
 * 3. Apply config updates on-the-fly to running sessions
 * 4. Track optimization history per session/folder
 *
 * Architecture:
 * - MonitoringService detects stalls -> triggers optimization
 * - IntelligenceService provides analysis -> guides improvement suggestions
 * - Meta-agent API runs BUILD → TEST → IMPROVE loop
 * - Updates are applied via session config injection
 */

import { db } from "@/db";
import { terminalSessions, sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { SessionAnalysis } from "./orchestrator-intelligence-service";
import type { StalledSession } from "./monitoring-service";
import type {
  TaskSpec,
  ProjectContext,
  AgentConfig,
  RefinementSuggestion,
  OptimizationResult,
} from "@/sdk/types/meta-agent";
import type { AgentProviderType } from "@/types/session";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Optimization trigger reason
 */
export type OptimizationTrigger =
  | "stall_detected"      // Session stalled (no activity)
  | "error_pattern"       // Repeated errors detected
  | "poor_performance"    // Low benchmark scores
  | "manual";             // User-initiated

/**
 * Optimization request for a session
 */
export interface OptimizationRequest {
  sessionId: string;
  trigger: OptimizationTrigger;
  analysis?: SessionAnalysis;
  stalledSession?: StalledSession;
  targetScore?: number;
  maxIterations?: number;
}

/**
 * Optimization tracking record
 */
export interface OptimizationRecord {
  id: string;
  sessionId: string;
  folderId: string | null;
  trigger: OptimizationTrigger;
  startedAt: Date;
  completedAt: Date | null;
  status: "pending" | "running" | "completed" | "failed";
  iterations: number;
  initialScore: number | null;
  finalScore: number | null;
  suggestionsApplied: number;
  configApplied: boolean;
  error: string | null;
}

/**
 * Config update result
 */
export interface ConfigUpdateResult {
  success: boolean;
  sessionId: string;
  configId: string;
  changes: string[];
  error?: string;
}

/**
 * Config version snapshot for tracking and rollback
 */
export interface ConfigVersionSnapshot {
  id: string;
  sessionId: string;
  folderId: string | null;
  configId: string;
  version: number;
  content: string;
  provider: string;
  score: number | null;
  createdAt: Date;
  isRolledBack: boolean;
  rollbackReason?: string;
}

/**
 * Performance tracking for config versions
 */
export interface PerformanceTracker {
  sessionId: string;
  configVersionId: string;
  stallCount: number;
  errorCount: number;
  successCount: number;
  avgResponseTime: number | null;
  lastActivityAt: Date;
  degradationDetected: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory tracking (in production, use database)
// ─────────────────────────────────────────────────────────────────────────────

const optimizationRecords = new Map<string, OptimizationRecord>();
const sessionOptimizationCooldown = new Map<string, Date>();
const OPTIMIZATION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between optimizations

// Config version tracking
const configVersionSnapshots = new Map<string, ConfigVersionSnapshot>();
const sessionConfigVersions = new Map<string, string[]>(); // sessionId -> [versionId1, versionId2, ...]
const performanceTrackers = new Map<string, PerformanceTracker>();

// Degradation thresholds
const DEGRADATION_STALL_THRESHOLD = 3; // 3 stalls after config change = degradation
const DEGRADATION_ERROR_THRESHOLD = 5; // 5 errors after config change = degradation
const ROLLBACK_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes between rollbacks

// ─────────────────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trigger meta-agent optimization for a stalled session
 *
 * Called by MonitoringService when a session is detected as stalled.
 * Converts session context to TaskSpec/ProjectContext and triggers optimization.
 */
export async function triggerOptimizationForStalledSession(
  stalledSession: StalledSession,
  userId: string,
  analysis?: SessionAnalysis
): Promise<OptimizationRecord | null> {
  const { sessionId, sessionName, folderId } = stalledSession;

  // Check cooldown to avoid over-optimization
  const lastOptimization = sessionOptimizationCooldown.get(sessionId);
  if (lastOptimization && Date.now() - lastOptimization.getTime() < OPTIMIZATION_COOLDOWN_MS) {
    console.log(
      `[MetaAgentOrchestrator] Skipping optimization for ${sessionId} - in cooldown period`
    );
    return null;
  }

  // Get session details
  const session = await db
    .select()
    .from(terminalSessions)
    .where(eq(terminalSessions.id, sessionId))
    .limit(1);

  if (session.length === 0) {
    console.error(`[MetaAgentOrchestrator] Session ${sessionId} not found`);
    return null;
  }

  const sessionData = session[0];

  // Skip if no agent provider (plain terminal sessions)
  if (!sessionData.agentProvider || sessionData.agentProvider === "none") {
    console.log(`[MetaAgentOrchestrator] Skipping ${sessionId} - no agent provider`);
    return null;
  }

  // Create optimization record
  const recordId = `opt-${sessionId}-${Date.now()}`;
  const record: OptimizationRecord = {
    id: recordId,
    sessionId,
    folderId,
    trigger: "stall_detected",
    startedAt: new Date(),
    completedAt: null,
    status: "pending",
    iterations: 0,
    initialScore: null,
    finalScore: null,
    suggestionsApplied: 0,
    configApplied: false,
    error: null,
  };

  optimizationRecords.set(recordId, record);
  sessionOptimizationCooldown.set(sessionId, new Date());

  // Build task spec from analysis
  const task = buildTaskSpecFromAnalysis(sessionId, sessionName, analysis);

  // Build project context
  const context = await buildProjectContext(sessionData, folderId, userId);

  // Trigger optimization in background
  runOptimizationAsync(record, task, context, sessionData.agentProvider as AgentProviderType, userId)
    .then((result) => {
      if (result) {
        record.status = "completed";
        record.completedAt = new Date();
        record.iterations = result.iterations;
        record.finalScore = result.finalScore;
        console.log(
          `[MetaAgentOrchestrator] Optimization completed for ${sessionId}: score ${result.finalScore}`
        );
      }
    })
    .catch((error) => {
      record.status = "failed";
      record.completedAt = new Date();
      record.error = error instanceof Error ? error.message : String(error);
      console.error(`[MetaAgentOrchestrator] Optimization failed for ${sessionId}:`, error);
    });

  return record;
}

/**
 * Trigger optimization based on error patterns from intelligence service
 */
export async function triggerOptimizationForErrorPatterns(
  sessionId: string,
  userId: string,
  analysis: SessionAnalysis
): Promise<OptimizationRecord | null> {
  // Only trigger if we have significant error patterns
  const errorCount = analysis.errorsEncountered.length;
  const unfixedErrors = errorCount - analysis.errorsFixes.length;

  if (unfixedErrors < 3) {
    // Not enough unfixed errors to warrant optimization
    return null;
  }

  // Check cooldown
  const lastOptimization = sessionOptimizationCooldown.get(sessionId);
  if (lastOptimization && Date.now() - lastOptimization.getTime() < OPTIMIZATION_COOLDOWN_MS) {
    return null;
  }

  // Get session details
  const session = await db
    .select()
    .from(terminalSessions)
    .where(eq(terminalSessions.id, sessionId))
    .limit(1);

  if (session.length === 0 || !session[0].agentProvider) {
    return null;
  }

  const sessionData = session[0];

  // Create record
  const recordId = `opt-${sessionId}-${Date.now()}`;
  const record: OptimizationRecord = {
    id: recordId,
    sessionId,
    folderId: sessionData.folderId,
    trigger: "error_pattern",
    startedAt: new Date(),
    completedAt: null,
    status: "pending",
    iterations: 0,
    initialScore: null,
    finalScore: null,
    suggestionsApplied: 0,
    configApplied: false,
    error: null,
  };

  optimizationRecords.set(recordId, record);
  sessionOptimizationCooldown.set(sessionId, new Date());

  const task = buildTaskSpecFromAnalysis(sessionId, sessionData.name, analysis);
  const context = await buildProjectContext(sessionData, sessionData.folderId, userId);

  // Run async
  runOptimizationAsync(record, task, context, sessionData.agentProvider as AgentProviderType, userId).catch(
    console.error
  );

  return record;
}

/**
 * Get refinement suggestions based on session analysis
 *
 * Used by the meta-agent to guide the IMPROVE phase.
 */
export function generateRefinementSuggestionsFromAnalysis(
  analysis: SessionAnalysis,
  _currentConfig: AgentConfig // Reserved for future config-aware suggestions
): RefinementSuggestion[] {
  const suggestions: RefinementSuggestion[] = [];
  const timestamp = Date.now();

  // Suggest adding gotchas to instructions
  for (const gotcha of analysis.gotchas.filter((g) => g.confidence >= 0.6)) {
    suggestions.push({
      id: `sug-gotcha-${timestamp}-${suggestions.length}`,
      target: "instructions",
      changeType: "add",
      suggestedValue: `\n\n## Gotcha\n${gotcha.content}`,
      rationale: `Agent encountered this issue: ${gotcha.context}`,
      expectedImpact: 0.1,
      confidence: gotcha.confidence,
      source: "benchmark_analysis",
    });
  }

  // Suggest adding patterns to system prompt
  for (const pattern of analysis.patterns.filter((p) => p.confidence >= 0.7)) {
    suggestions.push({
      id: `sug-pattern-${timestamp}-${suggestions.length}`,
      target: "system_prompt",
      changeType: "add",
      suggestedValue: `\n\nPreferred pattern: ${pattern.content}`,
      rationale: `This pattern was successful: ${pattern.context}`,
      expectedImpact: 0.05,
      confidence: pattern.confidence,
      source: "learned_pattern",
    });
  }

  // Suggest error fixes as constraints
  for (const fix of analysis.errorsFixes.slice(0, 5)) {
    suggestions.push({
      id: `sug-fix-${timestamp}-${suggestions.length}`,
      target: "instructions",
      changeType: "add",
      suggestedValue: `\n\n## Troubleshooting\n- If you see "${fix.error.slice(0, 80)}...", try: \`${fix.fix}\``,
      rationale: "This error was encountered and fixed during the session",
      expectedImpact: 0.15,
      confidence: 0.8,
      source: "benchmark_analysis",
    });
  }

  // If agent is stalling, suggest more explicit task breakdown
  if (analysis.commandsRun.length < 5 && analysis.filesModified.length === 0) {
    suggestions.push({
      id: `sug-breakdown-${timestamp}`,
      target: "system_prompt",
      changeType: "add",
      suggestedValue:
        "\n\nIMPORTANT: Break tasks into small, concrete steps. Execute one step at a time. Show progress after each step.",
      rationale: "Session showed minimal activity - may need clearer task structure",
      expectedImpact: 0.2,
      confidence: 0.6,
      source: "benchmark_analysis",
    });
  }

  return suggestions;
}

/**
 * Apply optimized config to a running session
 *
 * Updates the session's config file (CLAUDE.md, AGENTS.md, etc.) with
 * the improved configuration from the meta-agent.
 */
export async function applyConfigToSession(
  sessionId: string,
  config: AgentConfig,
  userId: string,
  score?: number
): Promise<ConfigUpdateResult> {
  // Get session
  const session = await db
    .select()
    .from(terminalSessions)
    .where(
      and(eq(terminalSessions.id, sessionId), eq(terminalSessions.userId, userId))
    )
    .limit(1);

  if (session.length === 0) {
    return {
      success: false,
      sessionId,
      configId: config.id,
      changes: [],
      error: "Session not found",
    };
  }

  const sessionData = session[0];
  if (!sessionData.projectPath) {
    return {
      success: false,
      sessionId,
      configId: config.id,
      changes: [],
      error: "Session has no project path",
    };
  }

  // Determine config file based on provider
  const configFileName = getConfigFileName(config.provider);
  const configPath = `${sessionData.projectPath}/${configFileName}`;

  const changes: string[] = [];

  try {
    // Import fs dynamically (server-side only)
    const fs = await import("fs/promises");
    const { existsSync } = await import("fs");

    // Create snapshot of current config BEFORE applying changes
    const snapshot = await createConfigSnapshot(
      sessionId,
      sessionData.folderId,
      config.id,
      config.provider,
      score ?? null
    );
    if (snapshot) {
      changes.push(`Created config snapshot v${snapshot.version}`);
    }

    // Read existing config
    let existingContent = "";
    if (existsSync(configPath)) {
      existingContent = await fs.readFile(configPath, "utf-8");
    }

    // Generate updated content
    const updatedContent = mergeConfigContent(
      existingContent,
      config.instructionsFile,
      config.systemPrompt
    );

    // Write updated config
    await fs.writeFile(configPath, updatedContent, "utf-8");
    changes.push(`Updated ${configFileName}`);

    // Update optimization record if exists
    const records = Array.from(optimizationRecords.values()).filter(
      (r) => r.sessionId === sessionId && r.status === "completed" && !r.configApplied
    );

    for (const record of records) {
      record.configApplied = true;
    }

    console.log(`[MetaAgentOrchestrator] Applied config to ${sessionId}: ${configFileName}`);

    return {
      success: true,
      sessionId,
      configId: config.id,
      changes,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[MetaAgentOrchestrator] Failed to apply config to ${sessionId}:`, error);

    return {
      success: false,
      sessionId,
      configId: config.id,
      changes,
      error: errorMsg,
    };
  }
}

/**
 * Get optimization history for a session or folder
 */
export function getOptimizationHistory(
  sessionId?: string,
  folderId?: string,
  limit: number = 10
): OptimizationRecord[] {
  let records = Array.from(optimizationRecords.values());

  if (sessionId) {
    records = records.filter((r) => r.sessionId === sessionId);
  }

  if (folderId) {
    records = records.filter((r) => r.folderId === folderId);
  }

  // Sort by startedAt descending
  records.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  return records.slice(0, limit);
}

/**
 * Get pending or running optimizations
 */
export function getActiveOptimizations(): OptimizationRecord[] {
  return Array.from(optimizationRecords.values()).filter(
    (r) => r.status === "pending" || r.status === "running"
  );
}

/**
 * Cancel a running optimization
 */
export function cancelOptimization(recordId: string): boolean {
  const record = optimizationRecords.get(recordId);
  if (!record || record.status !== "pending" && record.status !== "running") {
    return false;
  }

  record.status = "failed";
  record.completedAt = new Date();
  record.error = "Cancelled by user";

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build TaskSpec from session analysis
 */
function buildTaskSpecFromAnalysis(
  sessionId: string,
  sessionName: string,
  analysis?: SessionAnalysis
): TaskSpec {
  const task: TaskSpec = {
    id: `task-${sessionId}`,
    type: "feature", // Default to feature; could infer from session context
    description: `Continue work in session: ${sessionName}`,
    acceptanceCriteria: [],
    complexity: 5,
    relevantFiles: analysis?.filesModified || [],
    constraints: [],
  };

  // Add constraints from errors
  if (analysis?.errorsEncountered) {
    for (const error of analysis.errorsEncountered.slice(0, 3)) {
      task.constraints?.push(`Avoid error: ${error.slice(0, 100)}`);
    }
  }

  // Add acceptance criteria from patterns
  if (analysis?.patterns) {
    for (const pattern of analysis.patterns.filter((p) => p.confidence >= 0.7).slice(0, 3)) {
      task.acceptanceCriteria?.push(`Follow pattern: ${pattern.content}`);
    }
  }

  return task;
}

/**
 * Build ProjectContext from session data
 */
async function buildProjectContext(
  session: { projectPath: string | null; folderId: string | null; agentProvider: string | null },
  folderId: string | null,
  _userId: string // Reserved for user-specific context in future
): Promise<ProjectContext> {
  const context: ProjectContext = {
    projectPath: session.projectPath || "/tmp",
    projectType: "unknown",
    language: "typescript", // Default; could detect from project
    frameworks: [],
    packageManager: "bun",
    hasCI: false,
    folderId: folderId || undefined,
  };

  // Try to get folder info for more context
  if (folderId) {
    const folder = await db
      .select()
      .from(sessionFolders)
      .where(eq(sessionFolders.id, folderId))
      .limit(1);

    if (folder.length > 0 && folder[0].path) {
      context.projectPath = folder[0].path;
    }
  }

  // TODO: Detect project type from package.json, Cargo.toml, etc.
  // For now, infer from common patterns
  if (context.projectPath.includes("next") || context.projectPath.includes("Next")) {
    context.projectType = "nextjs";
    context.frameworks.push("next.js", "react");
  }

  return context;
}

/**
 * Run optimization asynchronously
 */
async function runOptimizationAsync(
  record: OptimizationRecord,
  task: TaskSpec,
  context: ProjectContext,
  provider: AgentProviderType,
  userId: string
): Promise<OptimizationResult | null> {
  record.status = "running";

  try {
    // Call the meta-agent API
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const response = await fetch(`${baseUrl}/api/sdk/meta`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // In a real implementation, we'd use proper auth
        "X-User-Id": userId,
      },
      body: JSON.stringify({
        task: {
          id: task.id,
          taskType: task.type,
          description: task.description,
          acceptanceCriteria: task.acceptanceCriteria || [],
          complexity: task.complexity,
          relevantFiles: task.relevantFiles || [],
          constraints: task.constraints || [],
        },
        context: {
          projectPath: context.projectPath,
          projectType: context.projectType,
          language: context.language,
          frameworks: context.frameworks,
          packageManager: context.packageManager,
          testFramework: context.testFramework,
          linter: context.linter,
          hasCi: context.hasCI,
          currentBranch: context.currentBranch,
          folderId: context.folderId,
        },
        options: {
          maxIterations: 3,
          targetScore: 0.8,
          minImprovement: 0.05,
          timeoutSeconds: 300,
          verbose: true,
          dryRun: false,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Meta-agent API returned ${response.status}`);
    }

    const result = await response.json() as OptimizationResult & { resultId?: string };

    record.iterations = result.iterations;
    record.finalScore = result.finalScore;

    // Apply the optimized config if we got a good result
    if (result.finalScore >= 0.7 && result.config) {
      const applyResult = await applyConfigToSession(
        record.sessionId,
        result.config,
        userId,
        result.finalScore
      );
      record.configApplied = applyResult.success;
    }

    return result;
  } catch (error) {
    record.status = "failed";
    record.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

/**
 * Get config file name for agent provider
 */
function getConfigFileName(provider: string): string {
  switch (provider) {
    case "claude":
      return "CLAUDE.md";
    case "codex":
      return "AGENTS.md";
    case "gemini":
      return "GEMINI.md";
    case "opencode":
      return "OPENCODE.md";
    default:
      return "AGENT.md";
  }
}

/**
 * Merge existing config content with new content
 */
function mergeConfigContent(
  existing: string,
  instructions: string,
  systemPrompt: string
): string {
  const lines: string[] = [];

  // Keep existing content but mark what's been added
  if (existing.trim()) {
    lines.push(existing.trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Add optimization section
  lines.push("## Meta-Agent Optimizations");
  lines.push("");
  lines.push(`> Auto-generated by meta-agent on ${new Date().toISOString().split("T")[0]}`);
  lines.push("");

  // Add system prompt additions if any
  if (systemPrompt && !existing.includes(systemPrompt.slice(0, 50))) {
    lines.push("### System Context");
    lines.push("");
    lines.push(systemPrompt);
    lines.push("");
  }

  // Add instruction additions if any
  if (instructions && !existing.includes(instructions.slice(0, 50))) {
    lines.push("### Additional Instructions");
    lines.push("");
    lines.push(instructions);
    lines.push("");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for Monitoring Service Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook for MonitoringService to call when stalls are detected
 *
 * This is the main integration point - call this from the stall detection loop.
 */
export async function onStalledSessionDetected(
  stalledSession: StalledSession,
  userId: string
): Promise<void> {
  const { sessionId, stalledMinutes } = stalledSession;

  // Record stall event for performance tracking
  recordPerformanceEvent(sessionId, "stall");

  // Check for auto-rollback on performance degradation
  const rolledBack = await checkAndAutoRollback(sessionId, userId);
  if (rolledBack) {
    console.log(
      `[MetaAgentOrchestrator] Auto-rolled back config for ${sessionId} due to degradation`
    );
    return; // Don't trigger optimization after rollback
  }

  // Only trigger optimization if session has been stalled for a significant time
  if (stalledMinutes < 10) {
    return;
  }

  // Try to get analysis from intelligence service
  let analysis: SessionAnalysis | undefined;
  try {
    const { analyzeSession } = await import("./orchestrator-intelligence-service");
    analysis = await analyzeSession(
      stalledSession.sessionId,
      stalledSession.tmuxSessionName,
      "", // projectPath - will be resolved
      "claude" // Default agent; would be detected in production
    );
  } catch (error) {
    console.warn("[MetaAgentOrchestrator] Failed to analyze session:", error);
  }

  // Trigger optimization
  await triggerOptimizationForStalledSession(stalledSession, userId, analysis);
}

/**
 * Hook for IntelligenceService to call on task complete
 *
 * Checks if optimization would benefit based on analysis results.
 */
export async function onTaskCompleteAnalysis(
  sessionId: string,
  userId: string,
  analysis: SessionAnalysis
): Promise<void> {
  // Record error events for performance tracking
  for (let i = 0; i < analysis.errorsEncountered.length; i++) {
    recordPerformanceEvent(sessionId, "error");
  }

  // Record success events for fixed errors
  for (let i = 0; i < analysis.errorsFixes.length; i++) {
    recordPerformanceEvent(sessionId, "success");
  }

  // Check for auto-rollback on performance degradation
  const rolledBack = await checkAndAutoRollback(sessionId, userId);
  if (rolledBack) {
    console.log(
      `[MetaAgentOrchestrator] Auto-rolled back config for ${sessionId} due to errors`
    );
    return;
  }

  // Check if there were many unfixed errors - trigger optimization
  const unfixedErrors = analysis.errorsEncountered.length - analysis.errorsFixes.length;
  if (unfixedErrors >= 3) {
    await triggerOptimizationForErrorPatterns(sessionId, userId, analysis);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Version Tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a snapshot of the current config before applying changes
 */
export async function createConfigSnapshot(
  sessionId: string,
  folderId: string | null,
  configId: string,
  provider: string,
  score: number | null
): Promise<ConfigVersionSnapshot | null> {
  // Get session to find project path
  const session = await db
    .select()
    .from(terminalSessions)
    .where(eq(terminalSessions.id, sessionId))
    .limit(1);

  if (session.length === 0 || !session[0].projectPath) {
    return null;
  }

  const configFileName = getConfigFileName(provider);
  const configPath = `${session[0].projectPath}/${configFileName}`;

  try {
    const fs = await import("fs/promises");
    const { existsSync } = await import("fs");

    let content = "";
    if (existsSync(configPath)) {
      content = await fs.readFile(configPath, "utf-8");
    }

    // Get existing versions for this session
    const existingVersions = sessionConfigVersions.get(sessionId) || [];
    const version = existingVersions.length + 1;

    const snapshot: ConfigVersionSnapshot = {
      id: `snapshot-${sessionId}-${Date.now()}`,
      sessionId,
      folderId,
      configId,
      version,
      content,
      provider,
      score,
      createdAt: new Date(),
      isRolledBack: false,
    };

    // Store snapshot
    configVersionSnapshots.set(snapshot.id, snapshot);

    // Update session version list
    existingVersions.push(snapshot.id);
    sessionConfigVersions.set(sessionId, existingVersions);

    // Initialize performance tracker for this version
    performanceTrackers.set(snapshot.id, {
      sessionId,
      configVersionId: snapshot.id,
      stallCount: 0,
      errorCount: 0,
      successCount: 0,
      avgResponseTime: null,
      lastActivityAt: new Date(),
      degradationDetected: false,
    });

    console.log(
      `[MetaAgentOrchestrator] Created config snapshot v${version} for session ${sessionId}`
    );

    return snapshot;
  } catch (error) {
    console.error("[MetaAgentOrchestrator] Failed to create config snapshot:", error);
    return null;
  }
}

/**
 * Record performance event for the current config version
 */
export function recordPerformanceEvent(
  sessionId: string,
  eventType: "stall" | "error" | "success",
  responseTimeMs?: number
): void {
  // Get current version for session
  const versionIds = sessionConfigVersions.get(sessionId) || [];
  if (versionIds.length === 0) {
    return; // No tracked versions
  }

  const currentVersionId = versionIds[versionIds.length - 1];
  const tracker = performanceTrackers.get(currentVersionId);
  if (!tracker) {
    return;
  }

  // Update counters
  switch (eventType) {
    case "stall":
      tracker.stallCount++;
      break;
    case "error":
      tracker.errorCount++;
      break;
    case "success":
      tracker.successCount++;
      break;
  }

  // Update avg response time
  if (responseTimeMs !== undefined) {
    if (tracker.avgResponseTime === null) {
      tracker.avgResponseTime = responseTimeMs;
    } else {
      // Running average
      tracker.avgResponseTime = (tracker.avgResponseTime + responseTimeMs) / 2;
    }
  }

  tracker.lastActivityAt = new Date();

  // Check for degradation
  if (
    tracker.stallCount >= DEGRADATION_STALL_THRESHOLD ||
    tracker.errorCount >= DEGRADATION_ERROR_THRESHOLD
  ) {
    tracker.degradationDetected = true;
    console.warn(
      `[MetaAgentOrchestrator] Degradation detected for session ${sessionId}: ` +
        `${tracker.stallCount} stalls, ${tracker.errorCount} errors`
    );
  }
}

/**
 * Check if the current config version is degraded and should be rolled back
 */
export function shouldRollback(sessionId: string): boolean {
  const versionIds = sessionConfigVersions.get(sessionId) || [];
  if (versionIds.length < 2) {
    // Need at least 2 versions to rollback
    return false;
  }

  const currentVersionId = versionIds[versionIds.length - 1];
  const tracker = performanceTrackers.get(currentVersionId);
  if (!tracker) {
    return false;
  }

  return tracker.degradationDetected;
}

/**
 * Rollback to the previous config version
 */
export async function rollbackConfig(
  sessionId: string,
  userId: string,
  reason: string
): Promise<{ success: boolean; rolledBackTo: number | null; error?: string }> {
  const versionIds = sessionConfigVersions.get(sessionId) || [];
  if (versionIds.length < 2) {
    return {
      success: false,
      rolledBackTo: null,
      error: "No previous version to rollback to",
    };
  }

  // Get current and previous versions
  const currentVersionId = versionIds[versionIds.length - 1];
  const previousVersionId = versionIds[versionIds.length - 2];

  const currentSnapshot = configVersionSnapshots.get(currentVersionId);
  const previousSnapshot = configVersionSnapshots.get(previousVersionId);

  if (!currentSnapshot || !previousSnapshot) {
    return {
      success: false,
      rolledBackTo: null,
      error: "Config snapshots not found",
    };
  }

  // Get session
  const session = await db
    .select()
    .from(terminalSessions)
    .where(
      and(eq(terminalSessions.id, sessionId), eq(terminalSessions.userId, userId))
    )
    .limit(1);

  if (session.length === 0 || !session[0].projectPath) {
    return {
      success: false,
      rolledBackTo: null,
      error: "Session not found or no project path",
    };
  }

  const configFileName = getConfigFileName(previousSnapshot.provider);
  const configPath = `${session[0].projectPath}/${configFileName}`;

  try {
    const fs = await import("fs/promises");

    // Write previous config content
    await fs.writeFile(configPath, previousSnapshot.content, "utf-8");

    // Mark current version as rolled back
    currentSnapshot.isRolledBack = true;
    currentSnapshot.rollbackReason = reason;

    // Remove current version from active list (keep in snapshots for history)
    versionIds.pop();
    sessionConfigVersions.set(sessionId, versionIds);

    // Reset performance tracker for previous version
    const previousTracker = performanceTrackers.get(previousVersionId);
    if (previousTracker) {
      previousTracker.stallCount = 0;
      previousTracker.errorCount = 0;
      previousTracker.degradationDetected = false;
      previousTracker.lastActivityAt = new Date();
    }

    console.log(
      `[MetaAgentOrchestrator] Rolled back ${sessionId} from v${currentSnapshot.version} to v${previousSnapshot.version}: ${reason}`
    );

    return {
      success: true,
      rolledBackTo: previousSnapshot.version,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("[MetaAgentOrchestrator] Rollback failed:", error);
    return {
      success: false,
      rolledBackTo: null,
      error: errorMsg,
    };
  }
}

/**
 * Get config version history for a session
 */
export function getConfigVersionHistory(sessionId: string): ConfigVersionSnapshot[] {
  const versionIds = sessionConfigVersions.get(sessionId) || [];
  const snapshots: ConfigVersionSnapshot[] = [];

  for (const id of versionIds) {
    const snapshot = configVersionSnapshots.get(id);
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }

  return snapshots;
}

/**
 * Get performance correlation data for config versions
 */
export function getPerformanceCorrelation(
  sessionId: string
): Array<{
  version: number;
  configId: string;
  score: number | null;
  stallCount: number;
  errorCount: number;
  successCount: number;
  degraded: boolean;
}> {
  const versionIds = sessionConfigVersions.get(sessionId) || [];
  const correlation: Array<{
    version: number;
    configId: string;
    score: number | null;
    stallCount: number;
    errorCount: number;
    successCount: number;
    degraded: boolean;
  }> = [];

  for (const id of versionIds) {
    const snapshot = configVersionSnapshots.get(id);
    const tracker = performanceTrackers.get(id);

    if (snapshot) {
      correlation.push({
        version: snapshot.version,
        configId: snapshot.configId,
        score: snapshot.score,
        stallCount: tracker?.stallCount || 0,
        errorCount: tracker?.errorCount || 0,
        successCount: tracker?.successCount || 0,
        degraded: tracker?.degradationDetected || false,
      });
    }
  }

  return correlation;
}

/**
 * Auto-rollback check - call this from stall detection to trigger automatic rollback
 */
export async function checkAndAutoRollback(
  sessionId: string,
  userId: string
): Promise<boolean> {
  if (!shouldRollback(sessionId)) {
    return false;
  }

  // Check rollback cooldown
  const lastRollbackKey = `rollback-${sessionId}`;
  const lastRollback = sessionOptimizationCooldown.get(lastRollbackKey);
  if (lastRollback && Date.now() - lastRollback.getTime() < ROLLBACK_COOLDOWN_MS) {
    console.log(`[MetaAgentOrchestrator] Skipping auto-rollback for ${sessionId} - in cooldown`);
    return false;
  }

  const result = await rollbackConfig(
    sessionId,
    userId,
    "Auto-rollback due to performance degradation"
  );

  if (result.success) {
    sessionOptimizationCooldown.set(lastRollbackKey, new Date());
    return true;
  }

  return false;
}
