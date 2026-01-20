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
 * ├── recordings/        # Session recordings
 * └── server/            # Server runtime files
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

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
    getRecordingsDir(),
    getServerDir(),
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
  get profilesDir() {
    return getProfilesDir();
  },
  get projectsDir() {
    return getProjectsDir();
  },
  get reposDir() {
    return getReposDir();
  },
  get recordingsDir() {
    return getRecordingsDir();
  },
  get serverDir() {
    return getServerDir();
  },
  ensureDirectories: ensureDataDirectories,
} as const;

export default AppPaths;
