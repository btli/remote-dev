/**
 * [n6uc.9] Diff route bounding: the GET handler must surface a structured
 * `truncated` response when `git diff` exceeds the byte/time cap, while keeping
 * the normal small-diff path and the ownership guard intact.
 *
 * [remote-dev-dxpd] Untracked/new files are included in the SAME single diff via
 * a throwaway index seeded by COPYING the real index (so staged/force-added
 * files are reviewed), then `add -N -- .` (bounded) + `diff <baseRef>`, all with
 * `GIT_INDEX_FILE` pointed at a temp path — no per-file subprocess fan-out and
 * the real `.git/index` is never mutated.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const getDefaultBranch = vi.fn();
const execFileNoThrow = vi.fn();
const execFileCapped = vi.fn();
const copyFile = vi.fn();
const rm = vi.fn();

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

vi.mock("node:fs/promises", () => {
  const mod = {
    copyFile: (...args: unknown[]) => copyFile(...args),
    rm: (...args: unknown[]) => rm(...args),
  };
  // The route imports named `copyFile`/`rm`; provide a `default` too so the
  // module's shape is valid for both import styles.
  return { ...mod, default: mod };
});

function call(id: string) {
  return import("./route").then(({ GET }) =>
    GET(new Request(`http://localhost/api/sessions/${id}/diff`), {
      params: Promise.resolve({ id }),
    }),
  );
}

/** Find the execFileCapped call whose argv contains `token`. */
function cappedCallWith(token: string) {
  return execFileCapped.mock.calls.find((c) =>
    (c[1] as string[]).includes(token),
  );
}

/**
 * execFileNoThrow handles: `merge-base`, `rev-parse --git-path index`, and (only
 * on the copy-fallback path) `read-tree HEAD`. Route by subcommand.
 */
function setNoThrow({
  mergeBase = "abc123",
  indexPath = ".git/index",
  indexPathExit = 0,
  readTreeExit = 0,
}: {
  mergeBase?: string;
  indexPath?: string;
  indexPathExit?: number;
  readTreeExit?: number;
} = {}) {
  execFileNoThrow.mockImplementation((_cmd: string, args: string[]) => {
    if (args.includes("merge-base")) {
      return Promise.resolve({ stdout: mergeBase, stderr: "", exitCode: 0 });
    }
    if (args.includes("rev-parse")) {
      return Promise.resolve({
        stdout: indexPath,
        stderr: "",
        exitCode: indexPathExit,
      });
    }
    if (args.includes("read-tree")) {
      return Promise.resolve({ stdout: "", stderr: "", exitCode: readTreeExit });
    }
    return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
  });
}

/**
 * execFileCapped handles `add -N` and the final `diff`. By default `add`
 * succeeds (empty) and the diff returns whatever the test sets via `diffResult`.
 */
function setCapped(diffResult: Record<string, unknown>) {
  execFileCapped.mockImplementation((_cmd: string, args: string[]) => {
    if (args.includes("add")) {
      return Promise.resolve({
        stdout: "",
        exitCode: 0,
        truncated: false,
        bytes: 0,
      });
    }
    // diff
    return Promise.resolve(diffResult);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ id: "s1", projectPath: "/repo" });
  getDefaultBranch.mockResolvedValue("main");
  setNoThrow();
  // By default the real-index copy SUCCEEDS (preferred seeding path).
  copyFile.mockResolvedValue(undefined);
  rm.mockResolvedValue(undefined);
  setCapped({ stdout: "", exitCode: 0, truncated: false, bytes: 0 });
});

