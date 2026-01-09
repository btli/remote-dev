import { describe, it, expect } from "bun:test";
import {
  Delegation,
  type DelegationResult,
  type DelegationError,
} from "./Delegation";
import { InvalidValueError, InvalidStateTransitionError } from "../errors/DomainError";

describe("Delegation", () => {
  const createTestDelegation = (
    overrides?: Partial<Parameters<typeof Delegation.create>[0]>
  ) => {
    return Delegation.create({
      taskId: "task-123",
      sessionId: "session-123",
      agentProvider: "claude",
      ...overrides,
    });
  };

  describe("create", () => {
    it("should create a delegation with spawning status", () => {
      const delegation = createTestDelegation();

      expect(delegation.id).toBeDefined();
      expect(delegation.taskId).toBe("task-123");
      expect(delegation.sessionId).toBe("session-123");
      expect(delegation.agentProvider).toBe("claude");
      expect(delegation.status).toBe("spawning");
      expect(delegation.worktreeId).toBeNull();
      expect(delegation.contextInjected).toBeNull();
      expect(delegation.executionLogs).toEqual([]);
      expect(delegation.result).toBeNull();
      expect(delegation.error).toBeNull();
      expect(delegation.transcriptPath).toBeNull();
    });

    it("should accept custom id", () => {
      const delegation = createTestDelegation({ id: "custom-del-id" });
      expect(delegation.id).toBe("custom-del-id");
    });

    it("should accept worktreeId", () => {
      const delegation = createTestDelegation({ worktreeId: "worktree-456" });
      expect(delegation.worktreeId).toBe("worktree-456");
    });

    it("should throw on empty taskId", () => {
      expect(() => createTestDelegation({ taskId: "" })).toThrow(InvalidValueError);
    });

    it("should throw on empty sessionId", () => {
      expect(() => createTestDelegation({ sessionId: "" })).toThrow(InvalidValueError);
    });
  });

  describe("state transitions", () => {
    describe("startContextInjection", () => {
      it("should transition from spawning to injecting_context", () => {
        const delegation = createTestDelegation();
        const injecting = delegation.startContextInjection("task context here");

        expect(injecting.status).toBe("injecting_context");
        expect(injecting.contextInjected).toBe("task context here");
        expect(delegation.status).toBe("spawning"); // Original unchanged
      });

      it("should throw when not in spawning state", () => {
        const delegation = createTestDelegation()
          .startContextInjection("ctx")
          .startRunning();
        expect(() => delegation.startContextInjection("ctx")).toThrow(
          InvalidStateTransitionError
        );
      });
    });

    describe("startRunning", () => {
      it("should transition from injecting_context to running", () => {
        const delegation = createTestDelegation()
          .startContextInjection("ctx");
        const running = delegation.startRunning();

        expect(running.status).toBe("running");
      });

      it("should throw when not in injecting_context state", () => {
        const delegation = createTestDelegation();
        expect(() => delegation.startRunning()).toThrow(InvalidStateTransitionError);
      });
    });

    describe("startMonitoring", () => {
      it("should transition from running to monitoring", () => {
        const delegation = createTestDelegation()
          .startContextInjection("ctx")
          .startRunning();
        const monitoring = delegation.startMonitoring();

        expect(monitoring.status).toBe("monitoring");
      });

      it("should throw when not in running state", () => {
        const delegation = createTestDelegation();
        expect(() => delegation.startMonitoring()).toThrow(InvalidStateTransitionError);
      });
    });

    describe("complete", () => {
      it("should transition to completed with result", () => {
        const result: DelegationResult = {
          success: true,
          summary: "Task completed successfully",
          exitCode: 0,
          filesModified: ["src/file.ts"],
          duration: 120,
          tokenUsage: 5000,
        };

        const delegation = createTestDelegation()
          .startContextInjection("ctx")
          .startRunning()
          .startMonitoring();
        const completed = delegation.complete(result);

        expect(completed.status).toBe("completed");
        expect(completed.result).toEqual(result);
        expect(completed.completedAt).toBeDefined();
        expect(completed.isSuccessful()).toBe(true);
      });

      it("should allow completion from running state", () => {
        const result: DelegationResult = {
          success: true,
          summary: "Fast completion",
          exitCode: 0,
          filesModified: [],
          duration: 10,
          tokenUsage: null,
        };

        const delegation = createTestDelegation()
          .startContextInjection("ctx")
          .startRunning();
        const completed = delegation.complete(result);

        expect(completed.status).toBe("completed");
      });
    });

    describe("fail", () => {
      it("should transition to failed with error", () => {
        const error: DelegationError = {
          code: "TIMEOUT",
          message: "Agent timed out",
          exitCode: 124,
          recoverable: true,
        };

        const delegation = createTestDelegation()
          .startContextInjection("ctx")
          .startRunning();
        const failed = delegation.fail(error);

        expect(failed.status).toBe("failed");
        expect(failed.error).toEqual(error);
        expect(failed.completedAt).toBeDefined();
        expect(failed.isSuccessful()).toBe(false);
      });

      it("should allow failure from spawning state", () => {
        const error: DelegationError = {
          code: "SPAWN_FAILED",
          message: "Failed to spawn agent",
          exitCode: null,
          recoverable: false,
        };

        const delegation = createTestDelegation();
        const failed = delegation.fail(error);

        expect(failed.status).toBe("failed");
      });
    });
  });

  describe("domain methods", () => {
    it("should add log entries", () => {
      const delegation = createTestDelegation();
      const withLog = delegation.addLog({
        level: "info",
        message: "Started execution",
        metadata: { pid: 1234 },
      });

      expect(withLog.executionLogs.length).toBe(1);
      expect(withLog.executionLogs[0].level).toBe("info");
      expect(withLog.executionLogs[0].message).toBe("Started execution");
      expect(withLog.executionLogs[0].timestamp).toBeDefined();
    });

    it("should set transcript path", () => {
      const delegation = createTestDelegation();
      const withPath = delegation.setTranscriptPath("/home/user/.claude/transcripts/abc.jsonl");

      expect(withPath.transcriptPath).toBe("/home/user/.claude/transcripts/abc.jsonl");
    });

    it("should attach worktree", () => {
      const delegation = createTestDelegation();
      const withWorktree = delegation.attachWorktree("worktree-789");

      expect(withWorktree.worktreeId).toBe("worktree-789");
      expect(withWorktree.hasWorktree()).toBe(true);
    });
  });

  describe("query methods", () => {
    it("should check terminal states", () => {
      const spawning = createTestDelegation();
      expect(spawning.isTerminal()).toBe(false);

      const completed = spawning
        .startContextInjection("ctx")
        .startRunning()
        .complete({
          success: true,
          summary: "Done",
          exitCode: 0,
          filesModified: [],
          duration: 10,
          tokenUsage: null,
        });
      expect(completed.isTerminal()).toBe(true);
    });

    it("should check running states", () => {
      const spawning = createTestDelegation();
      expect(spawning.isRunning()).toBe(false);

      const running = spawning.startContextInjection("ctx").startRunning();
      expect(running.isRunning()).toBe(true);

      const monitoring = running.startMonitoring();
      expect(monitoring.isRunning()).toBe(true);
    });

    it("should get duration", () => {
      const delegation = createTestDelegation()
        .startContextInjection("ctx")
        .startRunning()
        .complete({
          success: true,
          summary: "Done",
          exitCode: 0,
          filesModified: [],
          duration: 10,
          tokenUsage: null,
        });

      const duration = delegation.getDuration();
      expect(duration).toBeDefined();
      expect(typeof duration).toBe("number");
    });

    it("should get logs by level", () => {
      const delegation = createTestDelegation()
        .addLog({ level: "info", message: "Info 1" })
        .addLog({ level: "error", message: "Error 1" })
        .addLog({ level: "info", message: "Info 2" });

      const infoLogs = delegation.getLogsByLevel("info");
      expect(infoLogs.length).toBe(2);

      const errorLogs = delegation.getErrors();
      expect(errorLogs.length).toBe(1);
    });

    it("should check equality", () => {
      const del1 = createTestDelegation({ id: "same-id" });
      const del2 = Delegation.reconstitute({
        ...del1.toPlainObject(),
      });

      expect(del1.equals(del2)).toBe(true);
    });
  });

  describe("serialization", () => {
    it("should convert to plain object", () => {
      const delegation = createTestDelegation();
      const plain = delegation.toPlainObject();

      expect(plain.id).toBe(delegation.id);
      expect(plain.status).toBe("spawning");
      expect(plain.agentProvider).toBe("claude");
    });
  });
});
