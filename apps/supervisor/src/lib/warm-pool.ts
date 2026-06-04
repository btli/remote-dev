/**
 * Warm pool for agent-run envs (epic remote-dev-oyej.8 — extends jvcx).
 *
 * Pre-provisions a small pool of instances so an agent run can claim a hot env
 * instead of paying the cold-start provisioning cost. This module ONLY manages
 * `warm_pool` rows + their paired `instance` rows; it creates instances via
 * jvcx's EXISTING create path (insert a `requested` `instance` row, exactly like
 * `POST /api/instances`) and GCs them via jvcx's terminate path — it does NOT
 * re-implement provisioning, scaling, or the lifecycle state machine.
 *
 * State machine (warm_pool.status): provisioning → ready → claimed → terminating.
 * Promotion (provisioning → ready) happens in the reconciler arm when the paired
 * instance reaches `ready`; this module provides prewarm / claim / GC.
 *
 * Testability: all DB + provisioning operations are injected via {@link
 * WarmPoolDeps} (defaulting to the real implementations).
 */
import { and, asc, eq, inArray, lte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { warmPool, instance } from "@/db/schema";
import { namespaceForSlug } from "@/lib/slug";
import { resolveStorageTarget } from "@/lib/storage";
import { createLogger } from "@/lib/logger";

const log = createLogger("warm-pool");

export type WarmPoolRow = typeof warmPool.$inferSelect;

/** A freshly-created pooled instance + its warm_pool row id. */
export interface CreatedPooled {
  instanceId: string;
  warmPoolId: string;
}

export interface WarmPoolDeps {
  /** Count rows still counting toward capacity (provisioning + ready). */
  countActive(): Promise<number>;
  /** Create a `requested` instance + paired `provisioning` warm_pool row. */
  createPooledInstance(): Promise<CreatedPooled>;
  /** Atomically claim one `ready` row for `runId`; null when none available. */
  claimOneReady(runId: string): Promise<WarmPoolRow | null>;
  /** Ready rows whose TTL has elapsed (unclaimed). */
  listExpiredReady(): Promise<WarmPoolRow[]>;
  /** Request termination of an instance via jvcx's terminate path. */
  requestTerminate(instanceId: string): Promise<void>;
  /** Delete a warm_pool row (after its instance is terminating). */
  deletePoolRow(warmPoolId: string): Promise<void>;
  now(): Date;
  ttlMs: number;
}

const ACTIVE_STATUSES = ["provisioning", "ready"] as const;

/** Build a unique pooled slug (e.g. `pool-9f2a1c`). */
function pooledSlug(): string {
  return `pool-${crypto.randomUUID().slice(0, 8)}`;
}

function defaultDeps(): WarmPoolDeps {
  const ownerId = process.env.SUPERVISOR_WARM_POOL_OWNER_ID ?? "";
  const ttlMs = Number(
    process.env.SUPERVISOR_WARM_POOL_TTL_MS ?? `${30 * 60 * 1000}`,
  );
  return {
    countActive: async () => {
      const rows = await db
        .select({ id: warmPool.id })
        .from(warmPool)
        .where(inArray(warmPool.status, [...ACTIVE_STATUSES]));
      return rows.length;
    },
    createPooledInstance: async () => {
      if (!ownerId) {
        throw new Error(
          "SUPERVISOR_WARM_POOL_OWNER_ID is not set (required to own pooled instances)",
        );
      }
      const slug = pooledSlug();
      const storage = await resolveStorageTarget(null);
      // jvcx's create path: a `requested` instance row the reconciler picks up.
      const [inst] = await db
        .insert(instance)
        .values({
          slug,
          displayName: `Warm pool ${slug}`,
          ownerId,
          status: "requested",
          namespace: namespaceForSlug(slug),
          storageTargetId: storage.id,
          storageConfigSnapshot: JSON.stringify(storage.configSnapshot),
          storageRequest: storage.size,
        })
        .returning();
      const [pool] = await db
        .insert(warmPool)
        .values({
          instanceId: inst.id,
          status: "provisioning",
          imageTag: process.env.SUPERVISOR_INSTANCE_IMAGE ?? null,
          ttlExpiresAt: null,
        })
        .returning();
      log.info("warm-pool instance requested", { slug, instanceId: inst.id });
      return { instanceId: inst.id, warmPoolId: pool.id };
    },
    claimOneReady: async (runId) => {
      // Atomicity comes from the GUARDED UPDATE, not a single statement: we
      // SELECT the oldest `ready` row, then UPDATE it with a
      // `WHERE id=? AND status='ready'` guard. Two racing claims can't both win
      // the same row because only the first guarded UPDATE matches `ready`
      // (the loser's UPDATE affects 0 rows). When a claim IS lost, retry the
      // NEXT-oldest ready row rather than returning null (so a contended pool
      // doesn't spuriously cold-start while ready rows remain). Bounded by the
      // number of ready rows. (libsql lacks UPDATE...LIMIT, hence select+guard.)
      const candidates = await db
        .select({ id: warmPool.id })
        .from(warmPool)
        .where(eq(warmPool.status, "ready"))
        .orderBy(asc(warmPool.createdAt));
      for (const candidate of candidates) {
        const [claimed] = await db
          .update(warmPool)
          .set({
            status: "claimed",
            claimedByRunId: runId,
            claimedAt: new Date(),
          })
          .where(
            and(eq(warmPool.id, candidate.id), eq(warmPool.status, "ready")),
          )
          .returning();
        if (claimed) return claimed; // won this row
        // else: a concurrent claim took it — try the next-oldest ready row.
      }
      return null; // no ready row left to claim
    },
    listExpiredReady: async () => {
      const nowMs = Date.now();
      return db
        .select()
        .from(warmPool)
        .where(
          and(
            eq(warmPool.status, "ready"),
            isNotNull(warmPool.ttlExpiresAt),
            lte(warmPool.ttlExpiresAt, new Date(nowMs)),
          ),
        );
    },
    requestTerminate: async (instanceId) => {
      // jvcx terminate path: request `terminating`; the reconciler converges.
      await db
        .update(instance)
        .set({ status: "terminating", updatedAt: new Date() })
        .where(eq(instance.id, instanceId));
    },
    deletePoolRow: async (warmPoolId) => {
      await db.delete(warmPool).where(eq(warmPool.id, warmPoolId));
    },
    now: () => new Date(),
    ttlMs,
  };
}

/**
 * Ensure the pool has `targetSize` active (provisioning+ready) entries. Creates
 * the deficit via jvcx's create path. Size 0 disables the pool (no-op).
 */
export async function prewarm(
  targetSize: number,
  injectedDeps?: WarmPoolDeps,
): Promise<number> {
  if (targetSize <= 0) return 0;
  const deps = injectedDeps ?? defaultDeps();
  const active = await deps.countActive();
  const deficit = targetSize - active;
  if (deficit <= 0) return 0;
  for (let i = 0; i < deficit; i++) {
    try {
      await deps.createPooledInstance();
    } catch (err) {
      log.error("failed to create warm-pool instance", { error: String(err) });
      break; // back off this tick; retry next.
    }
  }
  return Math.max(0, deficit);
}

/**
 * Promote pooled instances whose paired instance has reached `ready`:
 * provisioning → ready (+ set ttlExpiresAt). Returns the number promoted.
 * Exposed as a default-deps op so the reconciler arm can call it.
 */
export async function promoteReady(injectedDeps?: WarmPoolDeps): Promise<number> {
  const deps = injectedDeps ?? defaultDeps();
  const ttlAt = new Date(deps.now().getTime() + deps.ttlMs);
  // ready instances that have a provisioning pool row.
  const promoted = await db
    .update(warmPool)
    .set({ status: "ready", ttlExpiresAt: ttlAt })
    .where(
      and(
        eq(warmPool.status, "provisioning"),
        inArray(
          warmPool.instanceId,
          db
            .select({ id: instance.id })
            .from(instance)
            .where(eq(instance.status, "ready")),
        ),
      ),
    )
    .returning({ id: warmPool.id });
  return promoted.length;
}

/**
 * Atomically claim one `ready` pooled env for `runId`. Returns the claimed row
 * or null when none is available (caller cold-starts a fresh instance).
 */
export async function claimReady(
  runId: string,
  injectedDeps?: WarmPoolDeps,
): Promise<WarmPoolRow | null> {
  const deps = injectedDeps ?? defaultDeps();
  return deps.claimOneReady(runId);
}

/**
 * GC unclaimed `ready` envs past their TTL: request termination + delete the
 * pool row. Returns the number reaped.
 */
export async function gcExpired(injectedDeps?: WarmPoolDeps): Promise<number> {
  const deps = injectedDeps ?? defaultDeps();
  const expired = await deps.listExpiredReady();
  for (const row of expired) {
    try {
      await deps.requestTerminate(row.instanceId);
      await deps.deletePoolRow(row.id);
    } catch (err) {
      log.error("failed to GC warm-pool row", {
        warmPoolId: row.id,
        error: String(err),
      });
    }
  }
  return expired.length;
}
