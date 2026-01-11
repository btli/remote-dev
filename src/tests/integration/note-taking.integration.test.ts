import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";
import { db } from "@/db";
import { sdkNotes, sdkInsights, users } from "@/db/schema";
import { eq, and, like } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * Integration tests for Note-Taking System
 *
 * Tests the note capture and insight extraction system:
 * - Note CRUD operations
 * - Tag management
 * - Filtering and search
 * - Pinning and archiving
 * - Insight extraction from notes
 *
 * These tests use the database directly without going through
 * the HTTP API layer, testing the data model and queries.
 */
describe("Note-Taking System", () => {
  // Test fixtures
  const testUserId = randomUUID();

  // Setup test user
  beforeAll(async () => {
    await db
      .insert(users)
      .values({
        id: testUserId,
        email: `test-notes-${testUserId}@example.com`,
        name: "Test Notes User",
      })
      .onConflictDoNothing();
  });

  // Cleanup test data
  afterEach(async () => {
    await db.delete(sdkNotes).where(eq(sdkNotes.userId, testUserId));
    await db.delete(sdkInsights).where(eq(sdkInsights.userId, testUserId));
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, testUserId));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Note CRUD Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Note Creation", () => {
    it("should create a note with minimal fields", async () => {
      const [note] = await db
        .insert(sdkNotes)
        .values({
          userId: testUserId,
          content: "Test observation note",
          type: "observation",
          tagsJson: "[]",
        })
        .returning();

      expect(note.id).toBeDefined();
      expect(note.content).toBe("Test observation note");
      expect(note.type).toBe("observation");
      expect(note.pinned).toBe(false);
      expect(note.archived).toBe(false);
    });

    it("should create a note with all fields", async () => {
      const [note] = await db
        .insert(sdkNotes)
        .values({
          userId: testUserId,
          content: "Found a bug in authentication flow",
          type: "gotcha",
          title: "Auth Bug",
          tagsJson: JSON.stringify(["bug", "auth", "critical"]),
          contextJson: JSON.stringify({
            file: "src/auth.ts",
            line: 42,
            snippet: "const token = await getToken();",
          }),
          priority: 0.9,
          pinned: true,
        })
        .returning();

      expect(note.title).toBe("Auth Bug");
      expect(note.type).toBe("gotcha");
      expect(note.priority).toBe(0.9);
      expect(note.pinned).toBe(true);

      const tags = JSON.parse(note.tagsJson);
      expect(tags).toContain("bug");
      expect(tags).toContain("auth");
      expect(tags).toContain("critical");

      const context = JSON.parse(note.contextJson!);
      expect(context.file).toBe("src/auth.ts");
      expect(context.line).toBe(42);
    });

    it("should create notes of all types", async () => {
      const noteTypes = [
        "observation",
        "decision",
        "gotcha",
        "pattern",
        "question",
        "todo",
        "reference",
      ] as const;

      for (const type of noteTypes) {
        const [note] = await db
          .insert(sdkNotes)
          .values({
            userId: testUserId,
            content: `Test ${type} note`,
            type,
            tagsJson: "[]",
          })
          .returning();

        expect(note.type).toBe(type);
      }

      const allNotes = await db
        .select()
        .from(sdkNotes)
        .where(eq(sdkNotes.userId, testUserId));

      expect(allNotes).toHaveLength(noteTypes.length);
    });
  });

  describe("Note Retrieval", () => {
    it("should retrieve notes by user", async () => {
      // Create multiple notes
      await db.insert(sdkNotes).values([
        { userId: testUserId, content: "Note 1", type: "observation", tagsJson: "[]" },
        { userId: testUserId, content: "Note 2", type: "decision", tagsJson: "[]" },
        { userId: testUserId, content: "Note 3", type: "gotcha", tagsJson: "[]" },
      ]);

      const notes = await db
        .select()
        .from(sdkNotes)
        .where(eq(sdkNotes.userId, testUserId));

      expect(notes).toHaveLength(3);
    });

    it("should filter notes by type", async () => {
      await db.insert(sdkNotes).values([
        { userId: testUserId, content: "Obs 1", type: "observation", tagsJson: "[]" },
        { userId: testUserId, content: "Obs 2", type: "observation", tagsJson: "[]" },
        { userId: testUserId, content: "Dec 1", type: "decision", tagsJson: "[]" },
      ]);

      const observations = await db
        .select()
        .from(sdkNotes)
        .where(and(eq(sdkNotes.userId, testUserId), eq(sdkNotes.type, "observation")));

      expect(observations).toHaveLength(2);
    });

    it("should filter notes by tag", async () => {
      await db.insert(sdkNotes).values([
        {
          userId: testUserId,
          content: "Bug note",
          type: "gotcha",
          tagsJson: JSON.stringify(["bug", "critical"]),
        },
        {
          userId: testUserId,
          content: "Feature note",
          type: "observation",
          tagsJson: JSON.stringify(["feature", "enhancement"]),
        },
        {
          userId: testUserId,
          content: "Another bug",
          type: "gotcha",
          tagsJson: JSON.stringify(["bug", "minor"]),
        },
      ]);

      // Search for notes with "bug" tag
      const bugNotes = await db
        .select()
        .from(sdkNotes)
        .where(
          and(eq(sdkNotes.userId, testUserId), like(sdkNotes.tagsJson, '%"bug"%'))
        );

      expect(bugNotes).toHaveLength(2);
    });

    it("should search notes by content", async () => {
      await db.insert(sdkNotes).values([
        {
          userId: testUserId,
          content: "The authentication flow has a bug",
          type: "gotcha",
          tagsJson: "[]",
        },
        {
          userId: testUserId,
          content: "Consider using OAuth for login",
          type: "decision",
          tagsJson: "[]",
        },
        {
          userId: testUserId,
          content: "Database connection pooling pattern",
          type: "pattern",
          tagsJson: "[]",
        },
      ]);

      const authNotes = await db
        .select()
        .from(sdkNotes)
        .where(
          and(
            eq(sdkNotes.userId, testUserId),
            like(sdkNotes.content, "%authentication%")
          )
        );

      expect(authNotes).toHaveLength(1);
      expect(authNotes[0].content).toContain("authentication");
    });

    it("should exclude archived notes by default query", async () => {
      await db.insert(sdkNotes).values([
        { userId: testUserId, content: "Active note", type: "observation", tagsJson: "[]", archived: false },
        { userId: testUserId, content: "Archived note", type: "observation", tagsJson: "[]", archived: true },
      ]);

      // Simulating "default" behavior: exclude archived
      const activeNotes = await db
        .select()
        .from(sdkNotes)
        .where(and(eq(sdkNotes.userId, testUserId), eq(sdkNotes.archived, false)));

      expect(activeNotes).toHaveLength(1);
      expect(activeNotes[0].content).toBe("Active note");
    });
  });

  describe("Note Updates", () => {
    it("should update note content", async () => {
      const [note] = await db
        .insert(sdkNotes)
        .values({
          userId: testUserId,
          content: "Original content",
          type: "observation",
          tagsJson: "[]",
        })
        .returning();

      const [updated] = await db
        .update(sdkNotes)
        .set({ content: "Updated content", updatedAt: new Date() })
        .where(eq(sdkNotes.id, note.id))
        .returning();

      expect(updated.content).toBe("Updated content");
    });

    it("should pin and unpin notes", async () => {
      const [note] = await db
        .insert(sdkNotes)
        .values({
          userId: testUserId,
          content: "Test note",
          type: "observation",
          tagsJson: "[]",
        })
        .returning();

      // Pin
      const [pinned] = await db
        .update(sdkNotes)
        .set({ pinned: true })
        .where(eq(sdkNotes.id, note.id))
        .returning();

      expect(pinned.pinned).toBe(true);

      // Unpin
      const [unpinned] = await db
        .update(sdkNotes)
        .set({ pinned: false })
        .where(eq(sdkNotes.id, note.id))
        .returning();

      expect(unpinned.pinned).toBe(false);
    });

    it("should archive and unarchive notes", async () => {
      const [note] = await db
        .insert(sdkNotes)
        .values({
          userId: testUserId,
          content: "Test note",
          type: "observation",
          tagsJson: "[]",
        })
        .returning();

      // Archive
      const [archived] = await db
        .update(sdkNotes)
        .set({ archived: true })
        .where(eq(sdkNotes.id, note.id))
        .returning();

      expect(archived.archived).toBe(true);

      // Unarchive
      const [unarchived] = await db
        .update(sdkNotes)
        .set({ archived: false })
        .where(eq(sdkNotes.id, note.id))
        .returning();

      expect(unarchived.archived).toBe(false);
    });

    it("should update note tags", async () => {
      const [note] = await db
        .insert(sdkNotes)
        .values({
          userId: testUserId,
          content: "Test note",
          type: "observation",
          tagsJson: JSON.stringify(["tag1", "tag2"]),
        })
        .returning();

      // Update tags
      const [updated] = await db
        .update(sdkNotes)
        .set({ tagsJson: JSON.stringify(["tag1", "tag2", "tag3"]) })
        .where(eq(sdkNotes.id, note.id))
        .returning();

      const tags = JSON.parse(updated.tagsJson);
      expect(tags).toHaveLength(3);
      expect(tags).toContain("tag3");
    });
  });

  describe("Note Deletion", () => {
    it("should delete a note", async () => {
      const [note] = await db
        .insert(sdkNotes)
        .values({
          userId: testUserId,
          content: "Test note",
          type: "observation",
          tagsJson: "[]",
        })
        .returning();

      await db.delete(sdkNotes).where(eq(sdkNotes.id, note.id));

      const result = await db
        .select()
        .from(sdkNotes)
        .where(eq(sdkNotes.id, note.id));

      expect(result).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Insight Operations
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Insight Creation", () => {
    it("should create an insight from notes", async () => {
      // First create some notes
      const notes = await db
        .insert(sdkNotes)
        .values([
          {
            userId: testUserId,
            content: "Always use async/await for database calls",
            type: "decision",
            tagsJson: JSON.stringify(["async", "database"]),
          },
          {
            userId: testUserId,
            content: "Use async/await pattern consistently",
            type: "pattern",
            tagsJson: JSON.stringify(["async", "best-practice"]),
          },
        ])
        .returning();

      // Create insight linking to those notes
      const [insight] = await db
        .insert(sdkInsights)
        .values({
          userId: testUserId,
          type: "convention",
          applicability: "folder",
          title: "Use async/await consistently",
          description: "Database operations should use async/await pattern",
          sourceNotesJson: JSON.stringify(notes.map((n) => n.id)),
          confidence: 0.75,
        })
        .returning();

      expect(insight.type).toBe("convention");
      expect(insight.applicability).toBe("folder");
      expect(insight.confidence).toBe(0.75);

      const sourceNotes = JSON.parse(insight.sourceNotesJson);
      expect(sourceNotes).toHaveLength(2);
    });

    it("should create insights of all types", async () => {
      const insightTypes = [
        "convention",
        "pattern",
        "anti_pattern",
        "skill",
        "gotcha",
        "best_practice",
        "dependency",
        "performance",
      ] as const;

      for (const type of insightTypes) {
        const [insight] = await db
          .insert(sdkInsights)
          .values({
            userId: testUserId,
            type,
            applicability: "folder",
            title: `Test ${type} insight`,
            description: `Description for ${type}`,
            sourceNotesJson: "[]",
            confidence: 0.5,
          })
          .returning();

        expect(insight.type).toBe(type);
      }

      const allInsights = await db
        .select()
        .from(sdkInsights)
        .where(eq(sdkInsights.userId, testUserId));

      expect(allInsights).toHaveLength(insightTypes.length);
    });

    it("should support different applicability scopes", async () => {
      const scopes = ["session", "folder", "global", "language", "framework"] as const;

      for (const scope of scopes) {
        const [insight] = await db
          .insert(sdkInsights)
          .values({
            userId: testUserId,
            type: "pattern",
            applicability: scope,
            title: `${scope} scoped insight`,
            description: "Test description",
            sourceNotesJson: "[]",
            confidence: 0.5,
          })
          .returning();

        expect(insight.applicability).toBe(scope);
      }
    });
  });

  describe("Insight Retrieval", () => {
    it("should filter insights by type", async () => {
      await db.insert(sdkInsights).values([
        {
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "Pattern 1",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.5,
        },
        {
          userId: testUserId,
          type: "gotcha",
          applicability: "folder",
          title: "Gotcha 1",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.5,
        },
        {
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "Pattern 2",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.5,
        },
      ]);

      const patterns = await db
        .select()
        .from(sdkInsights)
        .where(and(eq(sdkInsights.userId, testUserId), eq(sdkInsights.type, "pattern")));

      expect(patterns).toHaveLength(2);
    });

    it("should filter by confidence threshold", async () => {
      await db.insert(sdkInsights).values([
        {
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "High confidence",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.9,
        },
        {
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "Low confidence",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.3,
        },
      ]);

      const highConfidence = await db
        .select()
        .from(sdkInsights)
        .where(eq(sdkInsights.userId, testUserId))
        .then((rows) => rows.filter((r) => r.confidence >= 0.7));

      expect(highConfidence).toHaveLength(1);
      expect(highConfidence[0].title).toBe("High confidence");
    });

    it("should filter active insights only", async () => {
      await db.insert(sdkInsights).values([
        {
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "Active insight",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.5,
          active: true,
        },
        {
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "Inactive insight",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.5,
          active: false,
        },
      ]);

      const activeInsights = await db
        .select()
        .from(sdkInsights)
        .where(and(eq(sdkInsights.userId, testUserId), eq(sdkInsights.active, true)));

      expect(activeInsights).toHaveLength(1);
      expect(activeInsights[0].title).toBe("Active insight");
    });
  });

  describe("Insight Updates", () => {
    it("should track application count", async () => {
      const [insight] = await db
        .insert(sdkInsights)
        .values({
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "Test insight",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.5,
          applicationCount: 0,
        })
        .returning();

      expect(insight.applicationCount).toBe(0);

      // Increment application count
      const [updated] = await db
        .update(sdkInsights)
        .set({ applicationCount: (insight.applicationCount ?? 0) + 1 })
        .where(eq(sdkInsights.id, insight.id))
        .returning();

      expect(updated.applicationCount).toBe(1);
    });

    it("should verify insights", async () => {
      const [insight] = await db
        .insert(sdkInsights)
        .values({
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "Test insight",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.5,
          verified: false,
        })
        .returning();

      expect(insight.verified).toBe(false);

      const [verified] = await db
        .update(sdkInsights)
        .set({ verified: true })
        .where(eq(sdkInsights.id, insight.id))
        .returning();

      expect(verified.verified).toBe(true);
    });

    it("should deactivate insights", async () => {
      const [insight] = await db
        .insert(sdkInsights)
        .values({
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "Test insight",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.5,
          active: true,
        })
        .returning();

      const [deactivated] = await db
        .update(sdkInsights)
        .set({ active: false })
        .where(eq(sdkInsights.id, insight.id))
        .returning();

      expect(deactivated.active).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Cross-Session Learning
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Cross-Session Learning", () => {
    it("should link insights to multiple source sessions", async () => {
      const sessionIds = [randomUUID(), randomUUID(), randomUUID()];

      const [insight] = await db
        .insert(sdkInsights)
        .values({
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "Cross-session pattern",
          description: "Observed in multiple sessions",
          sourceNotesJson: "[]",
          sourceSessionsJson: JSON.stringify(sessionIds),
          confidence: 0.8,
        })
        .returning();

      const sourceSessions = JSON.parse(insight.sourceSessionsJson!);
      expect(sourceSessions).toHaveLength(3);
      expect(sourceSessions).toContain(sessionIds[0]);
      expect(sourceSessions).toContain(sessionIds[1]);
      expect(sourceSessions).toContain(sessionIds[2]);
    });

    it("should increase confidence for insights observed multiple times", async () => {
      // Simulate an insight being reinforced across sessions
      const [insight] = await db
        .insert(sdkInsights)
        .values({
          userId: testUserId,
          type: "pattern",
          applicability: "folder",
          title: "Recurring pattern",
          description: "Initially observed",
          sourceNotesJson: "[]",
          sourceSessionsJson: JSON.stringify([randomUUID()]),
          confidence: 0.5,
        })
        .returning();

      // "Observe" again - increment confidence
      const newConfidence = Math.min(0.95, insight.confidence + 0.1);
      const currentSessions = JSON.parse(insight.sourceSessionsJson!);
      currentSessions.push(randomUUID());

      const [reinforced] = await db
        .update(sdkInsights)
        .set({
          confidence: newConfidence,
          sourceSessionsJson: JSON.stringify(currentSessions),
        })
        .where(eq(sdkInsights.id, insight.id))
        .returning();

      expect(reinforced.confidence).toBe(0.6);
      expect(JSON.parse(reinforced.sourceSessionsJson!)).toHaveLength(2);
    });

    it("should track applicability context for language-specific insights", async () => {
      const [insight] = await db
        .insert(sdkInsights)
        .values({
          userId: testUserId,
          type: "convention",
          applicability: "language",
          applicabilityContext: "typescript",
          title: "TypeScript convention",
          description: "Use strict null checks",
          sourceNotesJson: "[]",
          confidence: 0.7,
        })
        .returning();

      expect(insight.applicability).toBe("language");
      expect(insight.applicabilityContext).toBe("typescript");

      // Query language-specific insights
      const tsInsights = await db
        .select()
        .from(sdkInsights)
        .where(
          and(
            eq(sdkInsights.userId, testUserId),
            eq(sdkInsights.applicability, "language"),
            eq(sdkInsights.applicabilityContext, "typescript")
          )
        );

      expect(tsInsights).toHaveLength(1);
    });
  });
});
