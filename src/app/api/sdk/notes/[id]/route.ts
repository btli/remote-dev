/**
 * SDK Note Entry API Routes
 *
 * Provides single note operations: get, update, delete.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sdkNotes, type NoteType } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";

/**
 * GET /api/sdk/notes/:id - Get a single note
 */
export const GET = withApiAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Note ID is required" },
        { status: 400 }
      );
    }

    const [note] = await db
      .select()
      .from(sdkNotes)
      .where(and(eq(sdkNotes.id, id), eq(sdkNotes.userId, userId)))
      .limit(1);

    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Parse JSON fields for response
    return NextResponse.json({
      ...note,
      tags: JSON.parse(note.tagsJson),
      context: note.contextJson ? JSON.parse(note.contextJson) : null,
    });
  } catch (error) {
    console.error("Failed to get note:", error);
    return NextResponse.json(
      { error: "Failed to get note" },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/sdk/notes/:id - Update a note
 *
 * Updatable fields:
 * - type: Note type
 * - title: Short title
 * - content: Note content
 * - tags: Tags array
 * - context: Context object
 * - priority: Priority (0.0 to 1.0)
 * - pinned: Pinned status
 * - archived: Archived status
 */
export const PATCH = withApiAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Note ID is required" },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Build updates object
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.type !== undefined) {
      const validTypes: NoteType[] = [
        "observation",
        "decision",
        "gotcha",
        "pattern",
        "question",
        "todo",
        "reference",
      ];
      if (!validTypes.includes(body.type)) {
        return NextResponse.json(
          { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
          { status: 400 }
        );
      }
      updates.type = body.type;
    }
    if (body.title !== undefined) updates.title = body.title;
    if (body.content !== undefined) updates.content = body.content;
    if (body.tags !== undefined) updates.tagsJson = JSON.stringify(body.tags);
    if (body.context !== undefined)
      updates.contextJson = JSON.stringify(body.context);
    if (body.priority !== undefined) {
      if (body.priority < 0 || body.priority > 1) {
        return NextResponse.json(
          { error: "priority must be between 0.0 and 1.0" },
          { status: 400 }
        );
      }
      updates.priority = body.priority;
    }
    if (body.pinned !== undefined) updates.pinned = body.pinned;
    if (body.archived !== undefined) updates.archived = body.archived;

    const [updated] = await db
      .update(sdkNotes)
      .set(updates)
      .where(and(eq(sdkNotes.id, id), eq(sdkNotes.userId, userId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Parse JSON fields for response
    return NextResponse.json({
      ...updated,
      tags: JSON.parse(updated.tagsJson),
      context: updated.contextJson ? JSON.parse(updated.contextJson) : null,
    });
  } catch (error) {
    console.error("Failed to update note:", error);
    return NextResponse.json(
      { error: "Failed to update note" },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/sdk/notes/:id - Delete a note
 */
export const DELETE = withApiAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Note ID is required" },
        { status: 400 }
      );
    }

    const result = await db
      .delete(sdkNotes)
      .where(and(eq(sdkNotes.id, id), eq(sdkNotes.userId, userId)))
      .returning({ id: sdkNotes.id });

    if (result.length === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete note:", error);
    return NextResponse.json(
      { error: "Failed to delete note" },
      { status: 500 }
    );
  }
});
