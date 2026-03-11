/**
 * Application Logger
 *
 * Re-exports from the infrastructure logging module for convenience.
 * All server-side code should import from here:
 *
 * @example
 * ```ts
 * import { createLogger } from "@/lib/logger";
 * const log = createLogger("MyService");
 * log.info("Something happened", { key: "value" });
 * ```
 */

export { createLogger } from "@/infrastructure/logging/AppLogger";
export type { Logger } from "@/infrastructure/logging/AppLogger";
