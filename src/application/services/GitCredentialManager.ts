/**
 * GitCredentialManager - Application service for git credential suppression.
 *
 * Orchestrates the setup and teardown of git credential configuration
 * for terminal sessions. Handles two modes:
 *
 * 1. **Profile sessions**: The profile's .gitconfig already has [credential]
 *    section from initialization. Only GIT_TERMINAL_PROMPT=0 is injected.
 *
 * 2. **Non-profile sessions**: A session-scoped .gitconfig is written to
 *    ~/.remote-dev/session-gitconfigs/{sessionId}.gitconfig with the gh
 *    credential helper configured. GIT_CONFIG_GLOBAL points to it.
 *
 * The gh credential helper reads GH_CONFIG_DIR (set by GitHubAccountEnvironment)
 * to authenticate as the correct GitHub account automatically.
 */

import { GitCredentialConfig } from "@/domain/value-objects/GitCredentialConfig";
import { TmuxEnvironment } from "@/domain/value-objects/TmuxEnvironment";
import type { SessionGitConfigGateway } from "@/application/ports/SessionGitConfigGateway";

export class GitCredentialManager {
  private credentialConfig: GitCredentialConfig | null = null;

  constructor(private readonly gateway: SessionGitConfigGateway) {}

  /**
   * Build the environment variables to inject for credential suppression.
   *
   * For profile sessions: returns only GIT_TERMINAL_PROMPT=0
   * (the profile's .gitconfig already has [credential] configured).
   *
   * For non-profile sessions: writes a session-scoped .gitconfig with the
   * gh credential helper and returns GIT_TERMINAL_PROMPT=0 + GIT_CONFIG_GLOBAL.
   */
  async buildSessionEnv(
    sessionId: string,
    hasProfile: boolean
  ): Promise<TmuxEnvironment> {
    const config = await this.getOrCreateConfig();

    if (hasProfile) {
      return config.toBaseEnvironment();
    }

    // Non-profile session: write a session-scoped gitconfig
    const content = config.toGitConfigSection();
    const configPath = await this.gateway.writeSessionGitConfig(
      sessionId,
      content
    );
    return config.toSessionEnvironment(configPath);
  }

  /**
   * Generate the [credential] section content for a profile's .gitconfig.
   * Called during profile initialization and git identity updates.
   */
  async getCredentialSection(): Promise<string> {
    const config = await this.getOrCreateConfig();
    return config.toGitConfigSection();
  }

  /**
   * Clean up the session-scoped .gitconfig on session close.
   */
  async cleanupSession(sessionId: string): Promise<void> {
    await this.gateway.removeSessionGitConfig(sessionId);
  }

  /**
   * Lazily resolve the gh binary path and create the config.
   */
  private async getOrCreateConfig(): Promise<GitCredentialConfig> {
    if (!this.credentialConfig) {
      const ghPath = await this.gateway.resolveGhBinaryPath();
      this.credentialConfig = GitCredentialConfig.create(ghPath);
    }
    return this.credentialConfig;
  }
}
