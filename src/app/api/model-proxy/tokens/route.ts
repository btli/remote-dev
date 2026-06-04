/**
 * Model-proxy token issuance + listing.
 *
 * This endpoint stays BEHIND the normal auth gate (it is excluded from the
 * `/api/model-proxy/` allowlist in src/proxy.ts) — it is the browser /
 * `withApiAuth` issuance surface used by session creation and admin/debug. The
 * forward endpoint (`/api/model-proxy/[provider]/...`) is what the per-session
 * `mp_…` token authenticates against.
 *
 * GET  → list the caller's tokens (metadata only; never the hash/full token).
 * POST → mint a token for the caller; the full token is returned ONCE.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse, parseJsonBody } from "@/lib/api";
import {
  issueProxyToken,
  listProxyTokens,
} from "@/services/model-proxy-token-service";

export const dynamic = "force-dynamic";

export const GET = withApiAuth(async (_request, { userId }) => {
  const tokens = await listProxyTokens(userId);
  return NextResponse.json({ tokens });
});

interface IssueTokenBody {
  sessionId?: string;
  instanceSlug?: string;
  providerScope?: string[];
  ttlMs?: number;
}

export const POST = withApiAuth(async (request, { userId }) => {
  const result = await parseJsonBody<IssueTokenBody>(request);
  if ("error" in result) return result.error;
  const body = result.data ?? {};

  if (body.providerScope !== undefined) {
    if (
      !Array.isArray(body.providerScope) ||
      !body.providerScope.every((p) => typeof p === "string")
    ) {
      return errorResponse("providerScope must be an array of strings", 400);
    }
  }
  if (body.ttlMs !== undefined && (typeof body.ttlMs !== "number" || body.ttlMs <= 0)) {
    return errorResponse("ttlMs must be a positive number", 400);
  }

  const { token, id } = await issueProxyToken({
    userId,
    sessionId: body.sessionId,
    instanceSlug: body.instanceSlug,
    providerScope: body.providerScope,
    ttlMs: body.ttlMs,
  });

  // The full token is returned ONCE — the caller must store it now.
  return NextResponse.json({ id, token }, { status: 201 });
});
