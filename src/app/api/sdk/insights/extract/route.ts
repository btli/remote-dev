/**
 * SDK Insights Extraction API Route
 *
 * Triggers insight extraction from notes.
 * Analyzes note patterns to generate consolidated insights.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  sdkNotes,
  sdkInsights,
  type NoteType,
  type InsightType,
  type InsightApplicability,
} from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { withApiAuth } from "@/lib/api";

/**
 * Extraction configuration
 */
interface ExtractionConfig {
  /** Minimum notes with same pattern to generate insight */
  minNoteFrequency: number;
  /** Base confidence for extracted insights */
  baseConfidence: number;
  /** Confidence boost per additional occurrence */
  frequencyBoost: number;
  /** Maximum confidence */
  maxConfidence: number;
}

const DEFAULT_CONFIG: ExtractionConfig = {
  minNoteFrequency: 2,
  baseConfidence: 0.5,
  frequencyBoost: 0.1,
  maxConfidence: 0.95,
};

/**
 * Keywords for insight type classification
 */
const INSIGHT_KEYWORDS: Record<InsightType, string[]> = {
  convention: [
    "convention",
    "standard",
    "style",
    "naming",
    "format",
    "structure",
    "organize",
  ],
  pattern: [
    "pattern",
    "approach",
    "solution",
    "technique",
    "method",
    "way",
    "strategy",
  ],
  anti_pattern: [
    "avoid",
    "don't",
    "never",
    "bad",
    "wrong",
    "mistake",
    "anti-pattern",
  ],
  skill: ["skill", "ability", "capability", "how to", "can", "learn"],
  gotcha: [
    "gotcha",
    "pitfall",
    "trap",
    "watch out",
    "careful",
    "issue",
    "problem",
    "bug",
  ],
  best_practice: [
    "best practice",
    "recommended",
    "prefer",
    "should",
    "always",
    "better",
  ],
  dependency: [
    "depends",
    "requires",
    "needs",
    "prerequisite",
    "before",
    "after",
  ],
  performance: [
    "performance",
    "speed",
    "slow",
    "fast",
    "optimize",
    "efficient",
    "memory",
  ],
};

/**
 * Map note types to potential insight types
 */
const NOTE_TO_INSIGHT_TYPE: Record<NoteType, InsightType[]> = {
  observation: ["pattern", "convention", "best_practice"],
  decision: ["convention", "pattern", "best_practice"],
  gotcha: ["gotcha", "anti_pattern"],
  pattern: ["pattern", "convention"],
  question: ["skill", "dependency"],
  todo: ["skill", "best_practice"],
  reference: ["dependency", "pattern"],
};

/**
 * Classify content into insight type based on keywords
 */