describe("GET /api/sessions/[id]/diff", () => {
  it("returns 404 for a session the caller does not own", async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await call("nope");
    expect(res.status).toBe(404);
    expect(execFileCapped).not.toHaveBeenCalled();
  });

  it("returns the raw diff with truncated:false for a normal small diff", async () => {
    setCapped({
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
    setCapped({
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

  it("bounds the diff exec with a byte cap + timeout, against the merge-base", async () => {
    await call("s1");
    const diffCall = cappedCallWith("diff");
    expect(diffCall?.[1]).toEqual(["-C", "/repo", "diff", "abc123"]);
    expect(diffCall?.[2]).toEqual(
      expect.objectContaining({ maxBytes: 10 * 1024 * 1024, timeout: 30000 }),
    );
  });

  it("bounds the `add -N` exec too (capped, timeout, safecrlf suppressed)", async () => {
    await call("s1");
    const addCall = cappedCallWith("add");
    expect(addCall).toBeTruthy();
    // safecrlf=false config BEFORE the subcommand; no filenames in argv.
    expect(addCall?.[1]).toEqual([
      "-C",
      "/repo",
      "-c",
      "core.safecrlf=false",
      "add",
      "-N",
      "--",
      ".",
    ]);
    expect(addCall?.[2]).toEqual(
      expect.objectContaining({ timeout: 30000 }),
    );
    expect((addCall?.[2] as { maxBytes?: number })?.maxBytes).toBeGreaterThan(0);
  });

  it("returns an empty diff (not truncated) when git fails outright", async () => {
    setCapped({ stdout: "", exitCode: 128, truncated: false, bytes: 0 });

    const res = await call("s1");
    const body = await res.json();
    expect(body.raw).toBe("");
    expect(body.truncated).toBe(false);
  });

  // --- [remote-dev-dxpd] throwaway-index untracked handling ----------------

  it("seeds by COPYING the real index, then diffs through GIT_INDEX_FILE (real index untouched)", async () => {
    setCapped({
      stdout: "diff --git a/new.ts b/new.ts\nnew file mode 100644\n+x\n",
      exitCode: 0,
      truncated: false,
      bytes: 40,
    });

    await call("s1");

    // The real index path is resolved (rev-parse --git-path index) and COPIED
    // into the temp index — not read-tree (read-tree only runs on fallback).
    const revParseCall = execFileNoThrow.mock.calls.find((c) =>
      (c[1] as string[]).includes("rev-parse"),
    );
    expect(revParseCall).toBeTruthy();
    expect(copyFile).toHaveBeenCalledTimes(1);
    // Copies the resolved (absolute) real index into the temp index.
    const [src, dst] = copyFile.mock.calls[0] as [string, string];
    expect(src).toBe("/repo/.git/index"); // relative ".git/index" → absolute
    expect(dst).toContain("rdv-diff-index-");
    // No read-tree on the happy (copy succeeded) path.
    expect(
      execFileNoThrow.mock.calls.some((c) =>
        (c[1] as string[]).includes("read-tree"),
      ),
    ).toBe(false);

    // add -N + diff carry the SAME GIT_INDEX_FILE temp path (= the copy dst).
    const addCall = cappedCallWith("add");
    const diffCall = cappedCallWith("diff");
    const idx = (addCall?.[2] as { env?: NodeJS.ProcessEnv })?.env
      ?.GIT_INDEX_FILE;
    expect(idx).toBe(dst);
    expect(idx).not.toBe("/repo/.git/index"); // never the real index
    expect(
      (diffCall?.[2] as { env?: NodeJS.ProcessEnv })?.env?.GIT_INDEX_FILE,
    ).toBe(idx);
  });

  it("falls back to read-tree HEAD when the real index can't be copied", async () => {
    copyFile.mockRejectedValue(new Error("ENOENT")); // e.g. fresh repo, no index
    setCapped({
      stdout: "diff --git a/only-new.ts b/only-new.ts\nnew file mode 100644\n+x\n",
      exitCode: 0,
      truncated: false,
      bytes: 50,
    });

    const res = await call("s1");
    const body = await res.json();
    expect(body.raw).toContain("only-new.ts");
    // Fallback path runs read-tree against the temp index.
    const readTreeCall = execFileNoThrow.mock.calls.find((c) =>
      (c[1] as string[]).includes("read-tree"),
    );
    expect(readTreeCall).toBeTruthy();
    expect(
      (readTreeCall?.[2] as { env?: NodeJS.ProcessEnv })?.env?.GIT_INDEX_FILE,
    ).toContain("rdv-diff-index-");
  });

  it("still diffs when rev-parse fails entirely (fresh repo → read-tree fallback)", async () => {
    setNoThrow({ indexPathExit: 128, readTreeExit: 128 }); // no index, no HEAD
    setCapped({
      stdout: "diff --git a/n.ts b/n.ts\nnew file mode 100644\n+x\n",
      exitCode: 0,
      truncated: false,
      bytes: 40,
    });

    const res = await call("s1");
    const body = await res.json();
    expect(body.raw).toContain("n.ts"); // add -N + diff still run on empty index
    expect(copyFile).not.toHaveBeenCalled(); // nothing to copy
  });

  it("does not 500 when add -N throws — degrades to the diff it can produce", async () => {
    execFileCapped.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes("add")) return Promise.reject(new Error("add boom"));
      return Promise.resolve({
        stdout: "diff --git a/tracked b/tracked\n+edit\n",
        exitCode: 0,
        truncated: false,
        bytes: 30,
      });
    });

    const res = await call("s1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.raw).toContain("tracked");
  });

  it("returns raw:'' (not truncated) when the diff exec throws (graceful)", async () => {
    execFileCapped.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes("add")) {
        return Promise.resolve({
          stdout: "",
          exitCode: 0,
          truncated: false,
          bytes: 0,
        });
      }
      return Promise.reject(new Error("spawn ENOENT"));
    });

    const res = await call("s1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.raw).toBe("");
    expect(body.truncated).toBe(false);
  });

  it("always cleans up the throwaway index (rm in finally)", async () => {
    await call("s1");
    // rm called for the temp index AND its .lock.
    const rmTargets = rm.mock.calls.map((c) => String(c[0]));
    expect(rmTargets.some((t) => /rdv-diff-index-.*(?<!\.lock)$/.test(t))).toBe(
      true,
    );
    expect(rmTargets.some((t) => t.endsWith(".lock"))).toBe(true);
  });
});
