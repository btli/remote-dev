/**
 * Tests for pure agent task sync and stop-hook message logic.
 *
 * We import from pure modules to avoid the DB import chain (node: modules
 * are incompatible with the happy-dom test environment).
 */
import { describe, it, expect } from "vitest";
import { parsePostToolUsePayload, mapAgentTaskStatus } from "../agent-todo-sync-pure";
import { classifyTask, buildStopMessage, POST_TASK_MARKER_PREFIX } from "../agent-stop-message";
import type { ProjectTask } from "@/types/task";

/** Helper to create a minimal ProjectTask for testing */
function makeTask(overrides: Partial<ProjectTask> & { title: string }): ProjectTask {
  return {
    id: "test-id",
    userId: "user-1",
    folderId: null,
    sessionId: "session-1",
    description: null,
    status: "open",
    priority: "medium",
    source: "agent",
    labels: [],
    subtasks: [],
    metadata: {},
    instructions: null,
    agentTaskKey: null,
    owner: null,
    dueDate: null,
    githubIssueUrl: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    blockedBy: [],
    ...overrides,
  };
}

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

  it("parses TaskCreate with metadata and owner", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskCreate",
      tool_input: {
        subject: "Fix auth",
        description: "Fix token refresh",
        metadata: { source_file: "auth.ts", line: 42 },
        owner: "agent-1",
      },
    });

    expect(ops).toHaveLength(1);
    if (ops[0].type === "create") {
      expect(ops[0].metadata).toEqual({ source_file: "auth.ts", line: 42 });
      expect(ops[0].owner).toBe("agent-1");
    }
  });

  it("parses TaskCreate with addBlockedBy", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskCreate",
      tool_input: {
        subject: "Write tests",
        addBlockedBy: ["1"],
      },
    });

    expect(ops).toHaveLength(1);
    if (ops[0].type === "create") {
      expect(ops[0].blockedBy).toEqual(["1"]);
    }
  });

  it("parses TaskUpdate with metadata and blockedBy", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskUpdate",
      tool_input: {
        taskId: "2",
        metadata: { progress: 50 },
        addBlockedBy: ["1", "3"],
      },
    });

    expect(ops).toHaveLength(1);
    if (ops[0].type === "update") {
      expect(ops[0].metadata).toEqual({ progress: 50 });
      expect(ops[0].blockedBy).toEqual(["1", "3"]);
    }
  });

  it("parses TaskUpdate with description change", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskUpdate",
      tool_input: {
        taskId: "1",
        description: "Updated description",
      },
    });

    expect(ops).toHaveLength(1);
    if (ops[0].type === "update") {
      expect(ops[0].description).toBe("Updated description");
    }
  });

  it("maps urgent priority to critical", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskCreate",
      tool_input: {
        subject: "Hotfix",
        priority: "urgent",
      },
    });

    expect(ops).toHaveLength(1);
    if (ops[0].type === "create") {
      expect(ops[0].priority).toBe("critical");
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

describe("TaskCreate/TaskUpdate key mismatch (position-based fallback)", () => {
  it("TaskCreate generates hash-based agentTaskId, not numeric", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskCreate",
      tool_input: { subject: "Step 1: Check PR eligibility" },
    });

    expect(ops).toHaveLength(1);
    if (ops[0].type === "create") {
      // agentTaskId is a hash (cc-XXXXX), NOT a numeric "1"
      expect(ops[0].agentTaskId).toMatch(/^cc-[a-z0-9]+$/);
      expect(ops[0].agentTaskId).not.toBe("1");
    }
  });

  it("TaskUpdate uses Claude Code's numeric taskId directly", () => {
    const ops = parsePostToolUsePayload({
      tool_name: "TaskUpdate",
      tool_input: { taskId: "3", status: "completed" },
    });

    expect(ops).toHaveLength(1);
    if (ops[0].type === "update") {
      // agentTaskId is the raw numeric ID from Claude Code
      expect(ops[0].agentTaskId).toBe("3");
    }
  });

  it("TaskCreate agentTaskId is deterministic for same subject", () => {
    const ops1 = parsePostToolUsePayload({
      tool_name: "TaskCreate",
      tool_input: { subject: "Fix auth bug" },
    });
    const ops2 = parsePostToolUsePayload({
      tool_name: "TaskCreate",
      tool_input: { subject: "Fix auth bug" },
    });

    expect(ops1[0].type).toBe("create");
    expect(ops2[0].type).toBe("create");
    if (ops1[0].type === "create" && ops2[0].type === "create") {
      expect(ops1[0].agentTaskId).toBe(ops2[0].agentTaskId);
    }
  });

  it("different subjects produce different agentTaskIds", () => {
    const ops1 = parsePostToolUsePayload({
      tool_name: "TaskCreate",
      tool_input: { subject: "Step 1: Check PR" },
    });
    const ops2 = parsePostToolUsePayload({
      tool_name: "TaskCreate",
      tool_input: { subject: "Step 2: Find files" },
    });

    if (ops1[0].type === "create" && ops2[0].type === "create") {
      expect(ops1[0].agentTaskId).not.toBe(ops2[0].agentTaskId);
    }
  });
});

