// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

const verifyProjectOwnership = vi.fn();
const listChannelGroups = vi.fn();
const listChannelGroupsForNode = vi.fn();
const createChannel = vi.fn();

vi.mock("@/services/channel-service", () => ({
  verifyProjectOwnership,
  listChannelGroups,
  listChannelGroupsForNode,
  createChannel,
  ChannelValidationError: class extends Error {},
}));

beforeEach(() => {
  verifyProjectOwnership.mockReset();
  listChannelGroups.mockReset();
  listChannelGroupsForNode.mockReset();
  createChannel.mockReset();
});

describe("GET /api/channels", () => {
  it("returns 200 with empty groups for unknown projectId (stale active-node id)", async () => {
    verifyProjectOwnership.mockResolvedValue(false);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/channels?projectId=stale-project-id"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ groups: [] });
    expect(verifyProjectOwnership).toHaveBeenCalledWith(
      "stale-project-id",
      "user-1",
    );
    // Critical: must NOT proceed to listChannelGroups, which would
    // ensure-create channels for a project the user doesn't own.
    expect(listChannelGroups).not.toHaveBeenCalled();
  });

  it("returns 200 with channel groups for an owned projectId", async () => {
    verifyProjectOwnership.mockResolvedValue(true);
    listChannelGroups.mockResolvedValue([
      { id: "g1", projectId: "p1", name: "Channels", position: 0, channels: [] },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/channels?projectId=p1"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].id).toBe("g1");
  });

  it("accepts legacy folderId as an alias for projectId", async () => {
    verifyProjectOwnership.mockResolvedValue(false);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/channels?folderId=legacy-id"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ groups: [] });
    expect(verifyProjectOwnership).toHaveBeenCalledWith(
      "legacy-id",
      "user-1",
    );
  });

  it("returns 200 with empty groups for unknown nodeId (project node)", async () => {
    listChannelGroupsForNode.mockResolvedValue([]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/channels?nodeId=stale-node&nodeType=project",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ groups: [] });
    expect(listChannelGroupsForNode).toHaveBeenCalledWith(
      { id: "stale-node", type: "project" },
      "user-1",
    );
  });

  it("returns 400 when nodeType is malformed (validation error, not unknown id)", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "http://localhost/api/channels?nodeId=foo&nodeType=bogus",
      ),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("INVALID_NODE_TYPE");
    expect(listChannelGroupsForNode).not.toHaveBeenCalled();
  });

  it("returns 400 when neither projectId nor nodeId is provided", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/channels"));

    expect(response.status).toBe(400);
  });
});
