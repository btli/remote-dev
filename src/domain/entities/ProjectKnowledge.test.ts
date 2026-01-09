import { describe, it, expect } from "bun:test";
import { ProjectKnowledge, type Convention, type LearnedPattern } from "./ProjectKnowledge";
import { InvalidValueError } from "../errors/DomainError";

describe("ProjectKnowledge", () => {
  const createTestKnowledge = (
    overrides?: Partial<Parameters<typeof ProjectKnowledge.create>[0]>
  ) => {
    return ProjectKnowledge.create({
      folderId: "folder-123",
      userId: "user-123",
      ...overrides,
    });
  };

  describe("create", () => {
    it("should create project knowledge with defaults", () => {
      const knowledge = createTestKnowledge();

      expect(knowledge.id).toBeDefined();
      expect(knowledge.folderId).toBe("folder-123");
      expect(knowledge.userId).toBe("user-123");
      expect(knowledge.techStack).toEqual([]);
      expect(knowledge.conventions).toEqual([]);
      expect(knowledge.agentPerformance).toEqual({});
      expect(knowledge.patterns).toEqual([]);
      expect(knowledge.skills).toEqual([]);
      expect(knowledge.tools).toEqual([]);
      expect(knowledge.lastScannedAt).toBeNull();
    });

    it("should accept custom id and tech stack", () => {
      const knowledge = createTestKnowledge({
        id: "custom-pk-id",
        techStack: ["TypeScript", "React", "Next.js"],
      });

      expect(knowledge.id).toBe("custom-pk-id");
      expect(knowledge.techStack).toEqual(["TypeScript", "React", "Next.js"]);
    });

    it("should accept metadata", () => {
      const knowledge = createTestKnowledge({
        metadata: {
          projectName: "remote-dev",
          framework: "Next.js",
          packageManager: "bun",
        },
      });

      expect(knowledge.metadata.projectName).toBe("remote-dev");
      expect(knowledge.metadata.framework).toBe("Next.js");
      expect(knowledge.metadata.packageManager).toBe("bun");
    });

    it("should throw on empty folderId", () => {
      expect(() => createTestKnowledge({ folderId: "" })).toThrow(InvalidValueError);
    });
  });

  describe("tech stack management", () => {
    it("should update tech stack", () => {
      const knowledge = createTestKnowledge();
      const updated = knowledge.updateTechStack(["TypeScript", "Bun"]);

      expect(updated.techStack).toEqual(["TypeScript", "Bun"]);
      expect(knowledge.techStack).toEqual([]); // Original unchanged
    });

    it("should add tech to stack", () => {
      const knowledge = createTestKnowledge({ techStack: ["TypeScript"] });
      const updated = knowledge.addTech("React");

      expect(updated.techStack).toEqual(["TypeScript", "React"]);
    });

    it("should not duplicate tech", () => {
      const knowledge = createTestKnowledge({ techStack: ["TypeScript"] });
      const updated = knowledge.addTech("TypeScript");

      expect(updated.techStack).toEqual(["TypeScript"]);
      expect(updated).toBe(knowledge); // Same instance
    });
  });

  describe("conventions", () => {
    it("should add convention", () => {
      const knowledge = createTestKnowledge();
      const withConvention = knowledge.addConvention({
        category: "code_style",
        description: "Use single quotes for strings",
        examples: ["const x = 'hello'"],
        confidence: 0.9,
        source: "detected",
      });

      expect(withConvention.conventions.length).toBe(1);
      expect(withConvention.conventions[0].category).toBe("code_style");
      expect(withConvention.conventions[0].id).toBeDefined();
      expect(withConvention.conventions[0].createdAt).toBeDefined();
    });

    it("should get conventions by category", () => {
      const knowledge = createTestKnowledge()
        .addConvention({
          category: "code_style",
          description: "Single quotes",
          examples: [],
          confidence: 0.9,
          source: "detected",
        })
        .addConvention({
          category: "naming",
          description: "camelCase variables",
          examples: [],
          confidence: 0.8,
          source: "manual",
        })
        .addConvention({
          category: "code_style",
          description: "2-space indent",
          examples: [],
          confidence: 0.95,
          source: "detected",
        });

      const codeStyleConventions = knowledge.getConventionsByCategory("code_style");
      expect(codeStyleConventions.length).toBe(2);
    });
  });

  describe("agent performance", () => {
    it("should record agent performance", () => {
      const knowledge = createTestKnowledge();
      const updated = knowledge.recordAgentPerformance("feature", "claude", true, 120);

      expect(updated.agentPerformance.feature).toBeDefined();
      expect(updated.agentPerformance.feature.claude.successRate).toBe(1);
      expect(updated.agentPerformance.feature.claude.avgDuration).toBe(120);
      expect(updated.agentPerformance.feature.claude.totalTasks).toBe(1);
    });

    it("should accumulate performance over multiple tasks", () => {
      const knowledge = createTestKnowledge()
        .recordAgentPerformance("feature", "claude", true, 100)
        .recordAgentPerformance("feature", "claude", true, 200)
        .recordAgentPerformance("feature", "claude", false, 150);

      const perf = knowledge.agentPerformance.feature.claude;
      expect(perf.totalTasks).toBe(3);
      expect(perf.successRate).toBeCloseTo(0.667, 2);
      expect(perf.avgDuration).toBe(150);
    });

    it("should get recommended agent", () => {
      const knowledge = createTestKnowledge()
        .recordAgentPerformance("feature", "claude", true, 100)
        .recordAgentPerformance("feature", "claude", true, 100)
        .recordAgentPerformance("feature", "claude", true, 100)
        .recordAgentPerformance("feature", "codex", true, 150)
        .recordAgentPerformance("feature", "codex", false, 200);

      const recommended = knowledge.getRecommendedAgent("feature");
      expect(recommended).toBe("claude"); // Higher success rate + more tasks
    });

    it("should return null for unknown task type", () => {
      const knowledge = createTestKnowledge();
      expect(knowledge.getRecommendedAgent("unknown")).toBeNull();
    });
  });

  describe("patterns", () => {
    it("should add pattern", () => {
      const knowledge = createTestKnowledge();
      const withPattern = knowledge.addPattern({
        type: "gotcha",
        description: "Don't forget to run bun install after pulling",
        context: "dependency updates",
        confidence: 0.85,
      });

      expect(withPattern.patterns.length).toBe(1);
      expect(withPattern.patterns[0].type).toBe("gotcha");
      expect(withPattern.patterns[0].usageCount).toBe(0);
    });

    it("should increment pattern usage", () => {
      const knowledge = createTestKnowledge().addPattern({
        type: "success",
        description: "Use async/await over .then()",
        context: "async code",
        confidence: 0.9,
      });

      const patternId = knowledge.patterns[0].id;
      const used = knowledge.usePattern(patternId);

      expect(used.patterns[0].usageCount).toBe(1);
      expect(used.patterns[0].lastUsedAt).toBeDefined();
    });

    it("should get high confidence patterns", () => {
      const knowledge = createTestKnowledge()
        .addPattern({
          type: "success",
          description: "High confidence",
          context: "test",
          confidence: 0.9,
        })
        .addPattern({
          type: "gotcha",
          description: "Low confidence",
          context: "test",
          confidence: 0.5,
        });

      const highConf = knowledge.getHighConfidencePatterns(0.7);
      expect(highConf.length).toBe(1);
      expect(highConf[0].description).toBe("High confidence");
    });
  });

  describe("skills", () => {
    it("should add skill", () => {
      const knowledge = createTestKnowledge();
      const withSkill = knowledge.addSkill({
        name: "Run Tests",
        description: "Execute test suite",
        command: "/test",
        steps: [
          { type: "command", action: "bun test" },
        ],
        triggers: ["run tests", "execute tests"],
        scope: "project",
        verified: true,
      });

      expect(withSkill.skills.length).toBe(1);
      expect(withSkill.skills[0].name).toBe("Run Tests");
      expect(withSkill.skills[0].usageCount).toBe(0);
    });

    it("should get verified skills", () => {
      const knowledge = createTestKnowledge()
        .addSkill({
          name: "Verified Skill",
          description: "Tested",
          command: "/verified",
          steps: [],
          triggers: [],
          scope: "project",
          verified: true,
        })
        .addSkill({
          name: "Unverified Skill",
          description: "Not tested",
          command: "/unverified",
          steps: [],
          triggers: [],
          scope: "project",
          verified: false,
        });

      const verified = knowledge.getVerifiedSkills();
      expect(verified.length).toBe(1);
      expect(verified[0].name).toBe("Verified Skill");
    });

    it("should find skill by command", () => {
      const knowledge = createTestKnowledge().addSkill({
        name: "Build",
        description: "Build project",
        command: "/build",
        steps: [],
        triggers: [],
        scope: "project",
        verified: true,
      });

      const skill = knowledge.findSkillByCommand("/build");
      expect(skill?.name).toBe("Build");

      const notFound = knowledge.findSkillByCommand("/unknown");
      expect(notFound).toBeUndefined();
    });
  });

  describe("tools", () => {
    it("should add tool", () => {
      const knowledge = createTestKnowledge();
      const withTool = knowledge.addTool({
        name: "lint_fix",
        description: "Run linter with auto-fix",
        inputSchema: { path: { type: "string" } },
        implementation: {
          type: "command",
          code: "bun run lint --fix",
        },
        triggers: ["fix lint", "lint fix"],
        confidence: 0.95,
        verified: true,
      });

      expect(withTool.tools.length).toBe(1);
      expect(withTool.tools[0].name).toBe("lint_fix");
    });

    it("should find tool by name", () => {
      const knowledge = createTestKnowledge().addTool({
        name: "typecheck",
        description: "Run TypeScript type checker",
        inputSchema: {},
        implementation: {
          type: "command",
          code: "bun run typecheck",
        },
        triggers: [],
        confidence: 0.9,
        verified: true,
      });

      const tool = knowledge.findToolByName("typecheck");
      expect(tool?.description).toBe("Run TypeScript type checker");
    });
  });

  describe("metadata", () => {
    it("should update metadata", () => {
      const knowledge = createTestKnowledge();
      const updated = knowledge.updateMetadata({
        projectName: "my-project",
        testRunner: "bun:test",
      });

      expect(updated.metadata.projectName).toBe("my-project");
      expect(updated.metadata.testRunner).toBe("bun:test");
      expect(updated.lastScannedAt).toBeDefined();
    });

    it("should mark as scanned", () => {
      const knowledge = createTestKnowledge();
      expect(knowledge.lastScannedAt).toBeNull();

      const scanned = knowledge.markScanned();
      expect(scanned.lastScannedAt).toBeDefined();
    });
  });

  describe("query methods", () => {
    it("should check if stale", () => {
      const knowledge = createTestKnowledge();
      expect(knowledge.isStale()).toBe(true); // Never scanned

      const scanned = knowledge.markScanned();
      expect(scanned.isStale()).toBe(false); // Just scanned
    });

    it("should check ownership", () => {
      const knowledge = createTestKnowledge({ userId: "user-123" });

      expect(knowledge.belongsTo("user-123")).toBe(true);
      expect(knowledge.belongsTo("user-456")).toBe(false);
    });
  });

  describe("serialization", () => {
    it("should convert to plain object", () => {
      const knowledge = createTestKnowledge({
        techStack: ["TypeScript"],
      });
      const plain = knowledge.toPlainObject();

      expect(plain.id).toBe(knowledge.id);
      expect(plain.techStack).toEqual(["TypeScript"]);
      expect(typeof plain.createdAt).toBe("object"); // Date
    });
  });
});
