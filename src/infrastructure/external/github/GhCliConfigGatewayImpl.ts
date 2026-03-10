/**
 * GhCliConfigGatewayImpl - Manages gh CLI configuration files on disk.
 *
 * Creates per-account config directories with hosts.yml files that the
 * gh CLI reads for authentication when GH_CONFIG_DIR is set.
 */

import { mkdir, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { getGhConfigsDir } from "@/lib/paths";
import type { GhCliConfigGateway } from "@/application/ports/GhCliConfigGateway";

export class GhCliConfigGatewayImpl implements GhCliConfigGateway {
  getConfigDir(providerAccountId: string): string {
    return join(getGhConfigsDir(), providerAccountId);
  }

  async writeHostsConfig(
    configDir: string,
    token: string,
    login: string
  ): Promise<void> {
    await mkdir(configDir, { recursive: true, mode: 0o700 });

    // gh CLI hosts.yml format
    const content = [
      "github.com:",
      `    oauth_token: ${token}`,
      `    user: ${login}`,
      "    git_protocol: https",
      "",
    ].join("\n");

    await writeFile(join(configDir, "hosts.yml"), content, { mode: 0o600 });
  }

  async removeConfig(configDir: string): Promise<void> {
    await rm(configDir, { recursive: true, force: true });
  }

  async isConfigValid(configDir: string): Promise<boolean> {
    try {
      await access(join(configDir, "hosts.yml"));
      return true;
    } catch {
      return false;
    }
  }
}
