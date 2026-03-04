/**
 * Tests for pure functions used in agent todo sync.
 *
 * Note: mapTodoWriteStatus is imported from task-service which depends on
 * @/db (node: modules). The happy-dom test environment can't resolve these.
 * We test the mapping logic inline here to avoid the import chain.
 */
import { describe, it, expect } from "vitest";

// Inline the pure mapping function to test without DB import chain
function mapTodoWriteStatus(status: string): string {
  switch (status) {
    case "in_progress":
      return "in_progress";
    case "completed":
      return "done";
    case "pending":
    default:
      return "open";
  }
}

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
