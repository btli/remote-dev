// @vitest-environment node
import { describe, it, expect } from "vitest";
import { nextAttentionId } from "../useJumpToAttention";

describe("nextAttentionId", () => {
  const ordered = ["a", "b", "c", "d"];
  const attention = new Set(["b", "d"]);

  it("returns the first attention session after the active one (wraps)", () => {
    expect(nextAttentionId(ordered, attention, "b")).toBe("d");
    expect(nextAttentionId(ordered, attention, "d")).toBe("b"); // wrap-around
    expect(nextAttentionId(ordered, attention, "a")).toBe("b");
    expect(nextAttentionId(ordered, attention, "c")).toBe("d");
  });

  it("returns the first attention session when active is null", () => {
    expect(nextAttentionId(ordered, attention, null)).toBe("b");
  });

  it("returns the sole attention session even if it is the active one", () => {
    expect(nextAttentionId(ordered, new Set(["c"]), "c")).toBe("c");
  });

  it("returns null when no session needs attention", () => {
    expect(nextAttentionId(ordered, new Set(), "a")).toBeNull();
  });

  it("ignores an unknown active id and starts from the front", () => {
    expect(nextAttentionId(ordered, attention, "zzz")).toBe("b");
  });
});
