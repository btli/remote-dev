/**
 * Shared types for pattern detectors.
 */

import type {
  OverseerIssue,
  OverseerObservations,
  OversightConfig,
} from "@/domain/entities/OverseerCheck";

/**
 * Context passed to pattern detectors.
 */
export interface DetectorContext {
  /** Current observations from this check */
  observations: OverseerObservations;
  /** Previous observations from recent checks */
  history: OverseerObservations[];
  /** Oversight configuration */
  config: OversightConfig;
  /** Task description for context */
  taskDescription: string;
  /** Task type (feature, bug, refactor, etc.) */
  taskType: string;
}

/**
 * Result from a pattern detector.
 */
export interface DetectorResult {
  /** Whether this detector found any issues */
  detected: boolean;
  /** Issues found by this detector */
  issues: OverseerIssue[];
}

/**
 * Pattern detector interface.
 */
export interface PatternDetector {
  /** Detector name for logging */
  name: string;
  /** Analyze context and return detected issues */
  detect(context: DetectorContext): DetectorResult;
}
