import { describe, it, expect } from "bun:test";
import { Task, type TaskResult, type TaskError } from "./Task";
import { TaskType } from "../value-objects/TaskType";
import { InvalidValueError, InvalidStateTransitionError } from "../errors/DomainError";

describe("Task", () => {
  const createTestTask = (overrides?: Partial<Parameters<typeof Task.create>[0]>) => {
    return Task.create({
      orchestratorId: "orch-123",
      userId: "user-123",
      description: "Implement user authentication",
      type: TaskType.feature(),
      ...overrides,
    });
  };

  describe("create", () => {
    it("should create a task with queued status", () => {
      const task = createTestTask();

      expect(task.id).toBeDefined();
      expect(task.orchestratorId).toBe("orch-123");
      expect(task.userId).toBe("user-123");
      expect(task.description).toBe("Implement user authentication");
      expect(task.type.toString()).toBe("feature");
      expect(task.status.toString()).toBe("queued");
      expect(task.confidence).toBe(1.0);
      expect(task.assignedAgent).toBeNull();
      expect(task.delegationId).toBeNull();
      expect(task.result).toBeNull();
      expect(task.error).toBeNull();
    });

    it("should accept custom id", () => {
      const task = createTestTask({ id: "custom-id" });
      expect(task.id).toBe("custom-id");
    });

    it("should accept custom confidence", () => {
      const task = createTestTask({ confidence: 0.8 });
      expect(task.confidence).toBe(0.8);
    });

    it("should throw on invalid confidence", () => {
      expect(() => createTestTask({ confidence: 1.5 })).toThrow(InvalidValueError);
      expect(() => createTestTask({ confidence: -0.1 })).toThrow(InvalidValueError);
    });

    it("should throw on empty description", () => {
      expect(() => createTestTask({ description: "" })).toThrow(InvalidValueError);
    });
  });

  describe("state transitions", () => {
    describe("startPlanning", () => {
      it("should transition from queued to planning", () => {
        const task = createTestTask();
        const planning = task.startPlanning();

        expect(planning.status.toString()).toBe("planning");
        expect(task.status.toString()).toBe("queued"); // Original unchanged
      });

      it("should throw when not in queued state", () => {
        const task = createTestTask().startPlanning();
        expect(() => task.startPlanning()).toThrow(InvalidStateTransitionError);
      });
    });

    describe("startExecution", () => {
      it("should transition from planning to executing with agent", () => {
        const task = createTestTask().startPlanning();
        const executing = task.startExecution("claude", "task context here");

        expect(executing.status.toString()).toBe("executing");
        expect(executing.assignedAgent).toBe("claude");
        expect(executing.contextInjected).toBe("task context here");
      });

      it("should throw when not in planning state", () => {
        const task = createTestTask();
        expect(() => task.startExecution("claude", "context")).toThrow(InvalidStateTransitionError);
      });
    });

    describe("startMonitoring", () => {
      it("should transition from executing to monitoring", () => {
        const task = createTestTask()
          .startPlanning()
          .startExecution("claude", "context");
        const monitoring = task.startMonitoring();

        expect(monitoring.status.toString()).toBe("monitoring");
      });
    });

    describe("complete", () => {
      it("should transition to completed with result", () => {
        const result: TaskResult = {
          success: true,
          summary: "Task completed successfully",
          filesModified: ["src/auth.ts"],
          learnings: ["Use NextAuth v5"],
        };

        const task = createTestTask()
          .startPlanning()
          .startExecution("claude", "context")
          .startMonitoring();
        const completed = task.complete(result);

        expect(completed.status.toString()).toBe("completed");
        expect(completed.result).toEqual(result);
        expect(completed.completedAt).toBeDefined();
        expect(completed.isSuccessful()).toBe(true);
      });
    });

    describe("fail", () => {
      it("should transition to failed with error", () => {
        const error: TaskError = {
          code: "TIMEOUT",
          message: "Task timed out",
          recoverable: true,
        };

        const task = createTestTask()
          .startPlanning()
          .startExecution("claude", "context")
          .startMonitoring();
        const failed = task.fail(error);

        expect(failed.status.toString()).toBe("failed");
        expect(failed.error).toEqual(error);
        expect(failed.completedAt).toBeDefined();
        expect(failed.isSuccessful()).toBe(false);
      });
    });

    describe("cancel", () => {
      it("should cancel from queued", () => {
        const task = createTestTask();
        const cancelled = task.cancel();

        expect(cancelled.status.toString()).toBe("cancelled");
        expect(cancelled.completedAt).toBeDefined();
      });

      it("should cancel from planning", () => {
        const task = createTestTask().startPlanning();
        const cancelled = task.cancel();

        expect(cancelled.status.toString()).toBe("cancelled");
      });

      it("should not cancel from completed", () => {
        const result: TaskResult = {
          success: true,
          summary: "Done",
          filesModified: [],
          learnings: [],
        };
        const task = createTestTask()
          .startPlanning()
          .startExecution("claude", "context")
          .startMonitoring()
          .complete(result);

        expect(() => task.cancel()).toThrow(InvalidStateTransitionError);
      });
    });
  });

  describe("domain methods", () => {
    it("should attach delegation", () => {
      const task = createTestTask()
        .startPlanning()
        .startExecution("claude", "context");
      const withDelegation = task.attachDelegation("del-123");

      expect(withDelegation.delegationId).toBe("del-123");
      expect(withDelegation.hasDelegation()).toBe(true);
    });

    it("should link to beads issue", () => {
      const task = createTestTask();
      const linked = task.linkToBeadsIssue("remote-dev-xyz");

      expect(linked.beadsIssueId).toBe("remote-dev-xyz");
      expect(linked.hasBeadsIssue()).toBe(true);
    });

    it("should update description", () => {
      const task = createTestTask();
      const updated = task.updateDescription("New description");

      expect(updated.description).toBe("New description");
    });

    it("should set estimated duration", () => {
      const task = createTestTask();
      const updated = task.setEstimatedDuration(3600);

      expect(updated.estimatedDuration).toBe(3600);
    });
  });

  describe("query methods", () => {
    it("should check terminal states", () => {
      const queued = createTestTask();
      expect(queued.isTerminal()).toBe(false);
      expect(queued.isQueued()).toBe(true);

      const cancelled = queued.cancel();
      expect(cancelled.isTerminal()).toBe(true);
    });

    it("should check active states", () => {
      const queued = createTestTask();
      expect(queued.isActive()).toBe(false);

      const planning = queued.startPlanning();
      expect(planning.isActive()).toBe(true);

      const executing = planning.startExecution("claude", "context");
      expect(executing.isActive()).toBe(true);
    });

    it("should get recommended agents from task type", () => {
      const task = createTestTask({ type: TaskType.feature() });
      const recommended = task.getRecommendedAgents();

      expect(recommended).toContain("claude");
    });

    it("should check ownership", () => {
      const task = createTestTask({ userId: "user-123" });

      expect(task.belongsTo("user-123")).toBe(true);
      expect(task.belongsTo("user-456")).toBe(false);
    });
  });

  describe("serialization", () => {
    it("should convert to plain object", () => {
      const task = createTestTask();
      const plain = task.toPlainObject();

      expect(plain.id).toBe(task.id);
      expect(plain.type).toBe("feature");
      expect(plain.status).toBe("queued");
      expect(typeof plain.createdAt).toBe("object"); // Date
    });
  });
});
