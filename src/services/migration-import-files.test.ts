// @vitest-environment node
/**
 * MigrationImportService file-phase tests — chunk intake (happy path, sha
 * mismatch, idempotent re-PUT, owner guard), finalize (assemble a 2-chunk
 * archive → verify → extract working tree / profiles / agent-settings,
 * REFUSE a non-empty destination), and verify's filesystem checks.
 *
 * Same harness as the stage-1 import tests: real temp-file libsql with the
 * full schema, plus a fixture $HOME so extraction targets stay inside tmp.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";

const execFile = promisify(execFileCb);

process.env.AUTH_SECRET = "migration-import-files-test-secret";

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
  initImport,
  importDb,
  receiveChunk,
  listReceivedChunks,
  finalizeImport,
  verifyImport,
  getImport,
  pruneStaleImports,
  MigrationImportError,
  type ImportBookkeeping,
} from "./migration-import-service";
import { users, profileGitIdentities, agentProfiles, migrationImports } from "@/db/schema";
import { getProjectsDir } from "@/lib/paths";
import type {
  ArchiveManifestEntry,
  BundleManifest,
  DbBundle,
  MigrationOptions,
} from "@/lib/migration-bundle";

const DEST_USER = "dest-user-1";
const JOB_ID = "22222222-2222-4222-8222-555555555555";
const SRC_PROJECT = "cccccccc-0000-4000-8000-000000000001";
const P1 = "cccccccc-0000-4000-8000-00000000p001";
const NOW = 1750000000000;

const OPTIONS: MigrationOptions = {
  workingTreeMode: "full_tar",
  includeDotEnv: true,
  includeAgentCreds: true,
  includeSshKeys: true,
  includeAgentSettings: true,
  includeChannelHistory: false,
  removeSourceAfterVerify: false,
};

function sha(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Minimal bundle: project + a pref (extraction target) + one profile. */
function makeBundle(): DbBundle {
  return {
    version: 1,
    project: {
      id: SRC_PROJECT,
      name: "Files App",
      groupId: null,
      collapsed: false,
      sortOrder: 0,
      isAutoCreated: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
    nodePreferences: [
      {
        id: "src-pref",
        ownerType: "project",
        defaultWorkingDirectory: "/Users/alice/dev/filesapp",
        defaultShell: null,
        startupCommand: null,
        theme: null,
        fontSize: null,
        fontFamily: null,
        githubRepoId: null,
        localRepoPath: null,
        defaultAgentProvider: null,
        agentProviderSettings: null,
        environmentVars: null,
        pinnedFiles: null,
        gitIdentityName: null,
        gitIdentityEmail: null,
        isSensitive: false,
      },
    ],
    tasks: [],
    taskDependencies: [],
    channelGroups: [],
    channels: [],
    peerMessages: [],
    mcpServers: [],
    agentConfigs: [],
    projectSecrets: null,
    repositoryHint: null,
    githubAccountHint: null,
    profiles: [
      {
        id: P1,
        name: "Files Profile",
        description: null,
        provider: "claude",
        isDefault: false,
        sourceConfigDir: "/src/profiles/p1",
        gitIdentity: {
          userName: "Alice",
          userEmail: "alice@example.com",
          sshKeyPath: "/src/profiles/p1/.ssh/id_ed25519",
          gpgKeyId: null,
          githubUsername: null,
        },
        appearance: null,
        jsonConfigs: [],
        secrets: null,
      },
    ],
    triggerConfigs: [],
    agentSchedules: [],
  };
}

interface FixtureArchive {
  entry: ArchiveManifestEntry;
  chunks: Buffer[];
}

/** tar.gz a fixture content dir and split it into `chunkCount` pieces. */
async function makeArchive(
  name: ArchiveManifestEntry["name"],
  contentDir: string,
  chunkCount: number,
): Promise<FixtureArchive> {
  const tarPath = join(contentDir, "..", `${name}-fixture.tar.gz`);
  await execFile("tar", ["-czf", tarPath, "-C", contentDir, "."]);
  const whole = await readFile(tarPath);
  const pieceSize = Math.ceil(whole.length / chunkCount);
  const chunks: Buffer[] = [];
  for (let i = 0; i < chunkCount; i++) {
    chunks.push(whole.subarray(i * pieceSize, Math.min((i + 1) * pieceSize, whole.length)));
  }
  return {
    entry: { name, sizeBytes: whole.length, sha256: sha(whole), chunkCount },
    chunks,
  };
}

function makeManifest(archives: ArchiveManifestEntry[]): BundleManifest {
  return {
    version: 1,
    sourceInstanceUrl: "https://source.example.com",
    sourceProjectId: SRC_PROJECT,
    sourceProjectName: "Files App",
    exportedAt: new Date(NOW).toISOString(),
    workingTreeMode: "full_tar",
    totalChunks: archives.reduce((n, a) => n + a.chunkCount, 0),
    totalBytes: archives.reduce((n, a) => n + a.sizeBytes, 0),
    agentSettingsIncluded: true,
    profileIds: [P1],
    warnings: [],
    archives,
    gitRemoteUrl: null,
    gitBranch: null,
    beadsIncluded: false,
  };
}

async function pushChunks(archive: FixtureArchive): Promise<void> {
  for (let index = 0; index < archive.chunks.length; index++) {
    await receiveChunk(DEST_USER, JOB_ID, {
      archiveName: archive.entry.name,
      chunkIndex: index,
      sha256: sha(archive.chunks[index]),
      totalChunks: archive.entry.chunkCount,
      body: archive.chunks[index],
    });
  }
}

let fixtureRoot: string;
let savedHome: string | undefined;
let savedClaudeConfigDir: string | undefined;

function write(relPath: string, content = "x"): void {
  const full = join(fixtureRoot, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

describe("MigrationImportService file phase", () => {
  beforeEach(async () => {
    handle = await createTestDb();
    fixtureRoot = handle.dir;
    process.env.RDV_DATA_DIR = join(fixtureRoot, "data");
    savedHome = process.env.HOME;
    savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.HOME = join(fixtureRoot, "home");
    mkdirSync(process.env.HOME, { recursive: true });
    delete process.env.CLAUDE_CONFIG_DIR;
    await handle.db.insert(users).values([
      { id: DEST_USER, email: "dest@example.com" },
      { id: "intruder", email: "intruder@example.com" },
    ]);
  });

  afterEach(() => {
    if (savedHome !== undefined) process.env.HOME = savedHome;
    if (savedClaudeConfigDir !== undefined) {
      process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir;
    } else {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    delete process.env.RDV_DATA_DIR;
    handle.cleanup();
  });

  async function initWithArchives(archives: ArchiveManifestEntry[]): Promise<void> {
    await initImport(DEST_USER, JOB_ID, "https://src", makeManifest(archives), OPTIONS);
    await importDb(DEST_USER, JOB_ID, makeBundle());
  }

  it("receives, verifies, assembles and extracts a 2-chunk working tree + profiles + agent settings", async () => {
    write("content/hello.txt", "hello from the source\n");
    write("content/src/deep/nested.txt", "nested");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content"), 2);

    write("profcontent/profiles/" + P1 + "/settings.json", '{"profile":true}');
    write("profcontent/profiles/" + P1 + "/.ssh/id_ed25519", "KEY");
    const profiles = await makeArchive("profiles", join(fixtureRoot, "profcontent"), 1);

    write("ascontent/agent-settings/claude/settings.json", '{"new":true}');
    const settings = await makeArchive("agent-settings", join(fixtureRoot, "ascontent"), 1);

    // Pre-existing host file → must be recorded as overwritten.
    write("home/.claude/settings.json", '{"old":true}');

    await initWithArchives([tree.entry, profiles.entry, settings.entry]);
    await pushChunks(tree);
    await pushChunks(profiles);
    await pushChunks(settings);

    const row = (await getImport(DEST_USER, JOB_ID))!;
    expect(row.status).toBe("receiving");
    expect(row.chunksReceived).toBe(4);
    expect(await listReceivedChunks(row)).toEqual({
      "working-tree": [0, 1],
      profiles: [0],
      "agent-settings": [0],
    });

    const { import: finalized, conflicts } = await finalizeImport(DEST_USER, JOB_ID);
    expect(finalized.status).toBe("completed");

    // Working tree extracted to the REWRITTEN destination: the persistent
    // projects root, getProjectsDir() = <RDV_DATA_DIR>/projects/filesapp.
    const destDir = join(getProjectsDir(), "filesapp");
    expect(readFileSync(join(destDir, "hello.txt"), "utf8")).toBe(
      "hello from the source\n",
    );
    expect(existsSync(join(destDir, "src/deep/nested.txt"))).toBe(true);

    // Profile files landed under the REMAPPED destination profile id.
    const bookkeeping = JSON.parse(finalized.optionsJson) as ImportBookkeeping;
    const newProfileId = bookkeeping.profileIdRemaps![P1];
    const profileDir = join(process.env.RDV_DATA_DIR!, "profiles", newProfileId);
    expect(readFileSync(join(profileDir, "settings.json"), "utf8")).toBe(
      '{"profile":true}',
    );
    expect(existsSync(join(profileDir, ".ssh/id_ed25519"))).toBe(true);

    // The sshKeyPath was rewritten onto the new configDir (includeSshKeys).
    const identity = await handle.db.query.profileGitIdentities.findFirst({
      where: eq(profileGitIdentities.profileId, newProfileId),
    });
    expect(identity?.sshKeyPath).toBe(join(profileDir, ".ssh/id_ed25519"));
    const profileRow = await handle.db.query.agentProfiles.findFirst({
      where: eq(agentProfiles.id, newProfileId),
    });
    expect(profileRow?.configDir).toBe(profileDir);

    // Agent settings copied into $HOME with the overwrite recorded.
    expect(readFileSync(join(process.env.HOME!, ".claude/settings.json"), "utf8")).toBe(
      '{"new":true}',
    );
    expect(
      conflicts.some(
        (c) =>
          c.type === "file_overwritten" &&
          c.detail === join(process.env.HOME!, ".claude/settings.json"),
      ),
    ).toBe(true);
    expect(bookkeeping.finalizeConflicts).toEqual(conflicts);

    // Verify: counts AND filesystem paths all present.
    const verify = await verifyImport(DEST_USER, JOB_ID);
    expect(verify.missingPaths).toEqual([]);
    expect(verify.ok).toBe(true);
  });

  it("overwrites a READ-ONLY existing agent-settings file without EACCES", async () => {
    // Agent settings can contain git repos (e.g. .claude/skills) whose
    // .git/objects/** are mode 0444; a re-migration / baked ~/.claude leaves
    // read-only targets in place. copyFile over a read-only file throws EACCES
    // — finalize must unlink first and land the new content cleanly.
    write("content_ro/file.txt", "tree");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content_ro"), 1);

    write("ascontent_ro/agent-settings/claude/settings.json", '{"new":true}');
    const settings = await makeArchive("agent-settings", join(fixtureRoot, "ascontent_ro"), 1);

    // Pre-existing READ-ONLY host file at the same dest path.
    const dest = join(process.env.HOME!, ".claude/settings.json");
    write("home/.claude/settings.json", '{"old":true}');
    const { chmodSync } = await import("node:fs");
    chmodSync(dest, 0o444);

    try {
      await initWithArchives([tree.entry, settings.entry]);
      await pushChunks(tree);
      await pushChunks(settings);

      const { import: finalized, conflicts } = await finalizeImport(DEST_USER, JOB_ID);
      expect(finalized.status).toBe("completed");
      // The read-only target was replaced with the incoming content.
      expect(readFileSync(dest, "utf8")).toBe('{"new":true}');
      expect(
        conflicts.some(
          (c) => c.type === "file_overwritten" && c.detail === dest,
        ),
      ).toBe(true);
    } finally {
      if (existsSync(dest)) chmodSync(dest, 0o644);
    }
  });

  it("rejects a chunk whose sha256 does not match (tmp cleaned)", async () => {
    write("content2/file.txt", "data");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content2"), 1);
    await initWithArchives([tree.entry]);

    await expect(
      receiveChunk(DEST_USER, JOB_ID, {
        archiveName: "working-tree",
        chunkIndex: 0,
        sha256: "0".repeat(64),
        totalChunks: 1,
        body: tree.chunks[0],
      }),
    ).rejects.toMatchObject({ status: 409, code: "CHUNK_SHA_MISMATCH" });

    const row = (await getImport(DEST_USER, JOB_ID))!;
    expect(await listReceivedChunks(row)).toEqual({});
    // No stray tmp files left in the archive dir.
    const archiveDir = join(row.stagingDir, "working-tree");
    if (existsSync(archiveDir)) {
      const { readdirSync } = await import("node:fs");
      expect(readdirSync(archiveDir)).toEqual([]);
    }
  });

  it("is idempotent on a re-PUT of the same chunk", async () => {
    write("content3/file.txt", "data");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content3"), 1);
    await initWithArchives([tree.entry]);

    const first = await receiveChunk(DEST_USER, JOB_ID, {
      archiveName: "working-tree",
      chunkIndex: 0,
      sha256: sha(tree.chunks[0]),
      totalChunks: 1,
      body: tree.chunks[0],
    });
    expect(first).toEqual({ duplicate: false, chunksReceived: 1 });

    const again = await receiveChunk(DEST_USER, JOB_ID, {
      archiveName: "working-tree",
      chunkIndex: 0,
      sha256: sha(tree.chunks[0]),
      totalChunks: 1,
      body: tree.chunks[0],
    });
    expect(again).toEqual({ duplicate: true, chunksReceived: 1 });
  });

  it("guards chunk intake and validates addressing", async () => {
    write("content4/file.txt", "data");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content4"), 1);
    await initWithArchives([tree.entry]);

    const valid = {
      archiveName: "working-tree",
      chunkIndex: 0,
      sha256: sha(tree.chunks[0]),
      totalChunks: 1,
      body: tree.chunks[0],
    };
    // Wrong user → indistinguishable from a missing import.
    await expect(receiveChunk("intruder", JOB_ID, valid)).rejects.toMatchObject({
      status: 404,
    });
    // Undeclared archive name.
    await expect(
      receiveChunk(DEST_USER, JOB_ID, { ...valid, archiveName: "profiles" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_ARCHIVE" });
    await expect(
      receiveChunk(DEST_USER, JOB_ID, { ...valid, archiveName: "../evil" }),
    ).rejects.toMatchObject({ code: "UNKNOWN_ARCHIVE" });
    // Wrong totals / out-of-range index.
    await expect(
      receiveChunk(DEST_USER, JOB_ID, { ...valid, totalChunks: 5 }),
    ).rejects.toMatchObject({ code: "CHUNK_TOTAL_MISMATCH" });
    await expect(
      receiveChunk(DEST_USER, JOB_ID, { ...valid, chunkIndex: 9 }),
    ).rejects.toMatchObject({ code: "CHUNK_INDEX_OUT_OF_RANGE" });
  });

  it("refuses to finalize with missing chunks", async () => {
    write("content5/file.txt", "data");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content5"), 2);
    await initWithArchives([tree.entry]);
    // Only chunk 0 of 2 arrives.
    await receiveChunk(DEST_USER, JOB_ID, {
      archiveName: "working-tree",
      chunkIndex: 0,
      sha256: sha(tree.chunks[0]),
      totalChunks: 2,
      body: tree.chunks[0],
    });

    await expect(finalizeImport(DEST_USER, JOB_ID)).rejects.toMatchObject({
      code: "CHUNKS_INCOMPLETE",
    });
    expect((await getImport(DEST_USER, JOB_ID))?.status).toBe("failed");
  });

  it("REFUSES to extract into a non-empty destination directory", async () => {
    write("content6/file.txt", "incoming");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content6"), 1);
    await initWithArchives([tree.entry]);
    await pushChunks(tree);

    // The destination working dir already has user files in it.
    const destDir = join(getProjectsDir(), "filesapp");
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, "precious.txt"), "do not clobber");

    await expect(finalizeImport(DEST_USER, JOB_ID)).rejects.toMatchObject({
      code: "DEST_DIR_NOT_EMPTY",
    });
    const row = (await getImport(DEST_USER, JOB_ID))!;
    expect(row.status).toBe("failed");
    // Existing files untouched; the refusal is recorded as a conflict.
    expect(readFileSync(join(destDir, "precious.txt"), "utf8")).toBe("do not clobber");
    const bookkeeping = JSON.parse(row.optionsJson) as ImportBookkeeping;
    expect(bookkeeping.finalizeConflicts?.some((c) => c.type === "dest_dir_not_empty")).toBe(
      true,
    );
    // Verify reflects the missing extraction.
    const verify = await verifyImport(DEST_USER, JOB_ID);
    expect(verify.ok).toBe(false);
  });

  it("fails finalize when the assembled archive hash does not match the manifest", async () => {
    write("content7/file.txt", "data");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content7"), 1);
    // Lie about the whole-archive hash in the manifest.
    const badEntry = { ...tree.entry, sha256: "f".repeat(64) };
    await initWithArchives([badEntry]);
    await receiveChunk(DEST_USER, JOB_ID, {
      archiveName: "working-tree",
      chunkIndex: 0,
      sha256: sha(tree.chunks[0]),
      totalChunks: 1,
      body: tree.chunks[0],
    });
    await expect(finalizeImport(DEST_USER, JOB_ID)).rejects.toMatchObject({
      code: "ARCHIVE_SHA_MISMATCH",
    });
  });

  it("streams async-iterable bodies (web-stream shape)", async () => {
    write("content8/file.txt", "streamed-content");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content8"), 1);
    await initWithArchives([tree.entry]);

    async function* stream(): AsyncIterable<Uint8Array> {
      const data = tree.chunks[0];
      // Deliver in two pieces to exercise the streaming path.
      yield data.subarray(0, Math.floor(data.length / 2));
      yield data.subarray(Math.floor(data.length / 2));
    }
    const result = await receiveChunk(DEST_USER, JOB_ID, {
      archiveName: "working-tree",
      chunkIndex: 0,
      sha256: sha(tree.chunks[0]),
      totalChunks: 1,
      body: stream(),
    });
    expect(result.duplicate).toBe(false);

    const { import: finalized } = await finalizeImport(DEST_USER, JOB_ID);
    expect(finalized.status).toBe("completed");
    expect(MigrationImportError).toBeDefined();
  });

  it("lets exactly ONE of two concurrent finalize calls run (atomic claim)", async () => {
    write("content9/file.txt", "claimed");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content9"), 1);
    await initWithArchives([tree.entry]);
    await pushChunks(tree);

    const [a, b] = await Promise.allSettled([
      finalizeImport(DEST_USER, JOB_ID),
      finalizeImport(DEST_USER, JOB_ID),
    ]);
    const outcomes = [a, b];
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    // One winner extracts; the loser gets a clean 409 (claim or precheck,
    // depending on interleaving) — never a double extraction or a crash.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = (rejected[0] as PromiseRejectedResult).reason as MigrationImportError;
    expect(error).toBeInstanceOf(MigrationImportError);
    expect(error.status).toBe(409);
    expect((await getImport(DEST_USER, JOB_ID))?.status).toBe("completed");
  });

  it("rejects finalize while another finalize holds the claim", async () => {
    write("content10/file.txt", "in-flight");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "content10"), 1);
    await initWithArchives([tree.entry]);
    await pushChunks(tree);

    // Simulate an in-flight finalize holding the claim.
    await handle.db
      .update(migrationImports)
      .set({ status: "finalizing" })
      .where(eq(migrationImports.id, JOB_ID));

    await expect(finalizeImport(DEST_USER, JOB_ID)).rejects.toMatchObject({ status: 409 });
    // The in-flight claim is untouched (not flipped to failed by the loser).
    expect((await getImport(DEST_USER, JOB_ID))?.status).toBe("finalizing");

    // And a chunk arriving mid-finalize is rejected too: the file set must
    // stop changing once assembly starts.
    await expect(
      receiveChunk(DEST_USER, JOB_ID, {
        archiveName: "working-tree",
        chunkIndex: 0,
        sha256: "0".repeat(64),
        totalChunks: 1,
        body: Buffer.from("late"),
      }),
    ).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  it("pruneStaleImports fails non-terminal imports older than 2h and reclaims their staging dir", async () => {
    write("contentp/file.txt", "abandoned");
    const tree = await makeArchive("working-tree", join(fixtureRoot, "contentp"), 1);
    await initWithArchives([tree.entry]);
    await pushChunks(tree); // status → receiving, staging dir populated

    const row = (await getImport(DEST_USER, JOB_ID))!;
    expect(row.status).toBe("receiving");
    expect(existsSync(row.stagingDir)).toBe(true);

    // Not yet stale → no-op.
    expect(await pruneStaleImports()).toBe(0);
    expect((await getImport(DEST_USER, JOB_ID))?.status).toBe("receiving");

    // Backdate it past the 2h cutoff.
    await handle.db
      .update(migrationImports)
      .set({ updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) })
      .where(eq(migrationImports.id, JOB_ID));

    expect(await pruneStaleImports()).toBe(1);
    expect((await getImport(DEST_USER, JOB_ID))?.status).toBe("failed");
    // Staging dir reclaimed.
    expect(existsSync(row.stagingDir)).toBe(false);

    // A completed import is never touched.
    const DONE_ID = "33333333-3333-4333-8333-555555555555";
    await initImport(DEST_USER, DONE_ID, "https://src", makeManifest([]), OPTIONS);
    await importDb(DEST_USER, DONE_ID, makeBundle());
    await finalizeImport(DEST_USER, DONE_ID); // DB-only → completed
    await handle.db
      .update(migrationImports)
      .set({ updatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000) })
      .where(eq(migrationImports.id, DONE_ID));
    expect(await pruneStaleImports()).toBe(0);
    expect((await getImport(DEST_USER, DONE_ID))?.status).toBe("completed");
  });
});
