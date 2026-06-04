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

const listSessionIds = vi.fn();
vi.mock("@/lib/agent-resume/session-id-discovery", () => ({
  listSessionIds: (...args: unknown[]) => listSessionIds(...args),
}));

vi.mock("@/services/agent-profile-service", () => ({
  getProfile: vi.fn().mockResolvedValue({ configDir: "/profiles/p1" }),
}));

beforeEach(() => listSessionIds.mockReset());

async function call(url: string) {
  const { GET } = await import("./route");
  return GET(new Request(url));
}

describe("GET /api/agent/sessions", () => {
  it("returns the discovered listing for a valid provider", async () => {
    listSessionIds.mockResolvedValue([
      { sessionId: "cx-1", lastModified: "2026-06-03T00:00:00.000Z" },
    ]);
    const res = await call("http://localhost/api/agent/sessions?provider=codex&projectPath=/tmp/proj");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe("codex");
    expect(body.sessions[0].sessionId).toBe("cx-1");
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
