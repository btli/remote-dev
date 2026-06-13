// @vitest-environment node
/**
 * MigrationExportService tests — bundle shape (validated against the wire
 * schema), secrets decryption for transport, GitHub relink hints,
 * cross-project dependency filtering, and the include* option gating
 * (channel history / agent settings / agent creds).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

process.env.AUTH_SECRET = "migration-export-test-secret";

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

import { buildDbBundle } from "./migration-export-service";
import { encrypt } from "@/lib/encryption";
import { dbBundleSchema, type MigrationOptions } from "@/lib/migration-bundle";
import {
  users,
  projects,
  nodePreferences,
  projectTasks,
  taskDependencies,
  channelGroups,
  channels,
  agentPeerMessages,
  mcpServers,
  agentConfigs,
  projectSecretsConfig,
  githubRepositories,
  projectRepositories,
  githubAccountMetadata,
  projectGitHubAccountLinks,
  agentProfiles,
  projectProfileLinks,
  profileGitIdentities,
  agentProfileJsonConfigs,
  profileSecretsConfig,
  triggerConfigs,
  agentSchedules,
} from "@/db/schema";

const USER = "src-user-1";
const PROJECT = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_PROJECT = "bbbbbbbb-0000-4000-8000-000000000002";
const PROFILE = "bbbbbbbb-0000-4000-8000-00000000p001";
const REPO = "bbbbbbbb-0000-4000-8000-00000000r001";
const NOW = new Date(1750000000000);

const OPTIONS: MigrationOptions = {
  workingTreeMode: "full_tar",
  includeDotEnv: true,
  includeAgentCreds: true,
  includeSshKeys: false,
  includeAgentSettings: true,
  includeChannelHistory: false,
  removeSourceAfterVerify: false,
};

async function seedSourceProject(): Promise<void> {
  const db = handle.db;
  await db.insert(users).values({ id: USER, email: "src@example.com" });
  await db.insert(projects).values([
    { id: PROJECT, userId: USER, name: "Exported App", createdAt: NOW, updatedAt: NOW },
    { id: OTHER_PROJECT, userId: USER, name: "Other", createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(nodePreferences).values({
    id: "pref-1",
    ownerId: PROJECT,
    ownerType: "project",
    userId: USER,
    defaultWorkingDirectory: "/Users/src/dev/exported-app",
    startupCommand: "bun dev",
    environmentVars: { FOO: "bar" },
    createdAt: NOW,
    updatedAt: NOW,
  });

  // Tasks: two in-project + one in another project, with an edge that leaves
  // the project (must be filtered out of the bundle).
  await db.insert(projectTasks).values([
    { id: "task-1", userId: USER, projectId: PROJECT, title: "A", createdAt: NOW, updatedAt: NOW },
    { id: "task-2", userId: USER, projectId: PROJECT, title: "B", createdAt: NOW, updatedAt: NOW },
    { id: "task-out", userId: USER, projectId: OTHER_PROJECT, title: "Out", createdAt: NOW, updatedAt: NOW },
  ]);
  await db.insert(taskDependencies).values([
    { blockerId: "task-1", blockedId: "task-2" },
    { blockerId: "task-1", blockedId: "task-out" }, // crosses the project boundary
  ]);

  await db.insert(channelGroups).values({
    id: "group-1",
    projectId: PROJECT,
    name: "Channels",
    createdAt: NOW,
  });
  await db.insert(channels).values({
    id: "channel-1",
    projectId: PROJECT,
    groupId: "group-1",
    name: "general",
    displayName: "#general",
    createdAt: NOW,
  });
  await db.insert(agentPeerMessages).values([
    {
      id: "msg-1",
      projectId: PROJECT,
      fromSessionName: "agent-a",
      body: "hello",
      channelId: "channel-1",
      createdAt: NOW,
    },
    {
      id: "msg-2",
      projectId: PROJECT,
      fromSessionName: "agent-b",
      body: "reply",
      channelId: "channel-1",
      parentMessageId: "msg-1",
      createdAt: NOW,
    },
  ]);

  await db.insert(mcpServers).values({
    id: "mcp-1",
    userId: USER,
    projectId: PROJECT,
    name: "browser",
    command: "bunx mcp",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(agentConfigs).values({
    id: "cfg-1",
    userId: USER,
    projectId: PROJECT,
    provider: "claude",
    configType: "CLAUDE.md",
    content: "# Notes",
    createdAt: NOW,
    updatedAt: NOW,
  });

  // Secrets stored ENCRYPTED (current write path of the secrets services).
  await db.insert(projectSecretsConfig).values({
    id: "psec-1",
    userId: USER,
    projectId: PROJECT,
    provider: "phase",
    providerConfig: encrypt(JSON.stringify({ API_KEY: "sk-project-secret" })),
    createdAt: NOW,
    updatedAt: NOW,
  });

  // GitHub repo + account links → exported as HINTS only.
  await db.insert(githubRepositories).values({
    id: REPO,
    userId: USER,
    githubId: 4242,
    name: "exported-app",
    fullName: "alice/exported-app",
    cloneUrl: "https://github.com/alice/exported-app.git",
    defaultBranch: "main",
    addedAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(projectRepositories).values({
    id: "pr-link-1",
    projectId: PROJECT,
    repositoryId: REPO,
    userId: USER,
    createdAt: NOW,
  });
  await db.insert(githubAccountMetadata).values({
    providerAccountId: "gh-12345",
    userId: USER,
    login: "alice",
    avatarUrl: "https://example.com/a.png",
    configDir: "/tmp/gh",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(projectGitHubAccountLinks).values({
    projectId: PROJECT,
    providerAccountId: "gh-12345",
    createdAt: NOW,
  });

  // Linked profile + satellites + encrypted profile secrets.
  await db.insert(agentProfiles).values({
    id: PROFILE,
    userId: USER,
    name: "Work",
    provider: "claude",
    configDir: `/tmp/profiles/${PROFILE}`,
    isDefault: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(projectProfileLinks).values({
    projectId: PROJECT,
    profileId: PROFILE,
    createdAt: NOW,
  });
  await db.insert(profileGitIdentities).values({
    id: "git-1",
    profileId: PROFILE,
    userName: "Alice",
    userEmail: "alice@example.com",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(agentProfileJsonConfigs).values({
    id: "json-1",
    profileId: PROFILE,
    userId: USER,
    agentType: "claude",
    configJson: '{"theme":"dark"}',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(profileSecretsConfig).values({
    id: "prof-sec-1",
    profileId: PROFILE,
    userId: USER,
    provider: "phase",
    providerConfig: encrypt(JSON.stringify({ TOKEN: "tok-profile-secret" })),
    createdAt: NOW,
    updatedAt: NOW,
  });

  await db.insert(triggerConfigs).values({
    id: "trig-1",
    userId: USER,
    projectId: PROJECT,
    githubRepoId: REPO,
    name: "fix-on-label",
    kind: "pr_labeled",
    promptTemplate: "fix {{repo}}",
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(agentSchedules).values({
    id: "sched-1",
    userId: USER,
    projectId: PROJECT,
    name: "nightly",
    prompt: "run checks",
    cronExpression: "0 2 * * *",
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("MigrationExportService", () => {
  beforeEach(async () => {
    handle = await createTestDb();
    await seedSourceProject();
  });

  afterEach(() => {
    handle.cleanup();
  });

  it("builds a wire-valid bundle with decrypted secrets and relink hints", async () => {
    const { bundle, warnings } = await buildDbBundle(USER, PROJECT, OPTIONS);

    // The bundle must satisfy its own import-boundary schema.
    const parsed = dbBundleSchema.safeParse(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    expect(warnings).toEqual([]);

    expect(bundle.project).toMatchObject({ id: PROJECT, name: "Exported App" });
    expect(bundle.nodePreferences).toHaveLength(1);
    expect(bundle.nodePreferences[0].environmentVars).toEqual({ FOO: "bar" });
    expect(bundle.tasks).toHaveLength(2);

    // The cross-project dependency edge is filtered; the in-project one stays.
    expect(bundle.taskDependencies).toEqual([{ blockerId: "task-1", blockedId: "task-2" }]);

    // Secrets travel DECRYPTED (destination re-encrypts with its own key).
    expect(bundle.projectSecrets?.providerConfigPlain).toEqual({
      API_KEY: "sk-project-secret",
    });
    expect(bundle.profiles).toHaveLength(1);
    expect(bundle.profiles[0].secrets?.providerConfigPlain).toEqual({
      TOKEN: "tok-profile-secret",
    });
    expect(bundle.profiles[0].isDefault).toBe(true);
    expect(bundle.profiles[0].gitIdentity?.userName).toBe("Alice");
    expect(bundle.profiles[0].jsonConfigs).toHaveLength(1);

    // GitHub linkage ships as HINTS only — ids + names, never tokens.
    expect(bundle.repositoryHint).toEqual({ githubId: 4242, fullName: "alice/exported-app" });
    expect(bundle.githubAccountHint).toEqual({
      providerAccountId: "gh-12345",
      login: "alice",
    });
    expect(bundle.triggerConfigs[0].githubRepoHint).toEqual({
      githubId: 4242,
      fullName: "alice/exported-app",
    });
    expect(JSON.stringify(bundle)).not.toContain("ghp_");

    expect(bundle.agentSchedules[0]).toMatchObject({
      name: "nightly",
      cronExpression: "0 2 * * *",
      enabled: true,
    });
  });

  it("gates channel history on includeChannelHistory", async () => {
    const withoutHistory = await buildDbBundle(USER, PROJECT, OPTIONS);
    expect(withoutHistory.bundle.channels).toHaveLength(1);
    expect(withoutHistory.bundle.peerMessages).toEqual([]);

    const withHistory = await buildDbBundle(USER, PROJECT, {
      ...OPTIONS,
      includeChannelHistory: true,
    });
    expect(withHistory.bundle.peerMessages).toHaveLength(2);
    expect(withHistory.bundle.peerMessages.map((m) => m.id).sort()).toEqual([
      "msg-1",
      "msg-2",
    ]);
  });

  it("gates agent settings and creds on their options", async () => {
    const { bundle, warnings } = await buildDbBundle(USER, PROJECT, {
      ...OPTIONS,
      includeAgentSettings: false,
      includeAgentCreds: false,
    });
    expect(bundle.agentConfigs).toEqual([]);
    expect(bundle.profiles[0].jsonConfigs).toEqual([]);
    expect(bundle.projectSecrets).toBeNull();
    expect(bundle.profiles[0].secrets).toBeNull();
    expect(warnings.some((w) => w.includes("includeAgentSettings"))).toBe(true);
  });

  it("rejects a project the caller does not own", async () => {
    await expect(buildDbBundle("intruder", PROJECT, OPTIONS)).rejects.toThrow(
      /Project not found/,
    );
  });

  it("exports cleanly when optional satellites are absent", async () => {
    // A second bare project: no prefs/tasks/channels/links/secrets at all.
    await handle.db.insert(projects).values({
      id: "bare-project",
      userId: USER,
      name: "Bare",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const { bundle } = await buildDbBundle(USER, "bare-project", OPTIONS);
    expect(bundle.tasks).toEqual([]);
    expect(bundle.projectSecrets).toBeNull();
    expect(bundle.repositoryHint).toBeNull();
    expect(bundle.githubAccountHint).toBeNull();
    expect(bundle.profiles).toEqual([]);
    const parsed = dbBundleSchema.safeParse(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.success).toBe(true);
  });
});

// Verify the channel read uses the projectId column (catch accidental
// cross-project leakage through the shared channel tables).
describe("MigrationExportService scoping", () => {
  beforeEach(async () => {
    handle = await createTestDb();
    await seedSourceProject();
  });
  afterEach(() => handle.cleanup());

  it("does not leak rows from other projects", async () => {
    await handle.db.insert(channelGroups).values({
      id: "other-group",
      projectId: OTHER_PROJECT,
      name: "Other",
      createdAt: NOW,
    });
    await handle.db.insert(channels).values({
      id: "other-channel",
      projectId: OTHER_PROJECT,
      groupId: "other-group",
      name: "other",
      displayName: "#other",
      createdAt: NOW,
    });
    const { bundle } = await buildDbBundle(USER, PROJECT, OPTIONS);
    expect(bundle.channels.map((c) => c.id)).toEqual(["channel-1"]);
    expect(bundle.channelGroups.map((g) => g.id)).toEqual(["group-1"]);
    const taskIds = bundle.tasks.map((t) => t.id);
    expect(taskIds).not.toContain("task-out");
  });
});
