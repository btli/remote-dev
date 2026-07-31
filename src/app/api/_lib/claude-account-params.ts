/**
 * Shared param helpers for `/api/claude-accounts/[accountId]/*` routes.
 */

import { errorResponse } from "@/lib/api";
import type { NextResponse } from "next/server";

/**
 * Require a non-empty `params.accountId`. Missing → 400 with the same message
 * every account route already used.
 */
export function requireAccountId(
  params: Record<string, string> | undefined
): { accountId: string } | { error: NextResponse } {
  const accountId = params?.accountId;
  if (!accountId) return { error: errorResponse("Account ID is required", 400) };
  return { accountId };
}
