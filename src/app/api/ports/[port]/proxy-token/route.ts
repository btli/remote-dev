import { NextResponse } from "next/server";
import { withApiAuth, errorResponse } from "@/lib/api";
import { generateProxyWsToken } from "@/lib/ws-token";
import { isPortProxyable } from "@/lib/proxy-port-utils";
import { isPortProxyableForUser } from "@/services/proxyable-ports-service";

/**
 * GET /api/ports/:port/proxy-token — mint a short-lived, PORT-BOUND token for the
 * in-pod port-proxy WebSocket bridge (remote-dev-kn0q).
 *
 * The bridge (`src/server/proxy-ws-bridge.ts`) requires a `kind:"proxy"` token
 * bound to the exact port being proxied — a terminal-SESSION token is rejected
 * there. This endpoint is the mint site that feeds the proxy client: it confirms
 * the caller may proxy `port` (it must be in their live `(listening ∪ claimed)`
 * set) and then issues a token bound to that single port.
 *
 * Dual-auth (session OR Bearer API key), matching `/api/ports/proxyable` and
 * `/api/sessions/:id/token`, so both the browser UI and agents can obtain one.
 *
 * Returns 403 (not 404) when the port isn't proxyable so the distinction from an
 * unauthenticated 401 is clear; the token itself never authorizes a port the
 * membership check rejected.
 */
export const GET = withApiAuth(async (_request, { userId, params }) => {
  const portRaw = params?.port ?? "";
  const port = Number(portRaw);

  if (!/^\d+$/.test(portRaw) || !Number.isInteger(port)) {
    return errorResponse("Invalid port", 400, "INVALID_PORT");
  }

  // First gate: syntactic allowlist (privileged <1024 + hard-blocked 6001/6002).
  if (!isPortProxyable(port)) {
    return errorResponse(`Port ${port} cannot be proxied`, 403, "PORT_BLOCKED");
  }

  // Second gate: runtime membership — only mint for ports the user actually has.
  if (!(await isPortProxyableForUser(userId, port))) {
    return errorResponse(
      `Port ${port} is not in your set of proxyable ports.`,
      403,
      "PORT_NOT_PROXYABLE",
    );
  }

  const token = generateProxyWsToken(userId, port);

  return NextResponse.json({
    token,
    port,
    expiresIn: 300, // 5 minutes
  });
});
