/**
 * GET /api/nodes (viewer) — nodes + capacity summary.
 *
 * 501 PHASE1_PENDING: node listing / capacity summary is part of the
 * storage + capacity work (jvcx.5 / Phase 3). Auth-wrapped.
 */
import { withSupervisorAuth, phase1Pending } from "@/lib/auth";

export const GET = withSupervisorAuth("viewer", async () => {
  return phase1Pending();
});
