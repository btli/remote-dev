/**
 * GET /api/health — liveness. Unauthenticated by design (spec §6.7).
 * Returns 200 as long as the Node process can serve HTTP.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ status: "ok" });
}
