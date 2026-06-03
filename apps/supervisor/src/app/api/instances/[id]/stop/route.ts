/**
 * POST /api/instances/:id/stop (operator) — alias for `/suspend`.
 *
 * Exact behavioral alias of suspend (remote-dev-jvcx.15): same operator role,
 * same owner-scoping, and the SAME canonical audit action `"suspend"` /
 * status `suspended`. The "Stop" terminology is a UI-facing relabel only; the
 * underlying lifecycle is unchanged. Both routes call the shared
 * {@link requestSuspend}.
 */
import { NextResponse } from "next/server";
import { withSupervisorAuth } from "@/lib/auth";
import { requestSuspend } from "@/lib/lifecycle-actions";

export const POST = withSupervisorAuth("operator", async (_request, { user, params }) => {
  const result = await requestSuspend(user, params?.id);
  return NextResponse.json(result.body, { status: result.status });
});
