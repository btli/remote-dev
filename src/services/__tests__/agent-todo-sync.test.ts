/**
 * Tests for parsePostToolUsePayload — the pure parsing logic in agent-todo-sync.
 *
 * We import from a pure module to avoid the DB import chain (node: modules
 * are incompatible with the happy-dom test environment).
 */
import { describe, it, expect } from "vitest";
import { parsePostToolUsePayload, mapAgentTaskStatus } from "../agent-todo-sync-pure";

describe("mapAgentTaskStatus", () => {
  it("maps 'completed' to 'done'", () => {
    expect(mapAgentTaskStatus("completed")).toBe("done");
  });

  it("maps 'in_progress' to 'in_progress'", () => {
    expect(mapAgentTaskStatus("in_progress")).toBe("in_progress");
  });

  it("maps 'pending' to 'open'", () => {
    expect(mapAgentTaskStatus("pending")).toBe("open");
  });

  it("maps unknown to 'open'", () => {
    expect(mapAgentTaskStatus("whatever")).toBe("open");
  });
});

describe("parsePostToolUsePayload", () => {
  it("parses TaskCreate payload", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskCreate",
      tool_input: {
        subject: "Fix login bug",
        description: "Fix the login bug in auth.ts",
        activeForm: "Fixing login",
      },
    });

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("create");
    if (ops[0].type === "create") {
      expect(ops[0].subject).toBe("Fix login bug");
      expect(ops[0].description).toBe("Fix the login bug in auth.ts");
      expect(ops[0].status).toBe("open");
    }
  });

  it("parses TaskUpdate with status", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskUpdate",
      tool_input: {
        taskId: "1",
        status: "completed",
      },
    });

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("update");
    if (ops[0].type === "update") {
      expect(ops[0].agentTaskId).toBe("1");
      expect(ops[0].status).toBe("done");
    }
  });

  it("parses TaskUpdate with in_progress status", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskUpdate",
      tool_input: {
        taskId: "2",
        status: "in_progress",
      },
    });

    expect(ops).toHaveLength(1);
    if (ops[0].type === "update") {
      expect(ops[0].agentTaskId).toBe("2");
      expect(ops[0].status).toBe("in_progress");
    }
  });

  it("parses TaskUpdate with addBlockedBy (no status change)", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskUpdate",
      tool_input: {
        taskId: "3",
        addBlockedBy: ["1"],
      },
    });

    expect(ops).toHaveLength(1);
    if (ops[0].type === "update") {
      expect(ops[0].agentTaskId).toBe("3");
      expect(ops[0].status).toBeUndefined();
    }
  });

  it("returns empty for TaskCreate without subject", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskCreate",
      tool_input: {},
    });

    expect(ops).toHaveLength(0);
  });

  it("returns empty for TaskUpdate without taskId", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskUpdate",
      tool_input: { status: "completed" },
    });

    expect(ops).toHaveLength(0);
  });

  it("returns empty for unrelated tool", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });

    expect(ops).toHaveLength(0);
  });

  it("handles legacy TodoWrite format", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TodoWrite",
      tool_input: {
        todos: [
          { id: "1", content: "Fix bug", status: "in_progress" },
          { id: "2", content: "Write tests", status: "pending" },
        ],
      },
    });

    expect(ops).toHaveLength(2);
    expect(ops[0].type).toBe("create");
    if (ops[0].type === "create") {
      expect(ops[0].subject).toBe("Fix bug");
      expect(ops[0].status).toBe("in_progress");
    }
    if (ops[1].type === "create") {
      expect(ops[1].subject).toBe("Write tests");
      expect(ops[1].status).toBe("open");
    }
  });

  it("includes full PostToolUse envelope fields gracefully", () => {
    const ops = parsePostToolUsePayload({
      session_id: "some-session",
      transcript_path: "/some/path.jsonl",
      cwd: "/some/dir",
      permission_mode: "default",
      hook_event_name: "PostToolUse",
      tool_name: "TaskCreate",
      tool_input: {
        subject: "Test task",
      },
      tool_response: { stdout: "", stderr: "" },
      tool_use_id: "toolu_123",
    });

    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("create");
  });
});
