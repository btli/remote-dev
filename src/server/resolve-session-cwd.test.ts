// @vitest-environment node
/**
 * [remote-dev-ipbo] Tests for the 3-tier WS connect-time cwd fallback:
 * validated query cwd → session row's project_path → home. The incident class
 * is "client sent NO cwd at all" — previously resolved to undefined silently,
 * letting tmux inherit the daemon's (deploy-deleted) cwd.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

// ESM namespace exports can't be spied on, so mock node:fs's statSync directly.
const statSync = vi.fn();
vi.mock("node:fs", () => ({ statSync: (p: string) => statSync(p) }));

import { resolveSessionCwd } from "./resolve-session-cwd";

/** Make statSync accept exactly the given directories and ENOENT everything else. */
function dirsExist(...dirs: string[]): void {
  statSync.mockImplementation((p: string) => {
    if (dirs.includes(p)) return { isDirectory: () => true };
    throw new Error("ENOENT");
  });
}

const HOME = "/home/tester";

describe("resolveSessionCwd", () => {
  beforeEach(() => {
    statSync.mockReset();
  });

  it("uses a valid query cwd (tier: query)", () => {
    dirsExist("/projects/app", HOME);
    const result = resolveSessionCwd("/projects/app", "/projects/other", HOME);
    expect(result).toEqual({ cwd: "/projects/app", tier: "query" });
  });

  it("falls back to the session row when the query cwd is rejected", () => {
    dirsExist("/projects/app", HOME);
    const result = resolveSessionCwd("/gone", "/projects/app", HOME);
    expect(result.cwd).toBe("/projects/app");
    expect(result.tier).toBe("session-row");
    expect(result.queryRejectedReason).toBe("missing");
    expect(result.rowRejectedReason).toBeUndefined();
  });

  it("falls back to the session row when NO query cwd was sent (incident class)", () => {
    // The silent-absence regression: absent query cwd previously produced
    // undefined with no log — now the row's project_path wins.
    dirsExist("/projects/app", HOME);
    const result = resolveSessionCwd(undefined, "/projects/app", HOME);
    expect(result.cwd).toBe("/projects/app");
    expect(result.tier).toBe("session-row");
    // Absence is not a rejection — no reason reported for the query tier.
    expect(result.queryRejectedReason).toBeUndefined();
  });

  it("falls back to home when the query is absent and the row has no path", () => {
    dirsExist(HOME);
    const result = resolveSessionCwd(undefined, null, HOME);
    expect(result).toEqual({ cwd: HOME, tier: "home" });
  });

  it("reports both rejection reasons when query and row are both rejected", () => {
    dirsExist(HOME);
    const result = resolveSessionCwd("/gone", "relative/dir", HOME);
    expect(result.cwd).toBe(HOME);
    expect(result.tier).toBe("home");
    expect(result.queryRejectedReason).toBe("missing");
    expect(result.rowRejectedReason).toBe("not-absolute");
  });

  it("resolves to '/' when even the homedir is unusable", () => {
    dirsExist(); // nothing exists
    const result = resolveSessionCwd(undefined, undefined, "/nonexistent-home");
    expect(result.cwd).toBe("/");
    expect(result.tier).toBe("home");
  });

  it("resolves to '/' when the homedir is empty", () => {
    dirsExist();
    const result = resolveSessionCwd(undefined, undefined, "");
    expect(result.cwd).toBe("/");
    expect(result.tier).toBe("home");
  });
});
