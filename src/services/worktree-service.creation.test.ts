// @vitest-environment node

import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createBranchWithWorktree } from "./worktree-service";

const execFile = promisify(execFileCallback);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) =>
    rm(path, { recursive: true, force: true })
  ));
});

describe("createBranchWithWorktree ownership", () => {
  it("distinguishes a worktree created now from an existing worktree reused by a retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "rdv-worktree-ownership-"));
    tempRoots.push(root);
    const repoPath = join(root, "repo");
    const worktreePath = join(root, "feature-worktree");
    await mkdir(repoPath);
    await execFile("git", ["init", "-b", "master", repoPath]);
    await execFile("git", ["-C", repoPath, "config", "user.name", "Remote Dev Test"]);
    await execFile("git", ["-C", repoPath, "config", "user.email", "test@remote.dev"]);
    await writeFile(join(repoPath, "README.md"), "base\n");
    await execFile("git", ["-C", repoPath, "add", "README.md"]);
    await execFile("git", ["-C", repoPath, "commit", "-m", "base"]);

    const created = await createBranchWithWorktree(
      repoPath,
      "feature/ownership",
      undefined,
      worktreePath,
    );
    expect(created).toEqual(expect.objectContaining({
      worktreePath,
      created: true,
    }));

    const reused = await createBranchWithWorktree(
      repoPath,
      "feature/ownership",
      undefined,
      worktreePath,
    );
    expect(reused).toEqual(expect.objectContaining({
      worktreePath,
      created: false,
    }));
  });

  it("rejects an unrelated repository at the deterministic retry path", async () => {
    const root = await mkdtemp(join(tmpdir(), "rdv-worktree-unrelated-"));
    tempRoots.push(root);
    const repoPath = join(root, "repo");
    const worktreePath = join(root, "feature-worktree");
    await mkdir(repoPath);
    await mkdir(worktreePath);
    await execFile("git", ["init", "-b", "master", repoPath]);
    await execFile("git", ["-C", repoPath, "config", "user.name", "Remote Dev Test"]);
    await execFile("git", ["-C", repoPath, "config", "user.email", "test@remote.dev"]);
    await writeFile(join(repoPath, "README.md"), "base\n");
    await execFile("git", ["-C", repoPath, "add", "README.md"]);
    await execFile("git", ["-C", repoPath, "commit", "-m", "base"]);

    await execFile("git", ["init", "-b", "feature/identity", worktreePath]);

    await expect(createBranchWithWorktree(
      repoPath,
      "feature/identity",
      undefined,
      worktreePath,
    )).rejects.toMatchObject({ code: "PATH_EXISTS" });
  });

  it("rejects a registered worktree that checks out a different branch", async () => {
    const root = await mkdtemp(join(tmpdir(), "rdv-worktree-wrong-branch-"));
    tempRoots.push(root);
    const repoPath = join(root, "repo");
    const worktreePath = join(root, "feature-worktree");
    await mkdir(repoPath);
    await execFile("git", ["init", "-b", "master", repoPath]);
    await execFile("git", ["-C", repoPath, "config", "user.name", "Remote Dev Test"]);
    await execFile("git", ["-C", repoPath, "config", "user.email", "test@remote.dev"]);
    await writeFile(join(repoPath, "README.md"), "base\n");
    await execFile("git", ["-C", repoPath, "add", "README.md"]);
    await execFile("git", ["-C", repoPath, "commit", "-m", "base"]);
    await execFile("git", [
      "-C",
      repoPath,
      "worktree",
      "add",
      "-b",
      "feature/other",
      worktreePath,
    ]);

    await expect(createBranchWithWorktree(
      repoPath,
      "feature/identity",
      undefined,
      worktreePath,
    )).rejects.toMatchObject({ code: "PATH_EXISTS" });
  });
});
