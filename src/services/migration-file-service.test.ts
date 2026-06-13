// @vitest-environment node
/**
 * MigrationFileService tests — archive builders against real temp-dir
 * fixtures (tar listings prove the exclusions), the git_essentials staging
 * (real `git init` fixture repo), agent-settings curation against a fixture
 * $HOME, chunk math, and the size preview.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFile = promisify(execFileCb);

process.env.AUTH_SECRET = "migration-file-test-secret";

import { createTestDb, type TestDbHandle } from "./__tests__/migration-test-db";

let handle: TestDbHandle;

vi.mock("@/db", () => ({
  get db() {
    return handle.db;
  },
}));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

import {
  buildArchives,
  chunkCountFor,
  readArchiveChunk,
  sha256File,
  sizePreview,
} from "./migration-file-service";
import * as exec from "@/lib/exec";
import { CHUNK_SIZE_BYTES, type MigrationOptions } from "@/lib/migration-bundle";
import { users, projects, nodePreferences, agentProfiles, projectProfileLinks } from "@/db/schema";

const OPTIONS: MigrationOptions = {
  workingTreeMode: "full_tar",
  includeDotEnv: true,
  includeAgentCreds: true,
  includeSshKeys: false,
  includeAgentSettings: true,
  includeChannelHistory: false,
  removeSourceAfterVerify: false,
};

let fixtureRoot: string;
let savedHome: string | undefined;
let savedClaudeConfigDir: string | undefined;

function write(relPath: string, content = "x"): void {
  const full = join(fixtureRoot, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

async function tarList(tarPath: string): Promise<string[]> {
  const { stdout } = await execFile("tar", ["-tzf", tarPath]);
  return stdout
    .split("\n")
    .map((line) => line.trim().replace(/^\.\//, "").replace(/\/$/, ""))
    .filter((line) => line.length > 0 && line !== ".");
}

describe("MigrationFileService", () => {
  beforeEach(async () => {
    handle = await createTestDb();
    fixtureRoot = mkdtempSync(join(tmpdir(), "rdv-migration-files-"));
    process.env.RDV_DATA_DIR = join(fixtureRoot, "data");
    savedHome = process.env.HOME;
    savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    if (savedClaudeConfigDir !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    delete process.env.RDV_DATA_DIR;
    rmSync(fixtureRoot, { recursive: true, force: true });
    handle.cleanup();
  });

  it("chunk math: ceil with a 1-chunk floor", () => {
    expect(chunkCountFor(0)).toBe(1);
    expect(chunkCountFor(1)).toBe(1);
    expect(chunkCountFor(CHUNK_SIZE_BYTES)).toBe(1);
    expect(chunkCountFor(CHUNK_SIZE_BYTES + 1)).toBe(2);
  });

  it("full_tar excludes dependency/build dirs at any depth", async () => {
    write("tree/src/index.ts", "code");
    write("tree/.beads/issues.jsonl", "{}");
    write("tree/node_modules/pkg/index.js", "junk");
    write("tree/packages/app/node_modules/dep/x.js", "junk");
    write("tree/.next/cache.bin", "junk");
    write("tree/sub/dist/out.js", "junk");

    const built = await buildArchives({
      jobId: "job-ft",
      workingDir: join(fixtureRoot, "tree"),
      options: OPTIONS,
      profiles: [],
    });

    expect(built.archives.map((a) => a.name)).toContain("working-tree");
    expect(built.beadsIncluded).toBe(true);
    const entry = built.archives.find((a) => a.name === "working-tree")!;
    expect(entry.chunkCount).toBe(1);
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.sizeBytes).toBeGreaterThan(0);

    const listing = await tarList(built.archivePaths["working-tree"]!);
    expect(listing).toContain("src/index.ts");
    expect(listing).toContain(".beads/issues.jsonl");
    expect(listing.some((p) => p.includes("node_modules"))).toBe(false);
    expect(listing.some((p) => p.includes(".next"))).toBe(false);
    expect(listing.some((p) => p.includes("dist"))).toBe(false);

    // The reported sha256 matches the file on disk (manifest honesty).
    expect(await sha256File(built.archivePaths["working-tree"]!)).toBe(entry.sha256);

    // readArchiveChunk(0) returns the whole (single-chunk) archive.
    const chunk = await readArchiveChunk(built.archivePaths["working-tree"]!, 0);
    expect(chunk.length).toBe(entry.sizeBytes);
  });

  it("tar invocations set COPYFILE_DISABLE=1 (no macOS AppleDouble ._* files)", async () => {
    write("tree/src/index.ts", "code");
    // Spy on the real execFile but delegate through to it, so the archive is
    // still produced and we can inspect the options tar was invoked with.
    const spy = vi.spyOn(exec, "execFile");

    await buildArchives({
      jobId: "job-copyfile",
      workingDir: join(fixtureRoot, "tree"),
      options: { ...OPTIONS, includeAgentSettings: false },
      profiles: [],
    });

    const tarCalls = spy.mock.calls.filter(([command]) => command === "tar");
    expect(tarCalls.length).toBeGreaterThan(0);
    for (const [, , options] of tarCalls) {
      expect(options?.env?.COPYFILE_DISABLE).toBe("1");
    }
    spy.mockRestore();
  });

  it("profiles archive excludes .cache always and .ssh unless includeSshKeys", async () => {
    write("profile/settings.json", "{}");
    write("profile/.ssh/id_ed25519", "KEY");
    write("profile/.cache/blob.bin", "junk");

    const without = await buildArchives({
      jobId: "job-p1",
      workingDir: null,
      options: { ...OPTIONS, workingTreeMode: "none", includeAgentSettings: false },
      profiles: [{ id: "src-prof", configDir: join(fixtureRoot, "profile") }],
    });
    const withoutListing = await tarList(without.archivePaths.profiles!);
    expect(withoutListing).toContain("profiles/src-prof/settings.json");
    expect(withoutListing.some((p) => p.includes(".ssh"))).toBe(false);
    expect(withoutListing.some((p) => p.includes(".cache"))).toBe(false);

    const withKeys = await buildArchives({
      jobId: "job-p2",
      workingDir: null,
      options: {
        ...OPTIONS,
        workingTreeMode: "none",
        includeAgentSettings: false,
        includeSshKeys: true,
      },
      profiles: [{ id: "src-prof", configDir: join(fixtureRoot, "profile") }],
    });
    const withListing = await tarList(withKeys.archivePaths.profiles!);
    expect(withListing).toContain("profiles/src-prof/.ssh/id_ed25519");
    expect(withListing.some((p) => p.includes(".cache"))).toBe(false);
  });

  it("agent-settings curates per provider and gates credentials", async () => {
    const home = join(fixtureRoot, "home");
    process.env.HOME = home;
    write("home/.claude/settings.json", "{}");
    write("home/.claude/CLAUDE.md", "# notes");
    write("home/.claude/not-curated.txt", "nope");
    write("home/.claude/skills/foo/SKILL.md", "skill");
    write("home/.codex/config.toml", "x=1");
    write("home/.codex/auth.json", "SECRET");
    write("home/.gemini/settings.json", "{}");
    write("home/.gemini/tmp/cache.bin", "junk");
    write("home/.gemini/history/old.txt", "junk");
    write("home/.gemini/oauth_creds.json", "SECRET");
    write("home/.config/opencode/config.json", "{}");
    write("home/.config/opencode/logs/run.log", "junk");

    const withCreds = await buildArchives({
      jobId: "job-as1",
      workingDir: null,
      options: { ...OPTIONS, workingTreeMode: "none" },
      profiles: [],
    });
    const listing = await tarList(withCreds.archivePaths["agent-settings"]!);
    expect(listing).toContain("agent-settings/claude/settings.json");
    expect(listing).toContain("agent-settings/claude/CLAUDE.md");
    expect(listing).toContain("agent-settings/claude/skills/foo/SKILL.md");
    expect(listing).not.toContain("agent-settings/claude/not-curated.txt");
    expect(listing).toContain("agent-settings/codex/config.toml");
    expect(listing).toContain("agent-settings/codex/auth.json");
    expect(listing).toContain("agent-settings/gemini/settings.json");
    expect(listing).toContain("agent-settings/gemini/oauth_creds.json");
    expect(listing.some((p) => p.includes("gemini/tmp"))).toBe(false);
    expect(listing.some((p) => p.includes("gemini/history"))).toBe(false);
    expect(listing).toContain("agent-settings/opencode/config.json");
    expect(listing.some((p) => p.includes("opencode/logs"))).toBe(false);
    expect(withCreds.info.some((i) => i.includes("claude/settings.json"))).toBe(true);

    const noCreds = await buildArchives({
      jobId: "job-as2",
      workingDir: null,
      options: { ...OPTIONS, workingTreeMode: "none", includeAgentCreds: false },
      profiles: [],
    });
    const noCredsListing = await tarList(noCreds.archivePaths["agent-settings"]!);
    expect(noCredsListing).not.toContain("agent-settings/codex/auth.json");
    expect(noCredsListing).not.toContain("agent-settings/gemini/oauth_creds.json");
    expect(noCredsListing).toContain("agent-settings/codex/config.toml");
  });

  it("agent-settings honors CLAUDE_CONFIG_DIR and skips silently when nothing exists", async () => {
    const home = join(fixtureRoot, "home-empty");
    process.env.HOME = home;
    mkdirSync(home, { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = join(fixtureRoot, "custom-claude");
    write("custom-claude/settings.json", "{}");

    const built = await buildArchives({
      jobId: "job-as3",
      workingDir: null,
      options: { ...OPTIONS, workingTreeMode: "none" },
      profiles: [],
    });
    const listing = await tarList(built.archivePaths["agent-settings"]!);
    expect(listing).toContain("agent-settings/claude/settings.json");

    // Now with NOTHING present at all: no agent-settings archive, no error.
    delete process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = join(fixtureRoot, "home-truly-empty");
    mkdirSync(process.env.HOME, { recursive: true });
    const empty = await buildArchives({
      jobId: "job-as4",
      workingDir: null,
      options: { ...OPTIONS, workingTreeMode: "none" },
      profiles: [],
    });
    expect(empty.archives.map((a) => a.name)).not.toContain("agent-settings");
  });

  it("git_essentials ships beads/env/untracked/diff and records the remote", async () => {
    const repo = join(fixtureRoot, "repo");
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => execFile("git", ["-C", repo, ...args]);
    await execFile("git", ["init", "-q", repo]);
    await git("config", "user.email", "t@example.com");
    await git("config", "user.name", "T");
    writeFileSync(join(repo, "tracked.txt"), "base\n");
    await git("add", "tracked.txt");
    await git("commit", "-q", "-m", "init");
    await git("remote", "add", "origin", "https://example.com/fixture.git");
    // Uncommitted change to a tracked file → migration.diff.
    writeFileSync(join(repo, "tracked.txt"), "base\nchanged\n");
    write("repo/.beads/issues.jsonl", "{}");
    write("repo/.env", "SECRET=1");
    write("repo/untracked.txt", "new");
    write("repo/node_modules/junk/x.js", "junk"); // untracked but excluded

    const built = await buildArchives({
      jobId: "job-ess",
      workingDir: repo,
      options: { ...OPTIONS, workingTreeMode: "git_essentials", includeAgentSettings: false },
      profiles: [],
    });

    expect(built.gitRemoteUrl).toBe("https://example.com/fixture.git");
    expect(built.gitBranch).toBeTruthy();
    expect(built.beadsIncluded).toBe(true);
    const listing = await tarList(built.archivePaths.essentials!);
    expect(listing).toContain(".beads/issues.jsonl");
    expect(listing).toContain(".env");
    expect(listing).toContain("untracked.txt");
    expect(listing).toContain("migration.diff");
    expect(listing.some((p) => p.includes("node_modules"))).toBe(false);
    // tracked.txt itself does NOT travel — the clone provides it.
    expect(listing).not.toContain("tracked.txt");

    // includeDotEnv=false drops env files.
    const noEnv = await buildArchives({
      jobId: "job-ess2",
      workingDir: repo,
      options: {
        ...OPTIONS,
        workingTreeMode: "git_essentials",
        includeAgentSettings: false,
        includeDotEnv: false,
      },
      profiles: [],
    });
    expect(await tarList(noEnv.archivePaths.essentials!)).not.toContain(".env");
  });

  it("git_essentials requires an origin remote", async () => {
    const repo = join(fixtureRoot, "repo-no-remote");
    mkdirSync(repo, { recursive: true });
    await execFile("git", ["init", "-q", repo]);
    await expect(
      buildArchives({
        jobId: "job-ess3",
        workingDir: repo,
        options: { ...OPTIONS, workingTreeMode: "git_essentials", includeAgentSettings: false },
        profiles: [],
      }),
    ).rejects.toThrow(/origin/);
  });

  it("size preview returns estimates and degrades instead of throwing", async () => {
    process.env.HOME = join(fixtureRoot, "home-sp");
    mkdirSync(process.env.HOME, { recursive: true });
    write("tree-sp/src/big.txt", "data".repeat(10_000));
    write("tree-sp/node_modules/junk.bin", "junk".repeat(50_000));

    await handle.db.insert(users).values({ id: "u1", email: "sp@example.com" });
    await handle.db.insert(projects).values({
      id: "proj-sp",
      userId: "u1",
      name: "SP",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await handle.db.insert(nodePreferences).values({
      id: "pref-sp",
      ownerId: "proj-sp",
      ownerType: "project",
      userId: "u1",
      defaultWorkingDirectory: join(fixtureRoot, "tree-sp"),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await handle.db.insert(agentProfiles).values({
      id: "prof-sp",
      userId: "u1",
      name: "P",
      provider: "claude",
      configDir: join(fixtureRoot, "profile-sp"),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    write("profile-sp/settings.json", "{}".repeat(100));
    await handle.db.insert(projectProfileLinks).values({
      projectId: "proj-sp",
      profileId: "prof-sp",
      createdAt: new Date(),
    });

    const full = await sizePreview("u1", "proj-sp", "full_tar");
    expect(full.workingTreeBytes).toBeGreaterThan(0);
    expect(full.profilesBytes).toBeGreaterThan(0);
    expect(full.totalBytes).toBeGreaterThanOrEqual(
      full.workingTreeBytes + full.profilesBytes,
    );

    const none = await sizePreview("u1", "proj-sp", "none");
    expect(none.workingTreeBytes).toBe(0);

    await expect(sizePreview("intruder", "proj-sp", "full_tar")).rejects.toThrow(
      /Project not found/,
    );
  });
});
