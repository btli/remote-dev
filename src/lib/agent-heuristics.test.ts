import { describe, it, expect } from "bun:test";
import {
  classifyTask,
  selectAgent,
  selectAgentForCategory,
  estimateComplexity,
  compareAgentsForTask,
  getAgentCapabilities,
  AGENT_CAPABILITIES,
  type TaskCategory,
  type ExecutableAgent,
} from "./agent-heuristics";

describe("agent-heuristics", () => {
  describe("classifyTask", () => {
    it("should classify research tasks", () => {
      const result = classifyTask("Research authentication patterns", "Investigate best practices for OAuth");

      expect(result.category).toBe("research");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.keywords).toContain("research");
    });

    it("should classify complex code tasks", () => {
      const result = classifyTask("Implement user service", "Build a complete authentication system");

      expect(result.category).toBe("complex_code");
      expect(result.keywords).toContain("implement");
    });

    it("should classify quick fix tasks", () => {
      const result = classifyTask("Fix typo in README", "Update the broken link");

      expect(result.category).toBe("quick_fix");
      expect(result.keywords).toContain("fix");
    });

    it("should classify testing tasks", () => {
      const result = classifyTask("Write unit tests", "Add test coverage for auth module");

      expect(result.category).toBe("testing");
      expect(result.keywords).toContain("test");
    });

    it("should classify review tasks", () => {
      const result = classifyTask("Security review", "Audit the authentication code");

      expect(result.category).toBe("review");
      expect(result.keywords).toContain("review");
    });

    it("should classify documentation tasks", () => {
      const result = classifyTask("Document API", "Write API reference docs");

      expect(result.category).toBe("documentation");
      expect(result.keywords).toContain("document");
    });

    it("should classify refactoring tasks", () => {
      const result = classifyTask("Refactor auth module", "Clean up and reorganize code");

      expect(result.category).toBe("refactoring");
      expect(result.keywords).toContain("refactor");
    });

    it("should fall back to general for ambiguous tasks", () => {
      const result = classifyTask("Do something", "Make changes");

      expect(["general", "quick_fix", "complex_code"]).toContain(result.category);
    });

    it("should provide reasoning", () => {
      const result = classifyTask("Research patterns", "");

      expect(result.reasoning).toContain("research");
      expect(result.reasoning).toContain("based on keywords");
    });
  });

  describe("selectAgentForCategory", () => {
    it("should select gemini for research", () => {
      const result = selectAgentForCategory("research");

      expect(result.recommended).toBe("gemini");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should select claude for complex code", () => {
      const result = selectAgentForCategory("complex_code");

      expect(result.recommended).toBe("claude");
    });

    it("should select codex for quick fixes", () => {
      const result = selectAgentForCategory("quick_fix");

      expect(result.recommended).toBe("codex");
    });

    it("should select codex for testing", () => {
      const result = selectAgentForCategory("testing");

      expect(result.recommended).toBe("codex");
    });

    it("should select claude for review", () => {
      const result = selectAgentForCategory("review");

      expect(result.recommended).toBe("claude");
    });

    it("should respect available agents", () => {
      const result = selectAgentForCategory("complex_code", ["gemini", "codex"]);

      expect(["gemini", "codex"]).toContain(result.recommended);
      expect(result.recommended).not.toBe("claude");
    });

    it("should provide alternatives", () => {
      const result = selectAgentForCategory("research");

      expect(result.alternatives.length).toBeGreaterThan(0);
      expect(result.alternatives).not.toContain(result.recommended);
    });

    it("should provide reasoning", () => {
      const result = selectAgentForCategory("research");

      expect(result.reasoning).toContain("gemini");
    });
  });

  describe("selectAgent", () => {
    it("should select appropriate agent for task", () => {
      const result = selectAgent("Research API patterns", "Investigate RESTful design");

      expect(result.recommended).toBe("gemini");
    });

    it("should handle complex code tasks", () => {
      const result = selectAgent("Implement authentication system");

      expect(result.recommended).toBe("claude");
    });

    it("should handle quick fixes", () => {
      const result = selectAgent("Fix bug in login");

      expect(result.recommended).toBe("codex");
    });

    it("should combine confidence from classification and selection", () => {
      const result = selectAgent("Research something specific", "Investigate patterns");

      // Combined confidence should be lower than max
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should respect available agents", () => {
      const result = selectAgent("Implement feature", "", ["codex", "opencode"]);

      expect(["codex", "opencode"]).toContain(result.recommended);
    });
  });

  describe("estimateComplexity", () => {
    it("should estimate low complexity for simple tasks", () => {
      const result = estimateComplexity("Fix typo", "Update single word");

      expect(result.level).toBe("low");
      expect(result.score).toBeLessThan(2);
    });

    it("should estimate high complexity for complex tasks", () => {
      const result = estimateComplexity(
        "Refactor authentication with security and performance optimization",
        "Multiple modules need database migration and API integration"
      );

      expect(result.level).toBe("high");
      expect(result.score).toBeGreaterThan(2);
    });

    it("should identify complexity factors", () => {
      const result = estimateComplexity("Integrate API with database migration");

      expect(result.factors).toContain("integration work");
      expect(result.factors).toContain("database changes");
    });

    it("should reduce complexity for simple indicators", () => {
      const result = estimateComplexity("Fix single typo", "Update one comment");

      // The 'single' keyword triggers 'limited scope' factor
      expect(result.factors).toContain("limited scope");
    });
  });

  describe("compareAgentsForTask", () => {
    it("should compare all agents", () => {
      const result = compareAgentsForTask("Research patterns");

      expect(result.length).toBe(4);
      expect(result.map((r) => r.agent)).toContain("claude");
      expect(result.map((r) => r.agent)).toContain("gemini");
      expect(result.map((r) => r.agent)).toContain("codex");
      expect(result.map((r) => r.agent)).toContain("opencode");
    });

    it("should sort by score descending", () => {
      const result = compareAgentsForTask("Research patterns");

      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score);
      }
    });

    it("should provide reasoning for each agent", () => {
      const result = compareAgentsForTask("Implement feature");

      for (const r of result) {
        expect(r.reasoning).toBeDefined();
        expect(r.reasoning.length).toBeGreaterThan(0);
      }
    });

    it("should prefer specialized agents for matching categories", () => {
      const research = compareAgentsForTask("Research patterns");
      const geminiScore = research.find((r) => r.agent === "gemini")?.score ?? 0;

      // Gemini should have high score for research
      expect(geminiScore).toBeGreaterThan(3);
    });
  });

  describe("getAgentCapabilities", () => {
    it("should return capabilities for claude", () => {
      const caps = getAgentCapabilities("claude");

      expect(caps.provider).toBe("claude");
      expect(caps.categories).toContain("complex_code");
      expect(caps.strengths.length).toBeGreaterThan(0);
      expect(caps.speedRating).toBeDefined();
      expect(caps.qualityRating).toBeDefined();
    });

    it("should return capabilities for all agents", () => {
      const agents: ExecutableAgent[] = ["claude", "gemini", "codex", "opencode"];

      for (const agent of agents) {
        const caps = getAgentCapabilities(agent);
        expect(caps.provider).toBe(agent);
        expect(caps.categories.length).toBeGreaterThan(0);
      }
    });
  });

  describe("AGENT_CAPABILITIES", () => {
    it("should have entries for all agents", () => {
      const agents: ExecutableAgent[] = ["claude", "gemini", "codex", "opencode"];

      for (const agent of agents) {
        expect(AGENT_CAPABILITIES[agent]).toBeDefined();
      }
    });

    it("should have valid ratings", () => {
      for (const agent of Object.values(AGENT_CAPABILITIES)) {
        expect(agent.speedRating).toBeGreaterThanOrEqual(1);
        expect(agent.speedRating).toBeLessThanOrEqual(5);
        expect(agent.qualityRating).toBeGreaterThanOrEqual(1);
        expect(agent.qualityRating).toBeLessThanOrEqual(5);
      }
    });

    it("should have non-empty strengths and weaknesses", () => {
      for (const agent of Object.values(AGENT_CAPABILITIES)) {
        expect(agent.strengths.length).toBeGreaterThan(0);
        expect(agent.weaknesses.length).toBeGreaterThan(0);
      }
    });
  });
});
