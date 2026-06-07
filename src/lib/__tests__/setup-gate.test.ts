// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate reads first-run state from the DB and (when complete) the session
// from auth-utils. Mock both boundaries so each test can drive the branch it
// exercises. findFirst is a fresh fn per test (reset in beforeEach).
const findFirst = vi.fn();
vi.mock("@/db", () => ({
  db: { query: { setupConfig: { findFirst: () => findFirst() } } },
}));
vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn(),
}));

import { getAuthSession } from "@/lib/auth-utils";
import { isSetupRequestAllowed } from "../setup-gate";

const authedSession = {
  user: { id: "user-1", email: "a@b.c", name: null },
} as unknown as Awaited<ReturnType<typeof getAuthSession>>;

describe("isSetupRequestAllowed", () => {
  beforeEach(() => {
    findFirst.mockReset();
    vi.mocked(getAuthSession).mockReset();
  });

  it("allows when no setup_config row exists (first run), without consulting auth", async () => {
    findFirst.mockResolvedValue(undefined);

    await expect(isSetupRequestAllowed()).resolves.toBe(true);
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("allows when setup exists but is not complete, without consulting auth", async () => {
    findFirst.mockResolvedValue({ isComplete: false });

    await expect(isSetupRequestAllowed()).resolves.toBe(true);
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("allows when setup is complete AND the caller has a session", async () => {
    findFirst.mockResolvedValue({ isComplete: true });
    vi.mocked(getAuthSession).mockResolvedValue(authedSession);

    await expect(isSetupRequestAllowed()).resolves.toBe(true);
    expect(getAuthSession).toHaveBeenCalledTimes(1);
  });

  it("denies when setup is complete and there is no session", async () => {
    findFirst.mockResolvedValue({ isComplete: true });
    vi.mocked(getAuthSession).mockResolvedValue(null);

    await expect(isSetupRequestAllowed()).resolves.toBe(false);
  });

  it("fails CLOSED on a DB error: requires (and checks) auth", async () => {
    findFirst.mockRejectedValue(new Error("db down"));
    vi.mocked(getAuthSession).mockResolvedValue(null);

    // A transient DB error must NOT open the routes: with no session → denied.
    await expect(isSetupRequestAllowed()).resolves.toBe(false);
    expect(getAuthSession).toHaveBeenCalledTimes(1);
  });

  it("fails CLOSED on a DB error but still admits an authenticated caller", async () => {
    findFirst.mockRejectedValue(new Error("db down"));
    vi.mocked(getAuthSession).mockResolvedValue(authedSession);

    await expect(isSetupRequestAllowed()).resolves.toBe(true);
  });
});
