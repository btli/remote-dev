/**
 * POST /api/instances/:id/suspend (operator) — request suspend (Stop, scale to 0).
 *
 * Thin wrapper over the shared {@link requestSuspend} (src/lib/lifecycle-actions.ts);
 * the `/stop` alias route uses the same helper, so behavior is identical and
 * tested once. Single-writer model + owner-scoping (404, not 403) live in the
 * helper.
 */
import { NextResponse } from "next/server";
import { withSupervisorAuth } from "@/lib/auth";
import { requestSuspend } from "@/lib/lifecycle-actions";

export const POST = withSupervisorAuth("operator", async (_request, { user, params }) => {
  const result = await requestSuspend(user, params?.id);
  return NextResponse.json(result.body, { status: result.status });
});
