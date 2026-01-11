/**
 * SDK Memory Entry API Routes
 *
 * Provides single entry operations: get, update, delete.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sdkMemoryEntries } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";

/**
 * GET /api/sdk/memory/:id - Get a single memory entry
 */
export const GET = withApiAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Memory entry ID is required" },
        { status: 400 }
      );
    }

    const [entry] = await db
      .select()
      .from(sdkMemoryEntries)
      .where(
        and(eq(sdkMemoryEntries.id, id), eq(sdkMemoryEntries.userId, userId))
      )
      .limit(1);

    if (!entry) {
      return NextResponse.json(
        { error: "Memory entry not found" },
        { status: 404 }
      );
    }

    // Update access tracking
    await db
      .update(sdkMemoryEntries)
      .set({
        accessCount: sql`${sdkMemoryEntries.accessCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(eq(sdkMemoryEntries.id, id));

    return NextResponse.json(entry);
  } catch (error) {
    console.error("Failed to get memory entry:", error);
    return NextResponse.json(
      { error: "Failed to get memory entry" },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/sdk/memory/:id - Update a memory entry
 */
export const PATCH = withApiAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Memory entry ID is required" },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Only allow updating certain fields
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.tier !== undefined) updates.tier = body.tier;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.confidence !== undefined) updates.confidence = body.confidence;
    if (body.relevance !== undefined) updates.relevance = body.relevance;
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.metadata !== undefined)
      updates.metadataJson = JSON.stringify(body.metadata);

    const [updated] = await db
      .update(sdkMemoryEntries)
      .set(updates)
      .where(
        and(eq(sdkMemoryEntries.id, id), eq(sdkMemoryEntries.userId, userId))
      )
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "Memory entry not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update memory entry:", error);
    return NextResponse.json(
      { error: "Failed to update memory entry" },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/sdk/memory/:id - Delete a memory entry
 */
export const DELETE = withApiAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Memory entry ID is required" },
        { status: 400 }
      );
    }

    const result = await db
      .delete(sdkMemoryEntries)
      .where(
        and(eq(sdkMemoryEntries.id, id), eq(sdkMemoryEntries.userId, userId))
      )
      .returning({ id: sdkMemoryEntries.id });

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Memory entry not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete memory entry:", error);
    return NextResponse.json(
      { error: "Failed to delete memory entry" },
      { status: 500 }
    );
  }
});
