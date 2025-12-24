/**
 * SplitService - Manages terminal split group operations
 */
import { db } from "@/db";
import { splitGroups, terminalSessions } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
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

  const result: SplitGroupWithSessions[] = [];

  for (const group of groups) {
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

    result.push({
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
    });
  }

  return result;
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
 * Add a session to an existing split group
 */
export async function addToSplit(
  userId: string,
  splitGroupId: string,
  existingSessionId?: string,
  newSessionName?: string
): Promise<SplitGroupWithSessions> {
  // Verify split group exists
  const group = await db.query.splitGroups.findFirst({
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

  // Get current sessions in the split
  const currentSessions = await db.query.terminalSessions.findMany({
    where: eq(terminalSessions.splitGroupId, splitGroupId),
    orderBy: [asc(terminalSessions.splitOrder)],
  });

  const nextOrder = currentSessions.length;
  const newSize = 1 / (nextOrder + 1);

  // Redistribute sizes for existing sessions
  for (let i = 0; i < currentSessions.length; i++) {
    await db
      .update(terminalSessions)
      .set({
        splitSize: newSize,
        updatedAt: new Date(),
      })
      .where(eq(terminalSessions.id, currentSessions[i].id));
  }

  if (existingSessionId) {
    // Add existing session to split
    await db
      .update(terminalSessions)
      .set({
        splitGroupId,
        splitOrder: nextOrder,
        splitSize: newSize,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(terminalSessions.id, existingSessionId),
          eq(terminalSessions.userId, userId)
        )
      );
  } else {
    // Create new session (inherit folder from first session in split)
    const name = newSessionName || `Terminal ${nextOrder + 1}`;
    const firstSession = currentSessions[0];
    const newSession = await SessionService.createSession(userId, {
      name,
      projectPath: firstSession?.projectPath ?? undefined,
      folderId: firstSession?.folderId ?? undefined,
    });

    await db
      .update(terminalSessions)
      .set({
        splitGroupId,
        splitOrder: nextOrder,
        splitSize: newSize,
        updatedAt: new Date(),
      })
      .where(eq(terminalSessions.id, newSession.id));
  }

  // Return updated split group
  return getSplitGroup(splitGroupId, userId) as Promise<SplitGroupWithSessions>;
}

/**
 * Remove a session from a split group (unsplit)
 * If only one session remains, deletes the split group
 */
export async function removeFromSplit(
  userId: string,
  sessionId: string
): Promise<void> {
  const session = await db.query.terminalSessions.findFirst({
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
  await db
    .update(terminalSessions)
    .set({
      splitGroupId: null,
      splitOrder: 0,
      splitSize: 0.5,
      updatedAt: new Date(),
    })
    .where(eq(terminalSessions.id, sessionId));

  // Check remaining sessions in split
  const remainingSessions = await db.query.terminalSessions.findMany({
    where: eq(terminalSessions.splitGroupId, splitGroupId),
    orderBy: [asc(terminalSessions.splitOrder)],
  });

  if (remainingSessions.length <= 1) {
    // Only one or zero sessions left, dissolve the split
    for (const s of remainingSessions) {
      await db
        .update(terminalSessions)
        .set({
          splitGroupId: null,
          splitOrder: 0,
          splitSize: 0.5,
          updatedAt: new Date(),
        })
        .where(eq(terminalSessions.id, s.id));
    }

    await db.delete(splitGroups).where(eq(splitGroups.id, splitGroupId));
  } else {
    // Redistribute sizes
    const newSize = 1 / remainingSessions.length;
    for (let i = 0; i < remainingSessions.length; i++) {
      await db
        .update(terminalSessions)
        .set({
          splitOrder: i,
          splitSize: newSize,
          updatedAt: new Date(),
        })
        .where(eq(terminalSessions.id, remainingSessions[i].id));
    }
  }
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
  // Verify split group exists
  const group = await db.query.splitGroups.findFirst({
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

  // Update each session's size
  for (let i = 0; i < layout.length; i++) {
    const { sessionId, size } = layout[i];
    await db
      .update(terminalSessions)
      .set({
        splitOrder: i,
        splitSize: size,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(terminalSessions.id, sessionId),
          eq(terminalSessions.splitGroupId, splitGroupId)
        )
      );
  }

  // Update split group timestamp
  await db
    .update(splitGroups)
    .set({ updatedAt: new Date() })
    .where(eq(splitGroups.id, splitGroupId));
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
