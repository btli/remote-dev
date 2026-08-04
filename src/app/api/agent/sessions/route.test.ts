// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Auth wrapper passes through with a fixed userId.
vi.mock("@/lib/api", () => ({
  withApiAuth:
    (handler: (req: Request, ctx: { userId: string }) => unknown) =>
    (req: Request) =>
      handler(req, { userId: "u1" }),
  errorResponse: (message: string, status: number, code: string) =>
    new Response(JSON.stringify({ error: message, code }), { status }),
}));

const listResumableSessions = vi.fn();
vi.mock("@/lib/agent-resume/session-id-discovery", () => ({
  listResumableSessions: (...args: unknown[]) => listResumableSessions(...args),
}));

const getProfile = vi.fn();
vi.mock("@/services/agent-profile-service", () => ({
  getProfile: (...args: unknown[]) => getProfile(...args),
}));

const getEnvironmentForSession = vi.fn();
vi.mock("@/services/preferences-service", () => ({
  getEnvironmentForSession: (...args: unknown[]) => getEnvironmentForSession(...args),
}));

beforeEach(() => {
  listResumableSessions.mockReset();
  getProfile.mockReset().mockResolvedValue({ configDir: "/profiles/p1" });
  getEnvironmentForSession.mockReset().mockResolvedValue(null);
});

afterEach(() => vi.unstubAllEnvs());

async function call(url: string) {
  const { GET } = await import("./route");
  return GET(new Request(url));
}

