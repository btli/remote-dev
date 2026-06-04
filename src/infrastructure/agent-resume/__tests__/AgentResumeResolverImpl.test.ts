// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/agent-resume/session-id-discovery", () => ({
  discoverLatestSessionId: vi.fn().mockResolvedValue("disk-id"),
}));

import { AgentResumeResolverImpl } from "../AgentResumeResolverImpl";
import type { Session } from "@/domain/entities/Session";

// Minimal Session stub exposing only the getters the resolver reads.
const sess = (over: {
  agentProvider?: string;
  typeMetadata?: Record<string, unknown>;
  projectPath?: string | null;
}): Session =>
  ({
    id: "s1",
    projectPath: over.projectPath ?? "/p",
    typeMetadata: over.typeMetadata ?? {},
    agentProvider: over.agentProvider ?? null,
  }) as unknown as Session;

describe("AgentResumeResolverImpl", () => {
  const r = new AgentResumeResolverImpl();

  it("uses the stored id for claude as --resume flags", async () => {
    const res = await r.resolveResume(
      sess({ agentProvider: "claude", typeMetadata: { agentSessionId: { claude: "stored-id" } } }),
    );
    expect(res).toEqual({
      provider: "claude",
      nativeSessionId: "stored-id",
      resumeFlags: ["--resume", "stored-id"],
      argvOverride: null,
    });
  });

  it("uses a codex subcommand argv override", async () => {
    const res = await r.resolveResume(
      sess({ agentProvider: "codex", typeMetadata: { agentSessionId: { codex: "cx" } } }),
    );
    expect(res?.argvOverride).toEqual(["codex", "resume", "cx"]);
    expect(res?.resumeFlags).toEqual([]);
  });

  it("uses --session for opencode", async () => {
    const res = await r.resolveResume(
      sess({ agentProvider: "opencode", typeMetadata: { agentSessionId: { opencode: "oc" } } }),
    );
    expect(res?.resumeFlags).toEqual(["--session", "oc"]);
  });

  it("returns null for antigravity (no resume support)", async () => {
    expect(await r.resolveResume(sess({ agentProvider: "antigravity" }))).toBeNull();
  });

  it("returns null for a provider-less / none session", async () => {
    expect(await r.resolveResume(sess({ agentProvider: "none" }))).toBeNull();
  });

  it("falls back to disk discovery when no stored id", async () => {
    const res = await r.resolveResume(sess({ agentProvider: "gemini" }));
    expect(res?.nativeSessionId).toBe("disk-id");
    expect(res?.resumeFlags).toEqual(["--resume", "disk-id"]);
  });
});
