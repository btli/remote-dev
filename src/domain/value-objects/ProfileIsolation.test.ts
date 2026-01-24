import { describe, it, expect } from "vitest";
import { ProfileIsolation } from "./ProfileIsolation";
import { InvalidValueError } from "../errors/DomainError";

describe("ProfileIsolation", () => {
  const profileDir = "/home/user/.remote-dev/profiles/test-profile";
  const realHome = "/home/user";

  describe("create", () => {
    it("should create isolation with valid paths", () => {
      const isolation = ProfileIsolation.create({ profileDir, realHome });

      expect(isolation.getProfileDir()).toBe(profileDir);
      expect(isolation.getRealHome()).toBe(realHome);
    });

    it("should reject non-absolute profileDir", () => {
      expect(() =>
        ProfileIsolation.create({ profileDir: "relative/path", realHome })
      ).toThrow(InvalidValueError);
    });

    it("should reject non-absolute realHome", () => {
      expect(() =>
        ProfileIsolation.create({ profileDir, realHome: "relative/home" })
      ).toThrow(InvalidValueError);
    });

    it("should reject empty profileDir", () => {
      expect(() =>
        ProfileIsolation.create({ profileDir: "", realHome })
      ).toThrow(InvalidValueError);
    });

    it("should accept valid SSH key path", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        sshKeyPath: "/home/user/.ssh/id_ed25519",
      });

      const env = isolation.toEnvironment();
      expect(env.get("GIT_SSH_COMMAND")).toContain("id_ed25519");
    });

    it("should reject SSH key path with dangerous characters", () => {
      expect(() =>
        ProfileIsolation.create({
          profileDir,
          realHome,
          sshKeyPath: "/path/to/key; rm -rf /",
        })
      ).toThrow(InvalidValueError);
    });
  });

  describe("fromProfileDir", () => {
    it("should create isolation with convenience factory", () => {
      const isolation = ProfileIsolation.fromProfileDir(
        profileDir,
        realHome,
        "claude"
      );

      expect(isolation.hasProvider("claude")).toBe(true);
      expect(isolation.hasProvider("codex")).toBe(false);
    });
  });

  describe("XDG directories", () => {
    it("should generate correct XDG_CONFIG_HOME", () => {
      const isolation = ProfileIsolation.create({ profileDir, realHome });

      expect(isolation.getConfigHome()).toBe(
        "/home/user/.remote-dev/profiles/test-profile/.config"
      );
    });

    it("should generate correct XDG_DATA_HOME", () => {
      const isolation = ProfileIsolation.create({ profileDir, realHome });

      expect(isolation.getDataHome()).toBe(
        "/home/user/.remote-dev/profiles/test-profile/.local/share"
      );
    });

    it("should generate correct XDG_CACHE_HOME", () => {
      const isolation = ProfileIsolation.create({ profileDir, realHome });

      expect(isolation.getCacheHome()).toBe(
        "/home/user/.remote-dev/profiles/test-profile/.cache"
      );
    });

    it("should generate correct XDG_STATE_HOME", () => {
      const isolation = ProfileIsolation.create({ profileDir, realHome });

      expect(isolation.getStateHome()).toBe(
        "/home/user/.remote-dev/profiles/test-profile/.local/state"
      );
    });
  });

  describe("git configuration", () => {
    it("should generate correct git config path", () => {
      const isolation = ProfileIsolation.create({ profileDir, realHome });

      expect(isolation.getGitConfigPath()).toBe(
        "/home/user/.remote-dev/profiles/test-profile/.gitconfig"
      );
    });

    it("should include git identity in environment", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        gitIdentity: {
          name: "Test User",
          email: "test@example.com",
        },
      });

      const env = isolation.toEnvironment();
      expect(env.get("GIT_AUTHOR_NAME")).toBe("Test User");
      expect(env.get("GIT_COMMITTER_NAME")).toBe("Test User");
      expect(env.get("GIT_AUTHOR_EMAIL")).toBe("test@example.com");
      expect(env.get("GIT_COMMITTER_EMAIL")).toBe("test@example.com");
    });

    it("should handle SSH key paths with spaces", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        sshKeyPath: "/path/with spaces/key",
      });

      const env = isolation.toEnvironment();
      expect(env.get("GIT_SSH_COMMAND")).toBe(
        "ssh -i '/path/with spaces/key' -o IdentitiesOnly=yes"
      );
    });

    it("should escape single quotes in SSH key path", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        sshKeyPath: "/path/with'quote/key",
      });

      const env = isolation.toEnvironment();
      expect(env.get("GIT_SSH_COMMAND")).toBe(
        "ssh -i '/path/with'\\''quote/key' -o IdentitiesOnly=yes"
      );
    });
  });

  describe("agent-specific directories", () => {
    it("should include all agent configs when provider is 'all'", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "all",
      });

      const env = isolation.toEnvironment();
      expect(env.has("CLAUDE_CONFIG_DIR")).toBe(true);
      expect(env.has("CODEX_HOME")).toBe(true);
      expect(env.has("GEMINI_HOME")).toBe(true);
      expect(env.has("OPENCODE_CONFIG_DIR")).toBe(true);
    });

    it("should only include claude config when provider is 'claude'", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "claude",
      });

      const env = isolation.toEnvironment();
      expect(env.has("CLAUDE_CONFIG_DIR")).toBe(true);
      expect(env.has("CODEX_HOME")).toBe(false);
      expect(env.has("GEMINI_HOME")).toBe(false);
      expect(env.has("OPENCODE_CONFIG_DIR")).toBe(false);
    });

    it("should generate correct Claude config path", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "claude",
      });

      expect(isolation.getClaudeConfigDir()).toBe(
        "/home/user/.remote-dev/profiles/test-profile/.claude"
      );
    });

    it("should generate correct OpenCode config path", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "opencode",
      });

      expect(isolation.getOpenCodeConfigDir()).toBe(
        "/home/user/.remote-dev/profiles/test-profile/.config/opencode"
      );
    });
  });

  describe("toEnvironment", () => {
    it("should NOT include HOME in environment", () => {
      const isolation = ProfileIsolation.create({ profileDir, realHome });
      const env = isolation.toEnvironment();

      // Critical: HOME should NOT be overridden
      expect(env.has("HOME")).toBe(false);
    });

    it("should include all XDG variables", () => {
      const isolation = ProfileIsolation.create({ profileDir, realHome });
      const env = isolation.toEnvironment();

      expect(env.has("XDG_CONFIG_HOME")).toBe(true);
      expect(env.has("XDG_DATA_HOME")).toBe(true);
      expect(env.has("XDG_CACHE_HOME")).toBe(true);
      expect(env.has("XDG_STATE_HOME")).toBe(true);
    });

    it("should include git config path", () => {
      const isolation = ProfileIsolation.create({ profileDir, realHome });
      const env = isolation.toEnvironment();

      expect(env.has("GIT_CONFIG_GLOBAL")).toBe(true);
    });

    it("should return TmuxEnvironment instance", () => {
      const isolation = ProfileIsolation.create({ profileDir, realHome });
      const env = isolation.toEnvironment();

      // TmuxEnvironment has specific methods
      expect(typeof env.toRecord).toBe("function");
      expect(typeof env.merge).toBe("function");
    });
  });

  describe("toEnvironmentForProvider", () => {
    it("should return full environment when provider matches", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "claude",
      });

      const env = isolation.toEnvironmentForProvider("claude");
      expect(env.has("CLAUDE_CONFIG_DIR")).toBe(true);
    });

    it("should return environment with specific provider from 'all'", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "all",
      });

      const env = isolation.toEnvironmentForProvider("codex");
      expect(env.has("CODEX_HOME")).toBe(true);
    });
  });

  describe("hasProvider", () => {
    it("should return true for matching provider", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "claude",
      });

      expect(isolation.hasProvider("claude")).toBe(true);
    });

    it("should return false for non-matching provider", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "claude",
      });

      expect(isolation.hasProvider("codex")).toBe(false);
    });

    it("should return true for any provider when set to 'all'", () => {
      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "all",
      });

      expect(isolation.hasProvider("claude")).toBe(true);
      expect(isolation.hasProvider("codex")).toBe(true);
      expect(isolation.hasProvider("gemini")).toBe(true);
      expect(isolation.hasProvider("opencode")).toBe(true);
    });
  });

  describe("equals", () => {
    it("should return true for equal isolations", () => {
      const a = ProfileIsolation.create({ profileDir, realHome });
      const b = ProfileIsolation.create({ profileDir, realHome });

      expect(a.equals(b)).toBe(true);
    });

    it("should return false for different profileDir", () => {
      const a = ProfileIsolation.create({ profileDir, realHome });
      const b = ProfileIsolation.create({
        profileDir: "/other/profile",
        realHome,
      });

      expect(a.equals(b)).toBe(false);
    });

    it("should return false for different provider", () => {
      const a = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "claude",
      });
      const b = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "codex",
      });

      expect(a.equals(b)).toBe(false);
    });
  });
});
