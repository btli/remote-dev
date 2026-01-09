/**
 * OversightService - Asynchronous safety monitoring and intervention.
 *
 * Responsibilities:
 * - Run pattern detectors against active delegations
 * - Generate OverseerCheck results
 * - Determine intervention level
 * - Execute interventions (warn, redirect, pause, terminate)
 */

import { db } from "@/db";
import { delegations, tasks, terminalSessions } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { DelegationStatusType } from "@/db/schema";
import * as TmuxService from "@/services/tmux-service";
import {
  OverseerCheck,
  type OverseerObservations,
  type OverseerIssue,
  type InterventionType,
  type OversightConfig,
  DEFAULT_OVERSIGHT_CONFIG,
} from "@/domain/entities/OverseerCheck";
import {
  loopDetector,
  costDetector,
  errorDetector,
  deviationDetector,
  safetyDetector,
  type DetectorContext,
  type PatternDetector,
} from "@/lib/pattern-detectors";
import { createHash } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// State Management
// ─────────────────────────────────────────────────────────────────────────────

interface DelegationOversightState {
  delegationId: string;
  taskDescription: string;
  taskType: string;
  startTime: Date;
  observationHistory: OverseerObservations[];
  checkHistory: OverseerCheck[];
}

// In-memory state for active oversights
const oversightStates = new Map<string, DelegationOversightState>();

// ─────────────────────────────────────────────────────────────────────────────
// Detector Registry
// ─────────────────────────────────────────────────────────────────────────────

const detectors: PatternDetector[] = [
  loopDetector,
  costDetector,
  errorDetector,
  deviationDetector,
  safetyDetector,
];

// ─────────────────────────────────────────────────────────────────────────────
// Service Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Perform an oversight check on a delegation.
 */
export async function checkDelegation(
  delegationId: string,
  config: OversightConfig = DEFAULT_OVERSIGHT_CONFIG
): Promise<OverseerCheck | null> {
  if (!config.enabled) return null;

  // Get delegation info
  const delegationResult = await db
    .select({
      id: delegations.id,
      taskId: delegations.taskId,
      sessionId: delegations.sessionId,
      status: delegations.status,
      agentProvider: delegations.agentProvider,
      createdAt: delegations.createdAt,
    })
    .from(delegations)
    .where(eq(delegations.id, delegationId))
    .limit(1);

  if (delegationResult.length === 0) return null;

  const delegation = delegationResult[0];

  // Only check active delegations
  const activeStatuses: DelegationStatusType[] = ["running", "monitoring"];
  if (!activeStatuses.includes(delegation.status as DelegationStatusType)) {
    return null;
  }

  // Get task info
  const taskResult = await db
    .select({
      description: tasks.description,
      type: tasks.type,
    })
    .from(tasks)
    .where(eq(tasks.id, delegation.taskId))
    .limit(1);

  if (taskResult.length === 0) return null;

  const task = taskResult[0];

  // Get session info for scrollback
  const sessionResult = await db
    .select({
      tmuxSessionName: terminalSessions.tmuxSessionName,
    })
    .from(terminalSessions)
    .where(eq(terminalSessions.id, delegation.sessionId))
    .limit(1);

  if (sessionResult.length === 0) return null;

  const session = sessionResult[0];

  // Initialize or get oversight state
  let state = oversightStates.get(delegationId);
  if (!state) {
    state = {
      delegationId,
      taskDescription: task.description,
      taskType: task.type,
      startTime: delegation.createdAt,
      observationHistory: [],
      checkHistory: [],
    };
    oversightStates.set(delegationId, state);
  }

  // Collect observations
  const observations = await collectObservations(
    session.tmuxSessionName,
    state.startTime
  );

  // Create check entity
  let check = OverseerCheck.create({
    delegationId,
    observations,
  });

  // Build detector context
  const context: DetectorContext = {
    observations,
    history: state.observationHistory,
    config,
    taskDescription: task.description,
    taskType: task.type,
  };

  // Run all detectors
  const allIssues: OverseerIssue[] = [];
  for (const detector of detectors) {
    try {
      const result = detector.detect(context);
      if (result.detected) {
        allIssues.push(...result.issues);
      }
    } catch (error) {
      console.error(`[OversightService] Detector ${detector.name} failed:`, error);
    }
  }

  // Add issues to check
  for (const issue of allIssues) {
    check = check.addIssue(issue);
  }

  // Determine intervention
  const intervention = determineIntervention(check.assessment.issues, config);
  if (intervention.type !== "none") {
    check = check.withIntervention(intervention);
  }

  // Update state
  state.observationHistory.push(observations);
  state.checkHistory.push(check);

  // Trim history to avoid memory bloat (keep last 20)
  if (state.observationHistory.length > 20) {
    state.observationHistory = state.observationHistory.slice(-20);
  }
  if (state.checkHistory.length > 20) {
    state.checkHistory = state.checkHistory.slice(-20);
  }

  return check;
}

