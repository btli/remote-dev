/**
 * SplitService - Manages terminal split group operations
 */
import { db } from "@/db";
import { splitGroups, terminalSessions } from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import type {
  SplitDirection,
  SplitGroup,
  SplitGroupWithSessions,
} from "@/types/split";
import * as SessionService from "./session-service";

export class SplitServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly splitGroupId?: string
  ) {
    super(message);
    this.name = "SplitServiceError";
  }
}

/**
 * Get all split groups for a user with their sessions
 */
export async function listSplitGroups(
  userId: string
): Promise<SplitGroupWithSessions[]> {
  const groups = await db.query.splitGroups.findMany({
    where: eq(splitGroups.userId, userId),
    orderBy: [asc(splitGroups.createdAt)],
  });

  if (groups.length === 0) {
    return [];
  }

  // Batch fetch all sessions for all groups (fixes N+1 query)
  const groupIds = groups.map((g) => g.id);
  const allSessions = await db.query.terminalSessions.findMany({
    where: and(
      inArray(terminalSessions.splitGroupId, groupIds),
      eq(terminalSessions.userId, userId)
    ),
    orderBy: [asc(terminalSessions.splitOrder)],
    columns: {
      id: true,
      splitGroupId: true,
      splitOrder: true,
      splitSize: true,
    },
  });

  // Group sessions by splitGroupId
  const sessionsByGroup = new Map<string, typeof allSessions>();
  for (const session of allSessions) {
    if (session.splitGroupId) {
      const existing = sessionsByGroup.get(session.splitGroupId) || [];
      existing.push(session);
      sessionsByGroup.set(session.splitGroupId, existing);
    }
  }

  return groups.map((group) => ({
    id: group.id,
    userId: group.userId,
    direction: group.direction as SplitDirection,
    createdAt: new Date(group.createdAt),
    updatedAt: new Date(group.updatedAt),
    sessions: (sessionsByGroup.get(group.id) || []).map((s) => ({
      sessionId: s.id,
      splitOrder: s.splitOrder,
      splitSize: s.splitSize ?? 0.5,
    })),
  }));
}

/**
 * Get a single split group by ID
 */
export async function getSplitGroup(
  splitGroupId: string,
  userId: string
): Promise<SplitGroupWithSessions | null> {
  const group = await db.query.splitGroups.findFirst({
    where: and(
      eq(splitGroups.id, splitGroupId),
      eq(splitGroups.userId, userId)
    ),
  });

  if (!group) return null;

  const sessions = await db.query.terminalSessions.findMany({
    where: and(
      eq(terminalSessions.splitGroupId, group.id),
      eq(terminalSessions.userId, userId)
    ),
    orderBy: [asc(terminalSessions.splitOrder)],
    columns: {
      id: true,
      splitOrder: true,
      splitSize: true,
    },
  });

  return {
    id: group.id,
    userId: group.userId,
    direction: group.direction as SplitDirection,
    createdAt: new Date(group.createdAt),
    updatedAt: new Date(group.updatedAt),
    sessions: sessions.map((s) => ({
      sessionId: s.id,
      splitOrder: s.splitOrder,
      splitSize: s.splitSize ?? 0.5,
    })),
  };
}

/**
 * Create a split from an existing session
 * Creates a new session and groups both in a split group
 */
export async function createSplit(
  userId: string,
  sourceSessionId: string,
  direction: SplitDirection,
  newSessionName?: string
): Promise<SplitGroupWithSessions> {
  // Verify source session exists and belongs to user
  const sourceSession = await db.query.terminalSessions.findFirst({
    where: and(
      eq(terminalSessions.id, sourceSessionId),
      eq(terminalSessions.userId, userId)
    ),
  });

  if (!sourceSession) {
    throw new SplitServiceError(
      "Source session not found",
      "SESSION_NOT_FOUND"
    );
  }

  // If source is already in a split, add to that split instead
  if (sourceSession.splitGroupId) {
    return addToSplit(
      userId,
      sourceSession.splitGroupId,
      undefined,
      newSessionName
    );
  }

  // Create the split group
  const [group] = await db
    .insert(splitGroups)
    .values({
      userId,
      direction,
    })
    .returning();

  // Update source session to be in the split group
  await db
    .update(terminalSessions)
    .set({
      splitGroupId: group.id,
      splitOrder: 0,
      splitSize: 0.5,
      updatedAt: new Date(),
    })
    .where(eq(terminalSessions.id, sourceSessionId));

  // Create a new session for the other pane (inherit folder from source)
  const name = newSessionName || `${sourceSession.name} (split)`;
  const newSession = await SessionService.createSession(userId, {
    name,
    projectPath: sourceSession.projectPath ?? undefined,
    folderId: sourceSession.folderId ?? undefined,
  });

  // Add new session to the split group
  await db
    .update(terminalSessions)
    .set({
      splitGroupId: group.id,
      splitOrder: 1,
      splitSize: 0.5,
      updatedAt: new Date(),
    })
    .where(eq(terminalSessions.id, newSession.id));

  return {
    id: group.id,
    userId: group.userId,
    direction: group.direction as SplitDirection,
    createdAt: new Date(group.createdAt),
    updatedAt: new Date(group.updatedAt),
    sessions: [
      { sessionId: sourceSessionId, splitOrder: 0, splitSize: 0.5 },
      { sessionId: newSession.id, splitOrder: 1, splitSize: 0.5 },
    ],
  };
}

