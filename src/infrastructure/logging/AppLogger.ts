/**
 * AppLogger - Application-wide logging singleton.
 *
 * Provides `createLogger(namespace)` factory that returns a namespaced logger
 * with error/warn/info/debug/trace methods. Each call:
 *   1. Checks the level against LOG_LEVEL threshold
 *   2. Writes to console (preserving existing dev experience)
 *   3. Writes to the logs SQLite database (synchronous, never throws)
 *
 * The logger is designed to be available before the DI container initializes,
 * so it bypasses the container and directly instantiates its repository.
 *
 * CRITICAL: The logger must NEVER propagate exceptions. If the logs DB is
 * corrupted or disk is full, the application must continue running.
 */

import { LEVEL_RANK, type LogLevelValue } from "@/domain/value-objects/LogLevel";
import type { LogSource } from "@/application/ports/LogRepository";
import { getLogRepositoryInstance } from "@/infrastructure/persistence/repositories/BetterSqliteLogRepository";

export interface Logger {
  error(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  trace(message: string, data?: Record<string, unknown>): void;
}

let _configuredLevel: LogLevelValue | null = null;

function getConfiguredLevel(): LogLevelValue {
  if (_configuredLevel) return _configuredLevel;
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LEVEL_RANK) {
    _configuredLevel = env as LogLevelValue;
  } else {
    _configuredLevel = process.env.NODE_ENV === "production" ? "warn" : "info";
  }
  return _configuredLevel;
}

function getSource(): LogSource {
  return process.env.RDV_SERVER_SOURCE === "terminal" ? "terminal" : "nextjs";
}

function shouldLog(level: LogLevelValue): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[getConfiguredLevel()];
}

function writeToConsole(
  level: LogLevelValue,
  namespace: string,
  message: string,
  data?: Record<string, unknown>
): void {
  const prefix = `[${namespace}]`;
  const args: unknown[] = [prefix, message];
  if (data) args.push(data);

  switch (level) {
    case "error":
      console.error(...args);
      break;
    case "warn":
      console.warn(...args);
      break;
    case "debug":
    case "trace":
      console.debug(...args);
      break;
    default:
      console.log(...args);
      break;
  }
}

function writeToDb(
  level: LogLevelValue,
  namespace: string,
  message: string,
  data?: Record<string, unknown>
): void {
  try {
    getLogRepositoryInstance().write({
      timestamp: Date.now(),
      level,
      namespace,
      message,
      data: data ? JSON.stringify(data) : null,
      source: getSource(),
    });
  } catch {
    // Never let logger errors crash the application
  }
}

function write(
  level: LogLevelValue,
  namespace: string,
  message: string,
  data?: Record<string, unknown>
): void {
  if (!shouldLog(level)) return;
  writeToConsole(level, namespace, message, data);
  writeToDb(level, namespace, message, data);
}

/**
 * Create a namespaced logger instance.
 *
 * @example
 * ```ts
 * import { createLogger } from "@/lib/logger";
 * const log = createLogger("SessionService");
 *
 * log.info("Session created", { sessionId, userId });
 * log.error("Failed to create session", { error: String(err) });
 * ```
 */
export function createLogger(namespace: string): Logger {
  return {
    error: (msg, data) => write("error", namespace, msg, data),
    warn: (msg, data) => write("warn", namespace, msg, data),
    info: (msg, data) => write("info", namespace, msg, data),
    debug: (msg, data) => write("debug", namespace, msg, data),
    trace: (msg, data) => write("trace", namespace, msg, data),
  };
}