/**
 * Execute an intervention on a delegation.
 */
export async function executeIntervention(
  check: OverseerCheck
): Promise<OverseerCheck> {
  const intervention = check.intervention;
  if (!intervention || intervention.type === "none") {
    return check;
  }

  console.log(
    `[OversightService] Executing ${intervention.type} intervention on delegation ${check.delegationId}`
  );

  try {
    switch (intervention.type) {
      case "warn":
        await executeWarnIntervention(check.delegationId, intervention.action);
        break;

      case "redirect":
        await executeRedirectIntervention(check.delegationId, intervention.action);
        break;

      case "pause":
        await executePauseIntervention(check.delegationId, intervention.reason);
        break;

      case "terminate":
        await executeTerminateIntervention(check.delegationId, intervention.reason);
        break;
    }

    return check.markInterventionExecuted();
  } catch (error) {
    console.error(
      `[OversightService] Failed to execute intervention:`,
      error
    );
    return check;
  }
}

/**
 * Clean up oversight state for a delegation.
 */
export function cleanupDelegation(delegationId: string): void {
  oversightStates.delete(delegationId);
}

/**
 * Get current oversight state for a delegation.
 */
export function getOversightState(
  delegationId: string
): DelegationOversightState | null {
  return oversightStates.get(delegationId) ?? null;
}

/**
 * Get all active oversight states.
 */
export function getActiveOversights(): string[] {
  return Array.from(oversightStates.keys());
}

// ─────────────────────────────────────────────────────────────────────────────
// Observation Collection
// ─────────────────────────────────────────────────────────────────────────────

async function collectObservations(
  tmuxSessionName: string,
  startTime: Date
): Promise<OverseerObservations> {
  let scrollback = "";
  try {
    scrollback = await TmuxService.capturePane(tmuxSessionName);
  } catch {
    // Session may have ended
  }

  // Calculate scrollback hash
  const scrollbackHash = createHash("md5")
    .update(scrollback)
    .digest("hex");

  // Extract command history from scrollback (basic parsing)
  const commandHistory = extractCommands(scrollback);

  // Extract files modified (from git status or similar output)
  const filesModified = extractFilesModified(scrollback);

  // Count errors in scrollback
  const errorCount = countErrors(scrollback);

  // Calculate time elapsed
  const timeElapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);

  return {
    scrollbackHash,
    scrollbackLength: scrollback.length,
    lastActionTime: new Date(),
    repeatPatternDetected: false, // Will be set by loop detector
    errorCount,
    costAccumulated: 0, // TODO: Integrate with token tracking
    timeElapsed,
    commandHistory,
    filesModified,
  };
}

/**
 * Extract commands from scrollback (simple heuristic).
 */
