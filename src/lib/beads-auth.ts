/**
 * Beads API authorization helpers.
 *
 * Validates that a projectPath belongs to the authenticated user's folders
 * and has a valid beads installation.
 */

import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { db } from "@/db";
import { sessionFolders, folderPreferences, userSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("BeadsAuth");

/**
 * Validate that a projectPath is authorized for the given user.
 *
 * Checks:
 * 1. Path is absolute and resolves cleanly (no traversal)
 * 2. The path has a .beads/ directory (is a beads-enabled project)
 * 3. The path matches one of the user's folder defaultWorkingDirectory values,
 *    or their global defaultWorkingDirectory setting
 *
 * Returns the resolved (canonical) path on success, null on failure.
 */
export async function validateProjectPath(
  userId: string,
  projectPath: string
): Promise<string | null> {
  // Expand tilde to home directory before resolving
  let expandedPath = projectPath;
  if (projectPath.startsWith("~/") || projectPath === "~") {
    const home = homedir();
    expandedPath = projectPath === "~" ? home : join(home, projectPath.slice(2));
  }

  // Resolve to absolute canonical path
  const resolved = resolve(expandedPath);

  // Must have a .beads/ directory
  if (!existsSync(resolve(resolved, ".beads"))) {
    log.debug("Project path has no .beads directory", { projectPath: resolved, userId });
    return null;
  }

  // Check if it matches the user's global defaultWorkingDirectory
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  if (settings?.defaultWorkingDirectory && resolve(settings.defaultWorkingDirectory) === resolved) {
    return resolved;
  }

  // Check if it matches any of the user's folder defaultWorkingDirectory values
  const folders = await db.query.sessionFolders.findMany({
    where: eq(sessionFolders.userId, userId),
    columns: { id: true },
  });

  if (folders.length > 0) {
    const folderIds = folders.map((f) => f.id);
    const prefs = await db.query.folderPreferences.findMany({
      where: and(
        eq(folderPreferences.userId, userId),
      ),
      columns: { folderId: true, defaultWorkingDirectory: true },
    });

    for (const pref of prefs) {
      if (
        pref.defaultWorkingDirectory &&
        folderIds.includes(pref.folderId) &&
        resolve(pref.defaultWorkingDirectory) === resolved
      ) {
        return resolved;
      }
    }
  }

  log.warn("Project path not authorized for user", { projectPath: resolved, userId });
  return null;
}
