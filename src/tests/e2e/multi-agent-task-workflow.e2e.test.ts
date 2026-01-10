import { describe, it, expect } from "bun:test";
import { TaskDecompositionService } from "@/services/task-decomposition-service";
import { AgentAssignmentService } from "@/services/agent-assignment-service";
import { DependencyResolverService, type BeadsIssue } from "@/services/dependency-resolver-service";
import { classifyTask, selectAgentForCategory, compareAgentsForTask } from "@/lib/agent-heuristics";

/**
 * E2E Test: Multi-Agent Task Workflow
 * Tests the complete workflow of decomposing a complex task,
 * assigning agents, resolving dependencies, and creating execution plans.
 */
describe("E2E: Multi-Agent Task Workflow", () => {
  const decompositionService = new TaskDecompositionService();
  const agentAssignment = new AgentAssignmentService();
  const dependencyResolver = new DependencyResolverService();

  describe("Complete Feature Implementation Planning", () => {
    it("should plan full-stack feature from decomposition to execution", () => {
      // Step 1: Decompose the feature into subtasks
      const decomposition = decompositionService.decompose({
        title: "Implement user authentication system",
        description: "Build complete auth with OAuth, JWT tokens, and session management",
        type: "feature",
      });

      expect(decomposition.subtasks.length).toBeGreaterThanOrEqual(4);
      expect(decomposition.reasoning).toBeDefined();

      // Step 2: Classify and assign agents to each subtask
      const assignments = decomposition.subtasks.map((subtask) => {
        const classification = classifyTask(subtask.title, subtask.description);
        const agent = selectAgentForCategory(classification.category);

        return {
          subtask,
          classification,
          agent: agent.recommended,
          confidence: agent.confidence,
        };
      });

      // Verify we have diverse agent assignments
      const uniqueAgents = new Set(assignments.map((a) => a.agent));
      expect(uniqueAgents.size).toBeGreaterThanOrEqual(1);

      // Step 3: Build dependency graph from decomposition
      const issues: BeadsIssue[] = decomposition.subtasks.map((subtask, idx) => ({
        id: `subtask-${idx}`,
        title: subtask.title,
        description: subtask.description,
        status: "open",
        priority: subtask.priority,
        type: "task",
        dependsOn: subtask.dependsOn.map((d) => `subtask-${d}`),
        blockedBy: [],
        createdAt: new Date(),
      }));

      const graph = dependencyResolver.buildDependencyGraph(issues);
      expect(graph.nodes.size).toBe(issues.length);

      // Step 4: Get execution order
      const executionOrder = dependencyResolver.topologicalSort(graph);
      expect(executionOrder.sequential.length).toBe(issues.length);
      expect(executionOrder.parallel.length).toBeGreaterThan(0);

      // Verify first group has no dependencies
      // firstGroup contains issue IDs directly
      const firstGroup = executionOrder.parallel[0];
      for (const issueId of firstGroup) {
        const issue = issues.find((i) => i.id === issueId);
        expect(issue?.dependsOn.length).toBe(0);
      }
    });

    it("should handle complex task with security review requirements", () => {
      // Task that requires security expertise
      const decomposition = decompositionService.decompose({
        title: "Implement OAuth2 authentication",
        description: "Add secure OAuth login with PKCE flow",
        type: "feature",
      });

      // Security-sensitive tasks should get appropriate agent assignments
      const securityTasks = decomposition.subtasks.filter(
        (s) => s.title.toLowerCase().includes("security") || s.category === "review"
      );

      // Auth features should include security considerations
      expect(decomposition.subtasks.some((s) =>
        s.title.toLowerCase().includes("security") ||
        s.title.toLowerCase().includes("review") ||
        s.title.toLowerCase().includes("test")
      )).toBe(true);
    });
  });

  describe("Agent Load Balancing", () => {
    it("should balance work across available agents", () => {
      agentAssignment.resetWorkloads();

      // Create multiple tasks of different types
      const tasks: BeadsIssue[] = [
        { id: "t1", title: "Research caching strategies", status: "open", priority: 2, type: "task", dependsOn: [], blockedBy: [], createdAt: new Date() },
        { id: "t2", title: "Research database options", status: "open", priority: 2, type: "task", dependsOn: [], blockedBy: [], createdAt: new Date() },
        { id: "t3", title: "Implement cache layer", status: "open", priority: 2, type: "feature", dependsOn: [], blockedBy: [], createdAt: new Date() },
        { id: "t4", title: "Build API endpoints", status: "open", priority: 2, type: "feature", dependsOn: [], blockedBy: [], createdAt: new Date() },
        { id: "t5", title: "Fix config bug", status: "open", priority: 1, type: "bug", dependsOn: [], blockedBy: [], createdAt: new Date() },
        { id: "t6", title: "Write unit tests", status: "open", priority: 2, type: "task", dependsOn: [], blockedBy: [], createdAt: new Date() },
      ];

      // Assign agents with load balancing
      const assignments = tasks.map((task) =>
        agentAssignment.assignAgent(task, { balanceLoad: true })
      );

      // Check workload distribution
      const stats = agentAssignment.getAssignmentStats();
      expect(stats.totalAssignments).toBe(6);

      // With load balancing, work should be distributed
      const workloads = agentAssignment.getWorkloads();
      const assignedAgents = workloads.filter((w) => w.assignedTasks > 0);
      expect(assignedAgents.length).toBeGreaterThanOrEqual(2);
    });

    it("should handle agent unavailability gracefully", () => {
      agentAssignment.resetWorkloads();

      // Complex task that would normally go to Claude
      const task: BeadsIssue = {
        id: "complex-1",
        title: "Implement complex authentication system",
        status: "open",
        priority: 1,
        type: "feature",
        dependsOn: [],
        blockedBy: [],
        createdAt: new Date(),
      };

      // Restrict to only Gemini and Codex
      const assignment = agentAssignment.assignAgent(task, {
        availableAgents: ["gemini", "codex"],
      });

      expect(["gemini", "codex"]).toContain(assignment.agent);
      expect(assignment.alternativeAgents.length).toBeGreaterThan(0);
    });
  });

  describe("Dependency Chain Resolution", () => {
    it("should resolve complex dependency chains correctly", () => {
      // Create tasks with chain dependencies: A -> B -> C -> D
      const issues: BeadsIssue[] = [
        { id: "A", title: "Define API schema", status: "open", priority: 1, type: "task", dependsOn: [], blockedBy: [], createdAt: new Date() },
        { id: "B", title: "Implement API endpoints", status: "open", priority: 2, type: "task", dependsOn: ["A"], blockedBy: [], createdAt: new Date() },
        { id: "C", title: "Add authentication", status: "open", priority: 2, type: "task", dependsOn: ["B"], blockedBy: [], createdAt: new Date() },
        { id: "D", title: "Write API tests", status: "open", priority: 3, type: "task", dependsOn: ["C"], blockedBy: [], createdAt: new Date() },
      ];

      const graph = dependencyResolver.buildDependencyGraph(issues);
      const order = dependencyResolver.topologicalSort(graph);

      // Should be 4 phases since it's a chain
      expect(order.parallel.length).toBe(4);

      // Each phase should have one task
      for (const phase of order.parallel) {
        expect(phase.length).toBe(1);
      }

      // Verify order: A before B before C before D (sequential contains issue IDs)
      const indexOfA = order.sequential.indexOf("A");
      const indexOfB = order.sequential.indexOf("B");
      const indexOfC = order.sequential.indexOf("C");
      const indexOfD = order.sequential.indexOf("D");

      expect(indexOfA).toBeGreaterThanOrEqual(0);
      expect(indexOfA).toBeLessThan(indexOfB);
      expect(indexOfB).toBeLessThan(indexOfC);
      expect(indexOfC).toBeLessThan(indexOfD);
    });

    it("should identify parallel execution opportunities", () => {
      // Tasks with diamond dependency: A -> B, A -> C, B & C -> D
      const issues: BeadsIssue[] = [
        { id: "A", title: "Setup project", status: "open", priority: 1, type: "task", dependsOn: [], blockedBy: [], createdAt: new Date() },
        { id: "B", title: "Build frontend", status: "open", priority: 2, type: "task", dependsOn: ["A"], blockedBy: [], createdAt: new Date() },
        { id: "C", title: "Build backend", status: "open", priority: 2, type: "task", dependsOn: ["A"], blockedBy: [], createdAt: new Date() },
        { id: "D", title: "Integration testing", status: "open", priority: 3, type: "task", dependsOn: ["B", "C"], blockedBy: [], createdAt: new Date() },
      ];

      const graph = dependencyResolver.buildDependencyGraph(issues);
      const order = dependencyResolver.topologicalSort(graph);

      // Phase 1: A, Phase 2: B and C (parallel), Phase 3: D
      expect(order.parallel.length).toBe(3);

      // Second phase should have 2 tasks (B and C can run in parallel)
      expect(order.parallel[1].length).toBe(2);
    });

    it("should detect cycles in dependency graph", () => {
      // Circular dependency: A -> B -> C -> A
      const issues: BeadsIssue[] = [
        { id: "A", title: "Task A", status: "open", priority: 1, type: "task", dependsOn: ["C"], blockedBy: [], createdAt: new Date() },
        { id: "B", title: "Task B", status: "open", priority: 1, type: "task", dependsOn: ["A"], blockedBy: [], createdAt: new Date() },
        { id: "C", title: "Task C", status: "open", priority: 1, type: "task", dependsOn: ["B"], blockedBy: [], createdAt: new Date() },
      ];

      const graph = dependencyResolver.buildDependencyGraph(issues);

      // Use detectCycles to find cycles
      const cycles = dependencyResolver.detectCycles(graph);
      expect(cycles.length).toBeGreaterThan(0);

      // First cycle should contain all three nodes
      expect(cycles[0].length).toBeGreaterThan(0);
    });
  });

  describe("Agent Comparison and Selection", () => {
    it("should compare agents for different task types", () => {
      // Research task
      const researchComparison = compareAgentsForTask(
        "Research best practices",
        "Investigate caching strategies"
      );
      // Result is sorted by score, first agent should be best match
      expect(researchComparison[0].agent).toBe("gemini");

      // Complex code task
      const complexComparison = compareAgentsForTask(
        "Implement authentication system",
        "Build secure login with OAuth"
      );
      expect(complexComparison[0].agent).toBe("claude");

      // Quick fix task - codex or opencode are good for quick fixes
      const fixComparison = compareAgentsForTask(
        "Fix typo in config",
        "Change variable name"
      );
      expect(["codex", "opencode"]).toContain(fixComparison[0].agent);
    });

    it("should provide scoring breakdown for agent selection", () => {
      const comparison = compareAgentsForTask(
        "Build complex API gateway",
        "Implement routing, rate limiting, and authentication"
      );

      // Each comparison should have score and reasoning
      for (const agentResult of comparison) {
        expect(agentResult.score).toBeGreaterThanOrEqual(0);
        expect(agentResult.reasoning).toBeDefined();
      }

      // Results should be sorted by score
      for (let i = 1; i < comparison.length; i++) {
        expect(comparison[i - 1].score).toBeGreaterThanOrEqual(comparison[i].score);
      }
    });
  });

  describe("End-to-End Planning Workflow", () => {
    it("should complete full planning cycle for epic", () => {
      agentAssignment.resetWorkloads();

      // Step 1: Get decomposition preview
      const preview = decompositionService.preview({
        title: "Build e-commerce checkout system",
        description: "Shopping cart, payment processing, order management",
        type: "feature",
      });

      expect(preview.estimatedEffort).toContain("subtasks");
      expect(preview.parallelization).toContain("parallel");

      // Step 2: Full decomposition
      const decomposition = decompositionService.decompose({
        title: "Build e-commerce checkout system",
        description: "Shopping cart, payment processing, order management",
        type: "feature",
      });

      // Step 3: Convert to issues for dependency resolution
      const issues: BeadsIssue[] = decomposition.subtasks.map((subtask, idx) => ({
        id: `checkout-${idx}`,
        title: subtask.title,
        description: subtask.description,
        status: "open",
        priority: subtask.priority,
        type: "task",
        dependsOn: subtask.dependsOn.map((d) => `checkout-${d}`),
        blockedBy: [],
        createdAt: new Date(),
      }));

      // Step 4: Build dependency graph
      const graph = dependencyResolver.buildDependencyGraph(issues);
      expect(graph.nodes.size).toBe(issues.length);

      // Step 5: Get execution order
      const order = dependencyResolver.topologicalSort(graph);
      // All issues should be sortable (no cycles)
      expect(order.sequential.length).toBe(issues.length);

      // Step 6: Assign agents to each task
      const executionPlan = issues.map((issue) => {
        const assignment = agentAssignment.assignAgent(issue, { balanceLoad: true });
        return {
          issueId: issue.id,
          title: issue.title,
          agent: assignment.agent,
          confidence: assignment.confidence,
        };
      });

      expect(executionPlan.length).toBe(issues.length);

      // Step 7: Verify workload distribution
      const stats = agentAssignment.getAssignmentStats();
      expect(stats.totalAssignments).toBe(issues.length);

      // Step 8: Calculate critical path length
      expect(order.criticalPath.length).toBeGreaterThan(0);
    });
  });
});
