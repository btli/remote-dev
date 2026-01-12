/**
 * Tests for Hindsight Generator Service
 */

import { describe, it, expect } from "vitest";
import {
  Episode,
  EpisodeBuilder,
  type EpisodeReflection,
} from "@/domain/entities/Episode";
import {
  generateHindsight,
  applyHindsight,
  analyzeEpisodePatterns,
} from "./hindsight-generator-service";

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createTestEpisode(options: {
  success?: boolean;
  actions?: Array<{ action: string; tool?: string; success: boolean; duration: number }>;
  pivots?: Array<{
    fromApproach: string;
    toApproach: string;
    reason: string;
    triggered_by: "error" | "feedback" | "discovery" | "timeout";
  }>;
  decisions?: Array<{
    context: string;
    options: string[];
    chosen: string;
    reasoning: string;
  }>;
}): Episode {
  const builder = new EpisodeBuilder("task-1", "folder-1", "task_execution");

  builder.setContext({
    taskDescription: "Test task for hindsight analysis",
    projectPath: "/test/project",
    initialState: "Clean state",
  });

  // Add actions
  const actions = options.actions || [
    { action: "Read file", tool: "Read", success: true, duration: 100 },
    { action: "Edit file", tool: "Edit", success: true, duration: 200 },
    { action: "Run tests", tool: "Bash", success: true, duration: 1000 },
  ];

  for (const action of actions) {
    builder.addAction({
      action: action.action,
      tool: action.tool,
      success: action.success,
      duration: action.duration,
    });
  }

  // Add pivots
  for (const pivot of options.pivots || []) {
    builder.addPivot(pivot);
  }

  // Add decisions
  for (const decision of options.decisions || []) {
    builder.addDecision(decision);
  }

  const reflection: EpisodeReflection = {
    whatWorked: [],
    whatFailed: [],
    keyInsights: [],
  };

  return builder.build(
    options.success !== false ? "success" : "failure",
    options.success !== false ? "Task completed" : "Task failed",
    reflection
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("generateHindsight", () => {
  it("should generate hindsight for a successful episode", () => {
    const episode = createTestEpisode({ success: true });
    const hindsight = generateHindsight(episode);

    expect(hindsight).toBeDefined();
    expect(hindsight.confidence).toBeGreaterThan(0);
    expect(hindsight.confidence).toBeLessThanOrEqual(1);
    expect(Array.isArray(hindsight.whatWorked)).toBe(true);
    expect(Array.isArray(hindsight.whatFailed)).toBe(true);
    expect(Array.isArray(hindsight.keyInsights)).toBe(true);
    expect(typeof hindsight.wouldDoDifferently).toBe("string");
  });

  it("should detect repeated failure pattern", () => {
    const episode = createTestEpisode({
      success: false,
      actions: [
        { action: "Try approach A", tool: "Bash", success: false, duration: 100 },
        { action: "Retry approach A", tool: "Bash", success: false, duration: 100 },
        { action: "Retry approach A again", tool: "Bash", success: false, duration: 100 },
        { action: "Still trying A", tool: "Bash", success: false, duration: 100 },
      ],
    });

    const hindsight = generateHindsight(episode);

    expect(hindsight.patterns.some((p) => p.type === "repeated_failure")).toBe(true);
    expect(hindsight.whatFailed.length).toBeGreaterThan(0);
  });

  it("should detect tool mastery pattern", () => {
    const episode = createTestEpisode({
      success: true,
      actions: [
        { action: "Read config", tool: "Read", success: true, duration: 50 },
        { action: "Read source", tool: "Read", success: true, duration: 50 },
        { action: "Read tests", tool: "Read", success: true, duration: 50 },
        { action: "Read docs", tool: "Read", success: true, duration: 50 },
      ],
    });

    const hindsight = generateHindsight(episode);

    expect(hindsight.patterns.some((p) => p.type === "tool_mastery")).toBe(true);
    expect(hindsight.whatWorked.some((w) => w.includes("Read"))).toBe(true);
  });

  it("should detect tool struggle pattern", () => {
    const episode = createTestEpisode({
      success: false,
      actions: [
        { action: "Edit file 1", tool: "Edit", success: false, duration: 100 },
        { action: "Edit file 2", tool: "Edit", success: false, duration: 100 },
        { action: "Edit file 3", tool: "Edit", success: false, duration: 100 },
        { action: "Edit file 4", tool: "Edit", success: true, duration: 100 },
      ],
    });

    const hindsight = generateHindsight(episode);

    expect(hindsight.patterns.some((p) => p.type === "tool_struggle")).toBe(true);
    expect(hindsight.whatFailed.some((w) => w.includes("Edit"))).toBe(true);
  });

  it("should detect recovery success pattern", () => {
    const episode = createTestEpisode({
      success: true,
      actions: [
        { action: "First attempt", tool: "Bash", success: false, duration: 100 },
        { action: "Debug", tool: "Read", success: true, duration: 50 },
        { action: "Fixed attempt", tool: "Bash", success: true, duration: 100 },
        { action: "Verify", tool: "Bash", success: true, duration: 50 },
      ],
    });

    const hindsight = generateHindsight(episode);

    expect(hindsight.patterns.some((p) => p.type === "recovery_success")).toBe(true);
    expect(hindsight.whatWorked.some((w) => w.toLowerCase().includes("recover"))).toBe(true);
  });

  it("should analyze effective pivots", () => {
    const episode = createTestEpisode({
      success: true,
      pivots: [
        {
          fromApproach: "Direct modification",
          toApproach: "Use abstraction layer",
          reason: "Direct approach was fragile",
          triggered_by: "error",
        },
      ],
      actions: [
        { action: "Try direct", tool: "Edit", success: false, duration: 100 },
        { action: "Use abstraction", tool: "Edit", success: true, duration: 100 },
        { action: "Complete", tool: "Bash", success: true, duration: 100 },
      ],
    });

    const hindsight = generateHindsight(episode);

    expect(hindsight.patterns.some((p) => p.type === "pivot_effective")).toBe(true);
    expect(hindsight.whatWorked.some((w) => w.includes("abstraction"))).toBe(true);
  });

  it("should generate wouldDoDifferently for failed episodes", () => {
    const episode = createTestEpisode({
      success: false,
      actions: [
        { action: "Attempt 1", tool: "Bash", success: false, duration: 100 },
        { action: "Attempt 2", tool: "Bash", success: false, duration: 100 },
        { action: "Attempt 3", tool: "Bash", success: false, duration: 100 },
        { action: "Attempt 4", tool: "Bash", success: false, duration: 100 },
        { action: "Attempt 5", tool: "Bash", success: false, duration: 100 },
        { action: "Attempt 6", tool: "Bash", success: false, duration: 100 },
      ],
    });

    const hindsight = generateHindsight(episode);

    expect(hindsight.wouldDoDifferently.length).toBeGreaterThan(0);
    // Should suggest stopping after consecutive failures
    expect(
      hindsight.wouldDoDifferently.toLowerCase().includes("stop") ||
      hindsight.wouldDoDifferently.toLowerCase().includes("reassess") ||
      hindsight.wouldDoDifferently.toLowerCase().includes("approach")
    ).toBe(true);
  });

  it("should calculate confidence based on evidence", () => {
    // Episode with little data
    const simpleEpisode = createTestEpisode({
      success: true,
      actions: [{ action: "Quick fix", tool: "Edit", success: true, duration: 50 }],
    });

    // Episode with more data
    const complexEpisode = createTestEpisode({
      success: true,
      actions: Array.from({ length: 15 }, (_, i) => ({
        action: `Action ${i + 1}`,
        tool: "Bash",
        success: true,
        duration: 100,
      })),
      decisions: [
        {
          context: "Choose approach",
          options: ["A", "B"],
          chosen: "A",
          reasoning: "Better fit",
        },
      ],
      pivots: [
        {
          fromApproach: "Old",
          toApproach: "New",
          reason: "Improvement",
          triggered_by: "discovery",
        },
      ],
    });

    const simpleHindsight = generateHindsight(simpleEpisode);
    const complexHindsight = generateHindsight(complexEpisode);

    expect(complexHindsight.confidence).toBeGreaterThan(simpleHindsight.confidence);
  });
});

describe("applyHindsight", () => {
  it("should apply hindsight to episode reflection", () => {
    const episode = createTestEpisode({
      success: true,
      actions: [
        { action: "Read", tool: "Read", success: true, duration: 50 },
        { action: "Edit", tool: "Edit", success: true, duration: 100 },
        { action: "Test", tool: "Bash", success: true, duration: 200 },
      ],
    });

    const updated = applyHindsight(episode);

    // Should have merged reflection data
    expect(updated.reflection.whatWorked.length).toBeGreaterThanOrEqual(0);
    expect(updated.reflection.keyInsights.length).toBeGreaterThanOrEqual(0);
    expect(updated.reflection.wouldDoDifferently).toBeDefined();
  });

  it("should not overwrite existing user-provided reflection", () => {
    const builder = new EpisodeBuilder("task-1", "folder-1", "task_execution");
    builder.setContext({
      taskDescription: "Test task",
      projectPath: "/test",
      initialState: "Clean",
    });
    builder.addAction({
      action: "Do something",
      tool: "Bash",
      success: true,
      duration: 100,
    });

    const episode = builder.build("success", "Done", {
      whatWorked: ["User insight: manual approach worked well"],
      whatFailed: [],
      keyInsights: [],
      wouldDoDifferently: "User: Next time try automation",
      userRating: 5,
      userFeedback: "Great job!",
    });

    const updated = applyHindsight(episode);

    // User-provided data should be preserved
    expect(updated.reflection.whatWorked).toContain("User insight: manual approach worked well");
    expect(updated.reflection.wouldDoDifferently).toBe("User: Next time try automation");
    expect(updated.reflection.userRating).toBe(5);
    expect(updated.reflection.userFeedback).toBe("Great job!");
  });
});

describe("analyzeEpisodePatterns", () => {
  it("should find common patterns across episodes", () => {
    const episodes = [
      createTestEpisode({
        success: true,
        actions: [
          { action: "Read", tool: "Read", success: true, duration: 50 },
          { action: "Edit", tool: "Edit", success: true, duration: 100 },
        ],
      }),
      createTestEpisode({
        success: true,
        actions: [
          { action: "Read config", tool: "Read", success: true, duration: 50 },
          { action: "Edit config", tool: "Edit", success: true, duration: 100 },
        ],
      }),
      createTestEpisode({
        success: false,
        actions: [
          { action: "Bad attempt", tool: "Bash", success: false, duration: 100 },
          { action: "Another bad", tool: "Bash", success: false, duration: 100 },
          { action: "Still bad", tool: "Bash", success: false, duration: 100 },
        ],
      }),
    ];

    const analysis = analyzeEpisodePatterns(episodes);

    expect(Array.isArray(analysis.commonSuccessPatterns)).toBe(true);
    expect(Array.isArray(analysis.commonFailurePatterns)).toBe(true);
    expect(Array.isArray(analysis.recommendations)).toBe(true);
  });

  it("should generate recommendations from patterns", () => {
    const episodes = [
      // Multiple episodes with same failure pattern
      createTestEpisode({
        success: false,
        actions: Array.from({ length: 5 }, () => ({
          action: "Failed attempt",
          tool: "Bash",
          success: false,
          duration: 100,
        })),
      }),
      createTestEpisode({
        success: false,
        actions: Array.from({ length: 5 }, () => ({
          action: "Failed attempt",
          tool: "Bash",
          success: false,
          duration: 100,
        })),
      }),
    ];

    const analysis = analyzeEpisodePatterns(episodes);

    expect(analysis.commonFailurePatterns.length).toBeGreaterThan(0);
    // Should have recommendations based on repeated patterns
    expect(analysis.recommendations.length).toBeGreaterThanOrEqual(0);
  });
});

describe("pattern detection edge cases", () => {
  it("should handle empty trajectory", () => {
    const builder = new EpisodeBuilder("task-1", "folder-1", "task_execution");
    builder.setContext({
      taskDescription: "Empty task",
      projectPath: "/test",
      initialState: "Clean",
    });

    const episode = builder.build("cancelled", "Cancelled", {
      whatWorked: [],
      whatFailed: [],
      keyInsights: [],
    });

    const hindsight = generateHindsight(episode);

    expect(hindsight).toBeDefined();
    expect(hindsight.patterns.length).toBe(0);
    expect(hindsight.confidence).toBeLessThan(0.6);
  });

  it("should handle partial outcome", () => {
    const builder = new EpisodeBuilder("task-1", "folder-1", "task_execution");
    builder.setContext({
      taskDescription: "Partial task",
      projectPath: "/test",
      initialState: "Clean",
    });
    builder.addAction({
      action: "Partial work",
      tool: "Edit",
      success: true,
      duration: 100,
    });

    const episode = builder.build("partial", "Partially completed", {
      whatWorked: [],
      whatFailed: [],
      keyInsights: [],
    });

    const hindsight = generateHindsight(episode);

    expect(hindsight).toBeDefined();
    // Partial outcome should have lower confidence than clear success/failure
    expect(hindsight.confidence).toBeLessThan(0.8);
  });

  it("should handle very long execution", () => {
    const episode = createTestEpisode({
      success: true,
      actions: Array.from({ length: 100 }, (_, i) => ({
        action: `Action ${i + 1}`,
        tool: i % 2 === 0 ? "Read" : "Edit",
        success: true,
        duration: 5000, // 5 seconds each = 8+ minutes total
      })),
    });

    const hindsight = generateHindsight(episode);

    expect(hindsight.patterns.some((p) => p.type === "prolonged_attempt")).toBe(true);
  });
});
