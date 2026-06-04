// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  CLIENT_RESUME_INFO,
  providerSupportsResume,
  buildResumeAgentFlags,
} from "../resume-providers.client";
import { AGENT_RESUME_REGISTRY } from "../agent-resume-registry";
import type { AgentProviderType } from "@/types/session";

const ALL_PROVIDERS: AgentProviderType[] = [
  "claude",
  "codex",
  "gemini",
  "antigravity",
  "opencode",
  "none",
];

describe("CLIENT_RESUME_INFO — parity with the server registry", () => {
  it("agrees with AGENT_RESUME_REGISTRY on supportsResume + resume kind/token", () => {
    // The client mirror MUST stay in lockstep with the server registry so the
    // picker/exit-screen never disagree with the launch path about resume.
    for (const p of ALL_PROVIDERS) {
      const client = CLIENT_RESUME_INFO[p];
      const server = AGENT_RESUME_REGISTRY[p];
      expect(client).toBeDefined();
      expect(client.supportsResume).toBe(server.supportsResume);
      expect(client.kind).toBe(server.resume.kind);
      expect(client.token).toBe(server.resume.token);
    }
  });
});

describe("providerSupportsResume", () => {
  it("is true for the four resume-capable agents and false otherwise", () => {
    expect(providerSupportsResume("claude")).toBe(true);
    expect(providerSupportsResume("codex")).toBe(true);
    expect(providerSupportsResume("gemini")).toBe(true);
    expect(providerSupportsResume("opencode")).toBe(true);
    expect(providerSupportsResume("antigravity")).toBe(false);
    expect(providerSupportsResume("none")).toBe(false);
  });
});

describe("buildResumeAgentFlags", () => {
  it("builds the flag pair for flag-kind providers", () => {
    expect(buildResumeAgentFlags("claude", "abc")).toEqual(["--resume", "abc"]);
    expect(buildResumeAgentFlags("gemini", "abc")).toEqual(["--resume", "abc"]);
    expect(buildResumeAgentFlags("opencode", "abc")).toEqual(["--session", "abc"]);
  });

  it("builds the subcommand pair for codex (appended after the command)", () => {
    // The agent plugin assembles `<command> <flags…>`, so ["resume", id] yields
    // `codex resume <id>` — the correct subcommand-style resume argv.
    expect(buildResumeAgentFlags("codex", "abc")).toEqual(["resume", "abc"]);
  });

  it("returns null for providers without resume support", () => {
    expect(buildResumeAgentFlags("antigravity", "abc")).toBeNull();
    expect(buildResumeAgentFlags("none", "abc")).toBeNull();
  });
});
