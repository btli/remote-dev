// @vitest-environment node
/**
 * Tests for `ensureDefaultProjectForUser` (remote-dev-bxcn) — the first-run
 * default-project seed that runs once when a brand-new user is created so
 * terminal creation works out of the box on a fresh instance.
 *
 * The seed reuses the real UI creation path (GroupService/ProjectService →
 * use-cases) and ensures the project's channels; these collaborators are mocked
 * to in-memory fakes so the test asserts the helper's BEHAVIOR — idempotency
 * (only seeds on zero projects), correct owner, `isAutoCreated=true`, channels
 * ensured, and non-fatal failure handling — rather than re-testing the
 * already-covered services.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeProject {
  id: string;
  userId: string;
  groupId: string | null;
  name: string;
  isAutoCreated: boolean;
}
interface FakeGroup {
  id: string;
  userId: string;
  name: string;
  parentGroupId: string | null;
}

// In-memory stores the fakes mutate; reset per test.
let projectsByUser: FakeProject[];
let groupsCreated: FakeGroup[];
let channelsEnsuredFor: string[];
let idSeq: number;

const listByUserMock = vi.fn(async (userId: string) =>
  projectsByUser.filter((p) => p.userId === userId)
);
const groupCreateMock = vi.fn(
  async (input: { userId: string; name: string; parentGroupId: string | null }) => {
    idSeq += 1;
    const group: FakeGroup = {
      id: `group-${idSeq}`,
      userId: input.userId,
      name: input.name,
      parentGroupId: input.parentGroupId,
    };
    groupsCreated.push(group);
    return group;
  }
);
const projectCreateMock = vi.fn(
  async (input: {
    userId: string;
    groupId: string | null;
    name: string;
    isAutoCreated?: boolean;
  }) => {
    idSeq += 1;
    const project: FakeProject = {
      id: `project-${idSeq}`,
      userId: input.userId,
      groupId: input.groupId,
      name: input.name,
      isAutoCreated: input.isAutoCreated ?? false,
    };
    // Persist so a follow-up listByUser sees it (idempotency check).
    projectsByUser.push(project);
    return project;
  }
);
const ensureProjectChannelsMock = vi.fn(async (projectId: string) => {
  channelsEnsuredFor.push(projectId);
  return { groupId: "chan-group", generalChannelId: "chan-general" };
});

vi.mock("@/infrastructure/container", () => ({
  container: {
    projectRepository: {
      listByUser: (userId: string) => listByUserMock(userId),
    },
  },
}));
vi.mock("@/services/group-service", () => ({
  GroupService: { create: (input: unknown) => groupCreateMock(input as never) },
}));
vi.mock("@/services/project-service", () => ({
  ProjectService: { create: (input: unknown) => projectCreateMock(input as never) },
}));
vi.mock("@/services/channel-service", () => ({
  ensureProjectChannels: (projectId: string) => ensureProjectChannelsMock(projectId),
}));

// `vi.hoisted` so the mock (created at module-eval time, when the SUT calls
// `createLogger` at import) can reference it without a TDZ error.
const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: warnMock,
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }),
}));

import {
  ensureDefaultProjectForUser,
  DEFAULT_GROUP_NAME,
  DEFAULT_PROJECT_NAME,
} from "@/lib/ensure-default-project";

beforeEach(() => {
  projectsByUser = [];
  groupsCreated = [];
  channelsEnsuredFor = [];
  idSeq = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ensureDefaultProjectForUser", () => {
  it("creates a default group + project owned by the user with isAutoCreated=true on first call", async () => {
    const created = await ensureDefaultProjectForUser("user-1");

    expect(created).toBe(true);

    // Group: default name, owned by the user, at the tree root.
    expect(groupCreateMock).toHaveBeenCalledTimes(1);
    expect(groupsCreated).toHaveLength(1);
    expect(groupsCreated[0]).toMatchObject({
      userId: "user-1",
      name: DEFAULT_GROUP_NAME,
      parentGroupId: null,
    });

    // Project: default name, owned by the user, inside the seeded group, flagged.
    expect(projectCreateMock).toHaveBeenCalledTimes(1);
    const projectArg = projectCreateMock.mock.calls[0][0];
    expect(projectArg).toMatchObject({
      userId: "user-1",
      groupId: groupsCreated[0].id,
      name: DEFAULT_PROJECT_NAME,
      isAutoCreated: true,
    });
    expect(projectsByUser[0].isAutoCreated).toBe(true);
  });

  it("ensures the seeded project's default channels", async () => {
    await ensureDefaultProjectForUser("user-1");
    expect(ensureProjectChannelsMock).toHaveBeenCalledTimes(1);
    // The id passed to ensureProjectChannels is the freshly-created project's id.
    expect(channelsEnsuredFor).toEqual([projectsByUser[0].id]);
  });

  it("is a no-op when the user already has a project (idempotent)", async () => {
    projectsByUser.push({
      id: "existing",
      userId: "user-1",
      groupId: null,
      name: "already here",
      isAutoCreated: false,
    });

    const created = await ensureDefaultProjectForUser("user-1");

    expect(created).toBe(false);
    expect(groupCreateMock).not.toHaveBeenCalled();
    expect(projectCreateMock).not.toHaveBeenCalled();
    expect(ensureProjectChannelsMock).not.toHaveBeenCalled();
  });

  it("only seeds once across repeated calls (second call sees the seeded project)", async () => {
    const first = await ensureDefaultProjectForUser("user-1");
    const second = await ensureDefaultProjectForUser("user-1");

    expect(first).toBe(true);
    expect(second).toBe(false);
    // Exactly one group + one project total.
    expect(groupCreateMock).toHaveBeenCalledTimes(1);
    expect(projectCreateMock).toHaveBeenCalledTimes(1);
  });

  it("scopes the zero-project check to the user (a different user's project doesn't block seeding)", async () => {
    projectsByUser.push({
      id: "other-user-project",
      userId: "other-user",
      groupId: null,
      name: "theirs",
      isAutoCreated: false,
    });

    const created = await ensureDefaultProjectForUser("user-1");

    expect(created).toBe(true);
    expect(projectCreateMock).toHaveBeenCalledTimes(1);
    expect(projectCreateMock.mock.calls[0][0]).toMatchObject({ userId: "user-1" });
  });

  it("is NON-FATAL and returns false when seeding throws (login must not break)", async () => {
    projectCreateMock.mockRejectedValueOnce(new Error("db down"));

    const created = await ensureDefaultProjectForUser("user-1");

    expect(created).toBe(false);
    // The failure was warned (loud + structured), not thrown.
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0][0]).toMatch(/Failed to seed default project/i);
  });

  it("does not throw when the idempotency check itself fails (returns false, warns)", async () => {
    listByUserMock.mockRejectedValueOnce(new Error("query failed"));

    await expect(ensureDefaultProjectForUser("user-1")).resolves.toBe(false);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });
});