describe("stableId collision resistance", () => {
  it("numbered steps produce unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 1; i <= 20; i++) {
      const ops = parsePostToolUsePayload({
        tool_name: "TaskCreate",
        tool_input: { subject: `Step ${i}: Do something` },
      });
      if (ops[0].type === "create") {
        ids.add(ops[0].agentTaskId);
      }
    }
    expect(ids.size).toBe(20);
  });

  it("similar prefixed subjects produce unique IDs", () => {
    const subjects = [
      "Fix authentication bug",
      "Fix authorization bug",
      "Fix authentication flow",
      "Fix authorization flow",
      "Fix auth token refresh",
    ];
    const ids = new Set<string>();
    for (const subject of subjects) {
      const ops = parsePostToolUsePayload({
        tool_name: "TaskCreate",
        tool_input: { subject },
      });
      if (ops[0].type === "create") {
        ids.add(ops[0].agentTaskId);
      }
    }
    expect(ids.size).toBe(subjects.length);
  });

  it("1000 random-ish subjects have no collisions", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const ops = parsePostToolUsePayload({
        tool_name: "TaskCreate",
        tool_input: { subject: `Task ${i}: ${String.fromCharCode(65 + (i % 26))} work item` },
      });
      if (ops[0].type === "create") {
        ids.add(ops[0].agentTaskId);
      }
    }
    expect(ids.size).toBe(1000);
  });
});

describe("classifyTask", () => {
  it("classifies a post-task via agentTaskKey", () => {
    const task = makeTask({
      title: "Code Simplifier",
      agentTaskKey: `${POST_TASK_MARKER_PREFIX}Code Simplifier`,
    });
    const result = classifyTask(task);
    expect(result).toEqual({ kind: "post-task", command: "/simplify" });
  });

  it("classifies a post-task via legacy description marker", () => {
    const task = makeTask({
      title: "Code Simplifier",
      description: `${POST_TASK_MARKER_PREFIX}Code Simplifier`,
    });
    const result = classifyTask(task);
    expect(result).toEqual({ kind: "post-task", command: "/simplify" });
  });

  it("classifies a post-task with known command", () => {
    const task = makeTask({
      title: "Code Simplifier",
      description: `${POST_TASK_MARKER_PREFIX}Code Simplifier`,
    });
    const result = classifyTask(task);
    expect(result).toEqual({ kind: "post-task", command: "/simplify" });
  });

  it("classifies Code Review post-task", () => {
    const task = makeTask({
      title: "Code Review",
      description: `${POST_TASK_MARKER_PREFIX}Code Review`,
    });
    const result = classifyTask(task);
    expect(result).toEqual({ kind: "post-task", command: "/code-review" });
  });

  it("classifies a post-task with unknown command as null", () => {
    const task = makeTask({
      title: "Unknown Post Task",
      description: `${POST_TASK_MARKER_PREFIX}Unknown Post Task`,
    });
    const result = classifyTask(task);
    expect(result).toEqual({ kind: "post-task", command: null });
  });

  it("classifies a manual task as user-assigned", () => {
    const task = makeTask({ title: "Fix login", source: "manual" });
    const result = classifyTask(task);
    expect(result).toEqual({ kind: "user-assigned" });
  });

  it("classifies an agent task as agent-owned", () => {
    const task = makeTask({ title: "Implement feature", source: "agent" });
    const result = classifyTask(task);
    expect(result).toEqual({ kind: "agent-owned" });
  });
});

