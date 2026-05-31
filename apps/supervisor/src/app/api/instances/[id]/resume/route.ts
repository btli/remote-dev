/**
 * POST /api/instances/:id/resume — scale a suspended instance back to 1.
 *
 * Phase 2 (jvcx.8). The suspended→ready transition is DEFINED in the instance
 * state machine, but the scale-to-1 mechanics are not implemented in Phase 1.
 * Auth-wrapped at `operator` so the contract exists; returns 501 PHASE1_PENDING.
 */
import { withSupervisorAuth, phase1Pending } from "@/lib/auth";

export const POST = withSupervisorAuth("operator", async () => phase1Pending());
