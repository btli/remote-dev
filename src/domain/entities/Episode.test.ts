import { describe, it, expect } from "bun:test";
import {
  Episode,
  EpisodeBuilder,
  type EpisodeReflection,
  type EpisodeOutcome,
  type EpisodeType,
} from "./Episode";

describe("Episode", () => {
  const createTestReflection = (): EpisodeReflection => ({
    whatWorked: ["Used proper error handling", "Wrote tests first"],
    whatFailed: ["Initial approach was too complex"],
    keyInsights: ["Simpler is better"],
    wouldDoDifferently: "Start with tests",
  });

  const createTestEpisode = (
    overrides?: Partial<Parameters<typeof Episode.create>[0]>
  ) => {
    return Episode.create({
      taskId: "task-123",
      folderId: "folder-123",
      type: "task_execution",
      context: {
        taskDescription: "Implement user authentication",
        projectPath: "/projects/auth",
        initialState: "No auth present",
        agentProvider: "claude",
      },
      trajectory: {
        actions: [
          {
            timestamp: new Date(),
            action: "Read file",
            tool: "Read",
            duration: 100,
            success: true,
          },
        ],
        observations: ["Found existing auth config"],
        decisions: [
          {
            timestamp: new Date(),
            context: "Choose auth method",
            options: ["JWT", "Session"],
            chosen: "JWT",
            reasoning: "Better for APIs",
          },
        ],
        pivots: [],
      },
      outcome: {
        outcome: "success",
        result: "Auth implemented successfully",
        duration: 30000,
        errorCount: 0,
        toolCallCount: 15,
      },
      reflection: createTestReflection(),
      tags: ["auth", "feature"],
      ...overrides,
    });
  };

  describe("create", () => {
    it("should create an episode with valid properties", () => {
      const episode = createTestEpisode();

      expect(episode.id).toBeDefined();
      expect(episode.taskId).toBe("task-123");
      expect(episode.folderId).toBe("folder-123");
      expect(episode.type).toBe("task_execution");
      expect(episode.context.taskDescription).toBe("Implement user authentication");
      expect(episode.outcome.outcome).toBe("success");
      expect(episode.tags).toContain("auth");
    });

    it("should generate unique IDs", () => {
      const episode1 = createTestEpisode();
      const episode2 = createTestEpisode();

      expect(episode1.id).not.toBe(episode2.id);
    });

    it("should set createdAt and updatedAt", () => {
      const episode = createTestEpisode();

      expect(episode.createdAt).toBeInstanceOf(Date);
      expect(episode.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("fromProps", () => {
    it("should reconstitute an episode from props", () => {
      const original = createTestEpisode();
      const props = original.toProps();
      const reconstituted = Episode.fromProps(props);

      expect(reconstituted.id).toBe(original.id);
      expect(reconstituted.taskId).toBe(original.taskId);
      expect(reconstituted.type).toBe(original.type);
    });
  });

  describe("immutability", () => {
    it("should return new instance when adding reflection", () => {
      const episode = createTestEpisode();
      const newReflection: EpisodeReflection = {
        ...createTestReflection(),
        keyInsights: ["New insight"],
      };

      const updated = episode.withReflection(newReflection);

      expect(updated).not.toBe(episode);
      expect(updated.reflection.keyInsights).toContain("New insight");
      expect(episode.reflection.keyInsights).not.toContain("New insight");
    });

    it("should return new instance when adding user feedback", () => {
      const episode = createTestEpisode();
      const updated = episode.withUserFeedback(5, "Great work!");

      expect(updated).not.toBe(episode);
      expect(updated.reflection.userRating).toBe(5);
      expect(updated.reflection.userFeedback).toBe("Great work!");
      expect(episode.reflection.userRating).toBeUndefined();
    });

    it("should return new instance when adding tags", () => {
      const episode = createTestEpisode();
      const updated = episode.withTags(["new-tag"]);

      expect(updated).not.toBe(episode);
      expect(updated.tags).toContain("new-tag");
      expect(updated.tags).toContain("auth");
    });

    it("should deduplicate tags", () => {
      const episode = createTestEpisode();
      const updated = episode.withTags(["auth", "new-tag"]);

      const authCount = updated.tags.filter((t) => t === "auth").length;
      expect(authCount).toBe(1);
    });
  });

  describe("outcome checks", () => {
    it("should correctly identify success", () => {
      const success = createTestEpisode({ outcome: { ...createTestEpisode().outcome, outcome: "success" } });
      expect(success.isSuccess()).toBe(true);
      expect(success.isFailed()).toBe(false);
    });

    it("should correctly identify failure", () => {
      const failure = createTestEpisode({
        outcome: {
          outcome: "failure",
          result: "Failed",
          duration: 5000,
          errorCount: 3,
          toolCallCount: 5,
        },
      });
      expect(failure.isSuccess()).toBe(false);
      expect(failure.isFailed()).toBe(true);
    });

    it("should correctly handle partial outcome", () => {
      const partial = createTestEpisode({
        outcome: {
          outcome: "partial",
          result: "Partially done",
          duration: 10000,
          errorCount: 1,
          toolCallCount: 10,
        },
      });
      expect(partial.isSuccess()).toBe(false);
      expect(partial.isFailed()).toBe(false);
    });
  });

  describe("summary methods", () => {
    it("should generate episode summary", () => {
      const episode = createTestEpisode();
      const summary = episode.getSummary();

      expect(summary).toContain("✅");
      expect(summary).toContain("task_execution");
      expect(summary).toContain("Implement user authentication");
    });

    it("should generate learnings summary", () => {
      const episode = createTestEpisode();
      const learnings = episode.getLearningsSummary();

      expect(learnings).toContain("What worked:");
      expect(learnings).toContain("What failed:");
      expect(learnings).toContain("Key insights:");
    });

    it("should generate context for similar task", () => {
      const episode = createTestEpisode();
      const context = episode.getContextForSimilarTask();

      expect(context).toContain("## Previous Similar Task Experience");
      expect(context).toContain("### What Worked");
      expect(context).toContain("Used proper error handling");
    });

    it("should show warnings for failed episodes", () => {
      const failure = createTestEpisode({
        outcome: {
          outcome: "failure",
          result: "Failed",
          duration: 5000,
          errorCount: 3,
          toolCallCount: 5,
        },
      });
      const context = failure.getContextForSimilarTask();

      expect(context).toContain("### What Failed (Avoid These)");
    });
  });

  describe("quality score", () => {
    it("should calculate higher score for successful episodes", () => {
      const success = createTestEpisode();
      const failure = createTestEpisode({
        outcome: {
          outcome: "failure",
          result: "Failed",
          duration: 5000,
          errorCount: 3,
          toolCallCount: 5,
        },
      });

      expect(success.getQualityScore()).toBeGreaterThan(failure.getQualityScore());
    });

    it("should include user rating in score", () => {
      const episode = createTestEpisode();
      const rated = episode.withUserFeedback(5);

      expect(rated.getQualityScore()).toBeGreaterThan(episode.getQualityScore());
    });

    it("should max out at 100", () => {
      const episode = createTestEpisode().withUserFeedback(5);
      expect(episode.getQualityScore()).toBeLessThanOrEqual(100);
    });
  });

  describe("serialization", () => {
    it("should convert to props and back", () => {
      const original = createTestEpisode();
      const props = original.toProps();
      const restored = Episode.fromProps(props);

      expect(restored.id).toBe(original.id);
      expect(restored.taskId).toBe(original.taskId);
      expect(restored.context.taskDescription).toBe(original.context.taskDescription);
      expect(restored.outcome.outcome).toBe(original.outcome.outcome);
      expect(restored.tags).toEqual(original.tags);
    });
  });
});

describe("EpisodeBuilder", () => {
  it("should build an episode incrementally", () => {
    const builder = new EpisodeBuilder("task-123", "folder-123");

    builder.setContext({
      taskDescription: "Build feature",
      projectPath: "/project",
      initialState: "Empty",
    });

    builder.addAction({
      action: "Read file",
      tool: "Read",
      duration: 100,
      success: true,
    });

    builder.addObservation("Found config");

    builder.addDecision({
      context: "Choose approach",
      options: ["A", "B"],
      chosen: "A",
      reasoning: "Better performance",
    });

    const episode = builder.build(
      "success",
      "Feature built",
      {
        whatWorked: ["Approach A worked"],
        whatFailed: [],
        keyInsights: ["Performance matters"],
      },
      ["feature"]
    );

    expect(episode.taskId).toBe("task-123");
    expect(episode.folderId).toBe("folder-123");
    expect(episode.context.taskDescription).toBe("Build feature");
    expect(episode.trajectory.actions).toHaveLength(1);
    expect(episode.trajectory.observations).toHaveLength(1);
    expect(episode.trajectory.decisions).toHaveLength(1);
    expect(episode.outcome.outcome).toBe("success");
    expect(episode.outcome.toolCallCount).toBe(1);
    expect(episode.outcome.errorCount).toBe(0);
  });

  it("should track error count", () => {
    const builder = new EpisodeBuilder("task-123", "folder-123");

    builder.addAction({ action: "A", duration: 100, success: true });
    builder.addAction({ action: "B", duration: 100, success: false });
    builder.addAction({ action: "C", duration: 100, success: false });

    const episode = builder.build("failure", "Failed", {
      whatWorked: [],
      whatFailed: ["B and C failed"],
      keyInsights: [],
    });

    expect(episode.outcome.errorCount).toBe(2);
    expect(episode.outcome.toolCallCount).toBe(3);
  });

  it("should track pivots", () => {
    const builder = new EpisodeBuilder("task-123", "folder-123");

    builder.addPivot({
      fromApproach: "Direct",
      toApproach: "Iterative",
      reason: "Too complex",
      triggered_by: "error",
    });

    const episode = builder.build("success", "Done", {
      whatWorked: ["Iterative worked"],
      whatFailed: ["Direct failed"],
      keyInsights: ["Start simple"],
    });

    expect(episode.trajectory.pivots).toHaveLength(1);
    expect(episode.trajectory.pivots[0].fromApproach).toBe("Direct");
    expect(episode.trajectory.pivots[0].triggered_by).toBe("error");
  });

  it("should calculate duration from start to build", async () => {
    const builder = new EpisodeBuilder("task-123", "folder-123");

    // Small delay to ensure non-zero duration
    await new Promise((resolve) => setTimeout(resolve, 10));

    const episode = builder.build("success", "Done", {
      whatWorked: [],
      whatFailed: [],
      keyInsights: [],
    });

    expect(episode.outcome.duration).toBeGreaterThan(0);
  });
});
