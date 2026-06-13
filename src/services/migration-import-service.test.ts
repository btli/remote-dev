// @vitest-environment node
/**
 * MigrationImportService tests — the destination-side DB import: FK-safe
 * ordering, id remapping (project collision, tasks/channels/messages),
 * node-preference upsert + working-directory rewrite, secrets re-encryption
 * under the destination AUTH_SECRET, schedules/triggers force-disabled,
 * verify recounts, and rollback.
 *
 * Real temp-file libsql with the FULL schema (generated from the real
 * dialect module — see migration-test-db.ts), `@/db` mocked to point at it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";

// Deterministic encryption key for the re-encryption round-trip assertions.
process.env.AUTH_SECRET = "migration-import-test-secret";

import { createTestDb, type TestDbHandle } from "./__tests__/migration-test-db";

let handle: TestDbHandle;

vi.mock("@/db", () => ({
  get db() {
    return handle.db;
  },
}));
// Keep the import graph light: the logger pulls in the SQLite log sidecar.
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
  finalizeImport,
  verifyImport,
  rollbackImport,
  getImport,
  type ImportBookkeeping,
} from "./migration-import-service";
import { decrypt } from "@/lib/encryption";
import {
  users,
  projects,
  nodePreferences,
  projectTasks,
  taskDependencies,
  agentPeerMessages,
  agentProfiles,
  profileSecretsConfig,
  projectSecretsConfig,
  agentSchedules,
  triggerConfigs,
  channels,
} from "@/db/schema";
import type { BundleManifest, DbBundle, MigrationOptions } from "@/lib/migration-bundle";

const DEST_USER = "dest-user-1";
const JOB_ID = "11111111-2222-4333-8444-555555555555";
const SRC_PROJECT = "aaaaaaaa-0000-4000-8000-000000000001";
const T1 = "aaaaaaaa-0000-4000-8000-00000000t001";
const T2 = "aaaaaaaa-0000-4000-8000-00000000t002";
const G1 = "aaaaaaaa-0000-4000-8000-00000000g001";
const C1 = "aaaaaaaa-0000-4000-8000-00000000c001";
const M1 = "aaaaaaaa-0000-4000-8000-00000000m001";
const M2 = "aaaaaaaa-0000-4000-8000-00000000m002";
const P1 = "aaaaaaaa-0000-4000-8000-00000000p001";
const NOW = 1750000000000;

const OPTIONS: MigrationOptions = {
  workingTreeMode: "full_tar",
  includeDotEnv: true,
  includeAgentCreds: true,
  includeSshKeys: false,
  includeAgentSettings: true,
  includeChannelHistory: true,
  removeSourceAfterVerify: false,
};

function makeManifest(): BundleManifest {
  return {
    version: 1,
    sourceInstanceUrl: "https://source.example.com",
    sourceProjectId: SRC_PROJECT,
    sourceProjectName: "My App",
    exportedAt: new Date(NOW).toISOString(),
    workingTreeMode: "full_tar",
    totalChunks: 0,
    totalBytes: 0,
    agentSettingsIncluded: true,
    profileIds: [P1],
    warnings: [],
  };
}

function makeBundle(): DbBundle {
  return {
    version: 1,
    project: {
      id: SRC_PROJECT,
      name: "My App",
      groupId: "src-group-1",
      collapsed: false,
      sortOrder: 3,
      isAutoCreated: false,
      createdAt: NOW,
      updatedAt: NOW,
    },
    nodePreferences: [
      {
        id: "src-pref-1",
        ownerType: "project",
        defaultWorkingDirectory: "/Users/alice/dev/myapp",
        defaultShell: "/bin/zsh",
        startupCommand: "bun run dev",
        theme: "tokyo-night",
        fontSize: 14,
        fontFamily: null,
        githubRepoId: null,
        localRepoPath: "/Users/alice/dev/myapp",
        defaultAgentProvider: "claude",
        agentProviderSettings: { claude: { model: "opus" } },
        environmentVars: { FOO: "bar" },
        pinnedFiles: ["README.md"],
        gitIdentityName: "Alice",
        gitIdentityEmail: "alice@example.com",
        isSensitive: false,
      },
    ],
    tasks: [
      {
        id: T1,
        title: "Blocker task",
        description: null,
        status: "open",
        priority: "high",
        source: "manual",
        labels: "[]",
        subtasks: "[]",
        metadata: "{}",
        instructions: null,
        agentTaskKey: null,
        owner: null,
        dueDate: null,
        githubIssueUrl: null,
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: T2,
        title: "Blocked task",
        description: "depends on T1",
        status: "open",
        priority: "medium",
        source: "manual",
        labels: "[]",
        subtasks: "[]",
        metadata: "{}",
        instructions: null,
        agentTaskKey: null,
        owner: null,
        dueDate: NOW,
        githubIssueUrl: null,
        sortOrder: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    taskDependencies: [{ blockerId: T1, blockedId: T2 }],
    channelGroups: [{ id: G1, name: "Channels", position: 0, createdAt: NOW }],
    channels: [
      {
        id: C1,
        groupId: G1,
        name: "general",
        displayName: "#general",
        type: "public",
        topic: null,
        isDefault: true,
        lastMessageAt: NOW,
        messageCount: 2,
        archivedAt: null,
        createdAt: NOW,
      },
    ],
    peerMessages: [
      {
        id: M1,
        fromSessionName: "agent-a",
        body: "hello",
        isUserMessage: false,
        channelId: C1,
        parentMessageId: null,
        replyCount: 1,
        createdAt: NOW,
      },
      {
        id: M2,
        fromSessionName: "agent-b",
        body: "hi back",
        isUserMessage: false,
        channelId: C1,
        parentMessageId: M1,
        replyCount: 0,
        createdAt: NOW + 1000,
      },
    ],
    mcpServers: [
      {
        name: "browser",
        transport: "stdio",
        command: "bunx",
        args: '["mcp-browser"]',
        env: "{}",
        enabled: true,
        autoStart: false,
      },
    ],
    agentConfigs: [
      { provider: "claude", configType: "CLAUDE.md", content: "# Project notes" },
    ],
    projectSecrets: {
      provider: "phase",
      providerConfigPlain: { API_KEY: "sk-plain-123" },
      enabled: true,
    },
    repositoryHint: null,
    githubAccountHint: null,
    profiles: [
      {
        id: P1,
        name: "Work",
        description: "work profile",
        provider: "claude",
        isDefault: true,
        gitIdentity: {
          userName: "Alice",
          userEmail: "alice@example.com",
          sshKeyPath: null,
          gpgKeyId: null,
          githubUsername: "alice",
        },
        appearance: {
          appearanceMode: "system",
          lightColorScheme: "ocean",
          darkColorScheme: "midnight",
          terminalOpacity: 100,
          terminalBlur: 0,
          terminalCursorStyle: "block",
        },
        jsonConfigs: [
          {
            agentType: "claude",
            configJson: '{"theme":"dark"}',
            isValid: true,
            validationErrors: null,
          },
        ],
        secrets: {
          provider: "phase",
          providerConfigPlain: { TOKEN: "tok-plain-456" },
          enabled: true,
        },
      },
    ],
    triggerConfigs: [
      {
        name: "fix-on-label",
        kind: "pr_labeled",
        filter: '{"label":"agent:fix"}',
        agentProvider: "claude",
        agentFlags: "[]",
        promptTemplate: "fix {{repo}}",
        worktreeType: null,
        enabled: true,
        githubRepoHint: null,
      },
    ],
    agentSchedules: [
      {
        name: "nightly",
        agentProvider: "claude",
        agentFlags: "[]",
        prompt: "run nightly checks",
        worktreeType: null,
        baseBranch: null,
        scheduleType: "recurring",
        cronExpression: "0 2 * * *",
        scheduledAt: null,
        timezone: "UTC",
        maxRetries: 0,
        enabled: true,
      },
    ],
  };
}

async function initAndImport(bundle = makeBundle()) {
  await initImport(DEST_USER, JOB_ID, "https://source.example.com", makeManifest(), OPTIONS);
  return importDb(DEST_USER, JOB_ID, bundle);
}

describe("MigrationImportService", () => {
  beforeEach(async () => {
    handle = await createTestDb();
    process.env.RDV_DATA_DIR = handle.dir;
    // This libsql build ENFORCES foreign keys, which makes these tests a real
    // FK-ordering proof — seed the user rows everything hangs off.
    await handle.db.insert(users).values([
      { id: DEST_USER, email: "dest@example.com" },
      { id: "someone-else", email: "other@example.com" },
    ]);
  });

  afterEach(() => {
    delete process.env.RDV_DATA_DIR;
    handle.cleanup();
  });

  it("imports a full bundle, keeping a free project id and remapping children", async () => {
    const result = await initAndImport();

    // Free id → kept verbatim.
    expect(result.importedProjectId).toBe(SRC_PROJECT);

    const project = await handle.db.query.projects.findFirst({
      where: eq(projects.id, SRC_PROJECT),
    });
    expect(project?.userId).toBe(DEST_USER);
    expect(project?.groupId).toBeNull(); // imported to root
    expect(result.conflicts.some((c) => c.type === "group_not_migrated")).toBe(true);

    // Tasks: fresh ids, host-bound session refs nulled.
    const tasks = await handle.db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, SRC_PROJECT));
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.sessionId === null)).toBe(true);
    expect(tasks.map((t) => t.id)).not.toContain(T1);

    // Dependency edge remapped to the fresh task ids.
    const deps = await handle.db.select().from(taskDependencies);
    expect(deps).toHaveLength(1);
    expect(deps[0].blockerId).toBe(result.idRemaps[T1]);
    expect(deps[0].blockedId).toBe(result.idRemaps[T2]);

    // Threaded message remap: parent + channel both rewritten.
    const reply = await handle.db.query.agentPeerMessages.findFirst({
      where: eq(agentPeerMessages.id, result.idRemaps[M2]),
    });
    expect(reply?.parentMessageId).toBe(result.idRemaps[M1]);
    expect(reply?.channelId).toBe(result.idRemaps[C1]);
    expect(reply?.fromSessionId).toBeNull();

    // Channel rows landed under the new project with remapped group.
    const channel = await handle.db.query.channels.findFirst({
      where: eq(channels.id, result.idRemaps[C1]),
    });
    expect(channel?.groupId).toBe(result.idRemaps[G1]);

    // Schedules: force-disabled + paused, no next run (no double cron firing).
    const [schedule] = await handle.db
      .select()
      .from(agentSchedules)
      .where(eq(agentSchedules.projectId, SRC_PROJECT));
    expect(schedule.enabled).toBe(false);
    expect(schedule.status).toBe("paused");
    expect(schedule.nextRunAt).toBeNull();
    expect(result.conflicts.some((c) => c.type === "schedule_disabled")).toBe(true);

    // Triggers: force-disabled pending review.
    const [trigger] = await handle.db
      .select()
      .from(triggerConfigs)
      .where(eq(triggerConfigs.projectId, SRC_PROJECT));
    expect(trigger.enabled).toBe(false);

    // Working directory rewritten to this host's ~/projects/<basename>.
    const [pref] = await handle.db
      .select()
      .from(nodePreferences)
      .where(
        and(eq(nodePreferences.ownerId, SRC_PROJECT), eq(nodePreferences.userId, DEST_USER)),
      );
    const expectedDir = join(homedir(), "projects", "myapp");
    expect(pref.defaultWorkingDirectory).toBe(expectedDir);
    expect(pref.localRepoPath).toBe(expectedDir);

    // …and the source→dest path map is recorded for stage 2.
    const row = await getImport(DEST_USER, JOB_ID);
    const bookkeeping = JSON.parse(row!.optionsJson) as ImportBookkeeping;
    expect(bookkeeping.pathMap?.["/Users/alice/dev/myapp"]).toBe(expectedDir);
    expect(bookkeeping.expectedRowCounts?.tasks).toBe(2);

    // Profile: fresh uuid, configDir keyed by it, never imported as default.
    const newProfileId = result.idRemaps[P1];
    expect(newProfileId).toBeDefined();
    const profile = await handle.db.query.agentProfiles.findFirst({
      where: eq(agentProfiles.id, newProfileId),
    });
    expect(profile?.isDefault).toBe(false);
    expect(profile?.configDir.endsWith(newProfileId)).toBe(true);

    // Secrets re-encrypted under THIS instance's AUTH_SECRET:
    // ciphertext differs from plaintext but decrypts to the original config.
    const profileSecrets = await handle.db.query.profileSecretsConfig.findFirst({
      where: eq(profileSecretsConfig.profileId, newProfileId),
    });
    expect(profileSecrets?.providerConfig).not.toContain("tok-plain-456");
    expect(JSON.parse(decrypt(profileSecrets!.providerConfig))).toEqual({
      TOKEN: "tok-plain-456",
    });

    const projSecrets = await handle.db.query.projectSecretsConfig.findFirst({
      where: eq(projectSecretsConfig.projectId, SRC_PROJECT),
    });
    // json-mode column round-trips the encrypted string.
    const storedCipher = projSecrets!.providerConfig as unknown as string;
    expect(typeof storedCipher).toBe("string");
    expect(storedCipher).not.toContain("sk-plain-123");
    expect(JSON.parse(decrypt(storedCipher))).toEqual({ API_KEY: "sk-plain-123" });

    expect(result.rowCounts).toMatchObject({
      project: 1,
      tasks: 2,
      taskDependencies: 1,
      channelGroups: 1,
      channels: 1,
      peerMessages: 2,
      mcpServers: 1,
      agentConfigs: 1,
      projectSecrets: 1,
      profiles: 1,
      agentSchedules: 1,
      triggerConfigs: 1,
    });
  });

  it("remaps the project id when it collides on the destination", async () => {
    await handle.db.insert(projects).values({
      id: SRC_PROJECT,
      userId: "someone-else",
      groupId: null,
      name: "Pre-existing",
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    });

    const result = await initAndImport();

    expect(result.importedProjectId).not.toBe(SRC_PROJECT);
    expect(result.idRemaps[SRC_PROJECT]).toBe(result.importedProjectId);
    expect(result.conflicts.some((c) => c.type === "project_id_collision")).toBe(true);

    // Children attach to the REMAPPED id, untouched original stays intact.
    const tasks = await handle.db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.projectId, result.importedProjectId));
    expect(tasks).toHaveLength(2);
    const original = await handle.db.query.projects.findFirst({
      where: eq(projects.id, SRC_PROJECT),
    });
    expect(original?.name).toBe("Pre-existing");
  });

  it("suffixes the working directory when another project already uses it", async () => {
    const contested = join(homedir(), "projects", "myapp");
    await handle.db.insert(nodePreferences).values({
      id: "other-pref",
      ownerId: "other-project",
      ownerType: "project",
      userId: "someone-else",
      defaultWorkingDirectory: contested,
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    });

    const result = await initAndImport();

    const [pref] = await handle.db
      .select()
      .from(nodePreferences)
      .where(
        and(
          eq(nodePreferences.ownerId, result.importedProjectId),
          eq(nodePreferences.userId, DEST_USER),
        ),
      );
    expect(pref.defaultWorkingDirectory).toBe(join(homedir(), "projects", "myapp-2"));
  });

  it("upserts node preferences on (ownerId, ownerType, userId)", async () => {
    await handle.db.insert(nodePreferences).values({
      id: "pre-existing-pref",
      ownerId: SRC_PROJECT,
      ownerType: "project",
      userId: DEST_USER,
      theme: "stale-theme",
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
    });

    await initAndImport();

    const prefs = await handle.db
      .select()
      .from(nodePreferences)
      .where(
        and(
          eq(nodePreferences.ownerId, SRC_PROJECT),
          eq(nodePreferences.ownerType, "project"),
          eq(nodePreferences.userId, DEST_USER),
        ),
      );
    expect(prefs).toHaveLength(1);
    // Upsert preserved the existing PK but applied the bundle values.
    expect(prefs[0].id).toBe("pre-existing-pref");
    expect(prefs[0].theme).toBe("tokyo-night");
    expect(prefs[0].startupCommand).toBe("bun run dev");
  });

  it("verifies row counts and flags drift", async () => {
    const result = await initAndImport();

    const ok = await verifyImport(DEST_USER, JOB_ID);
    expect(ok.ok).toBe(true);
    expect(ok.rowCounts.tasks).toBe(2);
    expect(ok.missingPaths).toEqual([]);

    await handle.db.delete(projectTasks).where(eq(projectTasks.id, result.idRemaps[T1]));
    const drifted = await verifyImport(DEST_USER, JOB_ID);
    expect(drifted.ok).toBe(false);
  });

  it("finalizes only a db-imported row, then completes", async () => {
    await initImport(DEST_USER, JOB_ID, "https://src", makeManifest(), OPTIONS);
    await expect(finalizeImport(DEST_USER, JOB_ID)).rejects.toThrow(/cannot be finalized/);

    await importDb(DEST_USER, JOB_ID, makeBundle());
    const finalized = await finalizeImport(DEST_USER, JOB_ID);
    expect(finalized.status).toBe("completed");
  });

  it("rolls back everything the import created", async () => {
    const result = await initAndImport();
    const stagingDir = (await getImport(DEST_USER, JOB_ID))!.stagingDir;
    expect(existsSync(stagingDir)).toBe(true);

    await rollbackImport(DEST_USER, JOB_ID);

    const project = await handle.db.query.projects.findFirst({
      where: eq(projects.id, result.importedProjectId),
    });
    expect(project).toBeUndefined();
    const profile = await handle.db.query.agentProfiles.findFirst({
      where: eq(agentProfiles.id, result.idRemaps[P1]),
    });
    expect(profile).toBeUndefined();
    expect(existsSync(stagingDir)).toBe(false);
    expect((await getImport(DEST_USER, JOB_ID))?.status).toBe("failed");
  });

  it("rejects import ids that are unsafe as a path component", async () => {
    await expect(
      initImport(DEST_USER, "../evil", "https://src", makeManifest(), OPTIONS),
    ).rejects.toThrow(/Invalid import id/);
  });

  it("marks the import failed when the bundle does not validate", async () => {
    await initImport(DEST_USER, JOB_ID, "https://src", makeManifest(), OPTIONS);
    const broken = { ...makeBundle(), project: undefined } as unknown as DbBundle;
    await expect(importDb(DEST_USER, JOB_ID, broken)).rejects.toThrow(/Invalid DB bundle/);
    expect((await getImport(DEST_USER, JOB_ID))?.status).toBe("failed");
  });
});
