/**
 * Tests for buildTodoSyncPlan — the pure diff logic in agent-todo-sync.
 *
 * We import from a pure module to avoid the DB import chain (node: modules
 * are incompatible with the happy-dom test environment).
 */
import { describe, it, expect } from "vitest";
import { buildTodoSyncPlan } from "../agent-todo-sync-pure";
import type { ProjectTask } from "@/types/task";

function makeExistingTask(overrides: Partial<ProjectTask> & { id: string; description: string; status: ProjectTask["status"] }): ProjectTask {
  return {
    userId: "user-1",
    folderId: "folder-1",
    sessionId: "session-1",
    title: "Task",
    priority: "medium",
    source: "agent",
    labels: [],
    subtasks: [],
    dueDate: null,
    githubIssueUrl: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("buildTodoSyncPlan", () => {
  it("creates new tasks for unknown todo IDs", () => {
    const incoming = [
      { id: "1", content: "Fix login bug", status: "in_progress" },
    ];
    const existing: ProjectTask[] = [];

    const plan = buildTodoSyncPlan(incoming, existing);

    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].title).toBe("Fix login bug");
    expect(plan.toCreate[0].status).toBe("in_progress");
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toCancel).toHaveLength(0);
  });

  it("updates status for existing tasks with changed status", () => {
    const incoming = [
      { id: "1", content: "Fix login bug", status: "completed" },
    ];
    const existing: ProjectTask[] = [
      makeExistingTask({
        id: "task-uuid-1",
        title: "Fix login bug",
        description: "TodoWrite #1",
        status: "in_progress",
      }),
    ];

    const plan = buildTodoSyncPlan(incoming, existing);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].taskId).toBe("task-uuid-1");
    expect(plan.toUpdate[0].status).toBe("done");
    expect(plan.toCancel).toHaveLength(0);
  });

  it("cancels tasks removed from todo list", () => {
    const incoming: { id: string; content: string; status: string }[] = [];
    const existing: ProjectTask[] = [
      makeExistingTask({
        id: "task-uuid-1",
        title: "Old task",
        description: "TodoWrite #1",
        status: "open",
      }),
    ];

    const plan = buildTodoSyncPlan(incoming, existing);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toCancel).toHaveLength(1);
    expect(plan.toCancel[0]).toBe("task-uuid-1");
  });

  it("skips tasks that haven't changed", () => {
    const incoming = [
      { id: "1", content: "Fix login bug", status: "in_progress" },
    ];
    const existing: ProjectTask[] = [
      makeExistingTask({
        id: "task-uuid-1",
        title: "Fix login bug",
        description: "TodoWrite #1",
        status: "in_progress",
      }),
    ];

    const plan = buildTodoSyncPlan(incoming, existing);

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toCancel).toHaveLength(0);
  });

  it("updates when title changes even if status is same", () => {
    const incoming = [
      { id: "1", content: "Fix login bug (urgent)", status: "in_progress" },
    ];
    const existing: ProjectTask[] = [
      makeExistingTask({
        id: "task-uuid-1",
        title: "Fix login bug",
        description: "TodoWrite #1",
        status: "in_progress",
      }),
    ];

    const plan = buildTodoSyncPlan(incoming, existing);

    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0].title).toBe("Fix login bug (urgent)");
  });

  it("does not cancel already-done tasks", () => {
    const incoming: { id: string; content: string; status: string }[] = [];
    const existing: ProjectTask[] = [
      makeExistingTask({
        id: "task-uuid-1",
        title: "Completed task",
        description: "TodoWrite #1",
        status: "done",
      }),
    ];

    const plan = buildTodoSyncPlan(incoming, existing);

    expect(plan.toCancel).toHaveLength(0);
  });

  it("handles multiple tasks in a single sync", () => {
    const incoming = [
      { id: "1", content: "Task A", status: "completed" },
      { id: "2", content: "Task B", status: "in_progress" },
      { id: "3", content: "Task C", status: "pending" },
    ];
    const existing: ProjectTask[] = [
      makeExistingTask({
        id: "task-uuid-1",
        title: "Task A",
        description: "TodoWrite #1",
        status: "in_progress",
      }),
      makeExistingTask({
        id: "task-uuid-old",
        title: "Removed task",
        description: "TodoWrite #99",
        status: "open",
      }),
    ];

    const plan = buildTodoSyncPlan(incoming, existing);

    expect(plan.toCreate).toHaveLength(2); // Task B and C are new
    expect(plan.toUpdate).toHaveLength(1); // Task A status changed
    expect(plan.toCancel).toHaveLength(1); // TodoWrite #99 removed
    expect(plan.toCancel[0]).toBe("task-uuid-old");
  });
});
