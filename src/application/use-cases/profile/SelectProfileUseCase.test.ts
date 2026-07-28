// @vitest-environment node
import { describe, it, expect } from "vitest";
import { SelectProfileUseCase } from "./SelectProfileUseCase";
import type {
  ProfileSelectionPolicy,
  SelectedAccount,
} from "@/application/ports/ProfileSelectionPolicy";

/** Fake policy returning scripted results; records calls for assertions. */
class FakePolicy implements ProfileSelectionPolicy {
  selectForProjectCalls: Array<{ projectId: string; userId: string }> = [];
  selectNextAvailableCalls = 0;

  constructor(private readonly forProject: SelectedAccount | null) {}

  async selectForProject(
    projectId: string,
    userId: string
  ): Promise<SelectedAccount | null> {
    this.selectForProjectCalls.push({ projectId, userId });
    return this.forProject;
  }

  async selectNextAvailable(): Promise<SelectedAccount | null> {
    this.selectNextAvailableCalls++;
    return null;
  }
}

const POOL_PICK: SelectedAccount = { accountId: "acct-pool", profileId: "p-pool" };
const AUTO_PICK: SelectedAccount = { accountId: "acct-auto", profileId: "p-auto" };

describe("SelectProfileUseCase", () => {
  it("returns the explicit profile and does not consult the policy", async () => {
    const policy = new FakePolicy(POOL_PICK);
    const useCase = new SelectProfileUseCase(policy);

    const result = await useCase.execute({
      projectId: "proj-1",
      userId: "u1",
      explicitProfileId: "explicit-1",
    });

    // The explicit pin wins outright; the account is left for the caller to
    // resolve from the pinned profile. [remote-dev-n4x4.6]
    expect(result).toEqual({
      profileId: "explicit-1",
      accountId: null,
      wasAutoSelected: false,
    });
    expect(policy.selectForProjectCalls).toHaveLength(0);
  });

  it("delegates to the policy when no explicit profile is given", async () => {
    const policy = new FakePolicy(AUTO_PICK);
    const useCase = new SelectProfileUseCase(policy);

    const result = await useCase.execute({ projectId: "proj-1", userId: "u1" });

    expect(result).toEqual({
      profileId: "p-auto",
      accountId: "acct-auto",
      wasAutoSelected: true,
    });
    expect(policy.selectForProjectCalls).toEqual([
      { projectId: "proj-1", userId: "u1" },
    ]);
  });

  it("surfaces a standalone account (no origin profile) with a null profileId", async () => {
    const policy = new FakePolicy({ accountId: "acct-solo", profileId: null });
    const useCase = new SelectProfileUseCase(policy);

    const result = await useCase.execute({ projectId: "proj-1", userId: "u1" });

    expect(result).toEqual({
      profileId: null,
      accountId: "acct-solo",
      wasAutoSelected: true,
    });
  });

  it("returns a null selection (not auto-selected) when nothing is configured", async () => {
    const policy = new FakePolicy(null);
    const useCase = new SelectProfileUseCase(policy);

    const result = await useCase.execute({ projectId: "proj-1", userId: "u1" });

    expect(result).toEqual({
      profileId: null,
      accountId: null,
      wasAutoSelected: false,
    });
  });

  it("treats an empty-string explicit id as no explicit selection", async () => {
    const policy = new FakePolicy(AUTO_PICK);
    const useCase = new SelectProfileUseCase(policy);

    const result = await useCase.execute({
      projectId: "proj-1",
      userId: "u1",
      explicitProfileId: "",
    });

    expect(result.profileId).toBe("p-auto");
    expect(result.accountId).toBe("acct-auto");
    expect(result.wasAutoSelected).toBe(true);
  });
});
