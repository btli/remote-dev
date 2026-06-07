/**
 * [remote-dev-1aa5] Monotonic ordering rule for agent activity-status writes.
 *
 * The terminal server's `/internal/agent-status` handler persists a status with
 * an atomic SQL guard (a single `UPDATE ... WHERE` that only writes when this
 * predicate would return true). This module is the single source of truth for
 * that decision so the rule is unit-testable in isolation; the SQL in
 * `terminal.ts` mirrors it exactly.
 *
 * Two independent guards:
 *
 *  1. **Monotonic arrival.** A write only wins when its server-arrival time
 *     (`incomingAt`) is newer-or-equal than the persisted one (`currentAt`), or
 *     no arrival has been recorded yet. This kills the late-hook race where a
 *     slow SubagentStop "running" (5s timeout) lands after a newer Stop "idle"
 *     (15s timeout) and resurrects the stale status.
 *
 *  2. **Subagent-stop terminal-status protection.** A "running" write tagged
 *     `source=subagent-stop` must NOT overwrite a turn that already ended — i.e.
 *     a current DB status of 'idle' or 'ended'. A legitimately new turn
 *     re-asserts running via the PreToolUse hook immediately (untagged), so this
 *     only blocks the spurious resurrection.
 */

export interface StatusWriteDecisionInput {
  /** Server-arrival epoch ms of the incoming write. */
  incomingAt: number;
  /** Persisted arrival epoch ms (null when none recorded yet). */
  currentAt: number | null;
  /** Persisted activity status (null when none recorded yet). */
  currentStatus: string | null;
  /** Incoming status value. */
  status: string;
  /** Optional source tag (e.g. "subagent-stop"). */
  source: string | null;
}

/**
 * Returns true when the incoming write should be applied to the DB.
 * Mirrors the atomic SQL WHERE guard in `terminal.ts`.
 */
export function shouldApplyStatusWrite(input: StatusWriteDecisionInput): boolean {
  // Guard 1: monotonic arrival ordering.
  if (input.currentAt != null && input.incomingAt < input.currentAt) {
    return false;
  }

  // Guard 2: a subagent-stop "running" never resurrects a terminal status.
  if (
    input.source === "subagent-stop" &&
    input.status === "running" &&
    (input.currentStatus === "idle" || input.currentStatus === "ended")
  ) {
    return false;
  }

  return true;
}
