#!/usr/bin/env bun
/**
 * Tiny leveled logger for the migration CLI.
 *
 * This is a standalone command-line tool (not server code), so it writes to
 * the console directly — the server's structured logger pulls in the db
 * dialect machinery and is not appropriate for a one-shot migration script.
 * Levels gate verbosity via `--log-level`.
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export interface Logger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
}

export function createCliLogger(level: LogLevel): Logger {
  const threshold = ORDER[level];
  const at = (l: LogLevel): boolean => ORDER[l] <= threshold;
  return {
    error(msg) {
      if (at("error")) console.error(msg);
    },
    warn(msg) {
      if (at("warn")) console.warn(msg);
    },
    info(msg) {
      if (at("info")) console.log(msg);
    },
    debug(msg) {
      if (at("debug")) console.log(msg);
    },
  };
}
