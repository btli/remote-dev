/**
 * SessionGitConfigGateway - Port for session-scoped git configuration file I/O.
 *
 * Abstracts the filesystem operations for writing and cleaning up
 * session-scoped .gitconfig files used by non-profile terminal sessions.
 */

export interface SessionGitConfigGateway {
  /**
   * Write a session-scoped .gitconfig file.
   * @param sessionId - The session UUID (used as filename)
   * @param content - The gitconfig content to write
   * @returns The absolute path to the written file
   */
  writeSessionGitConfig(sessionId: string, content: string): Promise<string>;

  /**
   * Remove a session-scoped .gitconfig file.
   * Silent if the file does not exist.
   * @param sessionId - The session UUID
   */
  removeSessionGitConfig(sessionId: string): Promise<void>;

  /**
   * Resolve the absolute path to the gh CLI binary.
   * Result is cached after the first successful resolution.
   * Falls back to bare "gh" if the binary cannot be found.
   */
  resolveGhBinaryPath(): Promise<string>;
}
