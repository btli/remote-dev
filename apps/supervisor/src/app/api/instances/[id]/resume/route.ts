/**
 * POST /api/instances/:id/resume (operator) — request resume (Start, scale to 1).
 *
 * Thin wrapper over the shared {@link requestResume} (src/lib/lifecycle-actions.ts);
 * the `/start` alias route uses the same helper, so behavior is identical and
 * tested once. Single-writer model + owner-scoping (404, not 403) live in the
 * helper. The slug re-appears in the router allowlist immediately while the pod
 * takes ~10–30 s to become ready → a brief 502/503 blip (accepted, §9).
 */
import { NextResponse } from "next/server";
import { withSupervisorAuth } from "@/lib/auth";
import { requestResume } from "@/lib/lifecycle-actions";

export const POST = withSupervisorAuth("operator", async (_request, { user, params }) => {
  const result = await requestResume(user, params?.id);
  return NextResponse.json(result.body, { status: result.status });
});
