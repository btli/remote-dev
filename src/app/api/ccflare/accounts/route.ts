import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/ccflare/accounts");

function proxyUrl(path: string): string {
  const port = process.env.CCFLARE_PORT || "8787";
  return `http://127.0.0.1:${port}${path}`;
}

/**
 * GET /api/ccflare/accounts - List accounts from ccflare's native API
 */
export const GET = withAuth(async () => {
  try {
    const resp = await fetch(proxyUrl("/api/accounts"), { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return errorResponse("ccflare unavailable", 502);
    const accounts = await resp.json();
    return NextResponse.json({ accounts });
  } catch (error) {
    log.debug("Failed to fetch ccflare accounts", { error: String(error) });
    return NextResponse.json({ accounts: [] });
  }
});

/**
 * DELETE /api/ccflare/accounts?id=xxx - Remove an account from ccflare
 */
export const DELETE = withAuth(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return errorResponse("Missing account id", 400);

    const resp = await fetch(proxyUrl(`/api/accounts/${id}`), {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return errorResponse((err as Record<string, string>).error || "Failed to delete", resp.status);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Failed to delete ccflare account", { error: String(error) });
    return errorResponse("Failed to delete account", 500);
  }
});

/**
 * PATCH /api/ccflare/accounts?id=xxx - Toggle pause on a ccflare account
 */
export const PATCH = withAuth(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return errorResponse("Missing account id", 400);

    const resp = await fetch(proxyUrl(`/api/accounts/${id}/toggle-pause`), {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return errorResponse((err as Record<string, string>).error || "Failed to toggle", resp.status);
    }
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (error) {
    log.error("Failed to toggle ccflare account", { error: String(error) });
    return errorResponse("Failed to toggle account", 500);
  }
});