/**
 * Add a session to an existing split group.
 * Uses a transaction to prevent TOCTOU race conditions when multiple
 * clients add sessions concurrently.
 */
export async function addToSplit(
  userId: string,
  splitGroupId: string,
  existingSessionId?: string,
  newSessionName?: string
): Promise<SplitGroupWithSessions> {
  // If we need to create a new session, do it outside the transaction
  // since SessionService.createSession has its own database operations
  let newSessionId: string | undefined;

  if (!existingSessionId) {
    // First, get the first session info for inheriting folder
    const firstSession = await db.query.terminalSessions.findFirst({
      where: eq(terminalSessions.splitGroupId, splitGroupId),
      orderBy: [asc(terminalSessions.splitOrder)],
    });

    // Create new session (inherit folder from first session in split)
    const name = newSessionName || "Terminal";
    const newSession = await SessionService.createSession(userId, {
      name,
      projectPath: firstSession?.projectPath ?? undefined,
      folderId: firstSession?.folderId ?? undefined,
    });
    newSessionId = newSession.id;
  }

  // Now perform the split update atomically
  await db.transaction(async (tx) => {
    // Verify split group exists
    const group = await tx.query.splitGroups.findFirst({
      where: and(
        eq(splitGroups.id, splitGroupId),
        eq(splitGroups.userId, userId)
      ),
    });

    if (!group) {
      throw new SplitServiceError(
        "Split group not found",
        "SPLIT_NOT_FOUND",
        splitGroupId
      );
    }

    // Get current sessions in the split (within transaction for consistency)
    const currentSessions = await tx.query.terminalSessions.findMany({
      where: eq(terminalSessions.splitGroupId, splitGroupId),
      orderBy: [asc(terminalSessions.splitOrder)],
    });

    const nextOrder = currentSessions.length;
    const newSize = 1 / (nextOrder + 1);

    // Batch update: redistribute sizes for existing sessions
    await Promise.all(
      currentSessions.map((session) =>
        tx
          .update(terminalSessions)
          .set({
            splitSize: newSize,
            updatedAt: new Date(),
          })
          .where(eq(terminalSessions.id, session.id))
      )
    );

    // Add the session to the split
    const sessionIdToAdd = existingSessionId || newSessionId;
    if (sessionIdToAdd) {
      await tx
        .update(terminalSessions)
        .set({
          splitGroupId,
          splitOrder: nextOrder,
          splitSize: newSize,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(terminalSessions.id, sessionIdToAdd),
            eq(terminalSessions.userId, userId)
          )
        );
    }
  });

  // Return updated split group
  return getSplitGroup(splitGroupId, userId) as Promise<SplitGroupWithSessions>;
}

/**
 * Remove a session from a split group (unsplit).
 * Uses a transaction to prevent TOCTOU race conditions when multiple
 * sessions are removed concurrently.
 * If only one session remains, deletes the split group.
 */
