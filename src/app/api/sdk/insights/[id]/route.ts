/**
 * SDK Insight Entry API Routes
 *
 * Provides single insight operations: get, update, delete.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  sdkInsights,
  type InsightType,
  type InsightApplicability,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";

/**
 * GET /api/sdk/insights/:id - Get a single insight
 */
export const GET = withApiAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Insight ID is required" },
        { status: 400 }
      );
    }

    const [insight] = await db
      .select()
      .from(sdkInsights)
      .where(and(eq(sdkInsights.id, id), eq(sdkInsights.userId, userId)))
      .limit(1);

    if (!insight) {
      return NextResponse.json({ error: "Insight not found" }, { status: 404 });
    }

    // Parse JSON fields for response
    return NextResponse.json({
      ...insight,
      sourceNotes: JSON.parse(insight.sourceNotesJson),
      sourceSessions: insight.sourceSessionsJson
        ? JSON.parse(insight.sourceSessionsJson)
        : [],
    });
  } catch (error) {
    console.error("Failed to get insight:", error);
    return NextResponse.json(
      { error: "Failed to get insight" },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/sdk/insights/:id - Update an insight
 *
 * Updatable fields:
 * - type: Insight type
 * - applicability: Applicability scope
 * - title: Insight title
 * - description: Insight description
 * - applicabilityContext: Specific context
 * - confidence: Confidence score (0.0 to 1.0)
 * - verified: Verified by user
 * - active: Active status
 */
export const PATCH = withApiAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Insight ID is required" },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Build updates object
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.type !== undefined) {
      const validTypes: InsightType[] = [
        "convention",
        "pattern",
        "anti_pattern",
        "skill",
        "gotcha",
        "best_practice",
        "dependency",
        "performance",
      ];
      if (!validTypes.includes(body.type)) {
        return NextResponse.json(
          { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
          { status: 400 }
        );
      }
      updates.type = body.type;
    }
    if (body.applicability !== undefined) {
      const validApplicability: InsightApplicability[] = [
        "session",
        "folder",
        "global",
        "language",
        "framework",
      ];
      if (!validApplicability.includes(body.applicability)) {
        return NextResponse.json(
          {
            error: `Invalid applicability. Must be one of: ${validApplicability.join(", ")}`,
          },
          { status: 400 }
        );
      }
      updates.applicability = body.applicability;
    }
    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.applicabilityContext !== undefined)
      updates.applicabilityContext = body.applicabilityContext;
    if (body.confidence !== undefined) {
      if (body.confidence < 0 || body.confidence > 1) {
        return NextResponse.json(
          { error: "confidence must be between 0.0 and 1.0" },
          { status: 400 }
        );
      }
      updates.confidence = body.confidence;
    }
    if (body.verified !== undefined) updates.verified = body.verified;
    if (body.active !== undefined) updates.active = body.active;

    const [updated] = await db
      .update(sdkInsights)
      .set(updates)
      .where(and(eq(sdkInsights.id, id), eq(sdkInsights.userId, userId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Insight not found" }, { status: 404 });
    }

    // Parse JSON fields for response
    return NextResponse.json({
      ...updated,
      sourceNotes: JSON.parse(updated.sourceNotesJson),
      sourceSessions: updated.sourceSessionsJson
        ? JSON.parse(updated.sourceSessionsJson)
        : [],
    });
  } catch (error) {
    console.error("Failed to update insight:", error);
    return NextResponse.json(
      { error: "Failed to update insight" },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/sdk/insights/:id - Delete an insight
 */
export const DELETE = withApiAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Insight ID is required" },
        { status: 400 }
      );
    }

    const result = await db
      .delete(sdkInsights)
      .where(and(eq(sdkInsights.id, id), eq(sdkInsights.userId, userId)))
      .returning({ id: sdkInsights.id });

    if (result.length === 0) {
      return NextResponse.json({ error: "Insight not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete insight:", error);
    return NextResponse.json(
      { error: "Failed to delete insight" },
      { status: 500 }
    );
  }
});

/**
 * POST /api/sdk/insights/:id/apply - Record an insight application
 */
export const POST = withApiAuth(async (request, { userId, params }) => {
  try {
    const id = params?.id;
    if (!id) {
      return NextResponse.json(
        { error: "Insight ID is required" },
        { status: 400 }
      );
    }

    // Increment application count
    const [updated] = await db
      .update(sdkInsights)
      .set({
        applicationCount: sql`${sdkInsights.applicationCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(sdkInsights.id, id), eq(sdkInsights.userId, userId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Insight not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      applicationCount: updated.applicationCount,
    });
  } catch (error) {
    console.error("Failed to record insight application:", error);
    return NextResponse.json(
      { error: "Failed to record insight application" },
      { status: 500 }
    );
  }
});