describe("GET /api/agent/sessions", () => {
  it("returns the discovered listing for a non-Claude provider (id + timestamp)", async () => {
    listResumableSessions.mockResolvedValue([
      { sessionId: "cx-1", lastModified: "2026-06-03T00:00:00.000Z" },
    ]);
    const res = await call("http://localhost/api/agent/sessions?provider=codex&projectPath=/tmp/proj");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("codex");
    expect(body.sessions[0].sessionId).toBe("cx-1");
    // No preview fields for disk-discovery providers.
    expect(body.sessions[0].firstUserMessage).toBeUndefined();
  });

  it("preserves Claude's rich previews (first message + git branch)", async () => {
    listResumableSessions.mockResolvedValue([
      {
        sessionId: "claude-uuid-1",
        lastModified: "2026-06-03T00:00:00.000Z",
        firstUserMessage: "fix the bug",
        gitBranch: "main",
      },
    ]);
    const res = await call(
      "http://localhost/api/agent/sessions?provider=claude&projectPath=/tmp/proj",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("claude");
    expect(body.sessions[0].firstUserMessage).toBe("fix the bug");
    expect(body.sessions[0].gitBranch).toBe("main");
  });

  it("empty-states gracefully when a provider has no discoverable sessions", async () => {
    listResumableSessions.mockResolvedValue([]);
    const res = await call(
      "http://localhost/api/agent/sessions?provider=gemini&projectPath=/tmp/proj",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
  });

  it("accepts Cursor and returns its project-scoped discovery results", async () => {
    listResumableSessions.mockResolvedValue([
      { sessionId: "cursor-chat-1", lastModified: "2026-08-03T00:00:00.000Z" },
    ]);
    const res = await call(
      "http://localhost/api/agent/sessions?provider=cursor&projectPath=/tmp/proj",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provider: "cursor",
      sessions: [
        { sessionId: "cursor-chat-1", lastModified: "2026-08-03T00:00:00.000Z" },
      ],
    });
  });

  it("keeps Cursor discovery on its shared data root when profileId is present", async () => {
    vi.stubEnv("CURSOR_DATA_DIR", "");
    listResumableSessions.mockResolvedValue([]);

    const res = await call(
      "http://localhost/api/agent/sessions?provider=cursor&projectPath=/tmp/proj&profileId=p1",
    );

    expect(res.status).toBe(200);
    expect(getProfile).not.toHaveBeenCalled();
    expect(listResumableSessions).toHaveBeenCalledWith("cursor", "/tmp/proj", {}, 20);
  });

  it("preserves an operator-supplied Cursor data root", async () => {
    vi.stubEnv("CURSOR_DATA_DIR", "/srv/cursor-data");
    listResumableSessions.mockResolvedValue([]);

    const res = await call(
      "http://localhost/api/agent/sessions?provider=cursor&projectPath=/tmp/proj&profileId=p1",
    );

    expect(res.status).toBe(200);
    expect(getProfile).not.toHaveBeenCalled();
    expect(listResumableSessions).toHaveBeenCalledWith(
      "cursor",
      "/tmp/proj",
      { CURSOR_DATA_DIR: "/srv/cursor-data" },
      20,
    );
  });

  it("uses a folder-level Cursor data root for the project picker", async () => {
    vi.stubEnv("CURSOR_DATA_DIR", "/srv/default-cursor-data");
    getEnvironmentForSession.mockResolvedValue({
      CURSOR_DATA_DIR: "/projects/p1/cursor-data",
    });
    listResumableSessions.mockResolvedValue([]);

    const res = await call(
      "http://localhost/api/agent/sessions?provider=cursor&projectPath=/tmp/proj&projectId=p1",
    );

    expect(res.status).toBe(200);
    expect(getEnvironmentForSession).toHaveBeenCalledWith("u1", "p1");
    expect(listResumableSessions).toHaveBeenCalledWith(
      "cursor",
      "/tmp/proj",
      { CURSOR_DATA_DIR: "/projects/p1/cursor-data" },
      20,
    );
  });

  it("accepts Kimi and returns its project-scoped discovery results", async () => {
    listResumableSessions.mockResolvedValue([
      { sessionId: "01JZK2ABC", lastModified: "2026-08-04T00:00:00.000Z" },
    ]);
    const res = await call(
      "http://localhost/api/agent/sessions?provider=kimi&projectPath=/tmp/proj",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provider: "kimi",
      sessions: [
        { sessionId: "01JZK2ABC", lastModified: "2026-08-04T00:00:00.000Z" },
      ],
    });
  });

  it("keeps Kimi discovery on its default home when profileId is present", async () => {
    vi.stubEnv("KIMI_CODE_HOME", "");
    listResumableSessions.mockResolvedValue([]);

    const res = await call(
      "http://localhost/api/agent/sessions?provider=kimi&projectPath=/tmp/proj&profileId=p1",
    );

    expect(res.status).toBe(200);
    expect(getProfile).not.toHaveBeenCalled();
    expect(listResumableSessions).toHaveBeenCalledWith("kimi", "/tmp/proj", {}, 20);
  });

  it("preserves an operator-supplied Kimi code home", async () => {
    vi.stubEnv("KIMI_CODE_HOME", "/srv/kimi-code");
    listResumableSessions.mockResolvedValue([]);

    const res = await call(
      "http://localhost/api/agent/sessions?provider=kimi&projectPath=/tmp/proj&profileId=p1",
    );

    expect(res.status).toBe(200);
    expect(getProfile).not.toHaveBeenCalled();
    expect(listResumableSessions).toHaveBeenCalledWith(
      "kimi",
      "/tmp/proj",
      { KIMI_CODE_HOME: "/srv/kimi-code" },
      20,
    );
  });

  it("uses a folder-level Kimi code home for the project picker", async () => {
    vi.stubEnv("KIMI_CODE_HOME", "/srv/default-kimi-code");
    getEnvironmentForSession.mockResolvedValue({
      KIMI_CODE_HOME: "/projects/p1/kimi-code",
    });
    listResumableSessions.mockResolvedValue([]);

    const res = await call(
      "http://localhost/api/agent/sessions?provider=kimi&projectPath=/tmp/proj&projectId=p1",
    );

    expect(res.status).toBe(200);
    expect(getEnvironmentForSession).toHaveBeenCalledWith("u1", "p1");
    expect(listResumableSessions).toHaveBeenCalledWith(
      "kimi",
      "/tmp/proj",
      { KIMI_CODE_HOME: "/projects/p1/kimi-code" },
      20,
    );
  });

  it("rejects an invalid provider", async () => {
    const res = await call("http://localhost/api/agent/sessions?provider=bogus&projectPath=/tmp/proj");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_PROVIDER");
  });

  it("rejects antigravity (not resume-capable)", async () => {
    const res = await call(
      "http://localhost/api/agent/sessions?provider=antigravity&projectPath=/tmp/proj",
    );
    expect(res.status).toBe(400);
  });

  it("rejects a missing projectPath", async () => {
    const res = await call("http://localhost/api/agent/sessions?provider=claude");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_PROJECT_PATH");
  });
});
