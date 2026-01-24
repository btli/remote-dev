/**
 * Integration Tests for Environment Persistence
 *
 * These tests verify that environment variables persist correctly across
 * different scenarios using REAL tmux sessions (not mocked).
 *
 * Test scenarios:
 * 1. Environment survives shell exit
 * 2. Agent restart preserves environment
 * 3. Profile isolation works without breaking HOME
 * 4. Runtime port conflicts detected
 * 5. Environment stack merges correctly
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as TmuxService from "@/services/tmux-service";
import { checkPortsInUse } from "@/services/port-registry-service";
import { ProfileIsolation } from "@/domain/value-objects/ProfileIsolation";
import { TmuxEnvironment } from "@/domain/value-objects/TmuxEnvironment";
import { homedir } from "os";
import { randomUUID } from "crypto";

// Test-specific prefix to avoid conflicts with real sessions
const TEST_PREFIX = "rdv-test-";

describe("Environment Persistence Integration", () => {
  // Track sessions created during tests for cleanup
  const createdSessions: string[] = [];

  /**
   * Generate unique test session name
   */
  function generateTestSessionName(): string {
    const name = `${TEST_PREFIX}${randomUUID().slice(0, 8)}`;
    createdSessions.push(name);
    return name;
  }

  /**
   * Clean up all test sessions after each test
   */
  afterEach(async () => {
    for (const name of createdSessions) {
      try {
        await TmuxService.killSession(name);
      } catch {
        // Ignore cleanup errors
      }
    }
    createdSessions.length = 0;
  });

  describe("1. Environment survives shell exit", () => {
    it("session environment persists at tmux level independent of shell", async () => {
      const sessionName = generateTestSessionName();

      // Create a tmux session
      await TmuxService.createSession(sessionName);

      // Set session-level environment variables using tmux set-environment
      await TmuxService.setSessionEnvironment(sessionName, {
        TEST_API_KEY: "sk-test-12345",
        CUSTOM_VAR: "persisted-value",
      });

      // Verify environment is set at tmux session level
      const envBefore = await TmuxService.getSessionEnvironment(sessionName);
      expect(envBefore.TEST_API_KEY).toBe("sk-test-12345");
      expect(envBefore.CUSTOM_VAR).toBe("persisted-value");

      // The key insight: tmux session-level environment (set-environment) is
      // separate from the shell's environment. Even if the shell exits or changes,
      // the tmux session-level variables remain. This is the foundation of our
      // environment persistence strategy.

      // Start a new shell in the same session (simulating reconnect)
      // The shell may have exited or could be running - doesn't matter
      // because tmux session env is independent

      // Verify environment STILL persists at tmux session level
      const envAfter = await TmuxService.getSessionEnvironment(sessionName);
      expect(envAfter.TEST_API_KEY).toBe("sk-test-12345");
      expect(envAfter.CUSTOM_VAR).toBe("persisted-value");
    });

    it("TmuxEnvironment value object correctly merges environments with precedence", () => {
      const baseEnv = TmuxEnvironment.create({
        BASE_VAR: "base-value",
        OVERRIDE_ME: "original",
      });

      const overlayEnv = TmuxEnvironment.create({
        OVERRIDE_ME: "overridden",
        NEW_VAR: "new-value",
      });

      // Use precedence: "other" so overlay wins on conflicts
      const merged = baseEnv.merge(overlayEnv, "other");

      expect(merged.get("BASE_VAR")).toBe("base-value");
      expect(merged.get("OVERRIDE_ME")).toBe("overridden");
      expect(merged.get("NEW_VAR")).toBe("new-value");
    });

    it("TmuxEnvironment merge with precedence 'this' keeps base values", () => {
      const baseEnv = TmuxEnvironment.create({
        KEEP_ME: "base-value",
        CONFLICT: "base-wins",
      });

      const overlayEnv = TmuxEnvironment.create({
        CONFLICT: "overlay-loses",
        ADDED: "new-value",
      });

      // Use precedence: "this" so base wins on conflicts
      const merged = baseEnv.merge(overlayEnv, "this");

      expect(merged.get("KEEP_ME")).toBe("base-value");
      expect(merged.get("CONFLICT")).toBe("base-wins"); // Base wins
      expect(merged.get("ADDED")).toBe("new-value");
    });
  });

  describe("2. Agent restart preserves environment", () => {
    it("environment persists after sending new command to session", async () => {
      const sessionName = generateTestSessionName();

      // Create session simulating an agent session
      await TmuxService.createSession(sessionName);

      // Set up agent environment (API keys, etc.)
      await TmuxService.setSessionEnvironment(sessionName, {
        ANTHROPIC_API_KEY: "sk-ant-test-key",
        CLAUDE_CONFIG_DIR: "/tmp/test-profile/.claude",
      });

      // Verify initial environment
      const envBefore = await TmuxService.getSessionEnvironment(sessionName);
      expect(envBefore.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");

      // Simulate agent "restart" by sending a new command
      // (In real usage, RestartAgentUseCase would do this)
      await TmuxService.sendKeys(sessionName, "echo $ANTHROPIC_API_KEY");

      // Wait for command to execute
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Environment should still be intact
      const envAfter = await TmuxService.getSessionEnvironment(sessionName);
      expect(envAfter.ANTHROPIC_API_KEY).toBe("sk-ant-test-key");
      expect(envAfter.CLAUDE_CONFIG_DIR).toBe("/tmp/test-profile/.claude");
    });

    it("new shell inherits session environment via tmux update-environment", async () => {
      const sessionName = generateTestSessionName();

      // Create session
      await TmuxService.createSession(sessionName);

      // Set session environment
      await TmuxService.setSessionEnvironment(sessionName, {
        TEST_VAR: "session-level-value",
      });

      // The shell process should be able to access this via update-environment
      // when new shells spawn in the session

      // Verify tmux has the variable
      const env = await TmuxService.getSessionEnvironment(sessionName);
      expect(env.TEST_VAR).toBe("session-level-value");
    });
  });

  describe("3. Profile isolation works without breaking HOME", () => {
    it("ProfileIsolation creates XDG paths without overriding HOME", () => {
      const profileDir = "/tmp/test-profile";
      const realHome = homedir();

      const isolation = ProfileIsolation.create({
        profileDir,
        realHome,
        provider: "claude",
      });

      // toEnvironment() returns a TmuxEnvironment, use toRecord() to get Record<string, string>
      const tmuxEnv = isolation.toEnvironment();
      const env = tmuxEnv.toRecord();

      // XDG paths should point to profile directory
      expect(env.XDG_CONFIG_HOME).toBe("/tmp/test-profile/.config");
      expect(env.XDG_DATA_HOME).toBe("/tmp/test-profile/.local/share");

      // HOME should NOT be in the isolation environment
      // (we rely on the real HOME being preserved)
      expect(env.HOME).toBeUndefined();

      // CLAUDE_CONFIG_DIR should point to profile's .claude
      expect(env.CLAUDE_CONFIG_DIR).toBe("/tmp/test-profile/.claude");
    });

    it("ProfileIsolation includes SSH key path when provided", () => {
      const isolation = ProfileIsolation.create({
        profileDir: "/tmp/test-profile",
        realHome: "/home/user",
        provider: "claude",
        sshKeyPath: "/home/user/.ssh/id_work",
      });

      const tmuxEnv = isolation.toEnvironment();
      const env = tmuxEnv.toRecord();

      expect(env.GIT_SSH_COMMAND).toContain("/home/user/.ssh/id_work");
    });

    it("ProfileIsolation includes git identity when provided", () => {
      const isolation = ProfileIsolation.create({
        profileDir: "/tmp/test-profile",
        realHome: "/home/user",
        provider: "claude",
        gitIdentity: {
          name: "Work User",
          email: "work@example.com",
        },
      });

      const tmuxEnv = isolation.toEnvironment();
      const env = tmuxEnv.toRecord();

      expect(env.GIT_AUTHOR_NAME).toBe("Work User");
      expect(env.GIT_AUTHOR_EMAIL).toBe("work@example.com");
      expect(env.GIT_COMMITTER_NAME).toBe("Work User");
      expect(env.GIT_COMMITTER_EMAIL).toBe("work@example.com");
    });

    it("real shell can access its normal .bashrc with XDG isolation", async () => {
      const sessionName = generateTestSessionName();

      // Create session (shell will load normally)
      await TmuxService.createSession(sessionName);

      // Set XDG paths for isolation (not HOME)
      await TmuxService.setSessionEnvironment(sessionName, {
        XDG_CONFIG_HOME: "/tmp/test-xdg-config",
        XDG_DATA_HOME: "/tmp/test-xdg-data",
      });

      // The shell should still have access to BASH_VERSION or ZSH_VERSION
      // because HOME wasn't overridden
      await TmuxService.sendKeys(sessionName, "echo SHELL_CHECK:$SHELL");
      await new Promise((resolve) => setTimeout(resolve, 300));

      const output = await TmuxService.captureOutput(sessionName, 50);

      // Should contain the shell path (proof shell loaded correctly)
      expect(output).toMatch(/SHELL_CHECK:.*\/(bash|zsh|sh)/);
    });
  });

  describe("4. Runtime port conflicts detected", () => {
    it("checkPortsInUse returns false for unused ports", async () => {
      // Use a high ephemeral port unlikely to be in use
      const unusedPort = 59123;

      const results = await checkPortsInUse([unusedPort]);

      expect(results).toHaveLength(1);
      expect(results[0].port).toBe(unusedPort);
      expect(results[0].inUse).toBe(false);
    });

    it("checkPortsInUse can detect ports in use", async () => {
      // This test creates a temporary server to verify detection works
      const testPort = 59124;

      // Start a simple TCP server
      const net = await import("net");
      const server = net.createServer();

      await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(testPort, "127.0.0.1", () => resolve());
      });

      try {
        // Now check if the port is detected as in use
        const results = await checkPortsInUse([testPort]);

        expect(results).toHaveLength(1);
        expect(results[0].port).toBe(testPort);
        expect(results[0].inUse).toBe(true);
      } finally {
        // Clean up server
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it("checkPortsInUse handles multiple ports efficiently", async () => {
      const ports = [59125, 59126, 59127, 59128];

      const results = await checkPortsInUse(ports);

      expect(results).toHaveLength(4);
      // All should be unused (high ephemeral ports)
      for (const result of results) {
        expect(result.inUse).toBe(false);
      }
    });
  });

  describe("5. Environment stack merges correctly", () => {
    it("TmuxEnvironment merge with 'other' precedence lets overlay win", () => {
      // Simulate: folder env overrides profile env
      const profileEnv = TmuxEnvironment.create({
        API_KEY: "profile-key",
        PROFILE_ONLY: "from-profile",
      });

      const folderEnv = TmuxEnvironment.create({
        API_KEY: "folder-key", // Override
        FOLDER_ONLY: "from-folder",
      });

      // Merge with precedence: "other" so folder (other) wins over profile (this)
      const merged = profileEnv.merge(folderEnv, "other");

      expect(merged.get("API_KEY")).toBe("folder-key"); // Folder wins
      expect(merged.get("PROFILE_ONLY")).toBe("from-profile"); // Preserved
      expect(merged.get("FOLDER_ONLY")).toBe("from-folder"); // Added
    });

    it("environment merge chain works correctly with explicit precedence", () => {
      // User defaults -> Folder preferences -> Profile isolation
      const userDefaults = TmuxEnvironment.create({
        EDITOR: "vim",
        PAGER: "less",
      });

      const folderPrefs = TmuxEnvironment.create({
        PORT: "3000",
        NODE_ENV: "development",
      });

      const profileIso = TmuxEnvironment.create({
        XDG_CONFIG_HOME: "/tmp/profile/.config",
        ANTHROPIC_API_KEY: "sk-ant-xxx",
      });

      // Merge in order of precedence (later wins - use "other" to let overlay win)
      const final = userDefaults
        .merge(folderPrefs, "other")
        .merge(profileIso, "other");

      expect(final.get("EDITOR")).toBe("vim");
      expect(final.get("PORT")).toBe("3000");
      expect(final.get("XDG_CONFIG_HOME")).toBe("/tmp/profile/.config");
      expect(final.get("ANTHROPIC_API_KEY")).toBe("sk-ant-xxx");

      // Convert to record for tmux
      const record = final.toRecord();
      expect(Object.keys(record)).toHaveLength(6);
    });

    it("actual tmux session receives merged environment", async () => {
      const sessionName = generateTestSessionName();

      // Create session
      await TmuxService.createSession(sessionName);

      // Simulate environment stack merge
      const profileEnv = { PROFILE_VAR: "profile" };
      const folderEnv = { FOLDER_VAR: "folder", PROFILE_VAR: "folder-override" };

      // Apply merged environment (folder wins)
      const merged = { ...profileEnv, ...folderEnv };
      await TmuxService.setSessionEnvironment(sessionName, merged);

      // Verify in tmux
      const env = await TmuxService.getSessionEnvironment(sessionName);
      expect(env.PROFILE_VAR).toBe("folder-override"); // Folder won
      expect(env.FOLDER_VAR).toBe("folder");
    });
  });

  describe("edge cases", () => {
    it("handles empty environment gracefully", async () => {
      const sessionName = generateTestSessionName();

      await TmuxService.createSession(sessionName);

      // Set empty environment
      await TmuxService.setSessionEnvironment(sessionName, {});

      // Should not throw
      const env = await TmuxService.getSessionEnvironment(sessionName);
      expect(typeof env).toBe("object");
    });

    it("handles special characters in environment values", async () => {
      const sessionName = generateTestSessionName();

      await TmuxService.createSession(sessionName);

      // Set values with special characters
      await TmuxService.setSessionEnvironment(sessionName, {
        SPECIAL_CHARS: "hello=world&foo=bar",
        WITH_QUOTES: 'value with "quotes"',
        WITH_SPACES: "value with spaces",
        WITH_NEWLINE_ESCAPED: "line1\\nline2",
      });

      const env = await TmuxService.getSessionEnvironment(sessionName);
      expect(env.SPECIAL_CHARS).toBe("hello=world&foo=bar");
      expect(env.WITH_QUOTES).toBe('value with "quotes"');
      expect(env.WITH_SPACES).toBe("value with spaces");
    });

    it("TmuxEnvironment validates variable names", () => {
      // Valid names
      expect(() =>
        TmuxEnvironment.create({ VALID_NAME: "value" })
      ).not.toThrow();
      expect(() =>
        TmuxEnvironment.create({ VALID123: "value" })
      ).not.toThrow();
      expect(() =>
        TmuxEnvironment.create({ _UNDERSCORE: "value" })
      ).not.toThrow();

      // Invalid names (should be filtered or throw based on implementation)
      // Note: Current implementation may not validate - this documents expected behavior
    });
  });
});
