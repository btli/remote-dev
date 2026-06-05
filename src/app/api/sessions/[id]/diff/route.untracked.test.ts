/**
 * [remote-dev-dxpd] Worktree diff must ALSO include untracked/new files.
 *
 * Regression coverage for the user-reported P1: `git diff <merge-base>` never
 * shows untracked files, so a worktree whose changes are (wholly or partly) new
 * files rendered "No changes against the base branch" (or silently dropped the
 * new files from a mixed review). These tests run REAL git against throwaway
 * repos (only auth + the session/worktree services are mocked) so they exercise
 * the actual throwaway-index plumbing the route uses (copy the real index +
 * `add -N -- .` + `diff <baseRef>` via `GIT_INDEX_FILE`), including the
 * force-staged-gitignored regression guard and symlink safety.
 */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Count throwaway diff-index files the route leaves behind in os.tmpdir(). */
function leftoverIndexCount(): number {
  return readdirSync(tmpdir()).filter((f) => f.startsWith("rdv-diff-index-"))
    .length;
}

const getSession = vi.fn();
const getDefaultBranch = vi.fn();

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

vi.mock("@/services/session-service", () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

vi.mock("@/services/worktree-service", () => ({
  getDefaultBranch: (...args: unknown[]) => getDefaultBranch(...args),
}));

// NOTE: @/lib/exec is intentionally NOT mocked here — we want real git execs.

const repos: string[] = [];

/** Create a throwaway git repo with one committed base file on `main`. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rdv-diff-"));
  repos.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@t.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "base.txt"), "base line\n");
  git("add", "base.txt");
  git("commit", "-qm", "base");
  return dir;
}

function call(id: string) {
  return import("./route").then(({ GET }) =>
    GET(new Request(`http://localhost/api/sessions/${id}/diff`), {
      params: Promise.resolve({ id }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getDefaultBranch.mockResolvedValue("main");
});

afterEach(() => {
  for (const dir of repos.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("GET /api/sessions/[id]/diff — untracked files (remote-dev-dxpd)", () => {
  it("includes a NEW untracked file (the exact reported bug)", async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "brandnew.ts"), "export const hi = 1;\n");
    getSession.mockResolvedValue({ id: "s1", projectPath: dir });

    const res = await call("s1");
    expect(res.status).toBe(200);
    const body = await res.json();

    // Was previously raw:"" → "No changes". Now the new file is present.
    expect(body.raw).not.toBe("");
    expect(body.raw).toContain("brandnew.ts");
    expect(body.raw).toContain("new file mode");
    expect(body.raw).toContain("+export const hi = 1;");
    expect(body.truncated).toBe(false);

    // And parseUnifiedDiff renders it with the isNew badge.
    const { parseUnifiedDiff } = await import(
      "@/components/session/diff/parseUnifiedDiff"
    );
    const files = parseUnifiedDiff(body.raw);
    const entry = files.find((f) => f.path === "brandnew.ts");
    expect(entry).toBeTruthy();
    expect(entry?.isNew).toBe(true);
    expect(entry?.additions).toBe(1);
  });

  it("includes BOTH a modified tracked file and a new untracked file (mixed)", async () => {
    const dir = makeRepo();
    // Modify the tracked file (shows up in the tracked diff).
    writeFileSync(join(dir, "base.txt"), "base line\nedited\n");
    // Add a brand-new untracked file (must be appended).
    writeFileSync(join(dir, "added.txt"), "fresh content\n");
    getSession.mockResolvedValue({ id: "s1", projectPath: dir });

    const res = await call("s1");
    const body = await res.json();

    // Tracked edit present.
    expect(body.raw).toContain("base.txt");
    expect(body.raw).toContain("+edited");
    // Untracked new file present.
    expect(body.raw).toContain("added.txt");
    expect(body.raw).toContain("+fresh content");

    const { parseUnifiedDiff } = await import(
      "@/components/session/diff/parseUnifiedDiff"
    );
    const paths = parseUnifiedDiff(body.raw).map((f) => f.path);
    expect(paths).toContain("base.txt");
    expect(paths).toContain("added.txt");
  });

  it("respects .gitignore (excluded files are NOT included)", async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, ".gitignore"), "secret.env\nnode_modules/\n");
    writeFileSync(join(dir, "secret.env"), "TOKEN=should-not-leak\n");
    writeFileSync(join(dir, "shown.txt"), "visible\n");
    getSession.mockResolvedValue({ id: "s1", projectPath: dir });

    const res = await call("s1");
    const body = await res.json();

    // The ignored file's CONTENT must never leak, and it must not be diffed as
    // its own new file. (Its name still appears as a line inside `.gitignore`'s
    // own diff, so we assert on the content + the per-file header instead.)
    expect(body.raw).not.toContain("should-not-leak");
    const { parseUnifiedDiff } = await import(
      "@/components/session/diff/parseUnifiedDiff"
    );
    const paths = parseUnifiedDiff(body.raw).map((f) => f.path);
    expect(paths).not.toContain("secret.env");
    // A normal untracked file (and .gitignore itself) ARE diffed.
    expect(paths).toContain("shown.txt");
    expect(paths).toContain(".gitignore");
    expect(body.raw).toContain("+visible");
  });

  it("SHOWS a force-staged gitignored file (git add -f) — no review bypass", async () => {
    // Regression guard for the index-copy seeding: a gitignored file the agent
    // force-staged lives in the REAL index but not in HEAD. Seeding the temp
    // index from `read-tree HEAD` would HIDE it (add -N re-applies .gitignore);
    // copying the real index keeps it visible for review.
    const dir = makeRepo();
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
    writeFileSync(join(dir, ".gitignore"), "ignored.env\n");
    writeFileSync(join(dir, "ignored.env"), "SECRET=force-staged-must-be-seen\n");
    git("add", "-f", "ignored.env"); // force-stage past .gitignore
    getSession.mockResolvedValue({ id: "s1", projectPath: dir });

    const res = await call("s1");
    const body = await res.json();

    const { parseUnifiedDiff } = await import(
      "@/components/session/diff/parseUnifiedDiff"
    );
    const entry = parseUnifiedDiff(body.raw).find((f) => f.path === "ignored.env");
    expect(entry).toBeTruthy();
    expect(entry?.isNew).toBe(true);
    expect(body.raw).toContain("SECRET=force-staged-must-be-seen");
  });

  it("handles untracked paths with spaces", async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "my new file.txt"), "spaced path\n");
    getSession.mockResolvedValue({ id: "s1", projectPath: dir });

    const res = await call("s1");
    const body = await res.json();

    expect(body.raw).toContain("my new file.txt");
    expect(body.raw).toContain("+spaced path");
  });

  it("returns raw:'' (no regression) for a worktree with no changes at all", async () => {
    const dir = makeRepo();
    getSession.mockResolvedValue({ id: "s1", projectPath: dir });

    const res = await call("s1");
    const body = await res.json();
    expect(body.raw).toBe("");
    expect(body.truncated).toBe(false);
  });

  it("includes a binary untracked file as a 'Binary files ... differ' note", async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "blob.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    getSession.mockResolvedValue({ id: "s1", projectPath: dir });

    const res = await call("s1");
    const body = await res.json();
    expect(body.raw).toContain("blob.bin");
    expect(body.raw).toContain("Binary files");
  });

  it("shows a DELETED tracked file as a deletion", async () => {
    const dir = makeRepo();
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], { stdio: "pipe" });
    // Commit a second tracked file, then delete it in the working tree.
    writeFileSync(join(dir, "gone.txt"), "remove me\n");
    git("add", "gone.txt");
    git("commit", "-qm", "add gone.txt");
    rmSync(join(dir, "gone.txt"));
    getSession.mockResolvedValue({ id: "s1", projectPath: dir });

    const res = await call("s1");
    const body = await res.json();

    const { parseUnifiedDiff } = await import(
      "@/components/session/diff/parseUnifiedDiff"
    );
    const entry = parseUnifiedDiff(body.raw).find((f) => f.path === "gone.txt");
    expect(entry).toBeTruthy();
    expect(entry?.isDeleted).toBe(true);
    expect(body.raw).toContain("deleted file mode");
    expect(body.raw).toContain("-remove me");
  });

  it("does NOT follow an untracked symlink — emits mode 120000 + target PATH, never the linked CONTENT", async () => {
    const dir = makeRepo();
    // A file OUTSIDE the worktree whose CONTENT must never appear in the diff.
    const outside = mkdtempSync(join(tmpdir(), "rdv-outside-"));
    repos.push(outside);
    const secretContent = "TOP-SECRET-LINKED-CONTENT-DO-NOT-LEAK";
    const target = join(outside, "secret.txt");
    writeFileSync(target, secretContent + "\n");
    // An untracked symlink in the worktree pointing at that external file.
    symlinkSync(target, join(dir, "linky"));
    getSession.mockResolvedValue({ id: "s1", projectPath: dir });

    const res = await call("s1");
    const body = await res.json();

    // The symlink is shown as a new symlink (mode 120000) whose "content" is the
    // TARGET PATH — git does NOT dereference it, so the linked file's bytes never
    // leak.
    expect(body.raw).toContain("linky");
    expect(body.raw).toContain("new file mode 120000");
    expect(body.raw).toContain(target); // the link target path is the payload
    expect(body.raw).not.toContain(secretContent); // never the linked content
  });

  it("always cleans up its throwaway temp index (no leak in os.tmpdir())", async () => {
    const before = leftoverIndexCount();
    const dir = makeRepo();
    writeFileSync(join(dir, "x.txt"), "y\n");
    getSession.mockResolvedValue({ id: "s1", projectPath: dir });

    await call("s1");

    // The `finally { rm(tempIndex) }` in the route must leave nothing behind.
    expect(leftoverIndexCount()).toBe(before);
  });
});
