/**
 * ProfileIsolation - Value object for XDG-compliant profile isolation.
 *
 * This value object generates environment variables for isolating agent profile
 * configurations WITHOUT overriding the user's HOME directory. Instead, it uses
 * the XDG Base Directory Specification to redirect config/data/cache directories.
 *
 * Benefits of XDG isolation over HOME override:
 * - User's shell dotfiles (.bashrc, .zshrc) still load from real HOME
 * - SSH keys and GPG keys remain accessible from real HOME
 * - Agent configs are isolated to profile-specific directories
 * - Most modern tools respect XDG variables
 *
 * XDG Base Directory Spec: https://specifications.freedesktop.org/basedir-spec/latest/
 */

import { join } from "path";
import { InvalidValueError } from "../errors/DomainError";
import { TmuxEnvironment } from "./TmuxEnvironment";

/**
 * Supported agent providers for profile-specific config directories.
 */
export type AgentProvider = "claude" | "codex" | "gemini" | "opencode" | "all";

export interface ProfileIsolationOptions {
  /** The profile directory (e.g., ~/.remote-dev/profiles/{id}/) */
  profileDir: string;
  /** The user's real HOME directory */
  realHome: string;
  /** Agent provider(s) to generate config paths for */
  provider?: AgentProvider;
  /** Optional SSH key path for git operations */
  sshKeyPath?: string;
  /** Optional git identity (name, email) */
  gitIdentity?: {
    name?: string;
    email?: string;
  };
}

export class ProfileIsolation {
  private readonly profileDir: string;
  private readonly realHome: string;
  private readonly provider: AgentProvider;
  private readonly sshKeyPath?: string;
  private readonly gitIdentity?: { name?: string; email?: string };

  private constructor(options: ProfileIsolationOptions) {
    this.profileDir = options.profileDir;
    this.realHome = options.realHome;
    this.provider = options.provider ?? "all";
    this.sshKeyPath = options.sshKeyPath;
    this.gitIdentity = options.gitIdentity;
  }

  /**
   * Create a ProfileIsolation instance.
   * @throws InvalidValueError if profileDir or realHome is invalid
   */
  static create(options: ProfileIsolationOptions): ProfileIsolation {
    ProfileIsolation.validatePath("profileDir", options.profileDir);
    ProfileIsolation.validatePath("realHome", options.realHome);

    if (options.sshKeyPath) {
      ProfileIsolation.validateSshKeyPath(options.sshKeyPath);
    }

    return new ProfileIsolation(options);
  }

  /**
   * Convenience factory for creating with minimal options.
   */
  static fromProfileDir(
    profileDir: string,
    realHome: string,
    provider?: AgentProvider
  ): ProfileIsolation {
    return ProfileIsolation.create({ profileDir, realHome, provider });
  }

  private static validatePath(name: string, path: string): void {
    if (!path || typeof path !== "string") {
      throw new InvalidValueError(
        `ProfileIsolation.${name}`,
        path,
        "Must be a non-empty string"
      );
    }

    if (!path.startsWith("/")) {
      throw new InvalidValueError(
        `ProfileIsolation.${name}`,
        path,
        "Must be an absolute path"
      );
    }
  }

