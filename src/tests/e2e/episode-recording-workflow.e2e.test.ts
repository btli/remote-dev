import { describe, it, expect } from "bun:test";
import { Episode, EpisodeBuilder } from "@/domain/entities/Episode";

/**
 * E2E Test: Episode Recording Workflow
 * Tests the complete workflow of recording an agent's task execution,
 * from initial context through actions, decisions, and final reflection.
 */
describe("E2E: Episode Recording Workflow", () => {
  describe("Complete Task Recording", () => {
    it("should record full feature implementation workflow", () => {
      const builder = new EpisodeBuilder("task-feature-001", "folder-project-1");

      // Step 1: Set initial context
      builder.setContext({
        taskDescription: "Implement user authentication with JWT",
        projectPath: "/projects/web-app",
        initialState: "No authentication system exists",
        agentProvider: "claude",
      });

      // Step 2: Research phase
      builder.addAction({
        action: "Read existing codebase structure",
        tool: "Read",
        duration: 500,
        success: true,
      });
      builder.addObservation("Found Express.js backend with no auth middleware");

      builder.addAction({
        action: "Research JWT best practices",
        tool: "WebSearch",
        duration: 2000,
        success: true,
      });
      builder.addObservation("Identified need for refresh tokens and secure cookie storage");

      // Step 3: Decision point
      builder.addDecision({
        context: "Choose authentication strategy",
        options: ["JWT with localStorage", "JWT with httpOnly cookies", "Session-based auth"],
        chosen: "JWT with httpOnly cookies",
        reasoning: "More secure against XSS, recommended for web applications",
      });

      // Step 4: Implementation phase
      builder.addAction({
        action: "Create auth middleware",
        tool: "Write",
        duration: 5000,
        success: true,
      });

      builder.addAction({
        action: "Implement login endpoint",
        tool: "Write",
        duration: 3000,
        success: true,
      });

      builder.addAction({
        action: "Implement refresh token endpoint",
        tool: "Write",
        duration: 2500,
        success: true,
      });

      builder.addAction({
        action: "Add logout endpoint",
        tool: "Write",
        duration: 1500,
        success: true,
      });

      // Step 5: Testing phase
      builder.addAction({
        action: "Write unit tests for auth middleware",
        tool: "Write",
        duration: 4000,
        success: true,
      });

      builder.addAction({
        action: "Run test suite",
        tool: "Bash",
        duration: 8000,
        success: true,
      });
      builder.addObservation("All 15 tests passing");

      // Step 6: Build complete episode
      const episode = builder.build(
        "success",
        "JWT authentication implemented with httpOnly cookies and refresh tokens",
        {
          whatWorked: [
            "httpOnly cookies prevented XSS vulnerabilities",
            "Refresh token rotation improved security",
            "TDD approach caught edge cases early",
          ],
          whatFailed: [
            "Initial token expiry was too short (15 min)",
            "First attempt at refresh logic had race condition",
          ],
          keyInsights: [
            "Always use httpOnly cookies for sensitive tokens",
            "Implement token rotation on refresh",
            "Set appropriate expiry times based on use case",
            "Handle concurrent refresh requests gracefully",
          ],
          wouldDoDifferently: "Start with refresh token design from the beginning",
        },
        ["auth", "jwt", "security", "feature"]
      );

      // Verify complete episode structure
      expect(episode.taskId).toBe("task-feature-001");
      expect(episode.folderId).toBe("folder-project-1");
      expect(episode.type).toBe("task_execution");
      expect(episode.context.agentProvider).toBe("claude");
      expect(episode.trajectory.actions).toHaveLength(8);
      expect(episode.trajectory.observations).toHaveLength(3);
      expect(episode.trajectory.decisions).toHaveLength(1);
      expect(episode.outcome.outcome).toBe("success");
      expect(episode.outcome.errorCount).toBe(0);
      expect(episode.reflection.keyInsights).toHaveLength(4);
      expect(episode.tags).toContain("security");
    });

    it("should record bug fix workflow with errors and pivot", () => {
      const builder = new EpisodeBuilder("task-bugfix-001", "folder-project-1");

      builder.setContext({
        taskDescription: "Fix authentication timeout issue",
        projectPath: "/projects/web-app",
        initialState: "Users getting logged out after 1 minute instead of 1 hour",
        agentProvider: "gemini",
      });

      // Initial investigation
      builder.addAction({
        action: "Read auth middleware code",
        tool: "Read",
        duration: 300,
        success: true,
      });
      builder.addObservation("Token expiry set to 60 (assumed minutes)");

      // First attempt - wrong fix
      builder.addAction({
        action: "Change expiry to 3600",
        tool: "Edit",
        duration: 500,
        success: true,
      });

      builder.addAction({
        action: "Run tests",
        tool: "Bash",
        duration: 5000,
        success: false,
      });

      // Realize the issue
      builder.addObservation("The 60 was already correct - the unit was seconds, not minutes");

      // Pivot to correct approach
      builder.addPivot({
        fromApproach: "Increase expiry value",
        toApproach: "Fix the time unit conversion",
        reason: "Discovered expiry value is in seconds, not minutes",
        triggered_by: "error",
      });

      // Correct fix
      builder.addAction({
        action: "Revert expiry change and fix unit conversion",
        tool: "Edit",
        duration: 800,
        success: true,
      });

      builder.addAction({
        action: "Run tests again",
        tool: "Bash",
        duration: 5000,
        success: true,
      });
      builder.addObservation("All tests passing, tokens now valid for 1 hour");

      const episode = builder.build(
        "success",
        "Fixed token expiry by correcting unit conversion (seconds to milliseconds)",
        {
          whatWorked: ["Tests caught the regression", "Reading JWT library docs clarified the issue"],
          whatFailed: ["Initial assumption about time units was wrong"],
          keyInsights: [
            "Always check documentation for time unit conventions",
            "JWT expiry can be in seconds or milliseconds depending on library",
          ],
        },
        ["bugfix", "auth"]
      );

      expect(episode.outcome.errorCount).toBe(1);
      expect(episode.trajectory.pivots).toHaveLength(1);
      expect(episode.trajectory.pivots[0].triggered_by).toBe("error");
    });
  });

  describe("Episode Quality and Retrieval", () => {
    it("should generate useful context for similar future tasks", () => {
      const episode = Episode.create({
        taskId: "task-api-001",
        folderId: "folder-api",
        type: "task_execution",
        context: {
          taskDescription: "Implement rate limiting for API endpoints",
          projectPath: "/projects/api",
          initialState: "No rate limiting",
          agentProvider: "claude",
        },
        trajectory: {
          actions: [
            {
              timestamp: new Date(),
              action: "Research rate limiting patterns",
              tool: "WebSearch",
              duration: 3000,
              success: true,
            },
            {
              timestamp: new Date(),
              action: "Implement sliding window algorithm",
              tool: "Write",
              duration: 8000,
              success: true,
            },
          ],
          observations: ["Redis provides efficient sliding window implementation"],
          decisions: [
            {
              timestamp: new Date(),
              context: "Choose rate limiting storage",
              options: ["In-memory", "Redis", "Database"],
              chosen: "Redis",
              reasoning: "Distributed, persistent, sub-millisecond latency",
            },
          ],
          pivots: [],
        },
        outcome: {
          outcome: "success",
          result: "Rate limiting implemented with Redis sliding window",
          duration: 25000,
          errorCount: 0,
          toolCallCount: 8,
        },
        reflection: {
          whatWorked: [
            "Redis sliding window is simple and effective",
            "Per-endpoint configuration provides flexibility",
          ],
          whatFailed: ["Initial limit was too aggressive (10 req/min)"],
          keyInsights: [
            "Use sliding window for smooth rate limiting",
            "Provide configurable limits per endpoint",
            "Include rate limit headers in responses",
          ],
          wouldDoDifferently: "Start with more generous limits and tighten based on metrics",
        },
        tags: ["api", "rate-limiting", "redis"],
      });

      // Generate context for similar task
      const context = episode.getContextForSimilarTask();

      expect(context).toContain("Previous Similar Task Experience");
      expect(context).toContain("What Worked");
      expect(context).toContain("sliding window");
      expect(context).toContain("Key Insights");
      expect(context).toContain("configurable limits");
    });

    it("should track quality score across episode lifecycle", () => {
      let episode = Episode.create({
        taskId: "task-quality-001",
        folderId: "folder-quality",
        type: "task_execution",
        context: {
          taskDescription: "Optimize database queries",
          projectPath: "/projects/db",
          initialState: "Slow queries",
        },
        trajectory: { actions: [], observations: [], decisions: [], pivots: [] },
        outcome: {
          outcome: "success",
          result: "Queries optimized",
          duration: 15000,
          errorCount: 0,
          toolCallCount: 5,
        },
        reflection: {
          whatWorked: ["Index additions"],
          whatFailed: [],
          keyInsights: ["Analyze query plans first"],
        },
        tags: ["optimization"],
      });

      const initialScore = episode.getQualityScore();
      expect(initialScore).toBeGreaterThan(0);

      // Add user feedback
      episode = episode.withUserFeedback(5, "Perfect optimization, 10x faster queries!");
      const feedbackScore = episode.getQualityScore();

      expect(feedbackScore).toBeGreaterThan(initialScore);
      expect(episode.reflection.userRating).toBe(5);

      // Add tags
      episode = episode.withTags(["database", "performance"]);
      expect(episode.tags).toContain("optimization");
      expect(episode.tags).toContain("database");
      expect(episode.tags).toContain("performance");
    });
  });

  describe("Episode Serialization and Persistence", () => {
    it("should round-trip through serialization without data loss", () => {
      const builder = new EpisodeBuilder("task-serialize-001", "folder-serialize");

      builder.setContext({
        taskDescription: "Implement feature X",
        projectPath: "/projects/x",
        initialState: "Initial state",
        agentProvider: "codex",
      });

      builder.addAction({
        action: "Action 1",
        tool: "Read",
        duration: 100,
        success: true,
      });

      builder.addDecision({
        context: "Choose approach",
        options: ["A", "B", "C"],
        chosen: "B",
        reasoning: "Best fit",
      });

      builder.addPivot({
        fromApproach: "B",
        toApproach: "C",
        reason: "B had limitations",
        triggered_by: "feedback",
      });

      const original = builder.build(
        "partial",
        "Partially completed",
        {
          whatWorked: ["Some things"],
          whatFailed: ["Other things"],
          keyInsights: ["Insights"],
          wouldDoDifferently: "Changes",
        },
        ["tag1", "tag2"]
      );

      // Serialize to props
      const props = original.toProps();

      // Deserialize from props
      const restored = Episode.fromProps(props);

      // Verify all fields preserved
      expect(restored.id).toBe(original.id);
      expect(restored.taskId).toBe(original.taskId);
      expect(restored.folderId).toBe(original.folderId);
      expect(restored.type).toBe(original.type);
      expect(restored.context.agentProvider).toBe("codex");
      expect(restored.trajectory.actions).toHaveLength(1);
      expect(restored.trajectory.decisions).toHaveLength(1);
      expect(restored.trajectory.pivots).toHaveLength(1);
      expect(restored.outcome.outcome).toBe("partial");
      expect(restored.reflection.wouldDoDifferently).toBe("Changes");
      expect(restored.tags).toEqual(["tag1", "tag2"]);
    });
  });
});
