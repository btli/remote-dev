/**
 * Tests for pure functions used in agent todo sync.
 */
import { describe, it, expect } from "vitest";
import { mapTodoWriteStatus } from "../agent-todo-sync-pure";

describe("mapTodoWriteStatus", () => {
  it("maps in_progress to in_progress", () => {
    expect(mapTodoWriteStatus("in_progress")).toBe("in_progress");
  });

  it("maps completed to done", () => {
    expect(mapTodoWriteStatus("completed")).toBe("done");
  });

  it("maps pending to open", () => {
    expect(mapTodoWriteStatus("pending")).toBe("open");
  });

  it("defaults unknown status to open", () => {
    expect(mapTodoWriteStatus("unknown")).toBe("open");
  });
});