export async function removeFromSplit(
  userId: string,
  sessionId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const session = await tx.query.terminalSessions.findFirst({
      where: and(
        eq(terminalSessions.id, sessionId),
        eq(terminalSessions.userId, userId)
      ),
    });

    if (!session || !session.splitGroupId) {
      return; // Session not in a split, nothing to do
    }

    const splitGroupId = session.splitGroupId;

    // Remove session from split
    await tx
      .update(terminalSessions)
      .set({
        splitGroupId: null,
        splitOrder: 0,
        splitSize: 0.5,
        updatedAt: new Date(),
      })
      .where(eq(terminalSessions.id, sessionId));

    // Check remaining sessions in split (within same transaction)
    const remainingSessions = await tx.query.terminalSessions.findMany({
      where: eq(terminalSessions.splitGroupId, splitGroupId),
      orderBy: [asc(terminalSessions.splitOrder)],
    });

    if (remainingSessions.length <= 1) {
      // Only one or zero sessions left, dissolve the split
      await Promise.all(
        remainingSessions.map((s) =>
          tx
            .update(terminalSessions)
            .set({
              splitGroupId: null,
              splitOrder: 0,
              splitSize: 0.5,
              updatedAt: new Date(),
            })
            .where(eq(terminalSessions.id, s.id))
        )
      );

      await tx.delete(splitGroups).where(eq(splitGroups.id, splitGroupId));
    } else {
      // Redistribute sizes
      const newSize = 1 / remainingSessions.length;
      await Promise.all(
        remainingSessions.map((s, i) =>
          tx
            .update(terminalSessions)
            .set({
              splitOrder: i,
              splitSize: newSize,
              updatedAt: new Date(),
            })
            .where(eq(terminalSessions.id, s.id))
        )
      );
    }
  });
}

/**
 * Dissolve a split group entirely (all sessions become standalone)
 */
export async function dissolveSplit(
  userId: string,
  splitGroupId: string
): Promise<void> {
  // Remove all sessions from split
  await db
    .update(terminalSessions)
    .set({
      splitGroupId: null,
      splitOrder: 0,
      splitSize: 0.5,
      updatedAt: new Date(),
    })
    .where(eq(terminalSessions.splitGroupId, splitGroupId));

  // Delete the split group
  await db
    .delete(splitGroups)
    .where(
      and(eq(splitGroups.id, splitGroupId), eq(splitGroups.userId, userId))
    );
}

/**
 * Update pane sizes within a split group
 */
export async function updateSplitLayout(
  userId: string,
  splitGroupId: string,
  layout: Array<{ sessionId: string; size: number }>
): Promise<void> {
  await db.transaction(async (tx) => {
    // Verify split group exists
    const group = await tx.query.splitGroups.findFirst({
      where: and(
        eq(splitGroups.id, splitGroupId),
        eq(splitGroups.userId, userId)
      ),
    });

    if (!group) {
      throw new SplitServiceError(
        "Split group not found",
        "SPLIT_NOT_FOUND",
        splitGroupId
      );
    }

    const now = new Date();

    // Update each session's size
    for (let i = 0; i < layout.length; i++) {
      const { sessionId, size } = layout[i];
      await tx
        .update(terminalSessions)
        .set({
          splitOrder: i,
          splitSize: size,
          updatedAt: now,
        })
        .where(
          and(
            eq(terminalSessions.id, sessionId),
            eq(terminalSessions.splitGroupId, splitGroupId)
          )
        );
    }

    // Update split group timestamp
    await tx
      .update(splitGroups)
      .set({ updatedAt: now })
      .where(eq(splitGroups.id, splitGroupId));
  });
}

/**
 * Change split direction (horizontal <-> vertical)
 */
export async function changeSplitDirection(
  userId: string,
  splitGroupId: string,
  direction: SplitDirection
): Promise<SplitGroup> {
  const [updated] = await db
    .update(splitGroups)
    .set({
      direction,
      updatedAt: new Date(),
    })
    .where(
      and(eq(splitGroups.id, splitGroupId), eq(splitGroups.userId, userId))
    )
    .returning();

  if (!updated) {
    throw new SplitServiceError(
      "Split group not found",
      "SPLIT_NOT_FOUND",
      splitGroupId
    );
  }

  return {
    id: updated.id,
    userId: updated.userId,
    direction: updated.direction as SplitDirection,
    createdAt: new Date(updated.createdAt),
    updatedAt: new Date(updated.updatedAt),
  };
}

/**
 * Get session-to-split mappings for a user
 */
export async function getSessionSplitMappings(
  userId: string
): Promise<Record<string, { splitGroupId: string; order: number; size: number }>> {
  const sessions = await db.query.terminalSessions.findMany({
    where: eq(terminalSessions.userId, userId),
    columns: {
      id: true,
      splitGroupId: true,
      splitOrder: true,
      splitSize: true,
    },
  });

  const mappings: Record<string, { splitGroupId: string; order: number; size: number }> = {};
  for (const session of sessions) {
    if (session.splitGroupId) {
      mappings[session.id] = {
        splitGroupId: session.splitGroupId,
        order: session.splitOrder,
        size: session.splitSize ?? 0.5,
      };
    }
  }
  return mappings;
}
