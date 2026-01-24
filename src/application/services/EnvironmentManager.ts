/**
 * EnvironmentManager - Domain service for resolving session environment stacks.
 *
 * This service orchestrates the resolution of environment variables from multiple
 * sources (system defaults, user preferences, folder preferences, profile isolation,
 * and secrets) and merges them into a single TmuxEnvironment for session creation.
 *
 * The merge order follows a layered approach where later layers override earlier ones:
 * 1. Base/System defaults (HOME, USER, SHELL, PATH, TERM)
 * 2. Folder environment variables
 * 3. Profile isolation (XDG variables, agent config paths)
 * 4. Secrets (API keys, credentials)
 */

import { TmuxEnvironment } from "@/domain/value-objects/TmuxEnvironment";
import {
  ProfileIsolation,
  type AgentProvider,
} from "@/domain/value-objects/ProfileIsolation";
import type { EnvironmentGateway } from "@/application/ports/EnvironmentGateway";

/**
 * Options for resolving the environment stack.
 */
export interface EnvironmentStackOptions {
  /** User ID for resolving preferences */
  userId: string;
  /** Optional folder ID for folder-specific environment */
  folderId?: string | null;
  /** Optional profile ID for profile isolation */
  profileId?: string | null;
  /** Optional agent provider for profile isolation */
  agentProvider?: AgentProvider;
  /** Whether to include secrets (default: true) */
  includeSecrets?: boolean;
}

/**
 * Resolved environment stack with individual layers and merged result.
 */
export interface EnvironmentStack {
  /** System defaults (HOME, USER, SHELL, PATH, TERM) */
  base: TmuxEnvironment;
  /** Folder-specific environment variables */
  folder: TmuxEnvironment;
  /** Profile isolation (XDG paths, agent config dirs) */
  profile: TmuxEnvironment;
  /** Secrets from configured providers */
  secrets: TmuxEnvironment;
  /** Final merged environment (all layers combined) */
  merged: TmuxEnvironment;
}

/**
 * Adapter interface for preferences service.
 * This allows the EnvironmentManager to be decoupled from the concrete implementation.
 */
export interface PreferencesAdapter {
  getEnvironmentForSession(
    userId: string,
    folderId?: string | null
  ): Promise<Record<string, string> | null>;
}

/**
 * Adapter interface for agent profile service.
 */
export interface AgentProfileAdapter {
  getProfile(
    profileId: string,
    userId: string
  ): Promise<{
    configDir: string;
    provider?: AgentProvider;
    sshKeyPath?: string;
    gitIdentity?: { name?: string; email?: string };
  } | null>;
}

/**
 * Adapter interface for secrets service.
 */
export interface SecretsAdapter {
  fetchSecretsForSession(
    userId: string,
    folderId?: string | null,
    profileId?: string | null
  ): Promise<Record<string, string> | null>;
}

export class EnvironmentManager {
  constructor(
    private readonly environmentGateway: EnvironmentGateway,
    private readonly preferencesAdapter: PreferencesAdapter,
    private readonly agentProfileAdapter: AgentProfileAdapter,
    private readonly secretsAdapter: SecretsAdapter
  ) {}

  /**
   * Resolve the full environment stack for a session.
   *
   * Returns individual layers for debugging/inspection and the merged result
   * for actual use.
   */
  async resolveStack(options: EnvironmentStackOptions): Promise<EnvironmentStack> {
    const { userId, folderId, profileId, agentProvider, includeSecrets = true } =
      options;

    // Layer 1: Base system defaults
    const base = this.environmentGateway.getSystemDefaults();

    // Layer 2: Folder environment
    let folder = TmuxEnvironment.empty();
    if (folderId) {
      const folderEnv = await this.preferencesAdapter.getEnvironmentForSession(
        userId,
        folderId
      );
      if (folderEnv) {
        folder = TmuxEnvironment.create(folderEnv);
      }
    }

    // Layer 3: Profile isolation (XDG variables)
    let profile = TmuxEnvironment.empty();
    if (profileId) {
      const profileData = await this.agentProfileAdapter.getProfile(
        profileId,
        userId
      );
      if (profileData) {
        const isolation = ProfileIsolation.create({
          profileDir: profileData.configDir,
          realHome: this.environmentGateway.getHome(),
          provider: agentProvider ?? profileData.provider ?? "all",
          sshKeyPath: profileData.sshKeyPath,
          gitIdentity: profileData.gitIdentity,
        });
        profile = isolation.toEnvironment();
      }
    }

    // Layer 4: Secrets
    let secrets = TmuxEnvironment.empty();
    if (includeSecrets) {
      const secretsData = await this.secretsAdapter.fetchSecretsForSession(
        userId,
        folderId,
        profileId
      );
      if (secretsData) {
        secrets = TmuxEnvironment.create(secretsData);
      }
    }

    // Merge all layers in order: base → folder → profile → secrets
    // Later layers override earlier ones ("other" precedence)
    const merged = base
      .merge(folder, "other")
      .merge(profile, "other")
      .merge(secrets, "other");

    return {
      base,
      folder,
      profile,
      secrets,
      merged,
    };
  }

  /**
   * Get the merged environment for a session.
   *
   * This is the primary method for session creation - returns just the
   * merged result without the individual layers.
   */
  async getEnvironmentForSession(
    userId: string,
    folderId?: string | null,
    profileId?: string | null,
    agentProvider?: AgentProvider
  ): Promise<TmuxEnvironment> {
    const stack = await this.resolveStack({
      userId,
      folderId,
      profileId,
      agentProvider,
      includeSecrets: true,
    });
    return stack.merged;
  }

  /**
   * Get environment for a session without secrets.
   *
   * Useful for display purposes where secrets shouldn't be shown.
   */
  async getEnvironmentWithoutSecrets(
    userId: string,
    folderId?: string | null,
    profileId?: string | null,
    agentProvider?: AgentProvider
  ): Promise<TmuxEnvironment> {
    const stack = await this.resolveStack({
      userId,
      folderId,
      profileId,
      agentProvider,
      includeSecrets: false,
    });
    return stack.merged;
  }
}
