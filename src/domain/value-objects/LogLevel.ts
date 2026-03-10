/**
 * LogLevel - Value object representing a log severity level.
 *
 * Levels in order of severity (highest to lowest):
 *   error > warn > info > debug > trace
 */

export type LogLevelValue = "error" | "warn" | "info" | "debug" | "trace";

export const LEVEL_RANK: Record<LogLevelValue, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};
