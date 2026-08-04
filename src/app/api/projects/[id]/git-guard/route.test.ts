// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
}));

const getProject = vi.fn();
vi.mock("@/services/project-service", () => ({
  ProjectService: { get: getProject },
}));

const getFolderGitIdentity = vi.fn();
vi.mock("@/services/preferences-service", () => ({
  getFolderGitIdentity,
}));

function request(body: unknown): Request {
  return new Request("http://localhost/api/projects/project-1/git-guard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown): Promise<Response> {
  const { POST } = await import("./route");
  return POST(request(body), {
    params: Promise.resolve({ id: "project-1" }),
  });
}

beforeEach(() => {
  getProject.mockReset().mockResolvedValue({ userId: "user-1" });
  getFolderGitIdentity.mockReset().mockResolvedValue({
    isSensitive: true,
    gitIdentityName: "Pseudonym",
    gitIdentityEmail: "alias@example.com",
  });
});

describe("POST /api/projects/[id]/git-guard", () => {
  it("evaluates an owned project's resolved identity", async () => {
    const response = await post({
      proposedAuthorName: "Real Name",
      proposedAuthorEmail: "real@example.com",
      proposedCommitterName: "Real Name",
      proposedCommitterEmail: "real@example.com",
      operation: "push",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      risk: "block",
      reason: expect.stringContaining("Identity mismatch"),
    });
    expect(getFolderGitIdentity).toHaveBeenCalledWith("user-1", "project-1");
  });

  it("does not evaluate a project owned by another user", async () => {
    getProject.mockResolvedValue({ userId: "user-2" });

    const response = await post({
      proposedAuthorName: "Real Name",
      proposedAuthorEmail: "real@example.com",
      proposedCommitterName: "Real Name",
      proposedCommitterEmail: "real@example.com",
      operation: "push",
    });

    expect(response.status).toBe(404);
    expect(getFolderGitIdentity).not.toHaveBeenCalled();
  });

  it("rejects malformed policy input", async () => {
    const response = await post({ operation: "delete" });

    expect(response.status).toBe(400);
    expect(getFolderGitIdentity).not.toHaveBeenCalled();
  });

  it("blocks a mismatched committer even when the author is the configured alias", async () => {
    const response = await post({
      proposedAuthorName: "Pseudonym",
      proposedAuthorEmail: "alias@example.com",
      proposedCommitterName: "Real Name",
      proposedCommitterEmail: "real@example.com",
      operation: "push",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      risk: "block",
      reason: expect.stringContaining("committer"),
    });
  });
});
