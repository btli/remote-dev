/**
 * Centralized Application Paths Configuration
 *
 * All application data is stored in ~/.remote-dev by default.
 * This can be overridden with the RDV_DATA_DIR environment variable.
 *
 * Directory Structure:
 * ~/.remote-dev/
 * ├── sqlite.db          # SQLite database
 * ├── logs/              # Application logs
 * ├── profiles/          # Agent profiles
 * ├── projects/          # Worktree storage
 * ├── repos/             # Cloned repositories
 * ├── session-gitconfigs/ # Session-scoped gitconfigs for non-profile sessions
 * ├── recordings/        # Session recordings
 * ├── server/            # Server runtime files
 * └── rdv/               # rdv CLI runtime files (.local-key)
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

/**
 * Get the base data directory for the application.
 *
 * Priority:
 * 1. RDV_DATA_DIR environment variable (explicit override)
 * 2. ~/.remote-dev (default)
 */
export function getDataDir(): string {
  return process.env.RDV_DATA_DIR || join(homedir(), ".remote-dev");
}

/**
 * Get the database file path.
 *
 * Priority:
 * 1. DATABASE_URL environment variable (for explicit SQLite path)
 * 2. RDV_DATA_DIR/sqlite.db
 * 3. ~/.remote-dev/sqlite.db (default)
 */
export function getDatabasePath(): string {
  // If DATABASE_URL is set and is a file URL, use it directly
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    // Handle file:path format
    if (dbUrl.startsWith("file:")) {
      return dbUrl.slice(5); // Remove 'file:' prefix
    }
    return dbUrl;
  }

  return join(getDataDir(), "sqlite.db");
}

/**
 * Get the database URL for libsql client.
 * Always returns a file: URL format.
 */
export function getDatabaseUrl(): string {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    // Already in file: format
    if (dbUrl.startsWith("file:")) {
      return dbUrl;
    }
    // Convert bare path to file: URL
    return `file:${dbUrl}`;
  }

  return `file:${join(getDataDir(), "sqlite.db")}`;
}

/**
 * Get the logs directory path.
 */
export function getLogsDir(): string {
  return join(getDataDir(), "logs");
}

/**
 * Get the logs database file path.
 * Stored separately from the main application database.
 */
export function getLogsDatabasePath(): string {
  return join(getLogsDir(), "logs.db");
}

/**
 * Get the agent profiles directory path.
 */
export function getProfilesDir(): string {
  return join(getDataDir(), "profiles");
}

/**
 * Get the projects/worktrees directory path.
 */
export function getProjectsDir(): string {
  return join(getDataDir(), "projects");
}

/**
 * Get the cloned repositories directory path.
 */
export function getReposDir(): string {
  return join(getDataDir(), "repos");
}

/**
 * Get the gh CLI config directories path.
 * Each GitHub account gets its own subdirectory with hosts.yml.
 */
export function getGhConfigsDir(): string {
  return join(getDataDir(), "gh-configs");
}

/**
 * Get the session-scoped gitconfig directory path.
 * Non-profile sessions get a lightweight .gitconfig here for credential suppression.
 * Files are named {sessionId}.gitconfig and cleaned up on session close.
 */
export function getSessionGitconfigsDir(): string {
  return join(getDataDir(), "session-gitconfigs");
}

/**
 * Get the session recordings directory path.
 */
export function getRecordingsDir(): string {
  return join(getDataDir(), "recordings");
}

/**
 * Get the server runtime directory path.
 */
export function getServerDir(): string {
  return join(getDataDir(), "server");
}

/**
 * Get the rdv CLI runtime directory path.
 * Stores CLI-related runtime files like the local API key.
 */
export function getRdvDir(): string {
  return join(getDataDir(), "rdv");
}

/**
 * Get the releases directory path.
 * Stores versioned release installations for the update system.
 *
 * Structure:
 * ~/.remote-dev/releases/
 * ├── 0.2.1/        # Versioned release directories
 * ├── 0.3.0/
 * └── current -> 0.3.0  # Symlink to active release
 */
export function getReleasesDir(): string {
  return join(getDataDir(), "releases");
}

/**
 * Get the current release symlink path.
 * Points to the active release directory.
 */
export function getCurrentReleaseDir(): string {
  return join(getReleasesDir(), "current");
}

/**
 * Get the deploy state directory path.
 * Stores deploy lock, state JSON, and deploy log.
 */
export function getDeployDir(): string {
  return join(getDataDir(), "deploy");
}

/**
 * Get the builds directory path.
 * Stores blue/green build slots for blue-green deploys.
 */
export function getBuildsDir(): string {
  return join(getDataDir(), "builds");
}

/**
 * Get the update staging directory path.
 * Used as a temporary directory during the update process.
 */
export function getUpdateStagingDir(): string {
  return join(getDataDir(), ".update-staging");
}

/**
 * Get the update download directory path.
 * Used to store downloaded tarballs before extraction.
 */
export function getUpdateDownloadDir(): string {
  return join(getDataDir(), ".update-download");
}

/**
 * Ensure the data directory and essential subdirectories exist.
 * Called during application startup.
 */
export function ensureDataDirectories(): void {
  const dataDir = getDataDir();
  const dirs = [
    dataDir,
    getLogsDir(),
    getProfilesDir(),
    getProjectsDir(),
    getReposDir(),
    getGhConfigsDir(),
    getSessionGitconfigsDir(),
    getRecordingsDir(),
    getServerDir(),
    getRdvDir(),
    getReleasesDir(),
    getDeployDir(),
    getBuildsDir(),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Application paths configuration object.
 * Provides easy access to all path functions.
 */
export const AppPaths = {
  get dataDir() {
    return getDataDir();
  },
  get databasePath() {
    return getDatabasePath();
  },
  get databaseUrl() {
    return getDatabaseUrl();
  },
  get logsDir() {
    return getLogsDir();
  },
  get logsDatabasePath() {
    return getLogsDatabasePath();
  },
  get profilesDir() {
    return getProfilesDir();
  },
  get projectsDir() {
    return getProjectsDir();
  },
  get reposDir() {
    return getReposDir();
  },
  get ghConfigsDir() {
    return getGhConfigsDir();
  },
  get sessionGitconfigsDir() {
    return getSessionGitconfigsDir();
  },
  get recordingsDir() {
    return getRecordingsDir();
  },
  get serverDir() {
    return getServerDir();
  },
  get rdvDir() {
    return getRdvDir();
  },
  get releasesDir() {
    return getReleasesDir();
  },
  get currentReleaseDir() {
    return getCurrentReleaseDir();
  },
  get deployDir() {
    return getDeployDir();
  },
  get buildsDir() {
    return getBuildsDir();
  },
  get updateStagingDir() {
    return getUpdateStagingDir();
  },
  get updateDownloadDir() {
    return getUpdateDownloadDir();
  },
  ensureDirectories: ensureDataDirectories,
} as const;

export default AppPaths;
