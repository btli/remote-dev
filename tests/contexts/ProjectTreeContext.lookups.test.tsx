import { describe, it, expect } from "vitest";
import { ProjectTreeContext } from "@/contexts/ProjectTreeContext";

describe("ProjectTreeContext export", () => {
  it("exports the context object so tests can inject a value", () => {
    expect(ProjectTreeContext).toBeDefined();
    expect(ProjectTreeContext.Provider).toBeDefined();
  });
});
