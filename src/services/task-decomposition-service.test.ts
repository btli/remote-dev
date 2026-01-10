import { describe, it, expect } from "bun:test";
import { TaskDecompositionService } from "./task-decomposition-service";

describe("TaskDecompositionService", () => {
  const service = new TaskDecompositionService();

  describe("decompose", () => {
    it("should decompose feature with API into 5 subtasks", () => {
      const result = service.decompose({
        title: "Implement user authentication",
        description: "Build API endpoints for login/signup and frontend UI components",
        type: "feature",
      });

      expect(result.subtasks.length).toBeGreaterThanOrEqual(4);
      expect(result.reasoning).toContain("feature-with-api");

      // Should have research, backend, frontend, tests, review
      const categories = result.subtasks.map((s) => s.category);
      expect(categories).toContain("research");
      expect(categories).toContain("complex_code");
    });

    it("should decompose auth feature with security review", () => {
      const result = service.decompose({
        title: "Implement OAuth authentication",
        description: "Add OAuth login with JWT tokens and secure session management",
        type: "feature",
      });

      expect(result.subtasks.length).toBeGreaterThanOrEqual(5);
      expect(result.reasoning).toContain("auth-feature");

      // Should include security review
      const hasSecurityReview = result.subtasks.some(
        (s) => s.title.toLowerCase().includes("security")
      );
      expect(hasSecurityReview).toBe(true);
    });

    it("should decompose database migration", () => {
      const result = service.decompose({
        title: "Add user roles table",
        description: "Create database migration for role-based access",
        type: "feature",
      });

      expect(result.subtasks.length).toBeGreaterThanOrEqual(3);
      expect(result.reasoning).toContain("database-migration");

      // Should have schema design and migration tasks
      const titles = result.subtasks.map((s) => s.title.toLowerCase());
      expect(titles.some((t) => t.includes("schema") || t.includes("design"))).toBe(true);
      expect(titles.some((t) => t.includes("migration"))).toBe(true);
    });

    it("should decompose refactoring task", () => {
      const result = service.decompose({
        title: "Refactor payment module",
        description: "Clean up and reorganize the code structure",
        type: "task",
      });

      expect(result.subtasks.length).toBeGreaterThanOrEqual(4);
      expect(result.reasoning).toContain("refactoring");

      // Should have analyze, design, test, refactor, verify steps
      const categories = result.subtasks.map((s) => s.category);
      expect(categories).toContain("research");
      expect(categories).toContain("refactoring");
    });

    it("should use generic pattern for unmatched tasks", () => {
      const result = service.decompose({
        title: "Do something generic",
        description: "A task that doesn't match specific patterns",
        type: "task",
      });

      expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
      expect(result.reasoning).toContain("generic-feature");
    });

    it("should generate correct dependencies", () => {
      const result = service.decompose({
        title: "Implement API feature",
        description: "Build backend API and frontend UI",
        type: "feature",
      });

      // Each subtask after the first should have dependencies
      for (let i = 1; i < result.subtasks.length; i++) {
        expect(result.subtasks[i].dependsOn.length).toBeGreaterThan(0);
      }

      // Dependencies should be valid indices
      for (const dep of result.dependencies) {
        expect(dep.from).toBeGreaterThanOrEqual(0);
        expect(dep.from).toBeLessThan(result.subtasks.length);
        expect(dep.to).toBeGreaterThanOrEqual(0);
        expect(dep.to).toBeLessThan(result.subtasks.length);
      }
    });

    it("should calculate parallel groups", () => {
      const result = service.decompose({
        title: "Implement feature",
        description: "A feature with API and frontend",
        type: "feature",
      });

      expect(result.parallelGroups.length).toBeGreaterThan(0);

      // First group should contain tasks with no dependencies
      const firstGroup = result.parallelGroups[0];
      for (const idx of firstGroup) {
        expect(result.subtasks[idx].dependsOn.length).toBe(0);
      }
    });

    it("should calculate critical path", () => {
      const result = service.decompose({
        title: "Implement complex feature",
        description: "Multiple API endpoints and frontend components",
        type: "feature",
      });

      expect(result.criticalPath.length).toBeGreaterThan(0);

      // Critical path should be valid indices
      for (const idx of result.criticalPath) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(result.subtasks.length);
      }
    });
  });

  describe("preview", () => {
    it("should provide decomposition preview", () => {
      const result = service.preview({
        title: "Add user authentication",
        description: "Build auth system with API and frontend",
        type: "feature",
      });

      expect(result.decomposition).toBeDefined();
      expect(result.estimatedEffort).toContain("subtasks");
      expect(result.estimatedEffort).toContain("complexity points");
      expect(result.parallelization).toContain("parallel phases");
    });
  });

  describe("suggestPattern", () => {
    it("should suggest feature-with-api pattern", () => {
      const result = service.suggestPattern({
        title: "Build API feature",
        description: "Backend API and frontend UI",
        type: "feature",
      });

      expect(result.patternName).toBe("feature-with-api");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should suggest auth-feature pattern", () => {
      const result = service.suggestPattern({
        title: "Add authentication",
        description: "OAuth login system",
        type: "feature",
      });

      expect(result.patternName).toBe("auth-feature");
    });

    it("should suggest database-migration pattern", () => {
      const result = service.suggestPattern({
        title: "Update schema",
        description: "Database migration for new tables",
        type: "task",
      });

      expect(result.patternName).toBe("database-migration");
    });

    it("should suggest refactoring pattern", () => {
      const result = service.suggestPattern({
        title: "Refactor module",
        description: "Clean up and improve code",
        type: "task",
      });

      expect(result.patternName).toBe("refactoring");
    });

    it("should fall back to generic-feature", () => {
      const result = service.suggestPattern({
        title: "Random task",
        description: "Something unspecific",
        type: "task",
      });

      expect(result.patternName).toBe("generic-feature");
    });
  });
});
