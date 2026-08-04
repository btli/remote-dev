// @vitest-environment node
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";

import {
  getCLICommand,
  getInstallInstructions,
  getProviderDocsUrl,
  getRequiredEnvVars,
  checkCLIStatus,
  checkRequiredEnvVars,
  matchesProviderIdentity,
  resolveVerifiedProviderExecutable,
  verifyCLIExecution,
} from "./agent-cli-service";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AgentCLIService", () => {
  describe("getCLICommand", () => {
    it("returns correct command for each provider", () => {
      expect(getCLICommand("claude")).toBe("claude");
      expect(getCLICommand("codex")).toBe("codex");
      expect(getCLICommand("gemini")).toBe("gemini");
      expect(getCLICommand("antigravity")).toBe("agy");
      expect(getCLICommand("opencode")).toBe("opencode");
      expect(getCLICommand("cursor")).toBe("agent");
      expect(getCLICommand("kimi")).toBe("kimi");
    });

    it("returns null for 'all' provider", () => {
      expect(getCLICommand("all")).toBeNull();
    });
  });

  describe("matchesProviderIdentity", () => {
    it("accepts Cursor's distinctive help output for the generic agent executable", () => {
      expect(matchesProviderIdentity("cursor", "Start the Cursor Agent")).toBe(true);
    });

    it("rejects an unrelated executable named agent", () => {
      expect(matchesProviderIdentity("cursor", "generic build agent 1.2.3")).toBe(false);
    });

    it("does not add an identity requirement to provider-specific executable names", () => {
      expect(matchesProviderIdentity("codex", "")).toBe(true);
      expect(matchesProviderIdentity("kimi", "")).toBe(true);
    });

    it("fingerprints the executable resolved from the supplied PATH", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "remote-dev-agent-identity-"));
      tempDirs.push(binDir);
      const agentPath = join(binDir, "agent");

      await writeFile(agentPath, "#!/bin/sh\necho 'Generic automation agent'\n");
      await chmod(agentPath, 0o755);
      expect(
        await resolveVerifiedProviderExecutable(
          "cursor",
          "agent",
          { PATH: binDir, NODE_ENV: "test" },
          process.cwd(),
        ),
      ).toBeNull();

      await writeFile(
        agentPath,
        "#!/bin/sh\necho 'Cursor Agent'\n",
      );
      expect(
        await resolveVerifiedProviderExecutable(
          "cursor",
          "agent",
          { PATH: binDir, NODE_ENV: "test" },
          process.cwd(),
        ),
      ).toBe(await realpath(agentPath));
    });

    it("accepts identifying help written by a CLI that exits non-zero", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "remote-dev-agent-identity-"));
      tempDirs.push(binDir);
      const agentPath = join(binDir, "agent");
      await writeFile(agentPath, "#!/bin/sh\necho 'Cursor Agent' >&2\nexit 1\n");
      await chmod(agentPath, 0o755);

      expect(
        await resolveVerifiedProviderExecutable("cursor", "agent", {
          PATH: binDir,
          NODE_ENV: "test",
        }),
      ).toBe(await realpath(agentPath));
    });

    it("reports a foreign agent executable as a Cursor identity mismatch", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "remote-dev-agent-status-"));
      tempDirs.push(binDir);
      const agentPath = join(binDir, "agent");
      await writeFile(agentPath, "#!/bin/sh\necho 'Generic automation agent'\n");
      await chmod(agentPath, 0o755);
      vi.stubEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);

      const status = await checkCLIStatus("cursor");

      expect(status).toMatchObject({
        provider: "cursor",
        installed: false,
        path: await realpath(agentPath),
        error: "Executable 'agent' is not the Cursor Agent CLI",
      });
    });

    it("uses the fingerprinted Cursor executable for the version probe", async () => {
      const binDir = await mkdtemp(join(tmpdir(), "remote-dev-agent-status-"));
      tempDirs.push(binDir);
      const agentPath = join(binDir, "agent");
      await writeFile(
        agentPath,
        "#!/bin/sh\nif [ \"$1\" = \"--help\" ]; then echo 'Cursor Agent'; else echo '1.2.3'; fi\n",
      );
      await chmod(agentPath, 0o755);
      vi.stubEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);

      await expect(checkCLIStatus("cursor")).resolves.toMatchObject({
        provider: "cursor",
        installed: true,
        path: await realpath(agentPath),
        version: "1.2.3",
      });
    });
  });

  describe("kimi native-installer detection", () => {
    it("detects kimi at $KIMI_CODE_HOME/bin/kimi when PATH lacks it (launchd-style env)", async () => {
      const kimiHome = await mkdtemp(join(tmpdir(), "remote-dev-kimi-home-"));
      tempDirs.push(kimiHome);
      const binDir = join(kimiHome, "bin");
      await mkdir(binDir, { recursive: true });
      const kimiPath = join(binDir, "kimi");
      await writeFile(kimiPath, "#!/bin/sh\necho '0.31.1'\n");
      await chmod(kimiPath, 0o755);
      // Simulate the server process env: the native installer only adds
      // ~/.kimi-code/bin to PATH via shell rc files, which launchd never sources.
      vi.stubEnv("KIMI_CODE_HOME", kimiHome);
      vi.stubEnv("PATH", "/usr/bin:/bin");

      const status = await checkCLIStatus("kimi");

      expect(status).toMatchObject({
        provider: "kimi",
        installed: true,
        version: "0.31.1",
        path: await realpath(kimiPath),
      });
    });

    it("verifyCLIExecution also resolves the native-installer location", async () => {
      const kimiHome = await mkdtemp(join(tmpdir(), "remote-dev-kimi-home-"));
      tempDirs.push(kimiHome);
      const binDir = join(kimiHome, "bin");
      await mkdir(binDir, { recursive: true });
      const kimiPath = join(binDir, "kimi");
      await writeFile(kimiPath, "#!/bin/sh\necho '0.31.1'\n");
      await chmod(kimiPath, 0o755);
      vi.stubEnv("PATH", "/usr/bin:/bin");

      const result = await verifyCLIExecution("kimi", {
        KIMI_CODE_HOME: kimiHome,
      });

      expect(result).toEqual({ success: true });
    });

    it("reports not installed when neither PATH nor the fallback location has kimi", async () => {
      const emptyHome = await mkdtemp(join(tmpdir(), "remote-dev-kimi-empty-"));
      tempDirs.push(emptyHome);
      vi.stubEnv("KIMI_CODE_HOME", emptyHome);
      vi.stubEnv("PATH", "/usr/bin:/bin");

      const status = await checkCLIStatus("kimi");

      expect(status.provider).toBe("kimi");
      expect(status.installed).toBe(false);
      expect(status.error).toContain("not found");
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
      expect(instructions).toContain("@openai/codex");
    });

    it("returns installation instructions for gemini", () => {
      const instructions = getInstallInstructions("gemini");
      expect(instructions).toContain("npm install -g");
      expect(instructions).toContain("gemini-cli");
    });

    it("returns installation instructions for antigravity", () => {
      const instructions = getInstallInstructions("antigravity");
      expect(instructions).toContain("google.dev/antigravity");
      expect(instructions).toContain("| sh");
    });

    it("returns installation instructions for opencode", () => {
      const instructions = getInstallInstructions("opencode");
      expect(instructions).toContain("npm install -g");
      expect(instructions).toContain("opencode-ai");
    });

    it("returns Cursor's official install script", () => {
      expect(getInstallInstructions("cursor")).toContain(
        "curl https://cursor.com/install -fsS | bash",
      );
    });

    it("returns installation instructions for kimi", () => {
      const instructions = getInstallInstructions("kimi");
      expect(instructions).toContain("curl -LsSf https://code.kimi.com/install.sh | bash");
      expect(instructions).toContain("npm install -g");
      expect(instructions).toContain("@moonshot-ai/kimi-code");
    });
  });

  describe("getProviderDocsUrl", () => {
    it("returns correct documentation URLs", () => {
      expect(getProviderDocsUrl("claude")).toContain("anthropic.com");
      expect(getProviderDocsUrl("codex")).toContain("openai.com");
      expect(getProviderDocsUrl("gemini")).toContain("geminicli.com");
      expect(getProviderDocsUrl("antigravity")).toContain("antigravity.google");
      expect(getProviderDocsUrl("opencode")).toContain("opencode.ai");
      expect(getProviderDocsUrl("cursor")).toBe("https://cursor.com/docs/cli/overview");
      expect(getProviderDocsUrl("kimi")).toBe("https://www.kimi.com/code/docs/en/");
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

    it("returns GOOGLE_API_KEY for antigravity", () => {
      const envVars = getRequiredEnvVars("antigravity");
      expect(envVars).toContain("GOOGLE_API_KEY");
    });

    it("returns empty array for opencode (multi-provider)", () => {
      const envVars = getRequiredEnvVars("opencode");
      expect(envVars).toEqual([]);
    });

    it("does not require CURSOR_API_KEY because browser login is supported", () => {
      expect(getRequiredEnvVars("cursor")).toEqual([]);
      expect(checkRequiredEnvVars("cursor", {})).toEqual({ valid: true, missing: [] });
    });

    it("requires no env vars for kimi (OAuth login or config.toml API key)", () => {
      expect(getRequiredEnvVars("kimi")).toEqual([]);
      expect(checkRequiredEnvVars("kimi", {})).toEqual({ valid: true, missing: [] });
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

    it("returns invalid for antigravity without GOOGLE_API_KEY", () => {
      const result = checkRequiredEnvVars("antigravity", {});
      expect(result.valid).toBe(false);
      expect(result.missing).toContain("GOOGLE_API_KEY");
    });
  });
});
