import { describe, it, expect } from "vitest";

import {
  getCLICommand,
  getInstallInstructions,
  getProviderDocsUrl,
  getRequiredEnvVars,
  checkRequiredEnvVars,
} from "./agent-cli-service";

describe("AgentCLIService", () => {
  describe("getCLICommand", () => {
    it("returns correct command for each provider", () => {
      expect(getCLICommand("claude")).toBe("claude");
      expect(getCLICommand("codex")).toBe("codex");
      expect(getCLICommand("gemini")).toBe("gemini");
      expect(getCLICommand("opencode")).toBe("opencode");
    });

    it("returns null for 'all' provider", () => {
      expect(getCLICommand("all")).toBeNull();
    });
  });

  describe("getInstallInstructions", () => {
    it("returns installation instructions for claude", () => {
      const instructions = getInstallInstructions("claude");
      expect(instructions).toContain("npm install -g");
      expect(instructions).toContain("claude-code");
    });

    it("returns installation instructions for codex", () => {
      const instructions = getInstallInstructions("codex");
      expect(instructions).toContain("npm install -g");
      expect(instructions).toContain("codex-cli");
    });

    it("returns installation instructions for gemini", () => {
      const instructions = getInstallInstructions("gemini");
      expect(instructions).toContain("npm install -g");
      expect(instructions).toContain("gemini-cli");
    });

    it("returns installation instructions for opencode", () => {
      const instructions = getInstallInstructions("opencode");
      expect(instructions).toContain("npm install -g");
      expect(instructions).toContain("opencode");
    });
  });

  describe("getProviderDocsUrl", () => {
    it("returns correct documentation URLs", () => {
      expect(getProviderDocsUrl("claude")).toContain("anthropic.com");
      expect(getProviderDocsUrl("codex")).toContain("openai.com");
      expect(getProviderDocsUrl("gemini")).toContain("geminicli.com");
      expect(getProviderDocsUrl("opencode")).toContain("opencode.ai");
    });
  });

  describe("getRequiredEnvVars", () => {
    it("returns ANTHROPIC_API_KEY for claude", () => {
      const envVars = getRequiredEnvVars("claude");
      expect(envVars).toContain("ANTHROPIC_API_KEY");
    });

    it("returns OPENAI_API_KEY for codex", () => {
      const envVars = getRequiredEnvVars("codex");
      expect(envVars).toContain("OPENAI_API_KEY");
    });

    it("returns GOOGLE_API_KEY for gemini", () => {
      const envVars = getRequiredEnvVars("gemini");
      expect(envVars).toContain("GOOGLE_API_KEY");
    });

    it("returns empty array for opencode (multi-provider)", () => {
      const envVars = getRequiredEnvVars("opencode");
      expect(envVars).toEqual([]);
    });
  });

  describe("checkRequiredEnvVars", () => {
    it("returns valid when all required vars are present", () => {
      const result = checkRequiredEnvVars("claude", {
        ANTHROPIC_API_KEY: "sk-ant-123",
      });
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("returns invalid when required vars are missing", () => {
      const result = checkRequiredEnvVars("claude", {});
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("ANTHROPIC_API_KEY");
    });

    it("returns valid for opencode with no env vars", () => {
      const result = checkRequiredEnvVars("opencode", {});
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("returns invalid for codex without OPENAI_API_KEY", () => {
      const result = checkRequiredEnvVars("codex", {
        ANTHROPIC_API_KEY: "wrong-key",
      });
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("OPENAI_API_KEY");
    });

    it("returns invalid for gemini without GOOGLE_API_KEY", () => {
      const result = checkRequiredEnvVars("gemini", {});
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("GOOGLE_API_KEY");
    });
  });
});
