import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/lib/auth-utils", () => ({
  getAuthSession: vi.fn(),
}));

vi.mock("@/services/session-service", () => ({
  getSession: vi.fn(),
}));

import { getAuthSession } from "@/lib/auth-utils";
import * as SessionService from "@/services/session-service";
import { PATCH } from "./route";

const mockGetAuthSession = vi.mocked(getAuthSession);
const mockGetSession = vi.mocked(SessionService.getSession);

describe("PATCH /api/sessions/[id]/mcp-servers", () => {
  let projectPath: string;
  let sourceFile: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), "rdv-codex-mcp-"));
    sourceFile = join(projectPath, ".codex", "config.toml");

    mkdirSync(join(projectPath, ".codex"), { recursive: true });
    writeFileSync(
      sourceFile,
      [
        '[mcp_servers.filesystem]',
        'command = "npx"',
        'args = ["-y", "@modelcontextprotocol/server-filesystem", "."]',
        'env = { ROOT = "." }',
        "",
      ].join("\n"),
      "utf-8"
    );

    mockGetAuthSession.mockResolvedValue({
      user: { id: "user-1" },
    } as Awaited<ReturnType<typeof getAuthSession>>);

    mockGetSession.mockResolvedValue({
      id: "session-1",
      terminalType: "agent",
      agentProvider: "codex",
      projectPath,
    } as Awaited<ReturnType<typeof SessionService.getSession>>);
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("toggles codex MCP servers without returning a 500", async () => {
    const disableResponse = await PATCH(
      new Request("http://localhost/api/sessions/session-1/mcp-servers", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          serverName: "filesystem",
          sourceFile,
          updates: {
            enabled: false,
          },
        }),
      }),
      { params: Promise.resolve({ id: "session-1" }) }
    );

    expect(disableResponse.status).toBe(200);

    const disabledPayload = await disableResponse.json();
    expect(
      disabledPayload.servers.find((server: { name: string }) => server.name === "filesystem")
        ?.enabled
    ).toBe(false);
    expect(readFileSync(sourceFile, "utf-8")).toContain("disabled = true");

    const enableResponse = await PATCH(
      new Request("http://localhost/api/sessions/session-1/mcp-servers", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          serverName: "filesystem",
          sourceFile,
          updates: {
            enabled: true,
          },
        }),
      }),
      { params: Promise.resolve({ id: "session-1" }) }
    );

    expect(enableResponse.status).toBe(200);

    const enabledPayload = await enableResponse.json();
    expect(
      enabledPayload.servers.find((server: { name: string }) => server.name === "filesystem")
        ?.enabled
    ).toBe(true);
    expect(readFileSync(sourceFile, "utf-8")).toContain("disabled = false");
  });
});
