/**
 * GhCliConfigGateway - Port interface for managing gh CLI configuration files.
 *
 * The gh CLI reads authentication from $GH_CONFIG_DIR/hosts.yml.
 * Each GitHub account gets its own isolated config directory.
 */

export interface GhCliConfigGateway {
  /** Write hosts.yml for a GitHub account, creating the directory if needed. */
  writeHostsConfig(configDir: string, token: string, login: string): Promise<void>;
  removeConfig(configDir: string): Promise<void>;
  isConfigValid(configDir: string): Promise<boolean>;

  /** Compute the config directory path for a given account (pure, no I/O). */
  getConfigDir(providerAccountId: string): string;
}
