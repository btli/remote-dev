/**
 * SDK Notes API Routes
 *
 * Provides CRUD operations for the note-taking service.
 * Notes are captured observations, decisions, gotchas, and patterns during coding sessions.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sdkNotes, type NoteType } from "@/db/schema";
import { eq, and, like, desc, asc } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";

/**
 * POST /api/sdk/notes - Create a new note
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const {
      sessionId,
      folderId,
      type = "observation",
      title,
      content,
      tags = [],
      context,
      priority = 0.5,
      pinned = false,
    } = body;

    // Validate required fields
    if (!content) {
      return NextResponse.json(
        { error: "content is required" },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes: NoteType[] = [
      "observation",
      "decision",
      "gotcha",
      "pattern",
      "question",
      "todo",
      "reference",
    ];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate priority range
    if (priority < 0 || priority > 1) {
      return NextResponse.json(
        { error: "priority must be between 0.0 and 1.0" },
        { status: 400 }
      );
    }

    const [note] = await db
      .insert(sdkNotes)
      .values({
        userId,
        sessionId: sessionId || null,
        folderId: folderId || null,
        type: type as NoteType,
        title: title || null,
        content,
        tagsJson: JSON.stringify(tags),
        contextJson: context ? JSON.stringify(context) : "{}",
        priority,
        pinned,
        archived: false,
      })
      .returning();

    // Parse JSON fields for response
    return NextResponse.json(
      {
        ...note,
        tags: JSON.parse(note.tagsJson),
        context: note.contextJson ? JSON.parse(note.contextJson) : null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create note:", error);
    return NextResponse.json(
      { error: "Failed to create note" },
      { status: 500 }
    );
  }
});

/**
 * GET /api/sdk/notes - Query notes
 *
 * Query params:
 * - sessionId: Filter by session
 * - folderId: Filter by folder
 * - type: Filter by note type
 * - tag: Filter by tag (searches within tagsJson)
 * - search: Search in content
 * - pinned: Filter by pinned status (true/false)
 * - archived: Include archived notes (default: false)
 * - sortBy: Sort field (createdAt, updatedAt, priority) - default: createdAt
 * - sortOrder: asc or desc - default: desc
 * - limit: Max results - default: 50
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const folderId = url.searchParams.get("folderId");
    const type = url.searchParams.get("type") as NoteType | null;
    const tag = url.searchParams.get("tag");
    const search = url.searchParams.get("search");
    const pinnedParam = url.searchParams.get("pinned");
    const archivedParam = url.searchParams.get("archived");
    const sortBy = url.searchParams.get("sortBy") || "createdAt";
    const sortOrder = url.searchParams.get("sortOrder") || "desc";
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

    // Build query conditions
    const conditions = [eq(sdkNotes.userId, userId)];

    // Exclude archived by default
    if (archivedParam === "true") {
      conditions.push(eq(sdkNotes.archived, true));
    } else if (archivedParam === "only") {
      // Only archived notes
      conditions.push(eq(sdkNotes.archived, true));
    } else {
      // Default: exclude archived
      conditions.push(eq(sdkNotes.archived, false));
    }

    if (sessionId) {
      conditions.push(eq(sdkNotes.sessionId, sessionId));
    }
    if (folderId) {
      conditions.push(eq(sdkNotes.folderId, folderId));
    }
    if (type) {
      conditions.push(eq(sdkNotes.type, type));
    }
    if (tag) {
      // Search for tag in JSON array
      conditions.push(like(sdkNotes.tagsJson, `%"${tag}"%`));
    }
    if (search) {
      conditions.push(like(sdkNotes.content, `%${search}%`));
    }
    if (pinnedParam === "true") {
      conditions.push(eq(sdkNotes.pinned, true));
    } else if (pinnedParam === "false") {
      conditions.push(eq(sdkNotes.pinned, false));
    }

    // Determine sort column and order
    const sortColumn =
      sortBy === "updatedAt"
        ? sdkNotes.updatedAt
        : sortBy === "priority"
        ? sdkNotes.priority
        : sdkNotes.createdAt;
    const orderFn = sortOrder === "asc" ? asc : desc;

    const notes = await db
      .select()
      .from(sdkNotes)
      .where(and(...conditions))
      .orderBy(orderFn(sortColumn))
      .limit(limit);

    // Parse JSON fields for response
    const parsedNotes = notes.map((note) => ({
      ...note,
      tags: JSON.parse(note.tagsJson),
      context: note.contextJson ? JSON.parse(note.contextJson) : null,
    }));

    return NextResponse.json(parsedNotes);
  } catch (error) {
    console.error("Failed to query notes:", error);
    return NextResponse.json(
      { error: "Failed to query notes" },
      { status: 500 }
    );
  }
});
