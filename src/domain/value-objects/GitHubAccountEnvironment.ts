/**
 * GitHubAccountEnvironment - Value object for GitHub account environment injection.
 *
 * Encapsulates the environment variables needed to authenticate with GitHub
 * in a terminal session: GH_TOKEN for API access and GH_CONFIG_DIR for gh CLI config.
 *
 * Parallel to ProfileIsolation, which generates XDG-based isolation vars.
 */

import { InvalidValueError } from "../errors/DomainError";
import { TmuxEnvironment } from "./TmuxEnvironment";

export class GitHubAccountEnvironment {
  private constructor(
    private readonly accessToken: string,
    private readonly configDir: string,
    private readonly login: string | null
  ) {}

  static create(
    accessToken: string,
    configDir: string,
    login?: string | null
  ): GitHubAccountEnvironment {
    if (!accessToken) {
      throw new InvalidValueError("GitHubAccountEnvironment.accessToken", "(redacted)", "Must be a non-empty string");
    }
    if (!configDir?.startsWith("/")) {
      throw new InvalidValueError("GitHubAccountEnvironment.configDir", configDir, "Must be an absolute path");
    }
    return new GitHubAccountEnvironment(accessToken, configDir, login ?? null);
  }

  toEnvironment(): TmuxEnvironment {
    const vars: Record<string, string> = {
      GH_TOKEN: this.accessToken,
      GH_CONFIG_DIR: this.configDir,
    };

    if (this.login) {
      vars.GITHUB_USER = this.login;
    }

    return TmuxEnvironment.create(vars);
  }

  getConfigDir(): string {
    return this.configDir;
  }

  equals(other: GitHubAccountEnvironment): boolean {
    return this.configDir === other.configDir;
  }
}
