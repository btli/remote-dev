/**
 * Revoke a single model-proxy token (with ownership check).
 *
 * Stays behind the normal auth gate (the issuance/management surface). After
 * revocation the token is rejected by `authenticateProxyToken`, so the agent's
 * proxy calls 401 immediately.
 */
import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { revokeProxyToken } from "@/services/model-proxy-token-service";

export const dynamic = "force-dynamic";

export const DELETE = withApiAuth(async (_request, { userId, params }) => {
  const id = params?.id;
  if (!id) return errorResponse("Token ID is required", 400);

  const revoked = await revokeProxyToken(id, userId);
  if (!revoked) return errorResponse("Token not found", 404);

  return new NextResponse(null, { status: 204 });
});
