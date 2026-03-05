/**
 * Tests for pure functions used in agent task sync.
 */
import { describe, it, expect } from "vitest";
import { mapAgentTaskStatus } from "../agent-todo-sync-pure";

describe("mapAgentTaskStatus", () => {
  it("maps in_progress to in_progress", () => {
    expect(mapAgentTaskStatus("in_progress")).toBe("in_progress");
  });

  it("maps completed to done", () => {
    expect(mapAgentTaskStatus("completed")).toBe("done");
  });

  it("maps pending to open", () => {
    expect(mapAgentTaskStatus("pending")).toBe("open");
  });

  it("defaults unknown status to open", () => {
    expect(mapAgentTaskStatus("unknown")).toBe("open");
  });
});
