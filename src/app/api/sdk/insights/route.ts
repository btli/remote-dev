/**
 * SDK Insights API Routes
 *
 * Provides read and management operations for extracted insights.
 * Insights are consolidated knowledge extracted from notes and session analysis.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  sdkInsights,
  type InsightType,
  type InsightApplicability,
} from "@/db/schema";
import { eq, and, like, desc, asc, gte, inArray, or, isNull } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";
import { getFolderWithAncestorIds } from "@/services/folder-service";

/**
 * POST /api/sdk/insights - Create a new insight manually
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const {
      folderId,
      type,
      applicability = "folder",
      title,
      description,
      applicabilityContext,
      sourceNotes = [],
      sourceSessions = [],
      confidence = 0.5,
    } = body;

    // Validate required fields
    if (!type || !title || !description) {
      return NextResponse.json(
        { error: "type, title, and description are required" },
        { status: 400 }
      );
    }

    // Validate type
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
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate applicability
    const validApplicability: InsightApplicability[] = [
      "session",
      "folder",
      "global",
      "language",
      "framework",
    ];
    if (!validApplicability.includes(applicability)) {
      return NextResponse.json(
        {
          error: `Invalid applicability. Must be one of: ${validApplicability.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Validate confidence range
    if (confidence < 0 || confidence > 1) {
      return NextResponse.json(
        { error: "confidence must be between 0.0 and 1.0" },
        { status: 400 }
      );
    }

    const [insight] = await db
      .insert(sdkInsights)
      .values({
        userId,
        folderId: folderId || null,
        type: type as InsightType,
        applicability: applicability as InsightApplicability,
        title,
        description,
        applicabilityContext: applicabilityContext || null,
        sourceNotesJson: JSON.stringify(sourceNotes),
        sourceSessionsJson: JSON.stringify(sourceSessions),
        confidence,
        applicationCount: 0,
        feedbackScore: 0.0,
        verified: false,
        active: true,
      })
      .returning();

    // Parse JSON fields for response
    return NextResponse.json(
      {
        ...insight,
        sourceNotes: JSON.parse(insight.sourceNotesJson),
        sourceSessions: insight.sourceSessionsJson
          ? JSON.parse(insight.sourceSessionsJson)
          : [],
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create insight:", error);
    return NextResponse.json(
      { error: "Failed to create insight" },
      { status: 500 }
    );
  }
});

/**
 * GET /api/sdk/insights - Query insights with folder inheritance
 *
 * Insights are folder-scoped with inheritance from parent folders.
 * When querying a subfolder, insights from all ancestor folders are included.
 *
 * Query params:
 * - folderId: Filter by folder (includes inherited insights from ancestors)
 * - type: Filter by insight type
 * - applicability: Filter by applicability scope
 * - applicabilityContext: Filter by specific context (e.g., "typescript")
 * - search: Search in title and description
 * - minConfidence: Minimum confidence score
 * - verified: Filter by verified status (true/false)
 * - active: Filter by active status (true/false) - default: true
 * - sortBy: Sort field (createdAt, confidence, applicationCount, feedbackScore)
 * - sortOrder: asc or desc - default: desc
 * - limit: Max results - default: 50
 * - inherit: Enable folder inheritance (default: true)
 */
export const GET = withApiAuth(async (request, { userId }) => {
  try {
    const url = new URL(request.url);
    const folderId = url.searchParams.get("folderId");
    const type = url.searchParams.get("type") as InsightType | null;
    const applicability = url.searchParams.get(
      "applicability"
    ) as InsightApplicability | null;
    const applicabilityContext = url.searchParams.get("applicabilityContext");
    const search = url.searchParams.get("search");
    const minConfidence = url.searchParams.get("minConfidence");
    const verifiedParam = url.searchParams.get("verified");
    const activeParam = url.searchParams.get("active");
    const sortBy = url.searchParams.get("sortBy") || "createdAt";
    const sortOrder = url.searchParams.get("sortOrder") || "desc";
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const inheritParam = url.searchParams.get("inherit");
    const inherit = inheritParam !== "false"; // Default to true

    // Build query conditions
    const conditions = [eq(sdkInsights.userId, userId)];

    // Default to active only
    if (activeParam === "false") {
      conditions.push(eq(sdkInsights.active, false));
    } else if (activeParam === "all") {
      // Include both active and inactive
    } else {
      // Default: active only
      conditions.push(eq(sdkInsights.active, true));
    }

    // Folder inheritance: include insights from folder + all ancestors + user-level
    if (folderId) {
      if (inherit) {
        // Get folder and all ancestor folder IDs
        const folderIds = await getFolderWithAncestorIds(folderId, userId);
        // Include insights from any of these folders OR user-level insights (null folderId)
        conditions.push(
          or(
            inArray(sdkInsights.folderId, folderIds),
            isNull(sdkInsights.folderId)
          )!
        );
      } else {
        // Exact match only (no inheritance)
        conditions.push(eq(sdkInsights.folderId, folderId));
      }
    }
    // If no folderId specified, return all user insights (no folder filter)

    if (type) {
      conditions.push(eq(sdkInsights.type, type));
    }
    if (applicability) {
      conditions.push(eq(sdkInsights.applicability, applicability));
    }
    if (applicabilityContext) {
      conditions.push(
        eq(sdkInsights.applicabilityContext, applicabilityContext)
      );
    }
    if (search) {
      // Search in title or description
      conditions.push(like(sdkInsights.title, `%${search}%`));
    }
    if (minConfidence) {
      conditions.push(gte(sdkInsights.confidence, parseFloat(minConfidence)));
    }
    if (verifiedParam === "true") {
      conditions.push(eq(sdkInsights.verified, true));
    } else if (verifiedParam === "false") {
      conditions.push(eq(sdkInsights.verified, false));
    }

    // Determine sort column and order
    const sortColumn =
      sortBy === "confidence"
        ? sdkInsights.confidence
        : sortBy === "applicationCount"
        ? sdkInsights.applicationCount
        : sortBy === "feedbackScore"
        ? sdkInsights.feedbackScore
        : sdkInsights.createdAt;
    const orderFn = sortOrder === "asc" ? asc : desc;

    const insights = await db
      .select()
      .from(sdkInsights)
      .where(and(...conditions))
      .orderBy(orderFn(sortColumn))
      .limit(limit);

    // Parse JSON fields and add inheritance info
    const parsedInsights = insights.map((insight) => ({
      ...insight,
      sourceNotes: JSON.parse(insight.sourceNotesJson),
      sourceSessions: insight.sourceSessionsJson
        ? JSON.parse(insight.sourceSessionsJson)
        : [],
      // Mark if this insight is inherited (from a parent folder)
      inherited: folderId ? insight.folderId !== folderId : false,
    }));

    return NextResponse.json(parsedInsights);
  } catch (error) {
    console.error("Failed to query insights:", error);
    return NextResponse.json(
      { error: "Failed to query insights" },
      { status: 500 }
    );
  }
});
