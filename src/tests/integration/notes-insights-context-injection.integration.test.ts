import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";
import { db } from "@/db";
import { sdkNotes, sdkInsights, sdkMemoryEntries, users, sessionFolders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID, createHash } from "crypto";
import {
  getMemoriesForContext,
  buildInjectionContext,
  prepareSessionContext,
  type InjectionContext,
} from "@/services/session-context-injection-service";

// Helper to generate content hash
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Integration tests for Notes & Insights Context Injection
 *
 * Tests the integration of notes and insights into the context injection system:
 * - Note retrieval for context (pinned, high-priority, recent)
 * - Insight retrieval for context (global and folder-scoped)
 * - Full context injection pipeline (markdown and JSON formatting)
 * - Statistics tracking
 *
 * These tests use the database directly without going through
 * the HTTP API layer, testing the service layer functions.
 */
describe("Notes & Insights Context Injection", () => {
  // Test fixtures
  const testUserId = randomUUID();
  const testFolderId = randomUUID();
  const otherFolderId = randomUUID(); // Second folder for scope tests

  // Setup test user and folder
  beforeAll(async () => {
    await db
      .insert(users)
      .values({
        id: testUserId,
        email: `test-context-${testUserId}@example.com`,
        name: "Test Context User",
      })
      .onConflictDoNothing();

    await db
      .insert(sessionFolders)
      .values([
        {
          id: testFolderId,
          userId: testUserId,
          name: "Test Folder",
          path: "/test/project",
        },
        {
          id: otherFolderId,
          userId: testUserId,
          name: "Other Folder",
          path: "/other/project",
        },
      ])
      .onConflictDoNothing();
  });

  // Cleanup test data
  afterEach(async () => {
    await db.delete(sdkNotes).where(eq(sdkNotes.userId, testUserId));
    await db.delete(sdkInsights).where(eq(sdkInsights.userId, testUserId));
    await db.delete(sdkMemoryEntries).where(eq(sdkMemoryEntries.userId, testUserId));
  });

  afterAll(async () => {
    await db.delete(sessionFolders).where(eq(sessionFolders.id, testFolderId));
    await db.delete(sessionFolders).where(eq(sessionFolders.id, otherFolderId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Note Retrieval for Context Injection
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Note Retrieval for Context", () => {
    it("should retrieve pinned notes for context injection", async () => {
      // Use old timestamp so only pinned note qualifies (not recent)
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);

      await db.insert(sdkNotes).values([
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "Pinned important note",
          type: "gotcha",
          title: "Critical Warning",
          tagsJson: JSON.stringify(["important"]),
          priority: 0.5,
          pinned: true,
          createdAt: oldDate,
        },
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "Regular unpinned note",
          type: "observation",
          tagsJson: "[]",
          priority: 0.5,
          pinned: false,
          createdAt: oldDate, // Old and not pinned and low priority
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      expect(sections.notes).toHaveLength(1);
      expect(sections.notes[0].pinned).toBe(true);
      expect(sections.notes[0].content).toBe("Pinned important note");
    });

    it("should retrieve high-priority notes for context injection", async () => {
      await db.insert(sdkNotes).values([
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "High priority note",
          type: "decision",
          title: "Important Decision",
          tagsJson: "[]",
          priority: 0.9,
          pinned: false,
        },
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "Low priority note",
          type: "observation",
          tagsJson: "[]",
          priority: 0.3,
          pinned: false,
          // Created more than 24h ago to exclude from recent
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      expect(sections.notes).toHaveLength(1);
      expect(sections.notes[0].priority).toBe(0.9);
      expect(sections.notes[0].content).toBe("High priority note");
    });

    it("should retrieve recent notes (last 24 hours)", async () => {
      await db.insert(sdkNotes).values([
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "Recent note",
          type: "observation",
          tagsJson: "[]",
          priority: 0.4,
          pinned: false,
          createdAt: new Date(), // Now
        },
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "Old note",
          type: "observation",
          tagsJson: "[]",
          priority: 0.4,
          pinned: false,
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 48h ago
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      expect(sections.notes).toHaveLength(1);
      expect(sections.notes[0].content).toBe("Recent note");
    });

    it("should exclude archived notes", async () => {
      await db.insert(sdkNotes).values([
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "Active pinned note",
          type: "gotcha",
          tagsJson: "[]",
          priority: 0.5,
          pinned: true,
          archived: false,
        },
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "Archived pinned note",
          type: "gotcha",
          tagsJson: "[]",
          priority: 0.5,
          pinned: true,
          archived: true,
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      expect(sections.notes).toHaveLength(1);
      expect(sections.notes[0].content).toBe("Active pinned note");
    });

    it("should respect folder scope for notes", async () => {
      // Use old dates so only pinned status matters
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);

      await db.insert(sdkNotes).values([
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "Note in test folder",
          type: "gotcha",
          tagsJson: "[]",
          pinned: true,
          createdAt: oldDate,
        },
        {
          userId: testUserId,
          folderId: otherFolderId,
          content: "Note in other folder",
          type: "gotcha",
          tagsJson: "[]",
          pinned: true,
          createdAt: oldDate,
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      expect(sections.notes).toHaveLength(1);
      expect(sections.notes[0].content).toBe("Note in test folder");
    });

    it("should include tags in note context", async () => {
      await db.insert(sdkNotes).values({
        userId: testUserId,
        folderId: testFolderId,
        content: "Tagged note",
        type: "pattern",
        title: "API Pattern",
        tagsJson: JSON.stringify(["api", "rest", "best-practice"]),
        pinned: true,
      });

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      expect(sections.notes[0].tags).toEqual(["api", "rest", "best-practice"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Insight Retrieval for Context Injection
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Insight Retrieval for Context", () => {
    it("should retrieve global insights for any folder", async () => {
      await db.insert(sdkInsights).values({
        userId: testUserId,
        type: "convention",
        applicability: "global",
        title: "Global Convention",
        description: "Always use TypeScript strict mode",
        sourceNotesJson: "[]",
        confidence: 0.8,
        active: true,
      });

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      expect(sections.insights).toHaveLength(1);
      expect(sections.insights[0].applicability).toBe("global");
      expect(sections.insights[0].title).toBe("Global Convention");
    });

    it("should retrieve folder-scoped insights", async () => {
      await db.insert(sdkInsights).values([
        {
          userId: testUserId,
          folderId: testFolderId,
          type: "pattern",
          applicability: "folder",
          title: "Folder Pattern",
          description: "Use this pattern in this folder",
          sourceNotesJson: "[]",
          confidence: 0.7,
          active: true,
        },
        {
          userId: testUserId,
          folderId: otherFolderId, // Use pre-created other folder
          type: "pattern",
          applicability: "folder",
          title: "Other Folder Pattern",
          description: "This is for another folder",
          sourceNotesJson: "[]",
          confidence: 0.7,
          active: true,
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      // Should only get the folder-scoped insight for testFolderId
      expect(sections.insights).toHaveLength(1);
      expect(sections.insights[0].title).toBe("Folder Pattern");
    });

    it("should include both global and folder-scoped insights", async () => {
      await db.insert(sdkInsights).values([
        {
          userId: testUserId,
          type: "convention",
          applicability: "global",
          title: "Global Insight",
          description: "Applies everywhere",
          sourceNotesJson: "[]",
          confidence: 0.8,
          active: true,
        },
        {
          userId: testUserId,
          folderId: testFolderId,
          type: "pattern",
          applicability: "folder",
          title: "Folder Insight",
          description: "Specific to this folder",
          sourceNotesJson: "[]",
          confidence: 0.7,
          active: true,
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      expect(sections.insights).toHaveLength(2);
      const titles = sections.insights.map(i => i.title);
      expect(titles).toContain("Global Insight");
      expect(titles).toContain("Folder Insight");
    });

    it("should filter by minimum confidence", async () => {
      await db.insert(sdkInsights).values([
        {
          userId: testUserId,
          type: "convention",
          applicability: "global",
          title: "High Confidence",
          description: "Very sure about this",
          sourceNotesJson: "[]",
          confidence: 0.8,
          active: true,
        },
        {
          userId: testUserId,
          type: "pattern",
          applicability: "global",
          title: "Low Confidence",
          description: "Not so sure",
          sourceNotesJson: "[]",
          confidence: 0.3, // Below default minConfidence of 0.5
          active: true,
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      expect(sections.insights).toHaveLength(1);
      expect(sections.insights[0].title).toBe("High Confidence");
    });

    it("should exclude inactive insights", async () => {
      await db.insert(sdkInsights).values([
        {
          userId: testUserId,
          type: "convention",
          applicability: "global",
          title: "Active Insight",
          description: "Currently active",
          sourceNotesJson: "[]",
          confidence: 0.8,
          active: true,
        },
        {
          userId: testUserId,
          type: "pattern",
          applicability: "global",
          title: "Inactive Insight",
          description: "Deactivated",
          sourceNotesJson: "[]",
          confidence: 0.8,
          active: false,
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      expect(sections.insights).toHaveLength(1);
      expect(sections.insights[0].title).toBe("Active Insight");
    });

    it("should prioritize verified insights", async () => {
      await db.insert(sdkInsights).values([
        {
          userId: testUserId,
          type: "convention",
          applicability: "global",
          title: "Unverified Insight",
          description: "Not verified",
          sourceNotesJson: "[]",
          confidence: 0.9, // Higher confidence
          active: true,
          verified: false,
        },
        {
          userId: testUserId,
          type: "pattern",
          applicability: "global",
          title: "Verified Insight",
          description: "User verified",
          sourceNotesJson: "[]",
          confidence: 0.7, // Lower confidence but verified
          active: true,
          verified: true,
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);

      // Verified should come first despite lower confidence
      expect(sections.insights[0].title).toBe("Verified Insight");
      expect(sections.insights[0].verified).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Context Formatting
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Context Formatting", () => {
    it("should format notes in markdown output", async () => {
      await db.insert(sdkNotes).values({
        userId: testUserId,
        folderId: testFolderId,
        content: "Always check null values",
        type: "gotcha",
        title: "Null Check",
        tagsJson: JSON.stringify(["typescript", "safety"]),
        priority: 0.8,
        pinned: true,
      });

      const sections = await getMemoriesForContext(testUserId, testFolderId);
      const context = buildInjectionContext(sections);

      expect(context.markdown).toContain("## Important Notes");
      expect(context.markdown).toContain("Always check null values");
      expect(context.markdown).toContain("Null Check");
      expect(context.markdown).toContain("[typescript, safety]");
    });

    it("should format insights in markdown output", async () => {
      await db.insert(sdkInsights).values({
        userId: testUserId,
        type: "convention",
        applicability: "global",
        title: "Use Strict Mode",
        description: "Always enable TypeScript strict mode",
        sourceNotesJson: "[]",
        confidence: 0.9,
        active: true,
        verified: true,
      });

      const sections = await getMemoriesForContext(testUserId, testFolderId);
      const context = buildInjectionContext(sections);

      expect(context.markdown).toContain("## Learned Insights");
      expect(context.markdown).toContain("Use Strict Mode");
      expect(context.markdown).toContain("Always enable TypeScript strict mode");
    });

    it("should include notes in JSON output", async () => {
      await db.insert(sdkNotes).values({
        userId: testUserId,
        folderId: testFolderId,
        content: "Important note content",
        type: "decision",
        title: "Decision Title",
        tagsJson: JSON.stringify(["tag1"]),
        pinned: true,
      });

      const sections = await getMemoriesForContext(testUserId, testFolderId);
      const context = buildInjectionContext(sections);

      const json = JSON.parse(context.json);
      expect(json.notes).toHaveLength(1);
      expect(json.notes[0].title).toBe("Decision Title");
      expect(json.notes[0].content).toBe("Important note content");
      expect(json.notes[0].type).toBe("decision");
      expect(json.notes[0].tags).toEqual(["tag1"]);
      expect(json.notes[0].pinned).toBe(true);
    });

    it("should include insights in JSON output", async () => {
      await db.insert(sdkInsights).values({
        userId: testUserId,
        type: "pattern",
        applicability: "global",
        title: "API Pattern",
        description: "Use REST conventions",
        sourceNotesJson: "[]",
        confidence: 0.85,
        active: true,
        verified: false,
      });

      const sections = await getMemoriesForContext(testUserId, testFolderId);
      const context = buildInjectionContext(sections);

      const json = JSON.parse(context.json);
      expect(json.insights).toHaveLength(1);
      expect(json.insights[0].title).toBe("API Pattern");
      expect(json.insights[0].description).toBe("Use REST conventions");
      expect(json.insights[0].type).toBe("pattern");
      expect(json.insights[0].confidence).toBe(0.85);
      expect(json.insights[0].verified).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Statistics Tracking
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Statistics Tracking", () => {
    it("should track notes count in stats", async () => {
      await db.insert(sdkNotes).values([
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "Note 1",
          type: "gotcha",
          tagsJson: "[]",
          pinned: true,
        },
        {
          userId: testUserId,
          folderId: testFolderId,
          content: "Note 2",
          type: "pattern",
          tagsJson: "[]",
          priority: 0.8,
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);
      const context = buildInjectionContext(sections);

      expect(context.stats.notes).toBe(2);
    });

    it("should track insights count in stats", async () => {
      await db.insert(sdkInsights).values([
        {
          userId: testUserId,
          type: "convention",
          applicability: "global",
          title: "Insight 1",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.8,
          active: true,
        },
        {
          userId: testUserId,
          type: "pattern",
          applicability: "global",
          title: "Insight 2",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.7,
          active: true,
        },
        {
          userId: testUserId,
          type: "gotcha",
          applicability: "global",
          title: "Insight 3",
          description: "Desc",
          sourceNotesJson: "[]",
          confidence: 0.6,
          active: true,
        },
      ]);

      const sections = await getMemoriesForContext(testUserId, testFolderId);
      const context = buildInjectionContext(sections);

      expect(context.stats.insights).toBe(3);
    });

    it("should include notes and insights in totalMemories", async () => {
      // Add some memories
      const memoryContent = "Memory pattern";
      await db.insert(sdkMemoryEntries).values({
        userId: testUserId,
        folderId: testFolderId,
        tier: "long_term",
        contentType: "pattern",
        content: memoryContent,
        contentHash: hashContent(memoryContent),
        confidence: 0.8,
        relevance: 0.7,
      });

      // Add notes
      await db.insert(sdkNotes).values({
        userId: testUserId,
        folderId: testFolderId,
        content: "Important note",
        type: "gotcha",
        tagsJson: "[]",
        pinned: true,
      });

      // Add insights
      await db.insert(sdkInsights).values({
        userId: testUserId,
        type: "convention",
        applicability: "global",
        title: "Convention",
        description: "Desc",
        sourceNotesJson: "[]",
        confidence: 0.8,
        active: true,
      });

      const sections = await getMemoriesForContext(testUserId, testFolderId);
      const context = buildInjectionContext(sections);

      // totalMemories should include patterns + notes + insights
      expect(context.stats.totalMemories).toBe(
        context.stats.patterns +
        context.stats.gotchas +
        context.stats.conventions +
        context.stats.skills +
        context.stats.observations +
        context.stats.notes +
        context.stats.insights
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Options Control
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Options Control", () => {
    it("should disable notes retrieval when includeNotes is false", async () => {
      await db.insert(sdkNotes).values({
        userId: testUserId,
        folderId: testFolderId,
        content: "Pinned note",
        type: "gotcha",
        tagsJson: "[]",
        pinned: true,
      });

      const sections = await getMemoriesForContext(testUserId, testFolderId, {
        includeNotes: false,
      });

      expect(sections.notes).toHaveLength(0);
    });

    it("should disable insights retrieval when includeInsights is false", async () => {
      await db.insert(sdkInsights).values({
        userId: testUserId,
        type: "convention",
        applicability: "global",
        title: "Global Insight",
        description: "Desc",
        sourceNotesJson: "[]",
        confidence: 0.8,
        active: true,
      });

      const sections = await getMemoriesForContext(testUserId, testFolderId, {
        includeInsights: false,
      });

      expect(sections.insights).toHaveLength(0);
    });

    it("should respect maxPerCategory for notes", async () => {
      // Insert more notes than the limit
      for (let i = 0; i < 10; i++) {
        await db.insert(sdkNotes).values({
          userId: testUserId,
          folderId: testFolderId,
          content: `Note ${i}`,
          type: "gotcha",
          tagsJson: "[]",
          pinned: true,
        });
      }

      const sections = await getMemoriesForContext(testUserId, testFolderId, {
        maxPerCategory: 3,
      });

      expect(sections.notes).toHaveLength(3);
    });

    it("should respect maxPerCategory for insights", async () => {
      // Insert more insights than the limit
      for (let i = 0; i < 10; i++) {
        await db.insert(sdkInsights).values({
          userId: testUserId,
          type: "convention",
          applicability: "global",
          title: `Insight ${i}`,
          description: `Desc ${i}`,
          sourceNotesJson: "[]",
          confidence: 0.8,
          active: true,
        });
      }

      const sections = await getMemoriesForContext(testUserId, testFolderId, {
        maxPerCategory: 4,
      });

      expect(sections.insights).toHaveLength(4);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Full Pipeline Integration
  // ─────────────────────────────────────────────────────────────────────────────

  describe("Full Pipeline Integration", () => {
    it("should prepare complete context with all categories", async () => {
      // Add memories
      const content1 = "Use dependency injection";
      const content2 = "Watch out for circular dependencies";
      await db.insert(sdkMemoryEntries).values([
        {
          userId: testUserId,
          folderId: testFolderId,
          tier: "long_term",
          contentType: "pattern",
          content: content1,
          contentHash: hashContent(content1),
          name: "DI Pattern",
          confidence: 0.8,
          relevance: 0.9,
        },
        {
          userId: testUserId,
          folderId: testFolderId,
          tier: "long_term",
          contentType: "gotcha",
          content: content2,
          contentHash: hashContent(content2),
          name: "Circular Deps",
          confidence: 0.7,
          relevance: 0.8,
        },
      ]);

      // Add notes
      await db.insert(sdkNotes).values({
        userId: testUserId,
        folderId: testFolderId,
        content: "Remember to update the README",
        type: "todo",
        title: "README Update",
        tagsJson: JSON.stringify(["docs"]),
        pinned: true,
      });

      // Add insights
      await db.insert(sdkInsights).values({
        userId: testUserId,
        type: "best_practice",
        applicability: "global",
        title: "Write Tests First",
        description: "Use TDD for better code quality",
        sourceNotesJson: "[]",
        confidence: 0.9,
        active: true,
        verified: true,
      });

      const context = await prepareSessionContext(testUserId, testFolderId, null);

      // Check all categories are present
      expect(context.stats.patterns).toBeGreaterThanOrEqual(1);
      expect(context.stats.gotchas).toBeGreaterThanOrEqual(1);
      expect(context.stats.notes).toBe(1);
      expect(context.stats.insights).toBe(1);

      // Check markdown contains all sections
      expect(context.markdown).toContain("DI Pattern");
      expect(context.markdown).toContain("Circular Deps");
      expect(context.markdown).toContain("README Update");
      expect(context.markdown).toContain("Write Tests First");

      // Check JSON contains all data
      const json = JSON.parse(context.json);
      expect(json.patterns.length).toBeGreaterThanOrEqual(1);
      expect(json.gotchas.length).toBeGreaterThanOrEqual(1);
      expect(json.notes.length).toBe(1);
      expect(json.insights.length).toBe(1);
    });
  });
});
