import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EnvironmentManager,
  type PreferencesAdapter,
  type AgentProfileAdapter,
  type SecretsAdapter,
} from "./EnvironmentManager";
import type { EnvironmentGateway } from "@/application/ports/EnvironmentGateway";
import { TmuxEnvironment } from "@/domain/value-objects/TmuxEnvironment";

describe("EnvironmentManager", () => {
  let mockEnvironmentGateway: EnvironmentGateway;
  let mockPreferencesAdapter: PreferencesAdapter;
  let mockAgentProfileAdapter: AgentProfileAdapter;
  let mockSecretsAdapter: SecretsAdapter;
  let manager: EnvironmentManager;

  beforeEach(() => {
    vi.resetAllMocks();

    mockEnvironmentGateway = {
      getProcessEnvironment: vi.fn().mockReturnValue(TmuxEnvironment.empty()),
      getSystemDefaults: vi.fn().mockReturnValue(
        TmuxEnvironment.create({
          HOME: "/home/user",
          USER: "testuser",
          SHELL: "/bin/bash",
          PATH: "/usr/bin:/bin",
          TERM: "xterm-256color",
        })
      ),
      validateForShell: vi.fn().mockReturnValue(true),
      get: vi.fn(),
      has: vi.fn(),
      getHome: vi.fn().mockReturnValue("/home/user"),
      getUser: vi.fn().mockReturnValue("testuser"),
      getShell: vi.fn().mockReturnValue("/bin/bash"),
    };

    mockPreferencesAdapter = {
      getEnvironmentForSession: vi.fn().mockResolvedValue(null),
    };

    mockAgentProfileAdapter = {
      getProfile: vi.fn().mockResolvedValue(null),
    };

    mockSecretsAdapter = {
      fetchSecretsForSession: vi.fn().mockResolvedValue(null),
    };

    manager = new EnvironmentManager(
      mockEnvironmentGateway,
      mockPreferencesAdapter,
      mockAgentProfileAdapter,
      mockSecretsAdapter
    );
  });

  describe("resolveStack", () => {
    it("should include base system defaults", async () => {
      const stack = await manager.resolveStack({ userId: "user-1" });

      expect(stack.base.get("HOME")).toBe("/home/user");
      expect(stack.base.get("USER")).toBe("testuser");
      expect(stack.base.get("SHELL")).toBe("/bin/bash");
    });

    it("should include folder environment when folderId provided", async () => {
      (mockPreferencesAdapter.getEnvironmentForSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        NODE_ENV: "development",
        PORT: "3000",
      });

      const stack = await manager.resolveStack({
        userId: "user-1",
        folderId: "folder-1",
      });

      expect(stack.folder.get("NODE_ENV")).toBe("development");
      expect(stack.folder.get("PORT")).toBe("3000");
    });

    it("should include profile isolation when profileId provided", async () => {
      (mockAgentProfileAdapter.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
        configDir: "/home/user/.remote-dev/profiles/profile-1",
        provider: "claude",
      });

      const stack = await manager.resolveStack({
        userId: "user-1",
        profileId: "profile-1",
      });

      expect(stack.profile.get("XDG_CONFIG_HOME")).toBe(
        "/home/user/.remote-dev/profiles/profile-1/.config"
      );
      expect(stack.profile.get("CLAUDE_CONFIG_DIR")).toBe(
        "/home/user/.remote-dev/profiles/profile-1/.claude"
      );
      // HOME should NOT be in profile (we don't override it)
      expect(stack.profile.has("HOME")).toBe(false);
    });

    it("should include secrets when includeSecrets is true", async () => {
      (mockSecretsAdapter.fetchSecretsForSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        ANTHROPIC_API_KEY: "sk-ant-xxx",
        OPENAI_API_KEY: "sk-xxx",
      });

      const stack = await manager.resolveStack({
        userId: "user-1",
        includeSecrets: true,
      });

      expect(stack.secrets.get("ANTHROPIC_API_KEY")).toBe("sk-ant-xxx");
      expect(stack.secrets.get("OPENAI_API_KEY")).toBe("sk-xxx");
    });

    it("should not include secrets when includeSecrets is false", async () => {
      (mockSecretsAdapter.fetchSecretsForSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        ANTHROPIC_API_KEY: "sk-ant-xxx",
      });

      const stack = await manager.resolveStack({
        userId: "user-1",
        includeSecrets: false,
      });

      expect(stack.secrets.isEmpty()).toBe(true);
      expect(mockSecretsAdapter.fetchSecretsForSession).not.toHaveBeenCalled();
    });

    it("should merge layers with later layers taking precedence", async () => {
      // Base has PATH
      (mockEnvironmentGateway.getSystemDefaults as ReturnType<typeof vi.fn>).mockReturnValue(
        TmuxEnvironment.create({
          PATH: "/usr/bin",
          TERM: "xterm",
        })
      );

      // Folder overrides PATH
      (mockPreferencesAdapter.getEnvironmentForSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        PATH: "/usr/local/bin:/usr/bin",
        MY_VAR: "folder",
      });

      // Profile adds XDG
      (mockAgentProfileAdapter.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
        configDir: "/home/user/.remote-dev/profiles/p1",
      });

      const stack = await manager.resolveStack({
        userId: "user-1",
        folderId: "folder-1",
        profileId: "profile-1",
      });

      // Folder overrides base PATH
      expect(stack.merged.get("PATH")).toBe("/usr/local/bin:/usr/bin");
      // Base TERM remains (not overridden)
      expect(stack.merged.get("TERM")).toBe("xterm");
      // Folder MY_VAR is included
      expect(stack.merged.get("MY_VAR")).toBe("folder");
      // Profile XDG is included
      expect(stack.merged.get("XDG_CONFIG_HOME")).toBeDefined();
    });
  });

  describe("getEnvironmentForSession", () => {
    it("should return merged environment with secrets", async () => {
      (mockPreferencesAdapter.getEnvironmentForSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        NODE_ENV: "production",
      });
      (mockSecretsAdapter.fetchSecretsForSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        API_KEY: "secret",
      });

      const env = await manager.getEnvironmentForSession("user-1", "folder-1");

      expect(env.get("HOME")).toBe("/home/user"); // From base
      expect(env.get("NODE_ENV")).toBe("production"); // From folder
      expect(env.get("API_KEY")).toBe("secret"); // From secrets
    });
  });

  describe("getEnvironmentWithoutSecrets", () => {
    it("should return merged environment without secrets", async () => {
      (mockPreferencesAdapter.getEnvironmentForSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        NODE_ENV: "production",
      });
      (mockSecretsAdapter.fetchSecretsForSession as ReturnType<typeof vi.fn>).mockResolvedValue({
        API_KEY: "secret",
      });

      const env = await manager.getEnvironmentWithoutSecrets("user-1", "folder-1");

      expect(env.get("HOME")).toBe("/home/user"); // From base
      expect(env.get("NODE_ENV")).toBe("production"); // From folder
      expect(env.has("API_KEY")).toBe(false); // Secrets excluded
    });
  });

  describe("empty responses", () => {
    it("should handle null folder environment", async () => {
      (mockPreferencesAdapter.getEnvironmentForSession as ReturnType<typeof vi.fn>).mockResolvedValue(
        null
      );

      const stack = await manager.resolveStack({
        userId: "user-1",
        folderId: "folder-1",
      });

      expect(stack.folder.isEmpty()).toBe(true);
    });

    it("should handle null profile", async () => {
      (mockAgentProfileAdapter.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const stack = await manager.resolveStack({
        userId: "user-1",
        profileId: "profile-1",
      });

      expect(stack.profile.isEmpty()).toBe(true);
    });

    it("should handle null secrets", async () => {
      (mockSecretsAdapter.fetchSecretsForSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const stack = await manager.resolveStack({ userId: "user-1" });

      expect(stack.secrets.isEmpty()).toBe(true);
    });
  });

  describe("agent provider", () => {
    it("should use agent provider from options", async () => {
      (mockAgentProfileAdapter.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
        configDir: "/home/user/.remote-dev/profiles/p1",
        provider: "all",
      });

      const stack = await manager.resolveStack({
        userId: "user-1",
        profileId: "profile-1",
        agentProvider: "claude",
      });

      // Should have Claude-specific config
      expect(stack.profile.get("CLAUDE_CONFIG_DIR")).toBeDefined();
      // Should not have Codex (since provider is specifically claude)
      expect(stack.profile.has("CODEX_HOME")).toBe(false);
    });
  });
});
