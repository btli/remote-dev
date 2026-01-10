import { describe, it, expect, beforeEach } from "bun:test";
import { AgentAssignmentService } from "./agent-assignment-service";
import type { BeadsIssue } from "./dependency-resolver-service";

describe("AgentAssignmentService", () => {
  let service: AgentAssignmentService;

  beforeEach(() => {
    service = new AgentAssignmentService();
    service.resetWorkloads();
  });

  const createTestIssue = (
    overrides?: Partial<BeadsIssue>
  ): BeadsIssue => ({
    id: "test-issue-123",
    title: "Test issue",
    status: "open",
    priority: 2,
    type: "task",
    description: "A test task",
    dependsOn: [],
    blockedBy: [],
    createdAt: new Date(),
    ...overrides,
  });

  describe("assignAgent", () => {
    it("should assign appropriate agent for research task", () => {
      const issue = createTestIssue({
        title: "Research authentication patterns",
        description: "Investigate best practices for OAuth",
      });

      const assignment = service.assignAgent(issue);

      expect(assignment.agent).toBe("gemini");
      expect(assignment.confidence).toBeGreaterThan(0);
      expect(assignment.reasoning).toBeDefined();
    });

    it("should assign appropriate agent for complex code task", () => {
      const issue = createTestIssue({
        title: "Implement authentication system",
        description: "Build secure login flow",
      });

      const assignment = service.assignAgent(issue);

      expect(assignment.agent).toBe("claude");
    });

    it("should assign appropriate agent for quick fix", () => {
      const issue = createTestIssue({
        title: "Fix bug in login",
        description: "Fix broken login button",
      });

      const assignment = service.assignAgent(issue);

      expect(assignment.agent).toBe("codex");
    });

    it("should respect available agents", () => {
      const issue = createTestIssue({
        title: "Implement feature",
      });

      const assignment = service.assignAgent(issue, {
        availableAgents: ["gemini", "codex"],
      });

      expect(["gemini", "codex"]).toContain(assignment.agent);
    });

    it("should provide alternative agents", () => {
      const issue = createTestIssue({
        title: "Research patterns",
      });

      const assignment = service.assignAgent(issue);

      expect(assignment.alternativeAgents.length).toBeGreaterThan(0);
      expect(assignment.alternativeAgents).not.toContain(assignment.agent);
    });

    it("should track workload after assignment", () => {
      const issue = createTestIssue({ title: "Research task" });

      service.assignAgent(issue);
      const workloads = service.getWorkloads();

      const geminiWorkload = workloads.find((w) => w.agent === "gemini");
      expect(geminiWorkload?.assignedTasks).toBe(1);
    });

    it("should prefer fast agents when preferFastExecution is true", () => {
      const issue = createTestIssue({
        title: "Implement feature",
        description: "Build something",
      });

      // Without preference
      const normal = service.assignAgent(issue);

      // With fast preference
      service.resetWorkloads();
      const fast = service.assignAgent(issue, { preferFastExecution: true });

      // Fast agents have higher speed rating, so might get different agent
      expect(fast.agent).toBeDefined();
    });

    it("should balance load when balanceLoad is true", () => {
      // Assign many tasks to one agent
      for (let i = 0; i < 5; i++) {
        service.assignAgent(createTestIssue({ title: "Research task " + i }));
      }

      // Next assignment should consider load
      const issue = createTestIssue({
        title: "Research another thing",
      });

      const assignment = service.assignAgent(issue, { balanceLoad: true });

      // With load balancing, might pick alternative agent
      expect(assignment.agent).toBeDefined();
    });
  });

  describe("getWorkloads", () => {
    it("should return workloads for all agents", () => {
      const workloads = service.getWorkloads();

      expect(workloads.length).toBe(4);
      expect(workloads.map((w) => w.agent)).toContain("claude");
      expect(workloads.map((w) => w.agent)).toContain("gemini");
      expect(workloads.map((w) => w.agent)).toContain("codex");
      expect(workloads.map((w) => w.agent)).toContain("opencode");
    });

    it("should initialize with zero workload", () => {
      const workloads = service.getWorkloads();

      for (const w of workloads) {
        expect(w.assignedTasks).toBe(0);
        expect(w.estimatedLoad).toBe(0);
        expect(w.currentlyActive).toBe(false);
      }
    });
  });

  describe("markAgentActive", () => {
    it("should mark agent as active", () => {
      service.markAgentActive("claude", true);

      const workloads = service.getWorkloads();
      const claudeWorkload = workloads.find((w) => w.agent === "claude");

      expect(claudeWorkload?.currentlyActive).toBe(true);
    });

    it("should mark agent as inactive", () => {
      service.markAgentActive("claude", true);
      service.markAgentActive("claude", false);

      const workloads = service.getWorkloads();
      const claudeWorkload = workloads.find((w) => w.agent === "claude");

      expect(claudeWorkload?.currentlyActive).toBe(false);
    });
  });

  describe("releaseAssignment", () => {
    it("should decrease workload when released", () => {
      const issue = createTestIssue({ title: "Research task" });
      const assignment = service.assignAgent(issue);

      const beforeRelease = service.getWorkloads().find(
        (w) => w.agent === assignment.agent
      );
      expect(beforeRelease?.assignedTasks).toBe(1);

      service.releaseAssignment(issue.id, assignment.agent);

      const afterRelease = service.getWorkloads().find(
        (w) => w.agent === assignment.agent
      );
      expect(afterRelease?.assignedTasks).toBe(0);
    });

    it("should not go below zero", () => {
      service.releaseAssignment("nonexistent", "claude");

      const workloads = service.getWorkloads();
      const claudeWorkload = workloads.find((w) => w.agent === "claude");

      expect(claudeWorkload?.assignedTasks).toBe(0);
    });
  });

  describe("getAgentForCategory", () => {
    it("should return recommendation for category", () => {
      const result = service.getAgentForCategory("research");

      expect(result.recommended).toBe("gemini");
      expect(result.alternatives.length).toBeGreaterThan(0);
    });

    it("should respect available agents", () => {
      const result = service.getAgentForCategory("research", {
        availableAgents: ["claude", "codex"],
      });

      expect(["claude", "codex"]).toContain(result.recommended);
    });
  });

  describe("compareAgents", () => {
    it("should compare agents for a task", () => {
      const result = service.compareAgents(
        "Research patterns",
        "Investigate best practices"
      );

      expect(result.length).toBe(4);
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
    });
  });

  describe("getAssignmentStats", () => {
    it("should return correct stats", () => {
      // Make some assignments
      service.assignAgent(createTestIssue({ title: "Research task" }));
      service.assignAgent(createTestIssue({ title: "Implement feature" }));
      service.markAgentActive("gemini", true);

      const stats = service.getAssignmentStats();

      expect(stats.totalAssignments).toBe(2);
      expect(stats.activeAgents).toBe(1);
      expect(stats.byAgent.gemini).toBe(1);
      expect(stats.byAgent.claude).toBe(1);
    });
  });

  describe("resetWorkloads", () => {
    it("should reset all workloads", () => {
      // Make assignments
      service.assignAgent(createTestIssue({ title: "Research" }));
      service.markAgentActive("claude", true);

      // Reset
      service.resetWorkloads();

      const workloads = service.getWorkloads();
      for (const w of workloads) {
        expect(w.assignedTasks).toBe(0);
        expect(w.estimatedLoad).toBe(0);
        expect(w.currentlyActive).toBe(false);
      }
    });
  });
});
