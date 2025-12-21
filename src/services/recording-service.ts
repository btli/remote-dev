import { db } from "@/db";
import { sessionRecordings } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import type {
  SessionRecording,
  ParsedRecording,
  CreateRecordingInput,
  UpdateRecordingInput,
} from "@/types/recording";

/**
 * Get all recordings for a user, ordered by creation date (newest first)
 */
export async function getRecordings(userId: string): Promise<SessionRecording[]> {
  const results = await db
    .select()
    .from(sessionRecordings)
    .where(eq(sessionRecordings.userId, userId))
    .orderBy(desc(sessionRecordings.createdAt));

  return results;
}

/**
 * Get a single recording by ID
 */
export async function getRecording(
  recordingId: string,
  userId: string
): Promise<SessionRecording | null> {
  const results = await db
    .select()
    .from(sessionRecordings)
    .where(
      and(
        eq(sessionRecordings.id, recordingId),
        eq(sessionRecordings.userId, userId)
      )
    );

  return results[0] ?? null;
}

/**
 * Get a recording and parse its data
 */
export async function getParsedRecording(
  recordingId: string,
  userId: string
): Promise<ParsedRecording | null> {
  const recording = await getRecording(recordingId, userId);
  if (!recording) return null;

  return {
    ...recording,
    data: JSON.parse(recording.data),
  };
}

/**
 * Create a new recording
 */
export async function createRecording(
  userId: string,
  input: CreateRecordingInput
): Promise<SessionRecording> {
  const [recording] = await db
    .insert(sessionRecordings)
    .values({
      userId,
      sessionId: input.sessionId ?? null,
      name: input.name,
      description: input.description ?? null,
      duration: input.duration,
      terminalCols: input.terminalCols,
      terminalRows: input.terminalRows,
      data: JSON.stringify(input.data),
    })
    .returning();

  return recording;
}

/**
 * Update an existing recording (name/description only)
 */
export async function updateRecording(
  recordingId: string,
  userId: string,
  input: UpdateRecordingInput
): Promise<SessionRecording | null> {
  const results = await db
    .update(sessionRecordings)
    .set(input)
    .where(
      and(
        eq(sessionRecordings.id, recordingId),
        eq(sessionRecordings.userId, userId)
      )
    )
    .returning();

  return results[0] ?? null;
}

/**
 * Delete a recording
 */
export async function deleteRecording(
  recordingId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(sessionRecordings)
    .where(
      and(
        eq(sessionRecordings.id, recordingId),
        eq(sessionRecordings.userId, userId)
      )
    )
    .returning({ id: sessionRecordings.id });

  return result.length > 0;
}

/**
 * Format duration as human-readable string (e.g., "2:34" or "1:02:34")
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
