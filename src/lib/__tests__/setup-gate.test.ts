// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The gate reads first-run state from the DB, the scoped/unscoped flag from
// base-path (INSTANCE_SLUG), and the session from auth-utils. Mock all three so
// each test drives the branch it exercises. findFirst is a fresh fn per test;
// INSTANCE_SLUG is a let we reassign per test via the mocked module getter.
const findFirst = vi.fn();
let instanceSlug = "";
vi.mock("@/db", () => ({
  db: { query: { setupConfig: { findFirst: () => findFirst() } } },
}));
vi.mock("@/lib/base-path", () => ({
  get INSTANCE_SLUG() {
    return instanceSlug;
  },
}));
vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn(),
}));

import { getAuthSession } from "@/lib/auth-utils";
import {
  hasValidSession,
  isFirstRunOpen,
  isSetupRequestAllowed,
} from "../setup-gate";

const authedSession = {
  user: { id: "user-1", email: "a@b.c", name: null },
} as unknown as Awaited<ReturnType<typeof getAuthSession>>;

describe("isSetupRequestAllowed", () => {
  beforeEach(() => {
    findFirst.mockReset();
    vi.mocked(getAuthSession).mockReset();
    instanceSlug = ""; // unscoped by default
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

  it("SCOPED instance: denies without a session EVEN when setup is incomplete (no first-run wizard)", async () => {
    instanceSlug = "alpha"; // scoped pod
    // Even if the DB says setup is incomplete, a scoped pod has no wizard, so the
    // open-first-run window must NOT apply: require a real session.
    findFirst.mockResolvedValue({ isComplete: false });
    vi.mocked(getAuthSession).mockResolvedValue(null);

    await expect(isSetupRequestAllowed()).resolves.toBe(false);
    // Scoped short-circuits before the setup-state lookup.
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("SCOPED instance: allows with a valid session", async () => {
    instanceSlug = "alpha";
    vi.mocked(getAuthSession).mockResolvedValue(authedSession);

    await expect(isSetupRequestAllowed()).resolves.toBe(true);
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

  it("denies (no 500) when getAuthSession THROWS — gate swallows it as unauthenticated", async () => {
    // getAuthSession does auth/DB work and can throw; the gate must treat a throw
    // as a DENY rather than propagating a 500 (codex Low 1).
    findFirst.mockResolvedValue({ isComplete: true });
    vi.mocked(getAuthSession).mockRejectedValue(new Error("auth backend down"));

    await expect(isSetupRequestAllowed()).resolves.toBe(false);
  });
});

describe("hasValidSession", () => {
  beforeEach(() => {
    vi.mocked(getAuthSession).mockReset();
  });

  it("true for a session with a user id", async () => {
    vi.mocked(getAuthSession).mockResolvedValue(authedSession);
    await expect(hasValidSession()).resolves.toBe(true);
  });

  it("false when there is no session", async () => {
    vi.mocked(getAuthSession).mockResolvedValue(null);
    await expect(hasValidSession()).resolves.toBe(false);
  });

  it("false (no throw) when getAuthSession rejects", async () => {
    vi.mocked(getAuthSession).mockRejectedValue(new Error("boom"));
    await expect(hasValidSession()).resolves.toBe(false);
  });
});

describe("isFirstRunOpen", () => {
  beforeEach(() => {
    findFirst.mockReset();
    instanceSlug = "";
  });

  it("true when unscoped and setup is incomplete", async () => {
    findFirst.mockResolvedValue({ isComplete: false });
    await expect(isFirstRunOpen()).resolves.toBe(true);
  });

  it("true when unscoped and there is no setup row at all", async () => {
    findFirst.mockResolvedValue(undefined);
    await expect(isFirstRunOpen()).resolves.toBe(true);
  });

  it("false when unscoped and setup is complete", async () => {
    findFirst.mockResolvedValue({ isComplete: true });
    await expect(isFirstRunOpen()).resolves.toBe(false);
  });

  it("false when scoped, regardless of DB state (short-circuits)", async () => {
    instanceSlug = "alpha";
    await expect(isFirstRunOpen()).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("false (fail-closed) on DB error", async () => {
    findFirst.mockRejectedValue(new Error("db down"));
    await expect(isFirstRunOpen()).resolves.toBe(false);
  });
});
