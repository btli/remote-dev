/**
 * PortClaimsService - Manages runtime port claims for live sessions.
 *
 * This is the control-plane companion to the declarative `portRegistry`.
 * Where `portRegistry` records project-level, env-var-derived port intent,
 * `portClaims` tracks ports actively claimed by a *running* terminal session:
 * which session/user/project holds the port, whether a listener is currently
 * bound (`isListening` / `pid`), and when the claim expires.
 *
 * The proxy data-plane consumes these claims to decide which ports are
 * reachable and to whom. Claims live for 24h and are pruned once expired.
 *
 * The whole database belongs to a single instance's users, so
 * "instance-wide" simply means "all non-expired claims".
 */
import { db } from "@/db";
import { portClaims } from "@/db/schema";
import { eq, and, gt, lte } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("PortClaims");

/** Time-to-live for a port claim. */
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A runtime port claim, mapped from its database row with `Date` objects.
 */
export interface PortClaim {
  id: string;
  sessionId: string;
  userId: string;
  projectId: string | null;
  port: number;
  variableName: string;
  /** `null` = listening status unknown (not yet probed). */
  isListening: boolean | null;
  pid: number | null;
  expiresAt: Date;
  claimedAt: Date;
  updatedAt: Date;
}

/**
 * Claim a set of ports for a running session.
 *
 * Upserts one claim per `(sessionId, port)`. Each claim's `expiresAt` is reset
 * to `now + 24h`. If a port is already claimed by this session, its
 * `variableName`, `expiresAt`, and `updatedAt` are refreshed (the listener
 * status / pid are left untouched so probe results survive re-claims).
 *
 * @param sessionId - The owning terminal session.
 * @param userId - The owning user.
 * @param projectId - Optional project association (null if none).
 * @param ports - The ports to claim, with their source variable names.
 */
export async function claimPortsForSession(
  sessionId: string,
  userId: string,
  projectId: string | null,
  ports: Array<{ port: number; variableName: string }>
): Promise<void> {
  if (ports.length === 0) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS);

  try {
    for (const { port, variableName } of ports) {
      await db
        .insert(portClaims)
        .values({
          sessionId,
          userId,
          projectId,
          port,
          variableName,
          expiresAt,
          claimedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          // Matches the `port_claim_session_port_unique` index.
          target: [portClaims.sessionId, portClaims.port],
          set: {
            variableName,
            expiresAt,
            updatedAt: now,
          },
        });
    }
  } catch (error) {
    log.error("Failed to claim ports for session", {
      error: String(error),
      sessionId,
      userId,
      portCount: ports.length,
    });
    throw error;
  }
}

/**
 * Release all port claims held by a session.
 *
 * Called when a session is closed or its ports are torn down.
 */
export async function releasePortsForSession(sessionId: string): Promise<void> {
  try {
    await db.delete(portClaims).where(eq(portClaims.sessionId, sessionId));
  } catch (error) {
    log.error("Failed to release ports for session", {
      error: String(error),
      sessionId,
    });
    throw error;
  }
}

/**
 * Get all non-expired claims for a user.
 */
export async function getActiveClaimsForUser(
  userId: string
): Promise<PortClaim[]> {
  const now = new Date();
  const rows = await db.query.portClaims.findMany({
    where: and(eq(portClaims.userId, userId), gt(portClaims.expiresAt, now)),
  });
  return rows.map(mapDbPortClaim);
}

/**
 * Get all non-expired claims across the instance.
 *
 * The whole database is a single instance's users, so this returns every
 * active claim regardless of user.
 */
export async function getActiveClaimsForInstance(): Promise<PortClaim[]> {
  const now = new Date();
  const rows = await db.query.portClaims.findMany({
    where: gt(portClaims.expiresAt, now),
  });
  return rows.map(mapDbPortClaim);
}

/**
 * Delete every claim whose `expiresAt` is at or before now.
 *
 * @returns The number of claims deleted.
 */
export async function pruneExpiredClaims(): Promise<number> {
  const now = new Date();
  try {
    const result = await db
      .delete(portClaims)
      .where(lte(portClaims.expiresAt, now));
    return result.rowsAffected;
  } catch (error) {
    log.error("Failed to prune expired claims", { error: String(error) });
    throw error;
  }
}

/**
 * Update the listener status (and optionally pid) of active claims by port.
 *
 * Matches by `port` against non-expired claims — a probe sweep observes ports
 * on the system, not individual claim ids, so matching by port lets one probe
 * result update every active claim for that port. `pid` is only changed when
 * provided in the update entry.
 *
 * @param updates - Per-port listener status, with optional pid.
 */
export async function updateListeningStatus(
  updates: Array<{ port: number; isListening: boolean; pid?: number | null }>
): Promise<void> {
  if (updates.length === 0) return;

  const now = new Date();
  try {
    for (const { port, isListening, pid } of updates) {
      await db
        .update(portClaims)
        .set({
          isListening,
          // Only overwrite pid when the caller supplies one.
          ...(pid !== undefined ? { pid } : {}),
          updatedAt: now,
        })
        .where(and(eq(portClaims.port, port), gt(portClaims.expiresAt, now)));
    }
  } catch (error) {
    log.error("Failed to update listening status", {
      error: String(error),
      portCount: updates.length,
    });
    throw error;
  }
}

// ============================================================================
// Database Mappers
// ============================================================================

function mapDbPortClaim(
  dbEntry: typeof portClaims.$inferSelect
): PortClaim {
  return {
    id: dbEntry.id,
    sessionId: dbEntry.sessionId,
    userId: dbEntry.userId,
    projectId: dbEntry.projectId ?? null,
    port: dbEntry.port,
    variableName: dbEntry.variableName,
    isListening: dbEntry.isListening ?? null,
    pid: dbEntry.pid ?? null,
    expiresAt: new Date(dbEntry.expiresAt),
    claimedAt: new Date(dbEntry.claimedAt),
    updatedAt: new Date(dbEntry.updatedAt),
  };
}
