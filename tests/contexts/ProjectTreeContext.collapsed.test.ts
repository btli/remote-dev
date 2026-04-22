import { describe, it, expectTypeOf } from "vitest";
import type { ProjectNode } from "@/contexts/ProjectTreeContext";

describe("ProjectNode.collapsed", () => {
  it("declares a boolean `collapsed` field on the frontend ProjectNode type", () => {
    expectTypeOf<ProjectNode>()
      .toHaveProperty("collapsed")
      .toEqualTypeOf<boolean>();
  });
});
