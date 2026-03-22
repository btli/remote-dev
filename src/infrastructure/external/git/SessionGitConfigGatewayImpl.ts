/**
 * SessionGitConfigGatewayImpl - Manages session-scoped git configuration files.
 *
 * Writes lightweight .gitconfig files for non-profile sessions to suppress
 * credential prompts and configure the gh credential helper. Files are stored
 * in ~/.remote-dev/session-gitconfigs/{sessionId}.gitconfig and cleaned up
 * when the session closes.
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { getSessionGitconfigsDir } from "@/lib/paths";
import type { SessionGitConfigGateway } from "@/application/ports/SessionGitConfigGateway";

const execFile = promisify(execFileCb);

export class SessionGitConfigGatewayImpl implements SessionGitConfigGateway {
  private cachedGhPath: string | null = null;

  async writeSessionGitConfig(
    sessionId: string,
    content: string
  ): Promise<string> {
    const dir = getSessionGitconfigsDir();
    await mkdir(dir, { recursive: true });
    const configPath = join(dir, `${sessionId}.gitconfig`);
    await writeFile(configPath, content, { mode: 0o600 });
    return configPath;
  }

  async removeSessionGitConfig(sessionId: string): Promise<void> {
    const configPath = join(getSessionGitconfigsDir(), `${sessionId}.gitconfig`);
    await rm(configPath, { force: true });
  }

  async resolveGhBinaryPath(): Promise<string> {
    if (this.cachedGhPath) return this.cachedGhPath;

    try {
      const { stdout } = await execFile("which", ["gh"]);
      const resolved = stdout.trim();
      if (resolved) {
        this.cachedGhPath = resolved;
        return resolved;
      }
    } catch {
      // gh not installed — fall back to bare command
    }

    this.cachedGhPath = "gh";
    return "gh";
  }
}
