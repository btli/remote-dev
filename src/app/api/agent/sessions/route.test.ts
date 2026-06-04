// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("@/services/agent-profile-service", () => ({
  getProfile: vi.fn().mockResolvedValue({ configDir: "/profiles/p1" }),
}));

beforeEach(() => listResumableSessions.mockReset());

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
