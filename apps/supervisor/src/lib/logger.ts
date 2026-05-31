/**
 * Structured logger for the Supervisor service.
 *
 * Mirrors the root app's `createLogger(namespace)` INTERFACE
 * (see src/infrastructure/logging/AppLogger.ts) so server-side code uses the
 * same ergonomics and NEVER calls `console.*` directly. This is a minimal
 * console-backed implementation — there is no separate logs database yet.
 *
 * @example
 * ```ts
 * import { createLogger } from "@/lib/logger";
 * const log = createLogger("Supervisor");
 * log.info("Started", { port: 6003 });
 * log.error("Failed", { error: String(err) });
 * ```
 */

const LEVEL_RANK = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
} as const;

type LogLevel = keyof typeof LEVEL_RANK;

export interface Logger {
  error(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
  trace(message: string, data?: Record<string, unknown>): void;
}

let configuredLevel: LogLevel | null = null;

function getConfiguredLevel(): LogLevel {
  if (configuredLevel) return configuredLevel;
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LEVEL_RANK) {
    configuredLevel = env as LogLevel;
  } else {
    configuredLevel = process.env.NODE_ENV === "production" ? "warn" : "info";
  }
  return configuredLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[getConfiguredLevel()];
}

function write(
  level: LogLevel,
  namespace: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;
  const prefix = `[${namespace}]`;
  const args: unknown[] = [prefix, message];
  if (data) args.push(data);

  // This module IS the logging boundary; console.* is intentional here, exactly
  // as the root app's AppLogger uses console internally.
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

/**
 * Create a namespaced logger. Use a PascalCase service/module name for the
 * namespace (e.g. "Supervisor", "Controller", "api/instances").
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
