import { describe, it, expect, beforeEach } from "bun:test";
import { Episode, EpisodeBuilder } from "@/domain/entities/Episode";

/**
 * Integration tests for Episodic Memory workflow
 * Tests the interaction between Episode entity and EpisodeBuilder
 */
describe("Episodic Memory Integration", () => {
  describe("EpisodeBuilder + Episode Lifecycle", () => {
    it("should build complete episode with actions and decisions", () => {
      const builder = new EpisodeBuilder("task-123", "folder-456");

      builder.setContext({
        taskDescription: "Implement authentication",
        projectPath: "/projects/auth",
        initialState: "No auth system",
        agentProvider: "claude",
      });

      // Simulate a typical task execution flow
      builder.addAction({
        action: "Read existing code",
        tool: "Read",
        duration: 150,
        success: true,
      });

      builder.addObservation("Found express server without auth middleware");

      builder.addDecision({
        context: "Choose authentication strategy",
        options: ["JWT", "Session-based", "OAuth2"],
        chosen: "JWT",
        reasoning: "Stateless, works well with API",
      });

      builder.addAction({
        action: "Create auth middleware",
        tool: "Write",
        duration: 2500,
        success: true,
      });

      builder.addAction({
        action: "Write unit tests",
        tool: "Write",
        duration: 1800,
        success: true,
      });

      builder.addObservation("All tests passing");

      const episode = builder.build(
        "success",
        "Authentication implemented with JWT",
        {
          whatWorked: ["JWT approach was straightforward", "TDD helped catch edge cases"],
          whatFailed: ["Initial token expiry was too short"],
          keyInsights: ["Always validate token signature", "Use refresh tokens for long sessions"],
          wouldDoDifferently: "Start with refresh token design from beginning",
        },
        ["auth", "feature", "jwt"]
      );

      // Verify complete episode structure
      expect(episode.taskId).toBe("task-123");
      expect(episode.folderId).toBe("folder-456");
      expect(episode.type).toBe("task_execution");
      expect(episode.context.agentProvider).toBe("claude");
      expect(episode.trajectory.actions).toHaveLength(3);
      expect(episode.trajectory.observations).toHaveLength(2);
      expect(episode.trajectory.decisions).toHaveLength(1);
      expect(episode.outcome.outcome).toBe("success");
      expect(episode.outcome.toolCallCount).toBe(3);
      expect(episode.outcome.errorCount).toBe(0);
      expect(episode.tags).toContain("jwt");
    });

    it("should track errors correctly in episode", () => {
      const builder = new EpisodeBuilder("task-456", "folder-789");

      builder.setContext({
        taskDescription: "Fix authentication bug",
        projectPath: "/projects/auth",
        initialState: "Users getting logged out randomly",
      });

      builder.addAction({
        action: "Read auth middleware",
        tool: "Read",
        duration: 100,
        success: true,
      });

      builder.addAction({
        action: "Attempt fix 1",
        tool: "Edit",
        duration: 500,
        success: false,
      });

      builder.addAction({
        action: "Attempt fix 2",
        tool: "Edit",
        duration: 300,
        success: false,
      });

      builder.addPivot({
        fromApproach: "Modify existing code",
        toApproach: "Refactor entire middleware",
        reason: "Original code too complex to patch",
        triggered_by: "error",
      });

      builder.addAction({
        action: "Rewrite middleware",
        tool: "Write",
        duration: 3000,
        success: true,
      });

      const episode = builder.build(
        "success",
        "Fixed by refactoring",
        {
          whatWorked: ["Clean rewrite was faster than patching"],
          whatFailed: ["Initial attempts to patch"],
          keyInsights: ["Sometimes starting fresh is better"],
        },
        ["bugfix", "auth"]
      );

      expect(episode.outcome.errorCount).toBe(2);
      expect(episode.outcome.toolCallCount).toBe(4);
      expect(episode.trajectory.pivots).toHaveLength(1);
      expect(episode.trajectory.pivots[0].triggered_by).toBe("error");
    });
  });

  describe("Episode Context Generation", () => {
    it("should generate useful context for similar tasks", () => {
      const episode = Episode.create({
        taskId: "task-123",
        folderId: "folder-123",
        type: "task_execution",
        context: {
          taskDescription: "Implement caching layer",
          projectPath: "/projects/api",
          initialState: "No caching",
          agentProvider: "claude",
        },
        trajectory: {
          actions: [
            {
              timestamp: new Date(),
              action: "Analyzed endpoints",
              tool: "Read",
              duration: 200,
              success: true,
            },
          ],
          observations: ["Found 50+ API endpoints"],
          decisions: [
            {
              timestamp: new Date(),
              context: "Choose cache strategy",
              options: ["Redis", "In-memory", "CDN"],
              chosen: "Redis",
              reasoning: "Distributed, persistent, fast",
            },
          ],
          pivots: [],
        },
        outcome: {
          outcome: "success",
          result: "Caching implemented",
          duration: 45000,
          errorCount: 0,
          toolCallCount: 12,
        },
        reflection: {
          whatWorked: ["Redis client library was easy to use", "Cache invalidation via TTL"],
          whatFailed: ["Initial cache key design was too granular"],
          keyInsights: [
            "Use consistent cache key naming convention",
            "Set appropriate TTLs for different data types",
          ],
          wouldDoDifferently: "Plan cache key structure upfront",
        },
        tags: ["caching", "redis", "performance"],
      });

      const context = episode.getContextForSimilarTask();

      // Should include key learnings
      expect(context).toContain("Previous Similar Task Experience");
      expect(context).toContain("What Worked");
      expect(context).toContain("Redis client library");
      expect(context).toContain("Key Insights");
      expect(context).toContain("cache key naming convention");
    });

    it("should include warnings for failed episodes", () => {
      const episode = Episode.create({
        taskId: "task-789",
        folderId: "folder-789",
        type: "task_execution",
        context: {
          taskDescription: "Migrate to new database",
          projectPath: "/projects/api",
          initialState: "Using MySQL",
        },
        trajectory: {
          actions: [],
          observations: [],
          decisions: [],
          pivots: [],
        },
        outcome: {
          outcome: "failure",
          result: "Migration failed - data loss",
          duration: 120000,
          errorCount: 5,
          toolCallCount: 20,
        },
        reflection: {
          whatWorked: ["Backup was created"],
          whatFailed: [
            "Schema mapping was incomplete",
            "Foreign key constraints not handled",
            "No rollback plan",
          ],
          keyInsights: [
            "Always test migration on copy first",
            "Document schema differences",
            "Have rollback plan ready",
          ],
          wouldDoDifferently: "Create staging environment for migration testing",
        },
        tags: ["migration", "database", "failure"],
      });

      const context = episode.getContextForSimilarTask();

      expect(context).toContain("What Failed (Avoid These)");
      expect(context).toContain("Schema mapping was incomplete");
      expect(context).toContain("Foreign key constraints");
    });
  });

  describe("Episode Quality Scoring", () => {
    it("should score successful episodes higher", () => {
      const successEpisode = Episode.create({
        taskId: "task-1",
        folderId: "folder-1",
        type: "task_execution",
        context: {
          taskDescription: "Task 1",
          projectPath: "/",
          initialState: "",
        },
        trajectory: { actions: [], observations: [], decisions: [], pivots: [] },
        outcome: {
          outcome: "success",
          result: "Done",
          duration: 10000,
          errorCount: 0,
          toolCallCount: 5,
        },
        reflection: {
          whatWorked: ["Everything"],
          whatFailed: [],
          keyInsights: [],
        },
        tags: [],
      });

      const failureEpisode = Episode.create({
        taskId: "task-2",
        folderId: "folder-2",
        type: "task_execution",
        context: {
          taskDescription: "Task 2",
          projectPath: "/",
          initialState: "",
        },
        trajectory: { actions: [], observations: [], decisions: [], pivots: [] },
        outcome: {
          outcome: "failure",
          result: "Failed",
          duration: 30000,
          errorCount: 10,
          toolCallCount: 20,
        },
        reflection: {
          whatWorked: [],
          whatFailed: ["Everything"],
          keyInsights: [],
        },
        tags: [],
      });

      expect(successEpisode.getQualityScore()).toBeGreaterThan(
        failureEpisode.getQualityScore()
      );
    });

    it("should boost score with user feedback", () => {
      const episode = Episode.create({
        taskId: "task-1",
        folderId: "folder-1",
        type: "task_execution",
        context: {
          taskDescription: "Task 1",
          projectPath: "/",
          initialState: "",
        },
        trajectory: { actions: [], observations: [], decisions: [], pivots: [] },
        outcome: {
          outcome: "success",
          result: "Done",
          duration: 10000,
          errorCount: 0,
          toolCallCount: 5,
        },
        reflection: {
          whatWorked: [],
          whatFailed: [],
          keyInsights: [],
        },
        tags: [],
      });

      const ratedEpisode = episode.withUserFeedback(5, "Excellent work!");

      expect(ratedEpisode.getQualityScore()).toBeGreaterThan(episode.getQualityScore());
      expect(ratedEpisode.reflection.userRating).toBe(5);
      expect(ratedEpisode.reflection.userFeedback).toBe("Excellent work!");
    });
  });

  describe("Episode Immutability", () => {
    it("should preserve original when adding tags", () => {
      const original = Episode.create({
        taskId: "task-1",
        folderId: "folder-1",
        type: "task_execution",
        context: {
          taskDescription: "Test",
          projectPath: "/",
          initialState: "",
        },
        trajectory: { actions: [], observations: [], decisions: [], pivots: [] },
        outcome: {
          outcome: "success",
          result: "Done",
          duration: 1000,
          errorCount: 0,
          toolCallCount: 1,
        },
        reflection: {
          whatWorked: [],
          whatFailed: [],
          keyInsights: [],
        },
        tags: ["original"],
      });

      const updated = original.withTags(["new-tag"]);

      expect(original.tags).toEqual(["original"]);
      expect(updated.tags).toContain("original");
      expect(updated.tags).toContain("new-tag");
      expect(original).not.toBe(updated);
    });

    it("should preserve original when updating reflection", () => {
      const original = Episode.create({
        taskId: "task-1",
        folderId: "folder-1",
        type: "task_execution",
        context: {
          taskDescription: "Test",
          projectPath: "/",
          initialState: "",
        },
        trajectory: { actions: [], observations: [], decisions: [], pivots: [] },
        outcome: {
          outcome: "success",
          result: "Done",
          duration: 1000,
          errorCount: 0,
          toolCallCount: 1,
        },
        reflection: {
          whatWorked: ["Original insight"],
          whatFailed: [],
          keyInsights: [],
        },
        tags: [],
      });

      const updated = original.withReflection({
        whatWorked: ["New insight"],
        whatFailed: [],
        keyInsights: ["Learned something"],
      });

      expect(original.reflection.whatWorked).toEqual(["Original insight"]);
      expect(updated.reflection.whatWorked).toEqual(["New insight"]);
      expect(updated.reflection.keyInsights).toEqual(["Learned something"]);
    });
  });

  describe("Episode Serialization", () => {
    it("should round-trip through toProps and fromProps", () => {
      const builder = new EpisodeBuilder("task-123", "folder-456");

      builder.setContext({
        taskDescription: "Complex task",
        projectPath: "/project",
        initialState: "Initial",
        agentProvider: "gemini",
      });

      builder.addAction({
        action: "Action 1",
        tool: "Read",
        duration: 100,
        success: true,
      });

      builder.addDecision({
        context: "Decision point",
        options: ["A", "B"],
        chosen: "A",
        reasoning: "Better option",
      });

      const original = builder.build(
        "success",
        "Completed",
        {
          whatWorked: ["A worked"],
          whatFailed: [],
          keyInsights: ["Insight"],
        },
        ["tag1", "tag2"]
      );

      // Serialize and deserialize
      const props = original.toProps();
      const restored = Episode.fromProps(props);

      // Verify all fields preserved
      expect(restored.id).toBe(original.id);
      expect(restored.taskId).toBe(original.taskId);
      expect(restored.folderId).toBe(original.folderId);
      expect(restored.type).toBe(original.type);
      expect(restored.context.agentProvider).toBe("gemini");
      expect(restored.trajectory.actions).toHaveLength(1);
      expect(restored.trajectory.decisions).toHaveLength(1);
      expect(restored.outcome.outcome).toBe("success");
      expect(restored.reflection.keyInsights).toEqual(["Insight"]);
      expect(restored.tags).toEqual(["tag1", "tag2"]);
    });
  });
});