function extractCommands(scrollback: string): string[] {
  const commands: string[] = [];
  const lines = scrollback.split("\n");

  for (const line of lines) {
    // Look for prompt patterns followed by commands
    const match = line.match(/^\s*[$#>]\s*(.+)$/);
    if (match && match[1].trim()) {
      commands.push(match[1].trim());
    }
  }

  return commands.slice(-20); // Keep last 20 commands
}

/**
 * Extract modified files from scrollback.
 */
function extractFilesModified(scrollback: string): string[] {
  const files = new Set<string>();

  // Look for git status output
  const gitModified = scrollback.match(/modified:\s+(.+)/g);
  if (gitModified) {
    for (const match of gitModified) {
      const file = match.replace("modified:", "").trim();
      files.add(file);
    }
  }

  // Look for file paths in common patterns
  const filePatterns = scrollback.match(/(?:src|lib|test|app)\/[^\s:]+\.[a-z]+/gi);
  if (filePatterns) {
    for (const file of filePatterns) {
      files.add(file);
    }
  }

  return Array.from(files);
}

/**
 * Count error patterns in scrollback.
 */
function countErrors(scrollback: string): number {
  let count = 0;

  const errorPatterns = [
    /error:/gi,
    /Error:/g,
    /ERROR/g,
    /failed/gi,
    /exception/gi,
    /TypeError/g,
    /SyntaxError/g,
    /ReferenceError/g,
    /ENOENT/g,
    /EPERM/g,
  ];

  for (const pattern of errorPatterns) {
    const matches = scrollback.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }

  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intervention Logic
// ─────────────────────────────────────────────────────────────────────────────

interface InterventionDecision {
  type: InterventionType;
  reason: string;
  action: string;
}

function determineIntervention(
  issues: OverseerIssue[],
  config: OversightConfig
): InterventionDecision {
  if (issues.length === 0) {
    return { type: "none", reason: "", action: "" };
  }

  // Find highest severity issue
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...issues].sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );
  const highest = sorted[0];

  // Determine intervention based on severity
  switch (highest.severity) {
    case "critical":
      if (highest.type === "safety_violation") {
        // Safety violations always terminate
        return {
          type: "terminate",
          reason: `Safety violation: ${highest.description}`,
          action: "Session terminated due to safety concern",
        };
      }
      // Other critical issues: terminate if autoTerminate, otherwise pause
      return config.autoTerminate
        ? {
            type: "terminate",
            reason: highest.description,
            action: "Session terminated due to critical issue",
          }
        : {
            type: "pause",
            reason: highest.description,
            action: "Session paused for human review",
          };

    case "high":
      return {
        type: "redirect",
        reason: highest.description,
        action: generateRedirectPrompt(highest),
      };

    case "medium":
      return {
        type: "warn",
        reason: highest.description,
        action: generateWarningPrompt(highest),
      };

    case "low":
      // Just log, no intervention
      return { type: "none", reason: "", action: "" };

    default:
      return { type: "none", reason: "", action: "" };
  }
}

function generateWarningPrompt(issue: OverseerIssue): string {
  return `⚠️ OVERSIGHT WARNING: ${issue.description}. Please review your approach and ensure you're making progress on the task.`;
}

function generateRedirectPrompt(issue: OverseerIssue): string {
  const prompts: Record<string, string> = {
    infinite_loop:
      "You appear to be in a loop. Please stop, analyze the situation, and try a different approach.",
    cost_runaway:
      "You are approaching cost limits. Please wrap up the current task efficiently.",
    time_runaway:
      "You are approaching time limits. Please prioritize completing the most important parts of the task.",
    error_spiral:
      "You have encountered many errors. Please step back, analyze the root cause, and address it before proceeding.",
    task_deviation:
      "You may be working on unrelated items. Please refocus on the original task.",
    safety_violation:
      "A safety concern was detected. Please avoid dangerous operations.",
    stall_detected:
      "Progress appears stalled. Please explain what's blocking you or try an alternative approach.",
  };

  return prompts[issue.type] ?? `Please address: ${issue.description}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intervention Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeWarnIntervention(
  delegationId: string,
  message: string
): Promise<void> {
  // Get session for this delegation
  const result = await db
    .select({
      sessionId: delegations.sessionId,
    })
    .from(delegations)
    .where(eq(delegations.id, delegationId))
    .limit(1);

  if (result.length === 0) return;

  const sessionResult = await db
    .select({
      tmuxSessionName: terminalSessions.tmuxSessionName,
    })
    .from(terminalSessions)
    .where(eq(terminalSessions.id, result[0].sessionId))
    .limit(1);

  if (sessionResult.length === 0) return;

  // Inject warning into session
  try {
    await TmuxService.sendKeys(sessionResult[0].tmuxSessionName, `echo "${message}"`);
    await TmuxService.sendKeys(sessionResult[0].tmuxSessionName, "Enter");
  } catch {
    console.error("[OversightService] Failed to inject warning");
  }
}

async function executeRedirectIntervention(
  delegationId: string,
  prompt: string
): Promise<void> {
  // Similar to warn but with stronger prompt
  await executeWarnIntervention(delegationId, `🔄 REDIRECT: ${prompt}`);
}

async function executePauseIntervention(
  delegationId: string,
  reason: string
): Promise<void> {
  console.log(`[OversightService] Pausing delegation ${delegationId}: ${reason}`);

  // Update delegation status to monitoring (paused state)
  await db
    .update(delegations)
    .set({
      status: "monitoring" as DelegationStatusType,
      updatedAt: new Date(),
    })
    .where(eq(delegations.id, delegationId));

  // TODO: Send notification to user about pause
}

async function executeTerminateIntervention(
  delegationId: string,
  reason: string
): Promise<void> {
  console.log(
    `[OversightService] Terminating delegation ${delegationId}: ${reason}`
  );

  // Get session info
  const result = await db
    .select({
      sessionId: delegations.sessionId,
      taskId: delegations.taskId,
    })
    .from(delegations)
    .where(eq(delegations.id, delegationId))
    .limit(1);

  if (result.length === 0) return;

  const { sessionId, taskId } = result[0];

  // Get tmux session name
  const sessionResult = await db
    .select({
      tmuxSessionName: terminalSessions.tmuxSessionName,
    })
    .from(terminalSessions)
    .where(eq(terminalSessions.id, sessionId))
    .limit(1);

  // Kill tmux session if it exists
  if (sessionResult.length > 0) {
    try {
      await TmuxService.killSession(sessionResult[0].tmuxSessionName);
    } catch {
      // Session may already be gone
    }
  }

  // Update delegation status
  await db
    .update(delegations)
    .set({
      status: "failed" as DelegationStatusType,
      errorJson: JSON.stringify({
        code: "OVERSIGHT_TERMINATED",
        message: reason,
        exitCode: null,
        recoverable: false,
      }),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(delegations.id, delegationId));

  // Update task status
  await db
    .update(tasks)
    .set({
      status: "failed",
      errorJson: JSON.stringify({
        code: "OVERSIGHT_TERMINATED",
        message: reason,
        recoverable: false,
      }),
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  // Clean up oversight state
  cleanupDelegation(delegationId);
}
