/**
 * SQLITE_BUSY retry helper.
 *
 * libsql can reject a write with `SQLITE_BUSY: database is locked` (or
 * `... cannot commit transaction - SQL statements in progress`) under write
 * contention. For a SINGLE statement or an ATOMIC batch this means the write
 * did NOT apply — so retrying it is safe and idempotent. This helper wraps such
 * a call, retrying with exponential backoff + jitter before giving up.
 *
 * It is intentionally scoped to NON-interactive operations. Interactive
 * `client.transaction()` is NOT retried here: a busy error mid-transaction can
 * leave partial work, so a blind retry would not be safe.
 *
 * Note: `Math.random` is used here purely for backoff jitter. The no-Math.random
 * rule in this codebase applies only to deterministic Workflow scripts; ordinary
 * application code may use it.
 */
import { createLogger } from "@/lib/logger";

const log = createLogger("DB");

/** Matches the busy/locked error shapes libsql surfaces under write contention. */
const BUSY_RE = /SQLITE_BUSY|database is locked|statements in progress/i;

/** Returns true when the error looks like a retryable SQLITE_BUSY/locked error. */
export function isBusyError(error: unknown): boolean {
  return BUSY_RE.test(String(error));
}

export interface BusyRetryOptions {
  /** Max attempts AFTER the first try (default 5 → up to 6 total attempts). */
  retries?: number;
  /** Base backoff delay in ms; doubles each attempt (default 50). */
  baseDelayMs?: number;
  /** Human label for logs (e.g. the operation name). */
  label?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run `fn`, retrying only on SQLITE_BUSY-like errors. Non-busy errors are
 * rethrown immediately (no retry). After exhausting `retries`, the last busy
 * error is rethrown.
 */
export async function withBusyRetry<T>(
  fn: () => Promise<T>,
  opts: BusyRetryOptions = {}
): Promise<T> {
  const retries = opts.retries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 50;
  const label = opts.label;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isBusyError(error)) throw error;
      lastError = error;
      if (attempt === retries) break;

      // Exponential backoff (50/100/200/400/800ms…) + small random jitter so
      // contending writers don't resynchronize on the same retry cadence.
      const backoff = baseDelayMs * 2 ** attempt;
      const jitter = Math.floor(Math.random() * baseDelayMs);
      const delayMs = backoff + jitter;
      log.warn("SQLITE_BUSY — retrying DB operation", {
        label,
        attempt: attempt + 1,
        retries,
        delayMs,
        error: String(error),
      });
      await sleep(delayMs);
    }
  }

  log.error("SQLITE_BUSY — retries exhausted", {
    label,
    retries,
    error: String(lastError),
  });
  throw lastError;
}
