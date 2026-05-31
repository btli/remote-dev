/**
 * Instance lifecycle state machine (spec §6.3).
 *
 * Legal transitions:
 *   requested    → provisioning | error | terminating
 *   provisioning → ready | error | terminating
 *   ready        → suspended | terminating | error        (ready↔suspended defined here,
 *   suspended    → ready | terminating | error             but scaling-to-0 is Phase 2 / jvcx.8)
 *   terminating  → deleted | error
 *   error        → terminating                            (allow cleanup of a failed instance)
 *   deleted      → (terminal — no outgoing transitions)
 *
 * `error` is reachable from any non-terminal state. `deleted` is terminal.
 *
 * The reconciler (controller/reconciler.ts) is the only writer that advances
 * states; it MUST gate every status write through {@link assertTransition} so an
 * illegal jump (e.g. `deleted → ready`) throws instead of silently corrupting a row.
 */

import type { InstanceStatus } from "@/db/schema";

/**
 * Adjacency list of legal transitions. A status maps to the set of statuses it
 * may move to next. `deleted` is terminal (empty set).
 *
 * Note: `error` is included as a target from every non-terminal state below
 * (provisioning/readiness failures, transient cluster errors that we decide are
 * fatal). It is NOT a free-for-all on the source side — only the listed sources
 * may originate a transition, and a self-transition (x → x) is always rejected.
 */
const TRANSITIONS: Record<InstanceStatus, ReadonlySet<InstanceStatus>> = {
  requested: new Set<InstanceStatus>(["provisioning", "terminating", "error"]),
  provisioning: new Set<InstanceStatus>(["ready", "terminating", "error"]),
  // ready ↔ suspended is DEFINED here (Phase 2 / jvcx.8 implements the actual
  // scale-to-0 / scale-to-1 mechanics; the transition itself is legal now).
  ready: new Set<InstanceStatus>(["suspended", "terminating", "error"]),
  suspended: new Set<InstanceStatus>(["ready", "terminating", "error"]),
  terminating: new Set<InstanceStatus>(["deleted", "error"]),
  // From `error` we still permit teardown so a failed instance can be cleaned up.
  error: new Set<InstanceStatus>(["terminating"]),
  // Terminal.
  deleted: new Set<InstanceStatus>([]),
};

/** All recognised instance statuses (handy for tests / exhaustiveness). */
export const ALL_STATUSES: readonly InstanceStatus[] = Object.keys(
  TRANSITIONS,
) as InstanceStatus[];

/** Terminal statuses have no outgoing transitions. */
export function isTerminal(status: InstanceStatus): boolean {
  return TRANSITIONS[status].size === 0;
}

/**
 * True iff moving `from → to` is a legal state-machine transition.
 *
 * A self-transition (`from === to`) is always `false` — callers should no-op
 * rather than "transition" to the same state.
 */
export function canTransition(
  from: InstanceStatus,
  to: InstanceStatus,
): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].has(to);
}

/** Thrown when an illegal instance state transition is attempted. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly from: InstanceStatus,
    readonly to: InstanceStatus,
  ) {
    super(`Illegal instance state transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

/**
 * Assert that `from → to` is legal; throw {@link IllegalTransitionError} if not.
 * Use this at every status-write site in the reconciler.
 */
export function assertTransition(
  from: InstanceStatus,
  to: InstanceStatus,
): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}
