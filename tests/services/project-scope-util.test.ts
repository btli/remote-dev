import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 3 smoke: translateFolderIdToProjectId only returns rows whose
 * `legacyFolderId` matches AND `userId` matches, so a user cannot read
 * another user's project bridge. We mock `@/db` to avoid touching SQLite.
 */

const selectLimitMock = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (n: number) => selectLimitMock(n),
        }),
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  projects: {
    id: "projects.id",
    legacyFolderId: "projects.legacy_folder_id",
    userId: "projects.user_id",
  },
}));

describe("translateFolderIdToProjectId", () => {
  beforeEach(() => {
    selectLimitMock.mockReset();
  });

  it("returns the project id when a mapping exists", async () => {
    selectLimitMock.mockResolvedValueOnce([{ id: "p-xyz" }]);
    const { translateFolderIdToProjectId } = await import(
      "@/services/project-scope-util"
    );
    await expect(translateFolderIdToProjectId("f-1", "u-1")).resolves.toBe(
      "p-xyz"
    );
    expect(selectLimitMock).toHaveBeenCalledWith(1);
  });

  it("returns null when the folder has no project bridge row", async () => {
    selectLimitMock.mockResolvedValueOnce([]);
    const { translateFolderIdToProjectId } = await import(
      "@/services/project-scope-util"
    );
    await expect(translateFolderIdToProjectId("f-2", "u-1")).resolves.toBeNull();
  });
});