function classifyInsightType(
  content: string,
  noteType: NoteType
): InsightType {
  const contentLower = content.toLowerCase();
  const candidateTypes = NOTE_TO_INSIGHT_TYPE[noteType];

  // Score each candidate type by keyword matches
  let bestType = candidateTypes[0];
  let bestScore = 0;

  for (const type of candidateTypes) {
    const keywords = INSIGHT_KEYWORDS[type];
    const score = keywords.filter((kw) => contentLower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  return bestType;
}

/**
 * Extract common themes from note tags
 */
function extractThemes(notes: Array<{ tagsJson: string }>): Map<string, number> {
  const tagCounts = new Map<string, number>();

  for (const note of notes) {
    const tags: string[] = JSON.parse(note.tagsJson);
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  return tagCounts;
}

/**
 * Calculate confidence based on frequency
 */
function calculateConfidence(
  count: number,
  config: ExtractionConfig
): number {
  const confidence =
    config.baseConfidence + (count - 1) * config.frequencyBoost;
  return Math.min(confidence, config.maxConfidence);
}

/**
 * POST /api/sdk/insights/extract - Extract insights from notes
 *
 * Request body:
 * - scope: "user" | "folder" | "session"
 * - folderId: Required if scope is "folder"
 * - sessionId: Required if scope is "session"
 * - noteTypes: Optional array of note types to include
 * - config: Optional extraction configuration overrides
 */
export const POST = withApiAuth(async (request, { userId }) => {
  try {
    const body = await request.json();
    const {
      scope = "user",
      folderId,
      sessionId,
      noteTypes,
      config: userConfig,
    } = body;

    // Validate scope parameters
    if (scope === "folder" && !folderId) {
      return NextResponse.json(
        { error: "folderId is required for folder scope" },
        { status: 400 }
      );
    }
    if (scope === "session" && !sessionId) {
      return NextResponse.json(
        { error: "sessionId is required for session scope" },
        { status: 400 }
      );
    }

    const config: ExtractionConfig = { ...DEFAULT_CONFIG, ...userConfig };

    // Build query conditions
    const conditions = [
      eq(sdkNotes.userId, userId),
      eq(sdkNotes.archived, false),
    ];

    if (scope === "folder" && folderId) {
      conditions.push(eq(sdkNotes.folderId, folderId));
    }
    if (scope === "session" && sessionId) {
      conditions.push(eq(sdkNotes.sessionId, sessionId));
    }
    if (noteTypes && noteTypes.length > 0) {
      conditions.push(inArray(sdkNotes.type, noteTypes));
    }

    // Fetch notes
    const notes = await db
      .select()
      .from(sdkNotes)
      .where(and(...conditions))
      .orderBy(desc(sdkNotes.createdAt));

    if (notes.length === 0) {
      return NextResponse.json({
        extracted: 0,
        insights: [],
        message: "No notes found matching criteria",
      });
    }

    // Group notes by type
    const notesByType = new Map<NoteType, typeof notes>();
    for (const note of notes) {
      const typeNotes = notesByType.get(note.type as NoteType) || [];
      typeNotes.push(note);
      notesByType.set(note.type as NoteType, typeNotes);
    }

    // Extract insights
    const extractedInsights: Array<{
      type: InsightType;
      applicability: InsightApplicability;
      title: string;
      description: string;
      sourceNotes: string[];
      confidence: number;
    }> = [];

    // 1. Extract from high-priority gotchas
    const gotchaNotes = notesByType.get("gotcha") || [];
    for (const note of gotchaNotes) {
      if ((note.priority ?? 0) >= 0.7) {
        extractedInsights.push({
          type: "gotcha",
          applicability: scope === "session" ? "session" : "folder",
          title: note.title || `Gotcha: ${note.content.slice(0, 50)}`,
          description: note.content,
          sourceNotes: [note.id],
          confidence: calculateConfidence(1, config) + 0.1, // Boost for high priority
        });
      }
    }

    // 2. Extract from decisions
    const decisionNotes = notesByType.get("decision") || [];
    if (decisionNotes.length >= config.minNoteFrequency) {
      // Group by similar content (simplified: by first tag)
      const decisionGroups = new Map<string, typeof notes>();
      for (const note of decisionNotes) {
        const tags: string[] = JSON.parse(note.tagsJson);
        const key = tags[0] || "general";
        const group = decisionGroups.get(key) || [];
        group.push(note);
        decisionGroups.set(key, group);
      }

      for (const [tag, group] of decisionGroups) {
        if (group.length >= config.minNoteFrequency) {
          extractedInsights.push({
            type: "convention",
            applicability: "folder",
            title: `Convention: ${tag}`,
            description: group
              .map((n) => n.content)
              .join("\n\n---\n\n")
              .slice(0, 2000),
            sourceNotes: group.map((n) => n.id),
            confidence: calculateConfidence(group.length, config),
          });
        }
      }
    }

    // 3. Extract patterns from recurring tags
    const themes = extractThemes(notes);
    for (const [tag, count] of themes) {
      if (count >= config.minNoteFrequency) {
        const tagNotes = notes.filter((n) =>
          (JSON.parse(n.tagsJson) as string[]).includes(tag)
        );

        // Classify based on predominant note type
        const typeCounts = new Map<NoteType, number>();
        for (const note of tagNotes) {
          const type = note.type as NoteType;
          typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        }
        const predominantType = [...typeCounts.entries()].sort(
          (a, b) => b[1] - a[1]
        )[0][0];

        const insightType = classifyInsightType(
          tagNotes.map((n) => n.content).join(" "),
          predominantType
        );

        // Check if we already have a similar insight
        const existingSimilar = extractedInsights.find(
          (i) =>
            i.title.toLowerCase().includes(tag.toLowerCase()) ||
            i.sourceNotes.some((id) => tagNotes.some((n) => n.id === id))
        );

        if (!existingSimilar) {
          extractedInsights.push({
            type: insightType,
            applicability: "folder",
            title: `${insightType.charAt(0).toUpperCase() + insightType.slice(1).replace("_", " ")}: ${tag}`,
            description: `Recurring theme (${count} occurrences): ${tagNotes
              .slice(0, 3)
              .map((n) => n.content.slice(0, 200))
              .join("\n\n")}`,
            sourceNotes: tagNotes.map((n) => n.id),
            confidence: calculateConfidence(count, config),
          });
        }
      }
    }

    // 4. Save extracted insights to database
    const savedInsights = [];
    for (const insight of extractedInsights) {
      const [saved] = await db
        .insert(sdkInsights)
        .values({
          userId,
          folderId: folderId || null,
          type: insight.type,
          applicability: insight.applicability,
          title: insight.title,
          description: insight.description,
          sourceNotesJson: JSON.stringify(insight.sourceNotes),
          sourceSessionsJson: sessionId ? JSON.stringify([sessionId]) : "[]",
          confidence: insight.confidence,
          applicationCount: 0,
          feedbackScore: 0.0,
          verified: false,
          active: true,
        })
        .returning();

      savedInsights.push({
        ...saved,
        sourceNotes: insight.sourceNotes,
        sourceSessions: sessionId ? [sessionId] : [],
      });
    }

    return NextResponse.json({
      extracted: savedInsights.length,
      insights: savedInsights,
      notesAnalyzed: notes.length,
    });
  } catch (error) {
    console.error("Failed to extract insights:", error);
    return NextResponse.json(
      { error: "Failed to extract insights" },
      { status: 500 }
    );
  }
});
