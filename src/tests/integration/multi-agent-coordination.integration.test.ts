import { describe, it, expect, beforeEach } from "bun:test";
import {
  classifyTask,
  selectAgent,
  selectAgentForCategory,
  estimateComplexity,
  compareAgentsForTask,
  type ExecutableAgent,
  type TaskCategory,
} from "@/lib/agent-heuristics";
import { TaskDecompositionService } from "@/services/task-decomposition-service";
import { AgentAssignmentService } from "@/services/agent-assignment-service";
import { DependencyResolverService, type BeadsIssue } from "@/services/dependency-resolver-service";

/**
 * Integration tests for Multi-Agent Coordination workflow
 * Tests the interaction between heuristics, decomposition, assignment, and dependency resolution
 */
describe("Multi-Agent Coordination Integration", () => {
  let taskDecomposition: TaskDecompositionService;
  let agentAssignment: AgentAssignmentService;
  let dependencyResolver: DependencyResolverService;

  beforeEach(() => {
    taskDecomposition = new TaskDecompositionService();
    agentAssignment = new AgentAssignmentService();
    agentAssignment.resetWorkloads();
    dependencyResolver = new DependencyResolverService();
  });

  describe("Classification → Agent Selection Flow", () => {
    it("should select appropriate agent based on task classification", () => {
      const testCases: Array<{ title: string; expectedAgent: ExecutableAgent }> = [
        { title: "Research authentication patterns", expectedAgent: "gemini" },
        { title: "Implement user service", expectedAgent: "claude" },
        { title: "Fix typo in README", expectedAgent: "codex" },
        { title: "Write unit tests", expectedAgent: "codex" },
        { title: "Security review of API", expectedAgent: "claude" },
      ];

      for (const { title, expectedAgent } of testCases) {
        const classification = classifyTask(title, "");
        const selection = selectAgentForCategory(classification.category);

        expect(selection.recommended).toBe(expectedAgent);
        expect(selection.confidence).toBeGreaterThan(0);
      }
    });

    it("should provide consistent results through selectAgent shorthand", () => {
      const result = selectAgent("Research API design patterns", "Investigate RESTful best practices");

      expect(result.recommended).toBe("gemini");
      expect(result.alternatives).toBeDefined();
      expect(result.reasoning).toContain("gemini");
    });
  });

  describe("Task Decomposition → Agent Assignment Flow", () => {
    it("should assign agents to decomposed subtasks", () => {
      // Decompose a complex feature
      const decomposition = taskDecomposition.decompose({
        title: "Implement user authentication",
        description: "Build API endpoints and frontend UI for login/signup",
        type: "feature",
      });

      expect(decomposition.subtasks.length).toBeGreaterThan(0);

      // Assign agents to each subtask
      const assignments = decomposition.subtasks.map((subtask) => {
        const mockIssue: BeadsIssue = {
          id: `subtask-${Math.random()}`,
          title: subtask.title,
          description: subtask.description,
          status: "open",
          priority: subtask.priority,
          type: "task",
          dependsOn: [],
          blockedBy: [],
          createdAt: new Date(),
        };

        return {
          subtask,
          assignment: agentAssignment.assignAgent(mockIssue),
        };
      });

      // Verify each subtask has an assignment
      for (const { subtask, assignment } of assignments) {
        expect(assignment.agent).toBeDefined();
        expect(assignment.confidence).toBeGreaterThan(0);
        expect(assignment.reasoning).toBeDefined();

        // Research tasks should go to gemini
        if (subtask.category === "research") {
          expect(assignment.agent).toBe("gemini");
        }

        // Complex code should go to claude
        if (subtask.category === "complex_code") {
          expect(assignment.agent).toBe("claude");
        }
      }
    });

    it("should respect parallel groups in assignment", () => {
      const decomposition = taskDecomposition.decompose({
        title: "Implement feature with API",
        description: "Backend and frontend components",
        type: "feature",
      });

      expect(decomposition.parallelGroups.length).toBeGreaterThan(0);

      // First group should have tasks that can run in parallel
      const firstGroup = decomposition.parallelGroups[0];
      expect(firstGroup.length).toBeGreaterThan(0);

      // All tasks in first group should have no dependencies
      for (const idx of firstGroup) {
        expect(decomposition.subtasks[idx].dependsOn).toHaveLength(0);
      }
    });
  });

  describe("Complexity Estimation → Decomposition Flow", () => {
    it("should produce more subtasks for complex tasks", () => {
      const simpleTask = {
        title: "Fix typo",
        description: "Update single word",
        type: "task" as const,
      };

      const complexTask = {
        title: "Implement authentication with OAuth, JWT, and multi-factor",
        description: "Build secure login with multiple integrations and database migrations",
        type: "feature" as const,
      };

      const simpleComplexity = estimateComplexity(simpleTask.title, simpleTask.description);
      const complexComplexity = estimateComplexity(complexTask.title, complexTask.description);

      expect(complexComplexity.score).toBeGreaterThan(simpleComplexity.score);
      expect(complexComplexity.level).toBe("high");

      const simpleDecomposition = taskDecomposition.decompose(simpleTask);
      const complexDecomposition = taskDecomposition.decompose(complexTask);

      expect(complexDecomposition.subtasks.length).toBeGreaterThan(
        simpleDecomposition.subtasks.length
      );
    });
  });

  describe("Dependency Resolution with Graph", () => {
    it("should build dependency graph from issues", () => {
      const issues: BeadsIssue[] = [
        {
          id: "beads-abc",
          title: "Task A",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: [],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "beads-def",
          title: "Task B",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["beads-abc"],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "beads-ghi",
          title: "Task C",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["beads-abc"],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "beads-jkl",
          title: "Task D",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["beads-def", "beads-ghi"],
          blockedBy: [],
          createdAt: new Date(),
        },
      ];

      const graph = dependencyResolver.buildDependencyGraph(issues);

      expect(graph.nodes.size).toBe(4);
      expect(graph.edges.get("beads-def")?.has("beads-abc")).toBe(true);
      expect(graph.edges.get("beads-jkl")?.has("beads-def")).toBe(true);
      expect(graph.edges.get("beads-jkl")?.has("beads-ghi")).toBe(true);
    });

    it("should get topological sort order", () => {
      const issues: BeadsIssue[] = [
        {
          id: "task-a",
          title: "Task A",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: [],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "task-b",
          title: "Task B",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["task-a"],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "task-c",
          title: "Task C",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["task-a"],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "task-d",
          title: "Task D",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["task-b", "task-c"],
          blockedBy: [],
          createdAt: new Date(),
        },
      ];

      const graph = dependencyResolver.buildDependencyGraph(issues);
      const order = dependencyResolver.topologicalSort(graph);

      // A should come first (no dependencies)
      expect(order.sequential[0]).toBe("task-a");

      // D should come last (depends on B and C)
      expect(order.sequential[order.sequential.length - 1]).toBe("task-d");

      // Should have parallel groups
      expect(order.parallel.length).toBeGreaterThan(0);
    });

    it("should detect circular dependencies", () => {
      const issues: BeadsIssue[] = [
        {
          id: "task-a",
          title: "Task A",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["task-c"],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "task-b",
          title: "Task B",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["task-a"],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "task-c",
          title: "Task C",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["task-b"],
          blockedBy: [],
          createdAt: new Date(),
        },
      ];

      const graph = dependencyResolver.buildDependencyGraph(issues);
      const cycles = dependencyResolver.detectCycles(graph);

      expect(cycles.length).toBeGreaterThan(0);
    });

    it("should find critical path", () => {
      const issues: BeadsIssue[] = [
        {
          id: "task-a",
          title: "Task A",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: [],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "task-b",
          title: "Task B",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["task-a"],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "task-c",
          title: "Task C",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["task-b"],
          blockedBy: [],
          createdAt: new Date(),
        },
      ];

      const graph = dependencyResolver.buildDependencyGraph(issues);
      const order = dependencyResolver.topologicalSort(graph);

      // Critical path should be the longest chain
      expect(order.criticalPath.length).toBe(3);
      expect(order.criticalPath).toContain("task-a");
      expect(order.criticalPath).toContain("task-b");
      expect(order.criticalPath).toContain("task-c");
    });
  });

  describe("Load Balancing Integration", () => {
    it("should distribute work across agents with load balancing", () => {
      // Create multiple similar tasks
      const issues: BeadsIssue[] = Array.from({ length: 10 }, (_, i) => ({
        id: `task-${i}`,
        title: `Research topic ${i}`,
        description: "Investigate best practices",
        status: "open" as const,
        priority: 2,
        type: "task" as const,
        dependsOn: [],
        blockedBy: [],
        createdAt: new Date(),
      }));

      // Assign all with load balancing
      const assignments = issues.map((issue) =>
        agentAssignment.assignAgent(issue, { balanceLoad: true })
      );

      // Check distribution
      const agentCounts = assignments.reduce(
        (acc, a) => {
          acc[a.agent] = (acc[a.agent] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

      // Should not all go to the same agent
      const agents = Object.keys(agentCounts);
      expect(agents.length).toBeGreaterThan(1);
    });

    it("should track workload correctly", () => {
      const issue1: BeadsIssue = {
        id: "task-1",
        title: "Research patterns",
        description: "",
        status: "open",
        priority: 2,
        type: "task",
        dependsOn: [],
        blockedBy: [],
        createdAt: new Date(),
      };

      const issue2: BeadsIssue = {
        id: "task-2",
        title: "Research more patterns",
        description: "",
        status: "open",
        priority: 2,
        type: "task",
        dependsOn: [],
        blockedBy: [],
        createdAt: new Date(),
      };

      // Initial workload should be 0
      let workloads = agentAssignment.getWorkloads();
      expect(workloads.every((w) => w.assignedTasks === 0)).toBe(true);

      // Assign first task
      const assignment1 = agentAssignment.assignAgent(issue1);
      workloads = agentAssignment.getWorkloads();
      const agent1Workload = workloads.find((w) => w.agent === assignment1.agent);
      expect(agent1Workload?.assignedTasks).toBe(1);

      // Assign second task
      const assignment2 = agentAssignment.assignAgent(issue2);
      workloads = agentAssignment.getWorkloads();
      const totalTasks = workloads.reduce((sum, w) => sum + w.assignedTasks, 0);
      expect(totalTasks).toBe(2);

      // Release first task
      agentAssignment.releaseAssignment(issue1.id, assignment1.agent);
      workloads = agentAssignment.getWorkloads();
      const updatedTotalTasks = workloads.reduce((sum, w) => sum + w.assignedTasks, 0);
      expect(updatedTotalTasks).toBe(1);
    });
  });

  describe("End-to-End Workflow", () => {
    it("should handle complete decomposition → assignment → ordering workflow", () => {
      // 1. Decompose a complex feature
      const decomposition = taskDecomposition.decompose({
        title: "Implement user dashboard",
        description: "Create API endpoints, database schema, and React components",
        type: "feature",
      });

      expect(decomposition.subtasks.length).toBeGreaterThan(0);

      // 2. Convert subtasks to beads-style issues
      const beadsIssues: BeadsIssue[] = decomposition.subtasks.map((subtask, idx) => ({
        id: `subtask-${idx}`,
        title: subtask.title,
        description: subtask.description,
        status: "open" as const,
        priority: subtask.priority,
        type: "task" as const,
        dependsOn: subtask.dependsOn.map((d) => `subtask-${d}`),
        blockedBy: [],
        createdAt: new Date(),
      }));

      // 3. Build dependency graph
      const graph = dependencyResolver.buildDependencyGraph(beadsIssues);

      // 4. Get execution order
      const order = dependencyResolver.topologicalSort(graph);
      expect(order.sequential.length).toBe(beadsIssues.length);

      // 5. Assign agents in execution order
      const executionPlan = order.sequential.map((issueId) => {
        const issue = beadsIssues.find((i) => i.id === issueId)!;
        const assignment = agentAssignment.assignAgent(issue);
        return { issue, assignment };
      });

      // Verify plan
      expect(executionPlan.length).toBe(beadsIssues.length);
      expect(executionPlan.every((p) => p.assignment.agent)).toBe(true);
    });

    it("should generate assignments for multiple issues in order", () => {
      // Create issues directly
      const issues: BeadsIssue[] = [
        {
          id: "beads-001",
          title: "Research auth patterns",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: [],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "beads-002",
          title: "Implement JWT middleware",
          status: "open",
          priority: 1,
          type: "task",
          dependsOn: ["beads-001"],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "beads-003",
          title: "Write auth tests",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: ["beads-002"],
          blockedBy: [],
          createdAt: new Date(),
        },
      ];

      // Build graph and get order
      const graph = dependencyResolver.buildDependencyGraph(issues);
      const order = dependencyResolver.topologicalSort(graph);

      // Assign agents in order
      const assignments = order.sequential.map((issueId) => {
        const issue = issues.find((i) => i.id === issueId)!;
        return agentAssignment.assignAgent(issue);
      });

      expect(assignments.length).toBe(3);
      expect(assignments.every((a) => a.agent)).toBe(true);

      // Research should be assigned to gemini
      expect(assignments[0].agent).toBe("gemini");
    });
  });

  describe("Agent Comparison Integration", () => {
    it("should rank agents based on task requirements", () => {
      const researchRanking = compareAgentsForTask("Research patterns", "Investigate best practices");

      // Gemini should rank high for research
      const geminiRank = researchRanking.findIndex((r) => r.agent === "gemini");
      expect(geminiRank).toBe(0); // Should be first

      const codeRanking = compareAgentsForTask(
        "Implement complex algorithm",
        "Build optimized data structure"
      );

      // Claude should rank high for complex code
      const claudeRank = codeRanking.findIndex((r) => r.agent === "claude");
      expect(claudeRank).toBeLessThanOrEqual(1); // Should be first or second
    });
  });

  describe("Task Category Patterns", () => {
    it("should correctly categorize various task types", () => {
      const testCases: Array<{ title: string; expectedCategory: TaskCategory }> = [
        { title: "Investigate caching strategies", expectedCategory: "research" },
        { title: "Analyze performance bottlenecks", expectedCategory: "research" },
        { title: "Build authentication system", expectedCategory: "complex_code" },
        { title: "Implement WebSocket server", expectedCategory: "complex_code" },
        { title: "Fix typo in config", expectedCategory: "quick_fix" },
        { title: "Update broken link", expectedCategory: "quick_fix" },
        { title: "Write unit tests for auth", expectedCategory: "testing" },
        { title: "Add integration tests", expectedCategory: "testing" },
        { title: "Review security implementation", expectedCategory: "review" },
        { title: "Code review for PR", expectedCategory: "review" },
        { title: "Document API endpoints", expectedCategory: "documentation" },
        { title: "Write README", expectedCategory: "documentation" },
        { title: "Refactor and clean up code", expectedCategory: "refactoring" },
      ];

      for (const { title, expectedCategory } of testCases) {
        const result = classifyTask(title, "");
        expect(result.category).toBe(expectedCategory);
      }
    });
  });

  describe("Workload Statistics", () => {
    it("should provide accurate assignment statistics", () => {
      // Make some assignments
      const issues: BeadsIssue[] = [
        {
          id: "task-1",
          title: "Research task",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: [],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "task-2",
          title: "Implement feature",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: [],
          blockedBy: [],
          createdAt: new Date(),
        },
        {
          id: "task-3",
          title: "Fix bug",
          status: "open",
          priority: 2,
          type: "task",
          dependsOn: [],
          blockedBy: [],
          createdAt: new Date(),
        },
      ];

      for (const issue of issues) {
        agentAssignment.assignAgent(issue);
      }

      agentAssignment.markAgentActive("gemini", true);

      const stats = agentAssignment.getAssignmentStats();

      expect(stats.totalAssignments).toBe(3);
      expect(stats.activeAgents).toBe(1);
      expect(Object.values(stats.byAgent).reduce((a, b) => a + b, 0)).toBe(3);
    });
  });
});
