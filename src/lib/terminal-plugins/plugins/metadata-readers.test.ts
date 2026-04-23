/**
 * Tests for the typed metadata narrowing helpers exported by the issues and
 * PRs client plugins.
 *
 * These helpers are the sole layer between arbitrary JSON stored on a session
 * and the typed shape UI components assume — malformed rows must fall back to
 * null instead of crashing the render.
 */
import { describe, it, expect } from "vitest";
import { readIssuesMetadata } from "./issues-plugin-client";
import { readPRsMetadata } from "./prs-plugin-client";
import type { TerminalSession } from "@/types/session";

function makeSession(
  typeMetadata: TerminalSession["typeMetadata"]
): TerminalSession {
  const now = new Date();
  return {
    id: "s",
    userId: "u",
    name: "n",
    tmuxSessionName: "t",
    projectPath: null,
    githubRepoId: null,
    worktreeBranch: null,
    worktreeType: null,
    projectId: "p",
    profileId: null,
    terminalType: "issues",
    agentProvider: null,
    agentExitState: null,
    agentExitCode: null,
    agentExitedAt: null,
    agentRestartCount: 0,
    agentActivityStatus: null,
    typeMetadata,
    scopeKey: null,
    parentSessionId: null,
    status: "active",
    pinned: false,
    tabOrder: 0,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe("readIssuesMetadata", () => {
  it("returns a fully-typed record for well-formed metadata", () => {
    const md = readIssuesMetadata(
      makeSession({
        repositoryId: "repo-123",
        repositoryName: "owner/name",
        repositoryUrl: "https://github.com/owner/name",
        selectedIssueNumber: 42,
      })
    );
    expect(md).toEqual({
      repositoryId: "repo-123",
      repositoryName: "owner/name",
      repositoryUrl: "https://github.com/owner/name",
      selectedIssueNumber: 42,
    });
  });

  it("null metadata → null", () => {
    expect(readIssuesMetadata(makeSession(null))).toBeNull();
  });

  it("missing repositoryId → null", () => {
    expect(
      readIssuesMetadata(
        makeSession({
          repositoryName: "owner/name",
        })
      )
    ).toBeNull();
  });

  it("empty-string repositoryId → null", () => {
    expect(
      readIssuesMetadata(
        makeSession({
          repositoryId: "",
          repositoryName: "owner/name",
        })
      )
    ).toBeNull();
  });

  it("non-string repositoryId → null", () => {
    expect(
      readIssuesMetadata(
        makeSession({
          repositoryId: 1234 as unknown as string,
        })
      )
    ).toBeNull();
  });

  it("non-string repositoryName / repositoryUrl → coerced to empty string", () => {
    const md = readIssuesMetadata(
      makeSession({
        repositoryId: "repo-123",
        repositoryName: 1234 as unknown as string,
        repositoryUrl: null as unknown as string,
      })
    );
    expect(md).toEqual({
      repositoryId: "repo-123",
      repositoryName: "",
      repositoryUrl: "",
      selectedIssueNumber: null,
    });
  });

  it("non-number selectedIssueNumber → null", () => {
    const md = readIssuesMetadata(
      makeSession({
        repositoryId: "repo-123",
        selectedIssueNumber: "42" as unknown as number,
      })
    );
    expect(md?.selectedIssueNumber).toBeNull();
  });
});

describe("readPRsMetadata", () => {
  it("returns a fully-typed record for well-formed metadata", () => {
    const md = readPRsMetadata(
      makeSession({
        repositoryId: "repo-123",
        repositoryName: "owner/name",
        repositoryUrl: "https://github.com/owner/name",
        selectedPrNumber: 7,
      })
    );
    expect(md).toEqual({
      repositoryId: "repo-123",
      repositoryName: "owner/name",
      repositoryUrl: "https://github.com/owner/name",
      selectedPrNumber: 7,
    });
  });

  it("null metadata → null", () => {
    expect(readPRsMetadata(makeSession(null))).toBeNull();
  });

  it("missing repositoryId → null", () => {
    expect(
      readPRsMetadata(
        makeSession({
          repositoryName: "owner/name",
        })
      )
    ).toBeNull();
  });

  it("empty-string repositoryId → null", () => {
    expect(
      readPRsMetadata(
        makeSession({
          repositoryId: "",
        })
      )
    ).toBeNull();
  });

  it("non-number selectedPrNumber → null", () => {
    const md = readPRsMetadata(
      makeSession({
        repositoryId: "repo-123",
        selectedPrNumber: "7" as unknown as number,
      })
    );
    expect(md?.selectedPrNumber).toBeNull();
  });
});
