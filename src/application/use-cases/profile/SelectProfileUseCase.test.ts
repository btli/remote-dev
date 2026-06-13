// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SelectProfileUseCase } from "./SelectProfileUseCase";
import type { ProfileSelectionPolicy } from "@/application/ports/ProfileSelectionPolicy";

/** Fake policy returning scripted results; records calls for assertions. */
class FakePolicy implements ProfileSelectionPolicy {
  selectForProjectCalls: Array<{ projectId: string; userId: string }> = [];
  selectNextAvailableCalls = 0;

  constructor(private readonly forProject: string | null) {}

  async selectForProject(projectId: string, userId: string): Promise<string | null> {
    this.selectForProjectCalls.push({ projectId, userId });
    return this.forProject;
  }

  async selectNextAvailable(): Promise<string | null> {
    this.selectNextAvailableCalls++;
    return null;
  }
}

describe("SelectProfileUseCase", () => {
  it("returns the explicit profile and does not consult the policy", async () => {
    const policy = new FakePolicy("pool-pick");
    const useCase = new SelectProfileUseCase(policy);

    const result = await useCase.execute({
      projectId: "proj-1",
      userId: "u1",
      explicitProfileId: "explicit-1",
    });

    expect(result).toEqual({ profileId: "explicit-1", wasAutoSelected: false });
    expect(policy.selectForProjectCalls).toHaveLength(0);
  });

  it("delegates to the policy when no explicit profile is given", async () => {
    const policy = new FakePolicy("auto-pick");
    const useCase = new SelectProfileUseCase(policy);

    const result = await useCase.execute({ projectId: "proj-1", userId: "u1" });

    expect(result).toEqual({ profileId: "auto-pick", wasAutoSelected: true });
    expect(policy.selectForProjectCalls).toEqual([{ projectId: "proj-1", userId: "u1" }]);
  });

  it("returns a null profile (not auto-selected) when nothing is configured", async () => {
    const policy = new FakePolicy(null);
    const useCase = new SelectProfileUseCase(policy);

    const result = await useCase.execute({ projectId: "proj-1", userId: "u1" });

    expect(result).toEqual({ profileId: null, wasAutoSelected: false });
  });

  it("treats an empty-string explicit id as no explicit selection", async () => {
    const policy = new FakePolicy("auto-pick");
    const useCase = new SelectProfileUseCase(policy);

    const result = await useCase.execute({
      projectId: "proj-1",
      userId: "u1",
      explicitProfileId: "",
    });

    expect(result.profileId).toBe("auto-pick");
    expect(result.wasAutoSelected).toBe(true);
  });
});
