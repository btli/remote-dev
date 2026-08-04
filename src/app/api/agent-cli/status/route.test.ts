// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const checkRequiredEnvVars = vi.fn(() => ({ valid: true, missing: [] }));
const verifyCLIExecution = vi.fn(async () => ({ success: true }));

vi.mock("@/services/agent-cli-service", () => ({
  AGENT_CLI_PROVIDERS: ["claude", "codex", "gemini", "antigravity", "opencode", "cursor", "kimi"],
  checkCLIStatus: vi.fn(),
  checkAllCLIStatus: vi.fn(),
  getInstallInstructions: vi.fn(),
  getProviderDocsUrl: vi.fn(),
  getRequiredEnvVars: vi.fn(),
  checkRequiredEnvVars,
  verifyCLIExecution,
}));

vi.mock("@/lib/api", () => ({
  withAuth:
    (handler: (request: Request) => Promise<Response>) =>
    (request: Request) =>
      handler(request),
  errorResponse: (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status }),
}));

describe("POST /api/agent-cli/status", () => {
  it("accepts Cursor without requiring CURSOR_API_KEY", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/agent-cli/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "cursor", env: {} }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(checkRequiredEnvVars).toHaveBeenCalledWith("cursor", expect.any(Object));
    expect(verifyCLIExecution).toHaveBeenCalledWith("cursor", {});
  });

  it("accepts Kimi without requiring any environment variables", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/agent-cli/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "kimi", env: {} }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(checkRequiredEnvVars).toHaveBeenCalledWith("kimi", expect.any(Object));
    expect(verifyCLIExecution).toHaveBeenCalledWith("kimi", {});
  });
});
