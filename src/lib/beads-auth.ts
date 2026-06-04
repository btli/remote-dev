/**
 * Beads API authorization helpers.
 *
 * Validates that a projectPath belongs to the authenticated user's folders.
 */

import { runtimeResolve as resolve, runtimeJoin as join } from "@/lib/dynamic-fs";
import { homedir } from "node:os";
import { db } from "@/db";
import { projects, nodePreferences, userSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("BeadsAuth");

/**
 * Validate that a projectPath is authorized for the given user.
 *
 * This validates path ownership only — whether the path has beads initialized
 * (a `.beads/` directory) is NOT an authorization concern and is reported
 * separately by the route layer.
 *
 * Checks:
 * 1. Path is absolute and resolves cleanly (no traversal)
 * 2. The path matches one of the user's folder defaultWorkingDirectory values,
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

  // Check if it matches the user's global defaultWorkingDirectory
  const settings = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  if (settings?.defaultWorkingDirectory && resolve(settings.defaultWorkingDirectory) === resolved) {
    return resolved;
  }

  // Check if it matches any of the user's project defaultWorkingDirectory values
  const userProjects = await db.query.projects.findMany({
    where: eq(projects.userId, userId),
    columns: { id: true },
  });

  if (userProjects.length > 0) {
    const projectIds = new Set(userProjects.map((p) => p.id));
    const prefs = await db.query.nodePreferences.findMany({
      where: and(
        eq(nodePreferences.userId, userId),
        eq(nodePreferences.ownerType, "project")
      ),
      columns: { ownerId: true, defaultWorkingDirectory: true },
    });

    for (const pref of prefs) {
      if (
        pref.defaultWorkingDirectory &&
        projectIds.has(pref.ownerId) &&
        resolve(pref.defaultWorkingDirectory) === resolved
      ) {
        return resolved;
      }
    }
  }

  log.warn("Project path not authorized for user", { projectPath: resolved, userId });
  return null;
}
