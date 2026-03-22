/**
 * GitCredentialConfig - Value object for git credential helper configuration.
 *
 * Encapsulates the configuration needed to suppress git credential prompts
 * and route authentication through the gh CLI credential helper.
 *
 * The key pattern is:
 *   [credential]
 *       helper =                              # Clear inherited chain (e.g., osxkeychain)
 *       helper = !/path/to/gh auth git-credential  # Set gh as the only helper
 *
 * The empty `helper =` clears the inherited credential helper chain (including
 * macOS osxkeychain), and the second line sets gh as the sole helper. This is
 * the same pattern used by `gh auth setup-git`.
 *
 * When combined with GH_CONFIG_DIR (set by GitHubAccountEnvironment), the gh
 * credential helper automatically authenticates as the correct GitHub account.
 */

import { InvalidValueError } from "../errors/DomainError";
import { TmuxEnvironment } from "./TmuxEnvironment";

export class GitCredentialConfig {
  private constructor(private readonly ghBinaryPath: string) {}

  /**
   * Create a GitCredentialConfig with a resolved gh binary path.
   * @throws InvalidValueError if ghBinaryPath is empty
   */
  static create(ghBinaryPath: string): GitCredentialConfig {
    if (!ghBinaryPath || typeof ghBinaryPath !== "string") {
      throw new InvalidValueError(
        "GitCredentialConfig.ghBinaryPath",
        ghBinaryPath,
        "Must be a non-empty string"
      );
    }
    return new GitCredentialConfig(ghBinaryPath);
  }

  /**
   * Generate the [credential] section for a .gitconfig file.
   *
   * The empty `helper =` line clears the inherited credential helper chain
   * (including macOS osxkeychain), ensuring only the gh helper is used.
   */
  toGitConfigSection(): string {
    return [
      "[credential]",
      "\thelper =",
      `\thelper = !${this.ghBinaryPath} auth git-credential`,
      "",
    ].join("\n");
  }

  /**
   * Base environment variables to inject into every session.
   * Prevents git from prompting for credentials interactively.
   */
  toBaseEnvironment(): TmuxEnvironment {
    return TmuxEnvironment.create({
      GIT_TERMINAL_PROMPT: "0",
    });
  }

  /**
   * Full environment for a non-profile session.
   * Includes GIT_CONFIG_GLOBAL pointing to a session-scoped gitconfig.
   */
  toSessionEnvironment(gitconfigPath: string): TmuxEnvironment {
    if (!gitconfigPath?.startsWith("/")) {
      throw new InvalidValueError(
        "GitCredentialConfig.gitconfigPath",
        gitconfigPath,
        "Must be an absolute path"
      );
    }

    return this.toBaseEnvironment().with("GIT_CONFIG_GLOBAL", gitconfigPath);
  }

  getGhBinaryPath(): string {
    return this.ghBinaryPath;
  }

  equals(other: GitCredentialConfig): boolean {
    return this.ghBinaryPath === other.ghBinaryPath;
  }
}
