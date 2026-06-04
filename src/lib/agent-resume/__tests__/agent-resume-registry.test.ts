// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  AGENT_RESUME_REGISTRY,
  getResumeSpec,
  verifyResumeFlag,
} from "../agent-resume-registry";
import type { AgentProviderType } from "@/types/session";

const ALL_PROVIDERS: AgentProviderType[] = [
  "claude",
  "codex",
  "gemini",
  "antigravity",
  "opencode",
  "none",
];

describe("AGENT_RESUME_REGISTRY", () => {
  it("has a spec for every AgentProviderType", () => {
    for (const p of ALL_PROVIDERS) {
      expect(AGENT_RESUME_REGISTRY[p]).toBeDefined();
      expect(AGENT_RESUME_REGISTRY[p].provider).toBe(p);
    }
  });

  it("marks antigravity and none as non-resumable", () => {
    expect(getResumeSpec("antigravity").supportsResume).toBe(false);
    expect(getResumeSpec("none").supportsResume).toBe(false);
    expect(getResumeSpec("antigravity").resume.kind).toBe("none");
  });

  it("uses --resume flag for claude", () => {
    const spec = getResumeSpec("claude");
    expect(spec.supportsResume).toBe(true);
    expect(spec.resume.kind).toBe("flag");
    expect(spec.resume.token).toBe("--resume");
  });

  it("uses a subcommand for codex resume", () => {
    const spec = getResumeSpec("codex");
    expect(spec.resume.kind).toBe("subcommand");
    expect(spec.resume.token).toBe("resume");
  });

  it("exposes a sessionIdSource and detect for resumable providers", () => {
    for (const p of ["claude", "codex", "gemini", "opencode"] as AgentProviderType[]) {
      const spec = getResumeSpec(p);
      expect(spec.detect.command).toBeTruthy();
      expect(spec.sessionIdSource).toBeDefined();
    }
  });

  it("getResumeSpec falls back to the none spec for unknown providers", () => {
    // @ts-expect-error — exercising the runtime fallback path with a bad value
    expect(getResumeSpec("bogus").provider).toBe("none");
  });
});

describe("verifyResumeFlag", () => {
  it("returns true when the CLI --help advertises the token", async () => {
    vi.resetModules();
    vi.doMock("@/lib/exec", () => ({
      execFileNoThrow: vi
        .fn()
        .mockResolvedValue({ stdout: "Usage: claude --resume <id>", stderr: "", exitCode: 0 }),
    }));
    const { verifyResumeFlag: verify } = await import("../agent-resume-registry");
    expect(await verify("claude")).toBe(true);
    vi.doUnmock("@/lib/exec");
  });

  it("returns false (and warns) when the token is absent", async () => {
    vi.resetModules();
    vi.doMock("@/lib/exec", () => ({
      execFileNoThrow: vi
        .fn()
        .mockResolvedValue({ stdout: "Usage: claude [options]", stderr: "", exitCode: 0 }),
    }));
    const { verifyResumeFlag: verify } = await import("../agent-resume-registry");
    expect(await verify("claude")).toBe(false);
    vi.doUnmock("@/lib/exec");
  });

  it("returns false for non-resumable providers without probing", async () => {
    expect(await verifyResumeFlag("antigravity")).toBe(false);
  });
});
