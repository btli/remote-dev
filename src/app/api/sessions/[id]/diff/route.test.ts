/**
 * [n6uc.9] Diff route bounding: the GET handler must surface a structured
 * `truncated` response when `git diff` exceeds the byte/time cap, while keeping
 * the normal small-diff path and the ownership guard intact.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const getDefaultBranch = vi.fn();
const execFileNoThrow = vi.fn();
const execFileCapped = vi.fn();

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

vi.mock("@/services/session-service", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

vi.mock("@/services/worktree-service", () => ({
  getDefaultBranch: (...args: unknown[]) => getDefaultBranch(...args),
}));

vi.mock("@/lib/exec", () => ({
  execFileNoThrow: (...args: unknown[]) => execFileNoThrow(...args),
  execFileCapped: (...args: unknown[]) => execFileCapped(...args),
}));

function call(id: string) {
  return import("./route").then(({ GET }) =>
    GET(new Request(`http://localhost/api/sessions/${id}/diff`), {
      params: Promise.resolve({ id }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ id: "s1", projectPath: "/repo" });
  getDefaultBranch.mockResolvedValue("main");
  // merge-base
  execFileNoThrow.mockResolvedValue({ stdout: "abc123", stderr: "", exitCode: 0 });
});

describe("GET /api/sessions/[id]/diff", () => {
  it("returns 404 for a session the caller does not own", async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await call("nope");
    expect(res.status).toBe(404);
    expect(execFileCapped).not.toHaveBeenCalled();
  });

  it("returns the raw diff with truncated:false for a normal small diff", async () => {
    execFileCapped.mockResolvedValue({
      stdout: "diff --git a/x b/x\n+hi\n",
      exitCode: 0,
      truncated: false,
      bytes: 23,
    });

    const res = await call("s1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.raw).toContain("diff --git");
    expect(body.base).toBe("abc123");
    expect(body.truncated).toBe(false);
    // No size fields on the normal path.
    expect(body.limit).toBeUndefined();
    expect(body.bytes).toBeUndefined();
  });

  it("surfaces truncated:true + bytes/limit when the diff exceeds the cap", async () => {
    execFileCapped.mockResolvedValue({
      stdout: "diff --git a/big b/big\n+partial\n",
      exitCode: 0, // killed mid-stream, but we keep the partial body
      truncated: true,
      bytes: 12_000_000,
    });

    const res = await call("s1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.bytes).toBe(12_000_000);
    expect(body.limit).toBe(10 * 1024 * 1024);
    // Partial body is still returned (not blanked).
    expect(body.raw).toContain("partial");
  });

  it("bounds the exec with a byte cap + timeout", async () => {
    execFileCapped.mockResolvedValue({
      stdout: "",
      exitCode: 0,
      truncated: false,
      bytes: 0,
    });

    await call("s1");
    expect(execFileCapped).toHaveBeenCalledWith(
      "git",
      ["-C", "/repo", "diff", "abc123"],
      expect.objectContaining({
        maxBytes: 10 * 1024 * 1024,
        timeout: 30000,
      }),
    );
  });

  it("returns an empty diff (not truncated) when git fails outright", async () => {
    execFileCapped.mockResolvedValue({
      stdout: "",
      exitCode: 128,
      truncated: false,
      bytes: 0,
    });

    const res = await call("s1");
    const body = await res.json();
    expect(body.raw).toBe("");
    expect(body.truncated).toBe(false);
  });
});
