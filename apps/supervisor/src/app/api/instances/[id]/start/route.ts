/**
 * POST /api/instances/:id/start (operator) — alias for `/resume`.
 *
 * Exact behavioral alias of resume (remote-dev-jvcx.15): same operator role,
 * same owner-scoping, and the SAME canonical audit action `"resume"` /
 * status `ready`. The "Start" terminology is a UI-facing relabel only; the
 * underlying lifecycle is unchanged. Both routes call the shared
 * {@link requestResume}.
 */
import { NextResponse } from "next/server";
import { withSupervisorAuth } from "@/lib/auth";
import { requestResume } from "@/lib/lifecycle-actions";

export const POST = withSupervisorAuth("operator", async (_request, { user, params }) => {
  const result = await requestResume(user, params?.id);
  return NextResponse.json(result.body, { status: result.status });
});
