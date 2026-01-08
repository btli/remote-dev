/**
 * Orchestrator Value Objects
 *
 * These value objects wrap the orchestrator type definitions with validation
 * and helper methods. They re-export the types from @/types/orchestrator.ts
 * to maintain a single source of truth.
 *
 * Note: Unlike SessionStatus which needs complex state machine logic,
 * orchestrator types are simple enums. We provide validation helpers
 * rather than full-fledged value object classes to avoid over-engineering.
 */

import type {
  OrchestratorType,
  OrchestratorStatus,
  OrchestratorScopeType,
  InsightType,
  InsightSeverity,
} from "@/types/orchestrator";

// Re-export types for convenience
export type {
  OrchestratorType,
  OrchestratorStatus,
  OrchestratorScopeType,
  InsightType,
  InsightSeverity,
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Valid orchestrator types
 */
export const ORCHESTRATOR_TYPES: readonly OrchestratorType[] = [
  "master",
  "sub_orchestrator",
] as const;

/**
 * Valid orchestrator statuses
 */
export const ORCHESTRATOR_STATUSES: readonly OrchestratorStatus[] = [
  "idle",
  "analyzing",
  "acting",
  "paused",
] as const;

/**
 * Valid insight types
 */
export const INSIGHT_TYPES: readonly InsightType[] = [
  "stall_detected",
  "performance",
  "error",
  "suggestion",
] as const;

/**
 * Valid insight severities
 */
export const INSIGHT_SEVERITIES: readonly InsightSeverity[] = [
  "info",
  "warning",
  "error",
  "critical",
] as const;

/**
 * Validate an orchestrator type.
 */
export function isValidOrchestratorType(value: unknown): value is OrchestratorType {
  return (
    typeof value === "string" &&
    (ORCHESTRATOR_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Validate an orchestrator status.
 */
export function isValidOrchestratorStatus(value: unknown): value is OrchestratorStatus {
  return (
    typeof value === "string" &&
    (ORCHESTRATOR_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Validate an orchestrator scope type.
 */
export function isValidOrchestratorScopeType(
  value: unknown
): value is OrchestratorScopeType {
  return value === "folder" || value === null;
}

/**
 * Validate an insight type.
 */
export function isValidInsightType(value: unknown): value is InsightType {
  return (
    typeof value === "string" && (INSIGHT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Validate an insight severity.
 */
export function isValidInsightSeverity(value: unknown): value is InsightSeverity {
  return (
    typeof value === "string" &&
    (INSIGHT_SEVERITIES as readonly string[]).includes(value)
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if orchestrator type is master.
 */
export function isMasterType(type: OrchestratorType): boolean {
  return type === "master";
}

/**
 * Check if orchestrator type is sub-orchestrator.
 */
export function isSubOrchestratorType(type: OrchestratorType): boolean {
  return type === "sub_orchestrator";
}

/**
 * Check if orchestrator status indicates active monitoring.
 */
export function isActiveStatus(status: OrchestratorStatus): boolean {
  return status !== "paused";
}

/**
 * Check if orchestrator status indicates monitoring activity.
 */
export function isMonitoringStatus(status: OrchestratorStatus): boolean {
  return status === "idle" || status === "analyzing";
}

/**
 * Check if insight severity is critical.
 */
export function isCriticalSeverity(severity: InsightSeverity): boolean {
  return severity === "critical";
}

/**
 * Check if insight severity indicates an error condition.
 */
export function isErrorSeverity(severity: InsightSeverity): boolean {
  return severity === "error" || severity === "critical";
}

/**
 * Check if insight severity is informational.
 */
export function isInfoSeverity(severity: InsightSeverity): boolean {
  return severity === "info";
}

/**
 * Get severity level as a number (for comparison).
 * Higher number = more severe.
 */
export function getSeverityLevel(severity: InsightSeverity): number {
  const levels: Record<InsightSeverity, number> = {
    info: 1,
    warning: 2,
    error: 3,
    critical: 4,
  };
  return levels[severity];
}

/**
 * Compare two severities.
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 */
export function compareSeverities(
  a: InsightSeverity,
  b: InsightSeverity
): -1 | 0 | 1 {
  const levelA = getSeverityLevel(a);
  const levelB = getSeverityLevel(b);
  if (levelA < levelB) return -1;
  if (levelA > levelB) return 1;
  return 0;
}

/**
 * Get display color for severity (for UI).
 */
export function getSeverityColor(severity: InsightSeverity): string {
  const colors: Record<InsightSeverity, string> = {
    info: "blue",
    warning: "yellow",
    error: "orange",
    critical: "red",
  };
  return colors[severity];
}

/**
 * Get display label for orchestrator type.
 */
export function getOrchestratorTypeLabel(type: OrchestratorType): string {
  const labels: Record<OrchestratorType, string> = {
    master: "Master Orchestrator",
    sub_orchestrator: "Project Orchestrator",
  };
  return labels[type];
}

/**
 * Get display label for orchestrator status.
 */
export function getOrchestratorStatusLabel(status: OrchestratorStatus): string {
  const labels: Record<OrchestratorStatus, string> = {
    idle: "Idle",
    analyzing: "Analyzing",
    acting: "Acting",
    paused: "Paused",
  };
  return labels[status];
}

/**
 * Get display label for insight type.
 */
export function getInsightTypeLabel(type: InsightType): string {
  const labels: Record<InsightType, string> = {
    stall_detected: "Stall Detected",
    performance: "Performance",
    error: "Error",
    suggestion: "Suggestion",
  };
  return labels[type];
}
