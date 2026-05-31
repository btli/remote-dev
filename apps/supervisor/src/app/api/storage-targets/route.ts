/**
 * GET /api/storage-targets (viewer) — live storage discovery.
 *
 * 501 PHASE1_PENDING: StorageClass/node discovery + registered-target merge +
 * resiliencyNote is jvcx.5. Auth-wrapped so the contract is exercisable now.
 */
import { withSupervisorAuth, phase1Pending } from "@/lib/auth";

export const GET = withSupervisorAuth("viewer", async () => {
  return phase1Pending();
});