  private static validateSshKeyPath(path: string): void {
    if (!path || typeof path !== "string") {
      throw new InvalidValueError(
        "ProfileIsolation.sshKeyPath",
        path,
        "Must be a non-empty string"
      );
    }

    // SSH key paths can be relative or absolute, but should not contain
    // shell special characters that could cause injection
    if (/[`$;|&]/.test(path)) {
      throw new InvalidValueError(
        "ProfileIsolation.sshKeyPath",
        path,
        "Contains potentially dangerous characters"
      );
    }
  }

  /**
   * Get the XDG_CONFIG_HOME path.
   * Default: ~/.config
   */
  getConfigHome(): string {
    return join(this.profileDir, ".config");
  }

  /**
   * Get the XDG_DATA_HOME path.
   * Default: ~/.local/share
   */
  getDataHome(): string {
    return join(this.profileDir, ".local", "share");
  }

  /**
   * Get the XDG_CACHE_HOME path.
   * Default: ~/.cache
   */
  getCacheHome(): string {
    return join(this.profileDir, ".cache");
  }

  /**
   * Get the XDG_STATE_HOME path.
   * Default: ~/.local/state
   */
  getStateHome(): string {
    return join(this.profileDir, ".local", "state");
  }

  /**
   * Get the git config file path.
   * Uses GIT_CONFIG_GLOBAL for profile-specific git config.
   */
  getGitConfigPath(): string {
    return join(this.profileDir, ".gitconfig");
  }

  /**
   * Get the Claude Code config directory.
   */
  getClaudeConfigDir(): string {
    return join(this.profileDir, ".claude");
  }

  /**
   * Get the Codex config directory.
   */
  getCodexHome(): string {
    return join(this.profileDir, ".codex");
  }

  /**
   * Get the Gemini config directory.
   */
  getGeminiHome(): string {
    return join(this.profileDir, ".gemini");
  }

  /**
   * Get the OpenCode config directory.
   */
  getOpenCodeConfigDir(): string {
    return join(this.profileDir, ".config", "opencode");
  }

  /**
   * Convert to a TmuxEnvironment with all isolation variables.
   *
   * IMPORTANT: Does NOT include HOME. The user's real HOME is preserved
   * so that shell startup files (.bashrc, .zshrc) load correctly.
   */
  toEnvironment(): TmuxEnvironment {
    const env: Record<string, string> = {};

    // XDG Base Directory variables
    env.XDG_CONFIG_HOME = this.getConfigHome();
    env.XDG_DATA_HOME = this.getDataHome();
    env.XDG_CACHE_HOME = this.getCacheHome();
    env.XDG_STATE_HOME = this.getStateHome();

    // Git configuration
    env.GIT_CONFIG_GLOBAL = this.getGitConfigPath();

    // Add git identity if provided
    if (this.gitIdentity?.name) {
      env.GIT_AUTHOR_NAME = this.gitIdentity.name;
      env.GIT_COMMITTER_NAME = this.gitIdentity.name;
    }
    if (this.gitIdentity?.email) {
      env.GIT_AUTHOR_EMAIL = this.gitIdentity.email;
      env.GIT_COMMITTER_EMAIL = this.gitIdentity.email;
    }

    // SSH key for git operations
    if (this.sshKeyPath) {
      // Properly escape the path for use in ssh command
      const escapedPath = this.sshKeyPath.replace(/'/g, "'\\''");
      env.GIT_SSH_COMMAND = `ssh -i '${escapedPath}' -o IdentitiesOnly=yes`;
    }

    // Agent-specific config directories
    if (this.provider === "all" || this.provider === "claude") {
      env.CLAUDE_CONFIG_DIR = this.getClaudeConfigDir();
    }
    if (this.provider === "all" || this.provider === "codex") {
      env.CODEX_HOME = this.getCodexHome();
    }
    if (this.provider === "all" || this.provider === "gemini") {
      env.GEMINI_HOME = this.getGeminiHome();
    }
    if (this.provider === "all" || this.provider === "opencode") {
      env.OPENCODE_CONFIG_DIR = this.getOpenCodeConfigDir();
    }

    return TmuxEnvironment.create(env);
  }

  /**
   * Get a subset of environment for a specific agent provider.
   */
  toEnvironmentForProvider(provider: AgentProvider): TmuxEnvironment {
    if (provider === this.provider || this.provider === "all") {
      // If this isolation already matches, just return full environment
      return this.toEnvironment();
    }

    // Create a new isolation with the specific provider
    const specific = ProfileIsolation.create({
      profileDir: this.profileDir,
      realHome: this.realHome,
      provider,
      sshKeyPath: this.sshKeyPath,
      gitIdentity: this.gitIdentity,
    });

    return specific.toEnvironment();
  }

  /**
   * Check if this isolation includes a specific provider.
   */
  hasProvider(provider: AgentProvider): boolean {
    return this.provider === "all" || this.provider === provider;
  }

  /**
   * Get the profile directory.
   */
  getProfileDir(): string {
    return this.profileDir;
  }

  /**
   * Get the real HOME directory.
   */
  getRealHome(): string {
    return this.realHome;
  }

  /**
   * Value equality check.
   */
  equals(other: ProfileIsolation): boolean {
    return (
      this.profileDir === other.profileDir &&
      this.realHome === other.realHome &&
      this.provider === other.provider &&
      this.sshKeyPath === other.sshKeyPath &&
      this.gitIdentity?.name === other.gitIdentity?.name &&
      this.gitIdentity?.email === other.gitIdentity?.email
    );
  }
}