describe("buildStopMessage", () => {
  it("includes task count in header", () => {
    const tasks = [makeTask({ title: "Task A" }), makeTask({ title: "Task B" })];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("2 incomplete task(s)");
  });

  it("includes task status tag", () => {
    const tasks = [makeTask({ title: "Implement feature", status: "in_progress" })];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("[in_progress]");
  });

  it("lists agent-owned task without source tag", () => {
    const tasks = [makeTask({ title: "Implement feature", source: "agent" })];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("- [open] Implement feature");
    expect(msg).not.toContain("(user-assigned)");
  });

  it("lists user-assigned task with source tag", () => {
    const tasks = [makeTask({ title: "Fix login", source: "manual" })];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("- [open] Fix login (user-assigned)");
  });

  it("lists post-task with slash command", () => {
    const tasks = [
      makeTask({
        title: "Code Simplifier",
        description: `${POST_TASK_MARKER_PREFIX}Code Simplifier`,
      }),
    ];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("- [open] Code Simplifier — run /simplify");
  });

  it("includes priority for non-medium tasks", () => {
    const tasks = [makeTask({ title: "Urgent fix", priority: "critical" })];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("[critical]");
  });

  it("omits priority for medium tasks", () => {
    const tasks = [makeTask({ title: "Normal task", priority: "medium" })];
    const msg = buildStopMessage(tasks);
    expect(msg).not.toContain("[medium]");
  });

  it("includes TaskCreate instruction", () => {
    const tasks = [makeTask({ title: "Some task" })];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("TaskCreate");
  });

  it("footer lists only commands for incomplete post-tasks", () => {
    const tasks = [
      makeTask({
        title: "Code Review",
        description: `${POST_TASK_MARKER_PREFIX}Code Review`,
      }),
    ];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("/code-review");
    expect(msg).not.toContain("/simplify");
  });

  it("footer lists all commands when all post-tasks are incomplete", () => {
    const tasks = [
      makeTask({
        title: "Code Simplifier",
        description: `${POST_TASK_MARKER_PREFIX}Code Simplifier`,
      }),
      makeTask({
        title: "Code Review",
        description: `${POST_TASK_MARKER_PREFIX}Code Review`,
      }),
    ];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("/simplify, /code-review");
  });

  it("omits slash command footer when no post-tasks are present", () => {
    const tasks = [makeTask({ title: "Fix bug", source: "manual" })];
    const msg = buildStopMessage(tasks);
    expect(msg).not.toContain("/simplify");
    expect(msg).not.toContain("/code-review");
  });

  it("includes instructions in stop message when present", () => {
    const tasks = [
      makeTask({
        title: "Fix auth",
        instructions: "Focus on token refresh in src/auth.ts",
      }),
    ];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("Instructions: Focus on token refresh in src/auth.ts");
  });

  it("includes description as context in stop message", () => {
    const tasks = [
      makeTask({
        title: "Fix auth",
        description: "The token refresh is failing intermittently",
      }),
    ];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("Context: The token refresh is failing intermittently");
  });

  it("skips legacy marker descriptions in stop message", () => {
    const tasks = [
      makeTask({
        title: "Fix auth",
        description: "agent-task:cc-abc123\nReal description",
      }),
    ];
    const msg = buildStopMessage(tasks);
    expect(msg).not.toContain("Context: agent-task:");
  });

  it("handles mixed task types", () => {
    const tasks = [
      makeTask({ title: "Fix bug", source: "manual", priority: "high" }),
      makeTask({ title: "Write tests", source: "agent", status: "in_progress" }),
      makeTask({
        title: "Code Simplifier",
        description: `${POST_TASK_MARKER_PREFIX}Code Simplifier`,
        priority: "low",
      }),
    ];
    const msg = buildStopMessage(tasks);
    expect(msg).toContain("3 incomplete task(s)");
    expect(msg).toContain("- [open] Fix bug [high] (user-assigned)");
    expect(msg).toContain("- [in_progress] Write tests");
    expect(msg).toContain("- [open] Code Simplifier [low] — run /simplify");
  });
});
