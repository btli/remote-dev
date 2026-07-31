/**
 * Shared helpers for `/api/claude-pools/*` routes.
 *
 * Keeps ownership gating and member-view assembly in one place so every pool
 * verb emits the same 400/404 and the same member JSON shape.
 */

import { errorResponse } from "@/lib/api";
import {
  profilePoolRepository,
  usageLimitStateRepository,
} from "@/infrastructure/container";
import { listAccounts } from "@/services/claude-account-service";
import { serializeLimitState } from "@/app/api/_lib/serialize-limit-state";
import type { ClaudePoolMember } from "@/types/claude-limits";
import type { PoolSummary } from "@/application/ports/ProfilePoolRepository";
import type { NextResponse } from "next/server";

/**
 * Resolve `params.poolId` and load the pool only when it belongs to `userId`.
 * Missing id → 400; missing/foreign pool → 404 (indistinguishable).
 */
export async function requireOwnedPool(
  params: Record<string, string> | undefined,
  userId: string
): Promise<
  { poolId: string; pool: PoolSummary } | { error: NextResponse }
> {
  const poolId = params?.poolId;
  if (!poolId) return { error: errorResponse("Pool ID is required", 400) };

  const pool = await profilePoolRepository.getPool(poolId, userId);
  if (!pool) return { error: errorResponse("Pool not found", 404) };

  return { poolId, pool };
}

/**
 * Members of a pool, ownership-filtered and annotated with display name +
 * serialized limit state. Foreign accountIds (shouldn't appear, but defensive)
 * are omitted so nothing leaks across users.
 */
export async function loadPoolMemberViews(
  poolId: string,
  userId: string
): Promise<ClaudePoolMember[]> {
  const [members, accounts] = await Promise.all([
    profilePoolRepository.membersOfPool(poolId),
    listAccounts(userId),
  ]);

  const nameById = new Map(
    accounts.map((a) => [a.id, a.alias ?? a.emailAddress ?? null])
  );
  const ownedMembers = members.filter((m) => nameById.has(m.accountId));

  const limitStates = await usageLimitStateRepository.findManyByAccountIds(
    ownedMembers.map((m) => m.accountId)
  );

  return ownedMembers.map((m) => ({
    accountId: m.accountId,
    name: nameById.get(m.accountId) ?? null,
    priority: m.priority,
    limitState: serializeLimitState(limitStates.get(m.accountId) ?? null),
  }));
}
