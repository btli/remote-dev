import { NextResponse } from "next/server";
import { withAuth, errorResponse } from "@/lib/api";
import { getFsPromises } from "@/lib/dynamic-fs";
import { getProjectsDir } from "@/lib/paths";
import { validateBrowsePath } from "@/lib/directory-browse";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/directories/roots");

interface QuickRoot {
  id: string;
  label: string;
  path: string;
}

/**
 * Return whether a directory exists and is accessible.
 */
async function dirExists(path: string): Promise<boolean> {
  try {
    const fsp = await getFsPromises();
    const stat = await fsp.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * GET /api/directories/roots - Quick-access browse roots that exist on disk.
 *
 * Includes Home and Projects (`~/.remote-dev/projects`) only when they exist
 * on disk AND resolve inside the browse allowlist. A missing or out-of-allowlist
 * root is silently omitted rather than treated as an error.
 *
 * Returns:
 *   - roots: Array of { id, label, path }
 */
export const GET = withAuth(async () => {
  try {
    const roots: QuickRoot[] = [];

    const home = process.env.HOME;
    if (home && (await dirExists(home)) && (await validateBrowsePath(home))) {
      roots.push({ id: "home", label: "Home", path: home });
    }

    const projectsDir = getProjectsDir();
    if ((await dirExists(projectsDir)) && (await validateBrowsePath(projectsDir))) {
      roots.push({ id: "projects", label: "Projects", path: projectsDir });
    }

    return NextResponse.json({ roots });
  } catch (error) {
    log.error("Error resolving quick-access roots", { error: String(error) });
    return errorResponse("Failed to resolve roots", 500);
  }
});
